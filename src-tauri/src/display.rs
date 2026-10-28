//! Display detection and the projector output window.
//!
//! The projector window is a separate native window (not a browser popup).
//! A watcher notices displays being connected or disconnected: if the
//! projector's display disappears the window is hidden (so it never covers
//! the operator screen) while keeping its content, and it returns to the
//! display when it reconnects.

use std::sync::Mutex;
use std::time::Duration;

use sanctuary_core::{Error, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use crate::presentation::{MAIN_LABEL, PROJECTOR_LABEL};

pub const EVENT_DISPLAYS_CHANGED: &str = "displays://changed";
pub const EVENT_PROJECTOR_CHANGED: &str = "projector://changed";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    /// Stable-ish identifier (the Windows device name, e.g. `\\.\DISPLAY2`).
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectorMode {
    /// Full screen on the chosen display.
    Fullscreen,
    /// A movable window (single-display rehearsal or testing).
    Window,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectorStatus {
    pub open: bool,
    pub visible: bool,
    pub mode: Option<ProjectorMode>,
    pub display_id: Option<String>,
    /// The chosen display is disconnected; output is hidden until it returns.
    pub waiting_for_display: bool,
}

#[derive(Default)]
pub struct ProjectorTarget {
    pub display_id: Option<String>,
    pub mode: Option<ProjectorMode>,
    pub waiting: bool,
}

pub struct DisplayManager {
    pub target: Mutex<ProjectorTarget>,
    pub browser_args: String,
    /// Must match the operator window's WebView2 profile folder.
    pub webview_data_dir: Option<std::path::PathBuf>,
}

fn info(m: &Monitor, primary: Option<&Monitor>, index: usize) -> DisplayInfo {
    let id = m.name().cloned().unwrap_or_else(|| format!("display-{index}"));
    let pos = m.position();
    let size = m.size();
    let is_primary = primary.map(|p| p.name() == m.name() && p.position() == pos).unwrap_or(index == 0);
    let friendly = format!(
        "Display {} — {}×{}{}",
        index + 1,
        size.width,
        size.height,
        if is_primary { " (primary)" } else { "" }
    );
    DisplayInfo {
        id,
        name: friendly,
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        scale_factor: m.scale_factor(),
        is_primary,
    }
}

pub fn list(app: &AppHandle) -> Result<Vec<DisplayInfo>> {
    let monitors = app.available_monitors().map_err(crate::state::tauri_err)?;
    let primary = app.primary_monitor().map_err(crate::state::tauri_err)?;
    Ok(monitors.iter().enumerate().map(|(i, m)| info(m, primary.as_ref(), i)).collect())
}

fn find_monitor(app: &AppHandle, id: &str) -> Result<Option<Monitor>> {
    Ok(app.available_monitors().map_err(crate::state::tauri_err)?.into_iter().find(|m| m.name().map(|n| n == id).unwrap_or(false)))
}

/// The display to use when none is chosen: the first non-primary display.
pub fn default_output(displays: &[DisplayInfo]) -> Option<&DisplayInfo> {
    displays.iter().find(|d| !d.is_primary)
}

pub fn status(app: &AppHandle, manager: &DisplayManager) -> ProjectorStatus {
    let window = app.get_webview_window(PROJECTOR_LABEL);
    let target = manager.target.lock().unwrap_or_else(|p| p.into_inner());
    ProjectorStatus {
        open: window.is_some(),
        visible: window.as_ref().and_then(|w| w.is_visible().ok()).unwrap_or(false),
        mode: target.mode,
        display_id: target.display_id.clone(),
        waiting_for_display: target.waiting,
    }
}

fn place_on(window: &tauri::WebviewWindow, monitor: &Monitor, mode: ProjectorMode) -> Result<()> {
    let pos = *monitor.position();
    let size = *monitor.size();
    let e = crate::state::tauri_err;
    match mode {
        ProjectorMode::Fullscreen => {
            window.set_fullscreen(false).map_err(e)?;
            window.set_position(PhysicalPosition::new(pos.x, pos.y)).map_err(e)?;
            window.set_size(PhysicalSize::new(size.width, size.height)).map_err(e)?;
            window.set_fullscreen(true).map_err(e)?;
        }
        ProjectorMode::Window => {
            window.set_fullscreen(false).map_err(e)?;
            let w = (size.width / 2).max(640);
            let h = w * 9 / 16;
            window.set_size(PhysicalSize::new(w, h)).map_err(e)?;
            window
                .set_position(PhysicalPosition::new(pos.x + (size.width as i32 - w as i32) / 2, pos.y + (size.height as i32 - h as i32) / 3))
                .map_err(e)?;
        }
    }
    Ok(())
}

/// Opens (or moves) the projector window onto a display.
pub fn open_projector(app: &AppHandle, manager: &DisplayManager, display_id: Option<String>, mode: ProjectorMode) -> Result<ProjectorStatus> {
    let displays = list(app)?;
    let chosen = match &display_id {
        Some(id) => displays.iter().find(|d| &d.id == id).or_else(|| default_output(&displays)),
        None => default_output(&displays),
    }
    .or_else(|| displays.first())
    .cloned()
    .ok_or_else(|| Error::Other("No display was found.".into()))?;
    let monitor = find_monitor(app, &chosen.id)?.ok_or_else(|| Error::Other("The selected display is not connected.".into()))?;

    let window = match app.get_webview_window(PROJECTOR_LABEL) {
        Some(w) => w,
        None => {
            let mut b = WebviewWindowBuilder::new(app, PROJECTOR_LABEL, WebviewUrl::App("projector.html".into()))
                .title("SanctuaryFlow Output")
                .decorations(mode == ProjectorMode::Window)
                .visible(false)
                .focused(false)
                .background_color(tauri::window::Color(0, 0, 0, 255))
                .additional_browser_args(&manager.browser_args);
            if let Some(dir) = &manager.webview_data_dir {
                b = b.data_directory(dir.clone());
            }
            b.build().map_err(crate::state::tauri_err)?
        }
    };
    window.set_decorations(mode == ProjectorMode::Window).map_err(crate::state::tauri_err)?;
    place_on(&window, &monitor, mode)?;
    window.show().map_err(crate::state::tauri_err)?;
    // Keep keyboard focus with the operator.
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.set_focus();
    }
    {
        let mut t = manager.target.lock().unwrap_or_else(|p| p.into_inner());
        t.display_id = Some(chosen.id.clone());
        t.mode = Some(mode);
        t.waiting = false;
    }
    let s = status(app, manager);
    let _ = app.emit_to(MAIN_LABEL, EVENT_PROJECTOR_CHANGED, &s);
    Ok(s)
}

pub fn close_projector(app: &AppHandle, manager: &DisplayManager) -> Result<()> {
    if let Some(w) = app.get_webview_window(PROJECTOR_LABEL) {
        w.destroy().map_err(crate::state::tauri_err)?;
    }
    *manager.target.lock().unwrap_or_else(|p| p.into_inner()) = ProjectorTarget::default();
    let _ = app.emit_to(MAIN_LABEL, EVENT_PROJECTOR_CHANGED, &status(app, manager));
    Ok(())
}

/// Polls the display configuration and reacts to changes.
pub fn start_watcher(app: AppHandle) {
    std::thread::Builder::new()
        .name("display-watcher".into())
        .spawn(move || {
            let mut last: Vec<DisplayInfo> = list(&app).unwrap_or_default();
            loop {
                std::thread::sleep(Duration::from_secs(2));
                let Ok(current) = list(&app) else { continue };
                if current == last {
                    continue;
                }
                log::info!("display configuration changed: {} display(s)", current.len());
                let _ = app.emit_to(MAIN_LABEL, EVENT_DISPLAYS_CHANGED, &current);
                let manager = app.state::<DisplayManager>();
                let (target_id, mode, waiting) = {
                    let t = manager.target.lock().unwrap_or_else(|p| p.into_inner());
                    (t.display_id.clone(), t.mode, t.waiting)
                };
                if let (Some(id), Some(mode), Some(window)) = (target_id, mode, app.get_webview_window(PROJECTOR_LABEL)) {
                    let present = current.iter().any(|d| d.id == id);
                    if !present && !waiting && mode == ProjectorMode::Fullscreen {
                        // Hide rather than let Windows drop the output onto the operator screen.
                        let _ = window.set_fullscreen(false);
                        let _ = window.hide();
                        manager.target.lock().unwrap_or_else(|p| p.into_inner()).waiting = true;
                        log::warn!("projector display {id} disconnected; output hidden until it returns");
                    } else if present && waiting {
                        if let Ok(Some(monitor)) = find_monitor(&app, &id)
                            && place_on(&window, &monitor, mode).is_ok() {
                                let _ = window.show();
                                manager.target.lock().unwrap_or_else(|p| p.into_inner()).waiting = false;
                                log::info!("projector display {id} reconnected; output restored");
                            }
                    } else if present && mode == ProjectorMode::Fullscreen {
                        // Resolution or position changed: re-fit.
                        if let Ok(Some(monitor)) = find_monitor(&app, &id) {
                            let _ = place_on(&window, &monitor, mode);
                        }
                    }
                    let _ = app.emit_to(MAIN_LABEL, EVENT_PROJECTOR_CHANGED, &status(&app, &manager));
                }
                last = current;
            }
        })
        .expect("spawn display watcher");
}
