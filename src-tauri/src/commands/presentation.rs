use sanctuary_core::Result;
use tauri::{AppHandle, Emitter, State};

use crate::display::{self, DisplayInfo, DisplayManager, ProjectorMode, ProjectorStatus};
use crate::presentation::{EVENT_PROJECTOR_STATUS, MAIN_LABEL, RecoveryFile};
use crate::state::AppState;

#[tauri::command]
pub async fn displays_list(app: AppHandle) -> Result<Vec<DisplayInfo>> {
    display::list(&app)
}

/// Must stay async: creating a window from a synchronous command deadlocks
/// the Windows event loop.
#[tauri::command]
pub async fn projector_open(
    app: AppHandle,
    manager: State<'_, DisplayManager>,
    display_id: Option<String>,
    mode: ProjectorMode,
) -> Result<ProjectorStatus> {
    display::open_projector(&app, &manager, display_id, mode)
}

#[tauri::command]
pub async fn projector_close(app: AppHandle, manager: State<'_, DisplayManager>) -> Result<()> {
    display::close_projector(&app, &manager)
}

#[tauri::command]
pub async fn projector_status(app: AppHandle, manager: State<'_, DisplayManager>) -> Result<ProjectorStatus> {
    Ok(display::status(&app, &manager))
}

/// Sends the current output to the projector window.
#[tauri::command]
pub async fn presentation_update(app: AppHandle, state: State<'_, AppState>, render: serde_json::Value) -> Result<()> {
    state.presentation.update_render(&app, render)
}

/// The latest output, for a projector window that just (re)loaded.
#[tauri::command]
pub async fn presentation_get_state(state: State<'_, AppState>) -> Result<Option<serde_json::Value>> {
    Ok(state.presentation.snapshot().render)
}

#[tauri::command]
pub async fn presentation_save_session(state: State<'_, AppState>, session: serde_json::Value) -> Result<()> {
    state.presentation.update_session(session);
    Ok(())
}

#[tauri::command]
pub async fn presentation_clear_session(state: State<'_, AppState>) -> Result<()> {
    state.presentation.clear_session();
    Ok(())
}

#[tauri::command]
pub async fn presentation_recovery(state: State<'_, AppState>) -> Result<RecoveryFile> {
    Ok(state.presentation.snapshot())
}

/// Playback / readiness reports from the projector, relayed to the operator.
#[tauri::command]
pub async fn projector_report(app: AppHandle, status: serde_json::Value) -> Result<()> {
    let _ = app.emit_to(MAIN_LABEL, EVENT_PROJECTOR_STATUS, status);
    Ok(())
}
