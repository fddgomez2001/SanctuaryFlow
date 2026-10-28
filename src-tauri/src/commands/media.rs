use std::path::{Path, PathBuf};

use sanctuary_core::media::{self, MediaAsset, MediaDetailsInput, MediaFolder, MediaImportResult, MediaProbe, MediaQuery};
use sanctuary_core::{Error, Result};
use serde::Serialize;
use tauri::State;
use tauri::ipc::{InvokeBody, Request};

use crate::state::{AppState, blocking};

#[tauri::command]
pub async fn media_list(state: State<'_, AppState>, query: MediaQuery) -> Result<Vec<MediaAsset>> {
    let db = state.db()?;
    let root = state.paths.media_dir.clone();
    blocking(move || db.read(|c| media::list_media(c, &root, &query))).await
}

#[tauri::command]
pub async fn media_get(state: State<'_, AppState>, id: String) -> Result<MediaAsset> {
    let db = state.db()?;
    let root = state.paths.media_dir.clone();
    blocking(move || db.read(|c| media::get_media(c, &root, &id))).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaImportOutcome {
    pub path: String,
    pub result: Option<MediaImportResult>,
    pub error: Option<String>,
}

/// Imports files one by one; a bad file does not stop the others.
#[tauri::command]
pub async fn media_import(state: State<'_, AppState>, paths: Vec<String>) -> Result<Vec<MediaImportOutcome>> {
    let db = state.db()?;
    let root = state.paths.media_dir.clone();
    blocking(move || {
        Ok(paths
            .into_iter()
            .map(|p| match db.write(|c| media::import_file(c, &root, &PathBuf::from(&p))) {
                Ok(r) => MediaImportOutcome { path: p, result: Some(r), error: None },
                Err(e) => MediaImportOutcome { path: p, result: None, error: Some(e.to_string()) },
            })
            .collect())
    })
    .await
}

/// Most files taken from one folder (and its subfolders) at a time.
const MAX_FOLDER_FILES: usize = 2000;

/// Supported media files in a folder and its subfolders (a few levels deep), by name.
fn media_files_in(dir: &Path) -> Result<Vec<PathBuf>> {
    let supported = media::supported_extensions();
    let mut found = Vec::new();
    let mut pending = vec![(dir.to_path_buf(), 0)];
    while let Some((folder, depth)) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() && depth < 4 {
                pending.push((path, depth + 1));
            } else if kind.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                if supported.contains(&ext.as_str()) {
                    found.push(path);
                }
            }
            if found.len() > MAX_FOLDER_FILES {
                return Err(Error::validation(format!("The folder has more than {MAX_FOLDER_FILES} media files. Choose a smaller folder.")));
            }
        }
    }
    found.sort();
    Ok(found)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderImport {
    /// The Media Library folder the files were put in.
    pub folder: String,
    pub outcomes: Vec<MediaImportOutcome>,
}

/// Imports every picture, video and song file in a folder on this computer
/// into a Media Library folder (named after it unless a name is given).
/// Files already in the library join the folder if they are in none.
#[tauri::command]
pub async fn media_import_folder(state: State<'_, AppState>, path: String, folder: Option<String>) -> Result<FolderImport> {
    let db = state.db()?;
    let root = state.paths.media_dir.clone();
    blocking(move || {
        let dir = PathBuf::from(&path);
        if !dir.is_dir() {
            return Err(Error::not_found(format!("{path} is not a folder.")));
        }
        let name = folder.or_else(|| dir.file_name().and_then(|n| n.to_str()).map(str::to_string));
        let name = media::normalize_folder(name.as_deref())?.unwrap_or_else(|| "Imported".to_string());
        let files = media_files_in(&dir)?;
        if files.is_empty() {
            return Err(Error::validation("There are no pictures, videos or songs in that folder."));
        }
        let outcomes: Vec<MediaImportOutcome> = files
            .into_iter()
            .map(|p| {
                let shown = p.to_string_lossy().into_owned();
                match db.write(|c| media::import_file(c, &root, &p)) {
                    Ok(r) => MediaImportOutcome { path: shown, result: Some(r), error: None },
                    Err(e) => MediaImportOutcome { path: shown, result: None, error: Some(e.to_string()) },
                }
            })
            .collect();
        let ids: Vec<String> = outcomes
            .iter()
            .filter_map(|o| o.result.as_ref())
            .filter(|r| !r.duplicate || r.asset.folder.is_none())
            .map(|r| r.asset.id.clone())
            .collect();
        db.write(|c| media::set_folder(c, &ids, Some(&name)))?;
        // Report the files as they are now, in their folder.
        let outcomes = outcomes
            .into_iter()
            .map(|mut o| {
                if let Some(r) = o.result.as_mut()
                    && let Ok(asset) = db.read(|c| media::get_media(c, &root, &r.asset.id))
                {
                    r.asset = asset;
                }
                o
            })
            .collect();
        Ok(FolderImport { folder: name, outcomes })
    })
    .await
}

#[tauri::command]
pub async fn media_folders(state: State<'_, AppState>) -> Result<Vec<MediaFolder>> {
    let db = state.db()?;
    blocking(move || db.read(media::list_folders)).await
}

/// Puts files into a folder, or takes them out of any (`folder` null).
#[tauri::command]
pub async fn media_set_folder(state: State<'_, AppState>, ids: Vec<String>, folder: Option<String>) -> Result<usize> {
    let db = state.db()?;
    blocking(move || db.write(|c| media::set_folder(c, &ids, folder.as_deref()))).await
}

#[tauri::command]
pub async fn media_rename_folder(state: State<'_, AppState>, from: String, to: String) -> Result<usize> {
    let db = state.db()?;
    blocking(move || db.write(|c| media::rename_folder(c, &from, &to))).await
}

#[tauri::command]
pub async fn media_update(state: State<'_, AppState>, id: String, details: MediaDetailsInput) -> Result<MediaAsset> {
    let db = state.db()?;
    let root = state.paths.media_dir.clone();
    blocking(move || db.write(|c| media::update_details(c, &root, &id, details))).await
}

#[tauri::command]
pub async fn media_set_probe(state: State<'_, AppState>, id: String, probe: MediaProbe) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| media::set_probe(c, &id, &probe))).await
}

/// Saves a thumbnail rendered by the UI. The image bytes are the raw request
/// body; the media id is passed in the `x-media-id` header.
#[tauri::command]
pub async fn media_set_thumbnail(state: State<'_, AppState>, request: Request<'_>) -> Result<String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(Error::validation("Expected image bytes."));
    };
    let id = request
        .headers()
        .get("x-media-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .ok_or_else(|| Error::validation("Missing media id."))?;
    let bytes = bytes.clone();
    let db = state.db()?;
    let root = state.paths.media_dir.clone();
    blocking(move || db.write(|c| media::set_thumbnail(c, &root, &id, &bytes))).await
}

/// Turns `name%20here.jpg` back into `name here.jpg`.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let escaped = if bytes[i] == b'%' && i + 2 < bytes.len() { u8::from_str_radix(&s[i + 1..i + 3], 16).ok() } else { None };
        if let Some(b) = escaped {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A file name that is safe to create on Windows.
pub fn safe_file_name(name: &str) -> String {
    const RESERVED: &str = "<>:\"/\\|?*";
    let cleaned: String = name.chars().map(|c| if c.is_control() || RESERVED.contains(c) { '_' } else { c }).collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    let limited: String = trimmed.chars().take(120).collect();
    if limited.is_empty() { "picture".into() } else { limited }
}

const MAX_PICTURE_BYTES: usize = 64 * 1024 * 1024;

/// Stores a picture made in the app (for example a page drawn from a PDF).
/// The bytes are the raw request body; the URL-encoded file name in the
/// `x-file-name` header gives the picture type, which is then checked against
/// the content like any imported file.
#[tauri::command]
pub async fn media_import_bytes(state: State<'_, AppState>, request: Request<'_>) -> Result<MediaAsset> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(Error::validation("Expected picture bytes."));
    };
    if bytes.is_empty() || bytes.len() > MAX_PICTURE_BYTES {
        return Err(Error::validation("The picture is empty or too large."));
    }
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(|v| safe_file_name(&percent_decode(v)))
        .ok_or_else(|| Error::validation("Missing file name."))?;
    if !sanctuary_core::deck_import::is_image_name(&name) {
        return Err(Error::validation("Only pictures can be added this way."));
    }
    // Pages of an imported presentation stay with their slides.
    let purpose = match request.headers().get("x-media-purpose").and_then(|v| v.to_str().ok()) {
        Some("slide") => media::MediaPurpose::Slide,
        _ => media::MediaPurpose::Library,
    };
    let bytes = bytes.clone();
    let db = state.db()?;
    let root = state.paths.media_dir.clone();
    blocking(move || {
        let dir = tempfile::Builder::new().prefix("sanctuaryflow-picture-").tempdir()?;
        let path = dir.path().join(&name);
        std::fs::write(&path, &bytes)?;
        Ok(db.write(|c| media::import_file_as(c, &root, &path, purpose))?.asset)
    })
    .await
}

#[tauri::command]
pub async fn media_references(state: State<'_, AppState>, id: String) -> Result<Vec<String>> {
    let db = state.db()?;
    blocking(move || db.read(|c| media::references(c, &id))).await
}

#[tauri::command]
pub async fn media_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    let db = state.db()?;
    let root = state.paths.media_dir.clone();
    blocking(move || db.write(|c| media::delete_media(c, &root, &id))).await
}

#[tauri::command]
pub fn media_supported_extensions() -> Vec<&'static str> {
    media::supported_extensions()
}
