//! Converts PowerPoint files to slide pictures with Microsoft PowerPoint
//! itself, through its COM automation interface (the same one Office macros
//! use), so every font, picture and layout looks exactly as designed. Without
//! PowerPoint the operator is asked to save the presentation as PDF instead;
//! nothing is guessed.

use std::path::{Path, PathBuf};
use std::time::Duration;

use sanctuary_core::{Error, Result};

/// Slides exported from one presentation, in order.
pub struct Exported {
    pub slides: Vec<ExportedSlide>,
    pub hidden: u32,
}

pub struct ExportedSlide {
    pub path: PathBuf,
    pub notes: String,
}

/// True when PowerPoint is installed for this Windows user.
#[cfg(windows)]
pub fn powerpoint_available() -> bool {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{HKEY, HKEY_CLASSES_ROOT, KEY_READ, RegCloseKey, RegOpenKeyExW};
    let name: Vec<u16> = "PowerPoint.Application\\CLSID".encode_utf16().chain(Some(0)).collect();
    let mut key: HKEY = std::ptr::null_mut();
    // SAFETY: `name` is NUL-terminated and `key` is a valid out pointer; the
    // key is closed straight away.
    unsafe {
        if RegOpenKeyExW(HKEY_CLASSES_ROOT, name.as_ptr(), 0, KEY_READ, &mut key) == ERROR_SUCCESS {
            RegCloseKey(key);
            return true;
        }
    }
    false
}

#[cfg(not(windows))]
pub fn powerpoint_available() -> bool {
    false
}

const TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// Exports every visible slide of `source` as a PNG (up to full HD) into
/// `out_dir`, with each slide's speaker notes.
pub fn export_with_powerpoint(source: &Path, out_dir: &Path) -> Result<Exported> {
    if !powerpoint_available() {
        return Err(Error::Unsupported(
            "Microsoft PowerPoint is not installed on this computer, so PowerPoint files can't be converted here. \
             Save or download the presentation as PDF (PowerPoint, Google Slides, Keynote and Canva can all do this) and import the PDF."
                .into(),
        ));
    }
    let source = std::path::absolute(source)?;
    if !source.is_file() {
        return Err(Error::not_found(format!("{} could not be found.", source.display())));
    }
    std::fs::create_dir_all(out_dir)?;
    let out = std::path::absolute(out_dir)?;

    // COM objects belong to the thread that created them, so PowerPoint is
    // driven from its own thread; a PowerPoint that hangs (for example on a
    // message box) cannot block the app.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("powerpoint-export".into())
        .spawn(move || {
            let _ = tx.send(com::export(&source, &out));
        })
        .map_err(|e| Error::Other(format!("The PowerPoint conversion could not be started: {e}")))?;
    match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(exported)) => Ok(exported),
        Ok(Err(message)) => Err(Error::validation(format!("PowerPoint could not open or convert the file: {message}"))),
        Err(_) => Err(Error::Other(
            "PowerPoint took too long to convert the presentation. Close any PowerPoint messages that may be waiting, or import a PDF instead.".into(),
        )),
    }
}

#[cfg(not(windows))]
mod com {
    pub fn export(_: &std::path::Path, _: &std::path::Path) -> Result<super::Exported, String> {
        Err("PowerPoint is only available on Windows.".into())
    }
}

#[cfg(windows)]
mod com {
    use std::mem::ManuallyDrop;
    use std::path::Path;

    use windows::Win32::System::Com::{
        CLSCTX_LOCAL_SERVER, CLSIDFromProgID, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize, DISPATCH_FLAGS, DISPATCH_METHOD,
        DISPATCH_PROPERTYGET, DISPPARAMS, EXCEPINFO, IDispatch,
    };
    use windows::Win32::System::Variant::VARIANT;
    use windows::core::{BSTR, GUID, PCWSTR, w};

    use super::{Exported, ExportedSlide};

    // Office's "tri-state" booleans.
    const MSO_TRUE: i32 = -1;
    const MSO_FALSE: i32 = 0;

    /// A late-bound COM object, called by member name like a macro would.
    struct Object(IDispatch);

    impl Object {
        fn call(&self, name: &str, args: &[VARIANT]) -> Result<VARIANT, String> {
            let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
            let names = [PCWSTR(wide.as_ptr())];
            let mut id = 0i32;
            // SAFETY: `names` points at one NUL-terminated string that outlives the call.
            unsafe { self.0.GetIDsOfNames(&GUID::zeroed(), names.as_ptr(), 1, 0, &mut id) }.map_err(|e| format!("{name}: {}", e.message()))?;
            // DISPPARAMS lists the arguments last to first.
            let mut reversed: Vec<VARIANT> = args.iter().rev().cloned().collect();
            let params = DISPPARAMS { rgvarg: reversed.as_mut_ptr(), rgdispidNamedArgs: std::ptr::null_mut(), cArgs: reversed.len() as u32, cNamedArgs: 0 };
            let mut result = VARIANT::default();
            let mut info = EXCEPINFO::default();
            let flags = DISPATCH_FLAGS(DISPATCH_METHOD.0 | DISPATCH_PROPERTYGET.0);
            // SAFETY: every pointer refers to a live local for the duration of the call.
            let outcome = unsafe { self.0.Invoke(id, &GUID::zeroed(), 0, flags, &params, Some(&mut result), Some(&mut info), None) };
            // The exception strings are owned by the caller.
            let description = info.bstrDescription.to_string();
            unsafe {
                ManuallyDrop::drop(&mut info.bstrSource);
                ManuallyDrop::drop(&mut info.bstrDescription);
                ManuallyDrop::drop(&mut info.bstrHelpFile);
            }
            outcome.map_err(|e| if description.trim().is_empty() { format!("{name}: {}", e.message()) } else { description.trim().to_string() })?;
            Ok(result)
        }

        fn object(&self, name: &str, args: &[VARIANT]) -> Result<Object, String> {
            let v = self.call(name, args)?;
            IDispatch::try_from(&v).map(Object).map_err(|_| format!("{name} did not return an object."))
        }

        fn int(&self, name: &str) -> Result<i32, String> {
            i32::try_from(&self.call(name, &[])?).map_err(|_| format!("{name} is not a number."))
        }

        fn float(&self, name: &str) -> Result<f64, String> {
            f64::try_from(&self.call(name, &[])?).map_err(|_| format!("{name} is not a number."))
        }

        fn text(&self, name: &str) -> Result<String, String> {
            BSTR::try_from(&self.call(name, &[])?).map(|b| b.to_string()).map_err(|_| format!("{name} is not text."))
        }
    }

    fn notes_of(slide: &Object) -> String {
        // Placeholder 2 of the notes page is the speaker notes body.
        (|| -> Result<String, String> {
            slide.object("NotesPage", &[])?.object("Shapes", &[])?.object("Placeholders", &[])?.object("Item", &[2i32.into()])?.object("TextFrame", &[])?.object("TextRange", &[])?.text("Text")
        })()
        .unwrap_or_default()
        .replace(['\r', '\u{b}'], "\n")
    }

    fn run(app: &Object, source: &Path, out: &Path) -> Result<Exported, String> {
        let presentations = app.object("Presentations", &[])?;
        // Open(FileName, ReadOnly, Untitled, WithWindow)
        let path = BSTR::from(source.to_string_lossy().as_ref());
        let pres = presentations.object("Open", &[path.into(), MSO_TRUE.into(), MSO_FALSE.into(), MSO_FALSE.into()])?;
        let result = (|| {
            let setup = pres.object("PageSetup", &[])?;
            let (w, h) = (setup.float("SlideWidth")?, setup.float("SlideHeight")?);
            let (mut width, mut height) = (((w / h) * 1080.0).round() as i32, 1080);
            if width > 1920 {
                width = 1920;
                height = ((h / w) * 1920.0).round() as i32;
            }
            let slides = pres.object("Slides", &[])?;
            let count = slides.int("Count")?;
            let mut exported = Exported { slides: Vec::new(), hidden: 0 };
            for i in 1..=count {
                let slide = slides.object("Item", &[i.into()])?;
                if slide.object("SlideShowTransition", &[])?.int("Hidden")? == MSO_TRUE {
                    exported.hidden += 1;
                    continue;
                }
                let file = out.join(format!("slide-{i:04}.png"));
                let name = BSTR::from(file.to_string_lossy().as_ref());
                slide.call("Export", &[name.into(), BSTR::from("PNG").into(), width.into(), height.into()])?;
                if !file.is_file() {
                    return Err(format!("slide {i} was not written."));
                }
                exported.slides.push(ExportedSlide { path: file, notes: notes_of(&slide) });
            }
            Ok(exported)
        })();
        let _ = pres.call("Close", &[]);
        result
    }

    pub fn export(source: &Path, out: &Path) -> Result<Exported, String> {
        // SAFETY: COM is initialised for this thread only and released below,
        // after every COM object created here has been dropped.
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok().map_err(|e| e.message())?;
        let outcome = (|| {
            let clsid = unsafe { CLSIDFromProgID(w!("PowerPoint.Application")) }.map_err(|_| "PowerPoint is not installed.".to_string())?;
            let app = Object(unsafe { CoCreateInstance(&clsid, None, CLSCTX_LOCAL_SERVER) }.map_err(|e| format!("PowerPoint could not be started: {}", e.message()))?);
            // PowerPoint runs once per user: if it was already open, leave it open.
            let started_here = app.int("Visible").unwrap_or(MSO_TRUE) == MSO_FALSE && app.object("Presentations", &[]).and_then(|p| p.int("Count")).unwrap_or(1) == 0;
            let result = run(&app, source, out);
            if started_here && app.object("Presentations", &[]).and_then(|p| p.int("Count")).unwrap_or(1) == 0 {
                let _ = app.call("Quit", &[]);
            }
            result
        })();
        unsafe { CoUninitialize() };
        outcome
    }
}
