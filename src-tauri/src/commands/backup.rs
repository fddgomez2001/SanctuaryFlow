use std::path::PathBuf;

use sanctuary_core::backup::{self, BackupHistoryEntry, BackupInfo, BackupManifest, BackupValidation};
use sanctuary_core::service_io::{self, LibraryImportResult};
use sanctuary_core::{Database, Error, Result, settings};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::presentation::MAIN_LABEL;
use crate::state::{AppState, blocking};

pub const EVENT_LIBRARY_RESTORED: &str = "library://restored";

fn backup_dir(state: &AppState, db: &Database) -> Result<PathBuf> {
    let configured = db.read(|c| settings::get_string(c, "backup.directory"))?;
    Ok(configured.map(PathBuf::from).unwrap_or_else(|| state.paths.backups_dir.clone()))
}

#[tauri::command]
pub async fn backup_create(state: State<'_, AppState>, directory: Option<String>, include_media: bool) -> Result<BackupInfo> {
    let db = state.db()?;
    let dir = match directory.filter(|d| !d.trim().is_empty()) {
        Some(d) => PathBuf::from(d),
        None => backup_dir(&state, &db)?,
    };
    let media = state.paths.media_dir.clone();
    blocking(move || {
        let dest = dir.join(backup::backup_file_name());
        backup::create_backup(&db, &media, &dest, include_media, "manual", env!("CARGO_PKG_VERSION"))
    })
    .await
}

#[tauri::command]
pub async fn backup_validate(path: String) -> Result<BackupValidation> {
    blocking(move || Ok(backup::validate_backup(&PathBuf::from(path), true))).await
}

#[tauri::command]
pub async fn backup_history(state: State<'_, AppState>, limit: u32) -> Result<Vec<BackupHistoryEntry>> {
    let db = state.db()?;
    blocking(move || db.read(|c| backup::history(c, limit))).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub manifest: BackupManifest,
    /// A backup of the library as it was just before the restore.
    pub safety_backup: String,
}

/// Restores a backup. The current library is backed up first; if the
/// restored library cannot be opened, the previous one is put back.
#[tauri::command]
pub async fn backup_restore(app: AppHandle, state: State<'_, AppState>, path: String, restore_media: bool) -> Result<RestoreOutcome> {
    let paths = state.paths.clone();
    let db = state.db()?;
    let (prepared, safety, old_history) = {
        let paths = paths.clone();
        let db = db.clone();
        blocking(move || {
            let prepared = backup::prepare_restore(&PathBuf::from(&path), &paths.data_dir, restore_media)?;
            let safety_path = paths.backups_dir.join(format!(
                "SanctuaryFlow-before-restore-{}.{}",
                chrono::Local::now().format("%Y%m%d-%H%M%S"),
                backup::BACKUP_EXTENSION
            ));
            let safety = backup::create_backup(&db, &paths.media_dir, &safety_path, restore_media, "pre_restore", env!("CARGO_PKG_VERSION"))?;
            let history = db.read(|c| backup::history(c, 500))?;
            Ok((prepared, safety, history))
        })
        .await?
    };
    drop(db);
    state.close_db()?;

    let swapped = {
        let paths = paths.clone();
        blocking(move || {
            let swap = backup::apply_restore(&prepared, &paths.db_path, &paths.media_dir)?;
            match Database::open(&paths.db_path) {
                Ok((db, _)) => {
                    db.write(|c| backup::merge_history(c, &old_history))?;
                    swap.commit();
                    crate::add_builtin_songs(&db);
                    Ok((db, prepared.manifest.clone()))
                }
                Err(e) => {
                    log::error!("restored library failed to open: {e}");
                    swap.rollback()?;
                    Err(Error::Other(format!("The restored library could not be opened ({e}). Your previous library was kept.")))
                }
            }
        })
        .await
    };
    match swapped {
        Ok((db, manifest)) => {
            state.set_db(db);
            let _ = app.emit_to(MAIN_LABEL, EVENT_LIBRARY_RESTORED, ());
            crate::add_builtin_bibles(&app);
            Ok(RestoreOutcome { manifest, safety_backup: safety.path })
        }
        Err(e) => {
            // Reopen whatever library is in place (the previous one after rollback).
            let reopen_path = paths.db_path.clone();
            match blocking(move || Database::open(&reopen_path).map(|(db, _)| db)).await {
                Ok(db) => state.set_db(db),
                Err(reopen) => {
                    *state.startup_error.lock().unwrap_or_else(|p| p.into_inner()) =
                        Some(format!("The library could not be reopened after a failed restore: {reopen}"));
                }
            }
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn library_export(state: State<'_, AppState>, path: String) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.read(|c| service_io::export_library(c, &PathBuf::from(path)).map(|_| ()))).await
}

#[tauri::command]
pub async fn library_import(state: State<'_, AppState>, path: String) -> Result<LibraryImportResult> {
    let db = state.db()?;
    blocking(move || db.write(|c| service_io::import_library(c, &PathBuf::from(path)))).await
}

/// Runs scheduled backups in the background when enabled in settings.
pub fn start_scheduler(app: AppHandle) {
    use tauri::Manager;
    std::thread::Builder::new()
        .name("backup-scheduler".into())
        .spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(120));
            loop {
                let state = app.state::<AppState>();
                if let Ok(db) = state.db()
                    && let Err(e) = run_scheduled(&state, &db) {
                        log::warn!("scheduled backup failed: {e}");
                    }
                std::thread::sleep(std::time::Duration::from_secs(600));
            }
        })
        .expect("spawn backup scheduler");
}

fn run_scheduled(state: &AppState, db: &Database) -> Result<()> {
    let s = db.read(settings::get_all)?;
    if !s.get("backup.scheduleEnabled").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Ok(());
    }
    let hours = s.get("backup.scheduleIntervalHours").and_then(|v| v.as_u64()).unwrap_or(168).max(1);
    let last: Option<String> = db.read(|c| {
        Ok(c.query_row(
            "SELECT MAX(created_at) FROM backup_history WHERE kind = 'scheduled' AND status = 'completed'",
            [],
            |r| r.get(0),
        )?)
    })?;
    let due = match last.and_then(|l| chrono::DateTime::parse_from_rfc3339(&l).ok()) {
        Some(t) => chrono::Utc::now().signed_duration_since(t) >= chrono::Duration::hours(hours as i64),
        None => true,
    };
    if !due {
        return Ok(());
    }
    let include_media = s.get("backup.includeMedia").and_then(|v| v.as_bool()).unwrap_or(true);
    let keep = s.get("backup.keepCount").and_then(|v| v.as_u64()).unwrap_or(10).max(1) as u32;
    let dir = backup_dir(state, db)?;
    let dest = dir.join(backup::backup_file_name());
    backup::create_backup(db, &state.paths.media_dir, &dest, include_media, "scheduled", env!("CARGO_PKG_VERSION"))?;
    db.write(|c| backup::prune_scheduled(c, keep))?;
    log::info!("scheduled backup written to {}", dest.display());
    Ok(())
}
