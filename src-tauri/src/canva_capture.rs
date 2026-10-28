//! Pictures of a public Canva design's pages, used as the operator's slide
//! thumbnails. A muted window outside every display opens the design's public
//! embed page (the same page the output shows) and WebView2 takes a picture of
//! what it draws at each page. Nothing else is read from Canva, and the window
//! has no access to the app: no capability names it.
//!
//! The operator window chooses the viewer size; it makes the viewer taller
//! than the design so Canva's page bar falls below it, and crops the bar away.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, mpsc};
use std::time::{Duration, Instant};

use sanctuary_core::{Error, Result};
use tauri::ipc::Response;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::display::DisplayManager;
use crate::state::{blocking, tauri_err};

pub const CAPTURE_LABEL: &str = "canva-capture";

/// The design has just opened; its first picture waits for pictures and fonts.
static JUST_OPENED: AtomicBool = AtomicBool::new(false);

/// True for `https://www.canva.com/design/<id>/<token>/view?embed`, the only
/// address the capture window may open.
fn is_embed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://www.canva.com/design/").and_then(|r| r.strip_suffix("/view?embed")) else {
        return false;
    };
    let part = |s: &str| (4..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    matches!(rest.split_once('/'), Some((id, token)) if part(id) && part(token))
}

fn window(app: &AppHandle) -> Result<WebviewWindow> {
    app.get_webview_window(CAPTURE_LABEL).ok_or_else(|| Error::Other("The Canva design is not open for page pictures.".into()))
}

/// Opens the design at page 1 in a viewer of `width` × `height` CSS pixels and
/// waits until it has loaded.
#[tauri::command]
pub async fn canva_capture_open(app: AppHandle, url: String, width: f64, height: f64) -> Result<()> {
    if !is_embed_url(&url) {
        return Err(Error::validation("This is not a public Canva design link."));
    }
    if let Some(old) = app.get_webview_window(CAPTURE_LABEL) {
        old.destroy().map_err(tauri_err)?;
    }
    let target: tauri::Url = format!("{url}#1").parse().map_err(|_| Error::validation("This is not a public Canva design link."))?;
    // To the right of every display, so it is never seen.
    let right = app.available_monitors().map_err(tauri_err)?.iter().map(|m| m.position().x + m.size().width as i32).max().unwrap_or(0);
    let manager = app.state::<DisplayManager>();
    let (loaded_tx, loaded) = mpsc::channel();
    let loaded_tx = Mutex::new(loaded_tx);
    let mut builder = WebviewWindowBuilder::new(&app, CAPTURE_LABEL, WebviewUrl::External(target))
        .title("SanctuaryFlow – Canva page pictures")
        .inner_size(width.clamp(320.0, 1920.0), height.clamp(240.0, 2400.0))
        .position(f64::from(right) + 400.0, 0.0)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .background_color(tauri::window::Color(0, 0, 0, 255))
        .additional_browser_args(&manager.browser_args)
        .on_page_load(move |_, payload| {
            if payload.event() == PageLoadEvent::Finished
                && let Ok(tx) = loaded_tx.lock()
            {
                let _ = tx.send(());
            }
        });
    if let Some(dir) = &manager.webview_data_dir {
        builder = builder.data_directory(dir.clone());
    }
    let window = builder.build().map_err(tauri_err)?;
    mute(&window)?;
    JUST_OPENED.store(true, Ordering::SeqCst);
    blocking(move || {
        loaded.recv_timeout(Duration::from_secs(45)).map_err(|_| Error::Other("Canva did not open the design in time. Check the internet connection.".into()))
    })
    .await
}

/// Turns to `page` and returns a JPEG picture of the viewer once the page has
/// settled (two pictures in a row are the same, or after a few seconds).
#[tauri::command]
pub async fn canva_capture_page(app: AppHandle, page: u32) -> Result<Response> {
    let window = window(&app)?;
    let mut url = window.url().map_err(tauri_err)?;
    let fragment = page.max(1).to_string();
    if url.fragment() != Some(fragment.as_str()) {
        url.set_fragment(Some(&fragment));
        window.navigate(url).map_err(tauri_err)?;
    }
    let just_opened = JUST_OPENED.swap(false, Ordering::SeqCst);
    blocking(move || {
        std::thread::sleep(Duration::from_millis(if just_opened { 2500 } else { 700 }));
        let deadline = Instant::now() + Duration::from_secs(8);
        let mut last = capture_jpeg(&window)?;
        loop {
            std::thread::sleep(Duration::from_millis(400));
            let next = capture_jpeg(&window)?;
            if next == last || Instant::now() > deadline {
                return Ok(Response::new(next));
            }
            last = next;
        }
    })
    .await
}

#[tauri::command]
pub async fn canva_capture_close(app: AppHandle) -> Result<()> {
    if let Some(w) = app.get_webview_window(CAPTURE_LABEL) {
        w.destroy().map_err(tauri_err)?;
    }
    Ok(())
}

/// A design with sound must never play it from the hidden window.
#[cfg(windows)]
fn mute(window: &WebviewWindow) -> Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
    use windows::core::Interface;
    window
        .with_webview(|webview| unsafe {
            if let Ok(core) = webview.controller().CoreWebView2()
                && let Ok(core) = core.cast::<ICoreWebView2_8>()
            {
                let _ = core.SetIsMuted(true);
            }
        })
        .map_err(tauri_err)
}

#[cfg(not(windows))]
fn mute(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

#[cfg(windows)]
fn capture_jpeg(window: &WebviewWindow) -> Result<Vec<u8>> {
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    use windows::Win32::System::Com::{IStream, STREAM_SEEK_END, STREAM_SEEK_SET};

    unsafe fn read_all(stream: &IStream) -> windows::core::Result<Vec<u8>> {
        let mut size = 0u64;
        unsafe {
            stream.Seek(0, STREAM_SEEK_END, Some(&mut size))?;
            stream.Seek(0, STREAM_SEEK_SET, None)?;
            let mut bytes = vec![0u8; size as usize];
            let mut read = 0u32;
            stream.Read(bytes.as_mut_ptr().cast(), size as u32, Some(&mut read)).ok()?;
            bytes.truncate(read as usize);
            Ok(bytes)
        }
    }

    let (tx, rx) = mpsc::channel::<std::result::Result<Vec<u8>, String>>();
    window
        .with_webview(move |webview| {
            let failed = tx.clone();
            let started = (|| unsafe {
                let core = webview.controller().CoreWebView2()?;
                let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)?;
                let written = stream.clone();
                let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                    let _ = tx.send(result.and_then(|()| read_all(&written)).map_err(|e| e.message()));
                    Ok(())
                }));
                core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG, &stream, &handler)
            })();
            if let Err(e) = started {
                let _ = failed.send(Err(e.message()));
            }
        })
        .map_err(tauri_err)?;
    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(bytes)) if !bytes.is_empty() => Ok(bytes),
        Ok(Ok(_)) => Err(Error::Other("The page picture came out empty.".into())),
        Ok(Err(e)) => Err(Error::Other(format!("The page picture could not be taken: {e}"))),
        Err(_) => Err(Error::Other("The page picture took too long.".into())),
    }
}

#[cfg(not(windows))]
fn capture_jpeg(_window: &WebviewWindow) -> Result<Vec<u8>> {
    Err(Error::Unsupported("Canva page pictures are taken on Windows only.".into()))
}

#[cfg(test)]
mod tests {
    use super::is_embed_url;

    #[test]
    fn only_canva_embed_addresses_are_opened() {
        assert!(is_embed_url("https://www.canva.com/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/view?embed"));
        assert!(!is_embed_url("https://www.canva.com/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/view"));
        assert!(!is_embed_url("https://www.canva.com/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/edit?embed"));
        assert!(!is_embed_url("https://www.canva.com/design/DAGatIO09_0/a/b/view?embed"));
        assert!(!is_embed_url("https://evil.example/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/view?embed"));
        assert!(!is_embed_url("https://www.canva.com.evil.example/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/view?embed"));
    }
}
