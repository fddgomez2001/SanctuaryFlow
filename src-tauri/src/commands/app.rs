use sanctuary_core::settings::{self, SettingsMap};
use sanctuary_core::{Result, dashboard, migrations, seed};
use serde::Serialize;
use tauri::State;

use crate::secure_store;
use crate::state::{AppState, blocking};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub media_dir: String,
    pub backups_dir: String,
    pub db_path: String,
    pub db_size_bytes: u64,
    pub free_disk_bytes: Option<u64>,
    pub schema_version: i64,
    pub device_id: Option<String>,
    /// Set when the library could not be opened; the UI shows recovery options.
    pub startup_error: Option<String>,
    pub notices: Vec<String>,
}

#[cfg(windows)]
fn free_disk_bytes(path: &std::path::Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut free: u64 = 0;
    // SAFETY: `wide` is NUL-terminated; out-pointers are valid or null.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(free)
}

#[cfg(not(windows))]
fn free_disk_bytes(_: &std::path::Path) -> Option<u64> {
    None
}

fn file_size(p: &std::path::Path) -> u64 {
    ["", "-wal"].iter().map(|s| std::fs::metadata(format!("{}{s}", p.display())).map(|m| m.len()).unwrap_or(0)).sum()
}

#[tauri::command]
pub async fn app_info(state: State<'_, AppState>) -> Result<AppInfo> {
    let paths = state.paths.clone();
    let db = state.db().ok();
    let startup_error = state.startup_error.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let notices = state.startup_notices.lock().unwrap_or_else(|p| p.into_inner()).clone();
    blocking(move || {
        let (schema_version, device_id) = match &db {
            Some(db) => db.read(|c| Ok((migrations::current_version(c)?, Some(seed::device_id(c)?))))?,
            None => (0, None),
        };
        Ok(AppInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            data_dir: paths.data_dir.to_string_lossy().into_owned(),
            media_dir: paths.media_dir.to_string_lossy().into_owned(),
            backups_dir: paths.backups_dir.to_string_lossy().into_owned(),
            db_path: paths.db_path.to_string_lossy().into_owned(),
            db_size_bytes: file_size(&paths.db_path),
            free_disk_bytes: free_disk_bytes(&paths.data_dir),
            schema_version,
            device_id,
            startup_error,
            notices,
        })
    })
    .await
}

#[tauri::command]
pub async fn dashboard_summary(state: State<'_, AppState>, today: String) -> Result<dashboard::DashboardSummary> {
    let db = state.db()?;
    blocking(move || db.read(|c| dashboard::summary(c, &today))).await
}

#[tauri::command]
pub async fn settings_get_all(state: State<'_, AppState>) -> Result<SettingsMap> {
    let db = state.db()?;
    blocking(move || db.read(settings::get_all)).await
}

#[tauri::command]
pub async fn settings_set(state: State<'_, AppState>, key: String, value: serde_json::Value) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| settings::set(c, &key, &value))).await
}

#[tauri::command]
pub async fn settings_set_many(state: State<'_, AppState>, values: SettingsMap) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| settings::set_many(c, &values))).await
}

#[tauri::command]
pub async fn secure_get(state: State<'_, AppState>, key: String) -> Result<Option<String>> {
    let dir = state.paths.secure_dir.clone();
    blocking(move || secure_store::get(&dir, &key)).await
}

#[tauri::command]
pub async fn secure_set(state: State<'_, AppState>, key: String, value: String) -> Result<()> {
    let dir = state.paths.secure_dir.clone();
    blocking(move || secure_store::set(&dir, &key, &value)).await
}

#[tauri::command]
pub async fn secure_delete(state: State<'_, AppState>, key: String) -> Result<()> {
    let dir = state.paths.secure_dir.clone();
    blocking(move || secure_store::delete(&dir, &key)).await
}
