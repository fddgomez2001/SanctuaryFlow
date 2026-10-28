use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use sanctuary_core::bible::import::{ImportSource, ParsedBible};
use sanctuary_core::{Database, Error, Result};
use serde::Serialize;

use crate::presentation::PresentationHub;

/// Where the library lives on disk.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paths {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub media_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub providers_dir: PathBuf,
    pub secure_dir: PathBuf,
    pub presentation_file: PathBuf,
}

impl Paths {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
            db_path: data_dir.join("library.sqlite3"),
            media_dir: data_dir.join("media"),
            backups_dir: data_dir.join("backups"),
            providers_dir: data_dir.join("providers"),
            secure_dir: data_dir.join("secure"),
            presentation_file: data_dir.join("presentation-state.json"),
        }
    }

    pub fn create_all(&self) -> std::io::Result<()> {
        for d in [&self.data_dir, &self.media_dir, &self.backups_dir, &self.providers_dir, &self.secure_dir] {
            std::fs::create_dir_all(d)?;
        }
        Ok(())
    }
}

/// A parsed Bible waiting for the operator to confirm the import.
pub struct PendingBibleImport {
    pub parsed: ParsedBible,
    pub source: ImportSource,
    pub created: Instant,
}

pub struct AppState {
    pub paths: Paths,
    db: RwLock<Option<Arc<Database>>>,
    /// Set when the library could not be opened at startup.
    pub startup_error: Mutex<Option<String>>,
    pub startup_notices: Mutex<Vec<String>>,
    pub presentation: PresentationHub,
    pub pending_imports: Mutex<HashMap<String, PendingBibleImport>>,
    pub http: reqwest::Client,
}

impl AppState {
    pub fn new(paths: Paths, db: Option<Database>, presentation: PresentationHub) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("SanctuaryFlow/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("HTTP client configuration is valid");
        Self {
            paths,
            db: RwLock::new(db.map(Arc::new)),
            startup_error: Mutex::new(None),
            startup_notices: Mutex::new(Vec::new()),
            presentation,
            pending_imports: Mutex::new(HashMap::new()),
            http,
        }
    }

    /// The open library database.
    pub fn db(&self) -> Result<Arc<Database>> {
        let guard = self.db.read().unwrap_or_else(|p| p.into_inner());
        guard.clone().ok_or_else(|| {
            match self.startup_error.lock().unwrap_or_else(|p| p.into_inner()).clone() {
                Some(e) => Error::Other(e),
                None => Error::Other("The library is being restored. Please wait a moment.".into()),
            }
        })
    }

    /// Takes the database out of service and waits until every in-flight
    /// command has released it, so its files can be replaced.
    pub fn close_db(&self) -> Result<()> {
        let taken = self.db.write().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(mut arc) = taken {
            let deadline = Instant::now() + std::time::Duration::from_secs(15);
            loop {
                match Arc::try_unwrap(arc) {
                    Ok(db) => {
                        drop(db);
                        return Ok(());
                    }
                    Err(still_shared) => {
                        if Instant::now() > deadline {
                            *self.db.write().unwrap_or_else(|p| p.into_inner()) = Some(still_shared);
                            return Err(Error::Other(
                                "The library is busy (an import or backup is still running). Try again when it finishes."
                                    .into(),
                            ));
                        }
                        arc = still_shared;
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                }
            }
        }
        Ok(())
    }

    pub fn set_db(&self, db: Database) {
        *self.db.write().unwrap_or_else(|p| p.into_inner()) = Some(Arc::new(db));
        *self.startup_error.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }
}

/// Runs blocking work (SQLite, file IO) on the blocking thread pool so the
/// window event loop and slide navigation never wait on it.
pub async fn blocking<T, F>(f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Error::Other(format!("A background task failed: {e}")))?
}

pub fn tauri_err(e: tauri::Error) -> Error {
    Error::Other(e.to_string())
}
