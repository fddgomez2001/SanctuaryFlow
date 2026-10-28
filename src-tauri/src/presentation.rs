//! Live presentation state shared between the operator and projector windows.
//!
//! The operator window owns navigation; every change is sent here, kept in
//! memory, forwarded to the projector window as a local event and written to a
//! recovery file by a background thread (so slide changes never wait on disk
//! and never touch the network).

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::mpsc::{self, Sender};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub const EVENT_RENDER: &str = "presentation://render";
pub const EVENT_PROJECTOR_STATUS: &str = "projector://status";
pub const PROJECTOR_LABEL: &str = "projector";
pub const MAIN_LABEL: &str = "main";

/// What is persisted for crash recovery.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryFile {
    /// The last state shown on the projector (opaque to Rust; defined by the UI).
    pub render: Option<serde_json::Value>,
    /// The operator's position in the service (opaque to Rust).
    pub session: Option<serde_json::Value>,
    pub saved_at: Option<String>,
}

pub struct PresentationHub {
    inner: Mutex<RecoveryFile>,
    writer: Sender<RecoveryFile>,
}

const MAX_STATE_BYTES: usize = 2 * 1024 * 1024;

impl PresentationHub {
    pub fn new(file: PathBuf) -> Self {
        let initial = std::fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice::<RecoveryFile>(&b).ok())
            .unwrap_or_default();
        let (tx, rx) = mpsc::channel::<RecoveryFile>();
        std::thread::Builder::new()
            .name("presentation-recovery".into())
            .spawn(move || {
                while let Ok(mut latest) = rx.recv() {
                    // Coalesce bursts of updates into one write.
                    std::thread::sleep(Duration::from_millis(300));
                    while let Ok(newer) = rx.try_recv() {
                        latest = newer;
                    }
                    if let Err(e) = write_atomic(&file, &latest) {
                        log::warn!("could not save presentation recovery state: {e}");
                    }
                }
            })
            .expect("spawn recovery writer");
        Self { inner: Mutex::new(initial), writer: tx }
    }

    pub fn snapshot(&self) -> RecoveryFile {
        self.inner.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn persist(&self, data: &RecoveryFile) {
        let _ = self.writer.send(data.clone());
    }

    /// Stores a new projector state and forwards it to the projector window.
    pub fn update_render(&self, app: &AppHandle, state: serde_json::Value) -> sanctuary_core::Result<()> {
        if state.to_string().len() > MAX_STATE_BYTES {
            return Err(sanctuary_core::Error::validation("The slide is too large to present."));
        }
        let data = {
            let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            inner.render = Some(state.clone());
            inner.saved_at = Some(sanctuary_core::util::now_iso());
            inner.clone()
        };
        if let Err(e) = app.emit_to(PROJECTOR_LABEL, EVENT_RENDER, state) {
            log::warn!("could not deliver slide to projector: {e}");
        }
        self.persist(&data);
        Ok(())
    }

    pub fn update_session(&self, session: serde_json::Value) {
        let data = {
            let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            inner.session = Some(session);
            inner.saved_at = Some(sanctuary_core::util::now_iso());
            inner.clone()
        };
        self.persist(&data);
    }

    pub fn clear_session(&self) {
        let data = {
            let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            inner.session = None;
            inner.clone()
        };
        self.persist(&data);
    }
}

fn write_atomic(path: &PathBuf, data: &RecoveryFile) -> std::io::Result<()> {
    let tmp = path.with_extension("json.partial");
    std::fs::write(&tmp, serde_json::to_vec(data)?)?;
    std::fs::rename(&tmp, path)
}
