//! Local operations used by the synchronization engine in the UI. The engine
//! talks to the cloud; these commands only read and update the local outbox
//! and apply what it downloads.

use sanctuary_core::Result;
use sanctuary_core::sync::{self, ApplyOutcome, ConflictResolution, PendingChange, RemoteRecord, SyncConflict, SyncStatus};
use tauri::State;

use crate::state::{AppState, blocking};

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>) -> Result<SyncStatus> {
    let db = state.db()?;
    blocking(move || db.read(sync::status)).await
}

#[tauri::command]
pub async fn sync_pending(state: State<'_, AppState>, limit: u32, now: String) -> Result<Vec<PendingChange>> {
    let db = state.db()?;
    // Uses the writer: entries for vanished entities are closed while reading.
    blocking(move || db.write(|c| sync::pending_batch(c, limit, &now))).await
}

#[tauri::command]
pub async fn sync_mark_pushed(state: State<'_, AppState>, op_id: String, remote_version: i64) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| sync::mark_pushed(c, &op_id, remote_version))).await
}

#[tauri::command]
pub async fn sync_mark_failed(state: State<'_, AppState>, op_id: String, error: String, next_attempt_at: String) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| sync::mark_failed(c, &op_id, &error, &next_attempt_at))).await
}

#[tauri::command]
pub async fn sync_mark_conflict(state: State<'_, AppState>, op_id: String, remote: RemoteRecord) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| sync::mark_conflict(c, &op_id, &remote))).await
}

#[tauri::command]
pub async fn sync_apply_remote(state: State<'_, AppState>, records: Vec<RemoteRecord>) -> Result<Vec<ApplyOutcome>> {
    let db = state.db()?;
    blocking(move || db.write(|c| records.iter().map(|r| sync::apply_remote(c, r)).collect())).await
}

#[tauri::command]
pub async fn sync_conflicts(state: State<'_, AppState>) -> Result<Vec<SyncConflict>> {
    let db = state.db()?;
    blocking(move || db.read(sync::list_conflicts)).await
}

#[tauri::command]
pub async fn sync_resolve(state: State<'_, AppState>, conflict_id: String, resolution: ConflictResolution) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| sync::resolve_conflict(c, &conflict_id, resolution))).await
}

#[tauri::command]
pub async fn sync_backfill(state: State<'_, AppState>) -> Result<u32> {
    let db = state.db()?;
    blocking(move || db.write(sync::backfill)).await
}

#[tauri::command]
pub async fn sync_reset(state: State<'_, AppState>) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(sync::reset)).await
}

#[tauri::command]
pub async fn sync_get_meta(state: State<'_, AppState>, key: String) -> Result<Option<String>> {
    let db = state.db()?;
    blocking(move || db.read(|c| sync::get_metadata(c, &key))).await
}

#[tauri::command]
pub async fn sync_set_meta(state: State<'_, AppState>, key: String, value: String) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| sync::set_metadata(c, &key, &value))).await
}
