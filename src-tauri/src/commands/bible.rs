use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use sanctuary_core::bible::import::{self, ImportOptions, ImportPreview, ImportResult, ImportSource};
use sanctuary_core::bible::validate::ValidationReport;
use sanctuary_core::bible::{
    self, BibleBookInfo, BibleSearchQuery, BibleSearchResult, ImportJob, Passage, PassageRef, SavePassageInput,
    SavedPassage, Translation, TranslationMetadataInput, Verse,
};
use sanctuary_core::{Error, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::presentation::MAIN_LABEL;
use crate::providers::{BibleProvider, EBible, ProviderCatalog, ProviderInfo};
use crate::state::{AppState, PendingBibleImport, blocking};

pub const EVENT_IMPORT_PROGRESS: &str = "bible-import://progress";

#[tauri::command]
pub async fn bible_translations(state: State<'_, AppState>) -> Result<Vec<Translation>> {
    let db = state.db()?;
    blocking(move || db.read(bible::list_translations)).await
}

#[tauri::command]
pub async fn bible_translation_update(state: State<'_, AppState>, id: String, metadata: TranslationMetadataInput) -> Result<Translation> {
    let db = state.db()?;
    blocking(move || db.write(|c| bible::update_translation_metadata(c, &id, metadata))).await
}

#[tauri::command]
pub async fn bible_translation_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| bible::delete_translation(c, &id))).await
}

#[tauri::command]
pub async fn bible_books(state: State<'_, AppState>, translation_id: Option<String>) -> Result<Vec<BibleBookInfo>> {
    let db = state.db()?;
    blocking(move || db.read(|c| bible::list_books(c, translation_id.as_deref()))).await
}

#[tauri::command]
pub async fn bible_chapter(state: State<'_, AppState>, translation_id: String, book_id: String, chapter: u32) -> Result<Vec<Verse>> {
    let db = state.db()?;
    blocking(move || db.read(|c| bible::get_chapter(c, &translation_id, &book_id, chapter))).await
}

#[tauri::command]
pub async fn bible_passage(state: State<'_, AppState>, translation_id: String, reference: PassageRef) -> Result<Passage> {
    let db = state.db()?;
    blocking(move || db.read(|c| bible::get_passage(c, &translation_id, &reference))).await
}

#[tauri::command]
pub async fn bible_search(state: State<'_, AppState>, query: BibleSearchQuery) -> Result<BibleSearchResult> {
    let db = state.db()?;
    blocking(move || db.read(|c| bible::search(c, &query))).await
}

#[tauri::command]
pub async fn bible_passage_use(state: State<'_, AppState>, input: SavePassageInput) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| bible::record_passage_use(c, &input))).await
}

#[tauri::command]
pub async fn bible_passage_favorite(state: State<'_, AppState>, input: SavePassageInput, favorite: bool) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| bible::set_passage_favorite(c, &input, favorite))).await
}

#[tauri::command]
pub async fn bible_saved_passages(state: State<'_, AppState>, favorites: bool, limit: u32) -> Result<Vec<SavedPassage>> {
    let db = state.db()?;
    blocking(move || db.read(|c| bible::list_saved_passages(c, favorites, limit))).await
}

#[tauri::command]
pub async fn bible_saved_passage_remove(state: State<'_, AppState>, id: String) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| bible::remove_saved_passage(c, &id))).await
}

#[tauri::command]
pub async fn bible_validation_report(state: State<'_, AppState>, translation_id: String) -> Result<Option<ValidationReport>> {
    let db = state.db()?;
    blocking(move || db.read(|c| import::latest_report(c, &translation_id))).await
}

#[tauri::command]
pub async fn bible_revalidate(state: State<'_, AppState>, translation_id: String) -> Result<ValidationReport> {
    let db = state.db()?;
    blocking(move || db.write(|c| import::revalidate(c, &translation_id))).await
}

#[tauri::command]
pub async fn bible_import_jobs(state: State<'_, AppState>, limit: u32) -> Result<Vec<ImportJob>> {
    let db = state.db()?;
    blocking(move || db.read(|c| bible::list_import_jobs(c, limit))).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewResponse {
    pub token: String,
    pub preview: ImportPreview,
    /// Metadata to pre-fill the import form (from the file or the provider).
    pub suggested_metadata: TranslationMetadataInput,
    pub license_text: Option<String>,
}

fn suggested_from_detected(preview: &ImportPreview) -> TranslationMetadataInput {
    let d = &preview.detected;
    TranslationMetadataInput {
        code: d.code.clone().unwrap_or_default().chars().filter(|c| c.is_alphanumeric() || *c == '-').take(24).collect(),
        name: d.name.clone().unwrap_or_default(),
        language: d.language.clone().unwrap_or_default(),
        versification: d.versification.clone(),
        text_direction: d.text_direction.clone(),
        publisher: d.publisher.clone(),
        license_name: d.license_name.clone(),
        license_url: d.license_url.clone(),
        copyright_notice: d.copyright_notice.clone(),
        source_url: d.source_url.clone(),
        ..Default::default()
    }
}

fn remember(state: &AppState, pending: PendingBibleImport) -> String {
    let token = sanctuary_core::util::new_id();
    let mut map = state.pending_imports.lock().unwrap_or_else(|p| p.into_inner());
    map.retain(|_, p| p.created.elapsed() < Duration::from_secs(1800));
    // Parsed Bibles are large; keep only the most recent few.
    while map.len() >= 3 {
        let oldest = map.iter().min_by_key(|(_, p)| p.created).map(|(k, _)| k.clone());
        match oldest {
            Some(k) => {
                map.remove(&k);
            }
            None => break,
        }
    }
    map.insert(token.clone(), pending);
    token
}

/// Parses and validates a local file, folder or zip without importing it.
#[tauri::command]
pub async fn bible_import_preview(state: State<'_, AppState>, path: String) -> Result<ImportPreviewResponse> {
    let db = state.db()?;
    let p = PathBuf::from(&path);
    let (parsed, source, preview) = blocking(move || {
        let sources = import::read_sources(&p)?;
        let format = import::detect_format(&sources)?;
        let checksum = import::checksum_sources(&sources);
        let parsed = import::parse_sources(format, &sources)?;
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("source").to_string();
        let preview = db.read(|c| import::build_preview(c, format, &name, checksum.clone(), &parsed))?;
        let source = ImportSource { kind: "file".into(), format, path: Some(path), provider: None, checksum: Some(checksum) };
        Ok((parsed, source, preview))
    })
    .await?;
    let suggested_metadata = suggested_from_detected(&preview);
    let token = remember(&state, PendingBibleImport { parsed, source, created: Instant::now() });
    Ok(ImportPreviewResponse { token, preview, suggested_metadata, license_text: None })
}

#[tauri::command]
pub fn bible_import_discard(state: State<'_, AppState>, token: String) {
    state.pending_imports.lock().unwrap_or_else(|p| p.into_inner()).remove(&token);
}

/// Imports a previewed source inside one transaction.
#[tauri::command]
pub async fn bible_import_commit(
    app: AppHandle,
    state: State<'_, AppState>,
    token: String,
    options: ImportOptions,
) -> Result<ImportResult> {
    let db = state.db()?;
    let pending = {
        let mut map = state.pending_imports.lock().unwrap_or_else(|p| p.into_inner());
        let p = map.remove(&token).ok_or_else(|| Error::validation("The preview has expired. Choose the file again."))?;
        Arc::new(p)
    };
    let work = pending.clone();
    let result = blocking(move || {
        let progress = |done: u32, total: u32| {
            let _ = app.emit_to(MAIN_LABEL, EVENT_IMPORT_PROGRESS, serde_json::json!({ "done": done, "total": total }));
        };
        db.write(|c| import::commit(c, &work.parsed, &work.source, options, &progress))
    })
    .await;
    if result.is_err() {
        // Keep the preview so the operator can fix the form and retry.
        if let Ok(p) = Arc::try_unwrap(pending) {
            state.pending_imports.lock().unwrap_or_else(|p| p.into_inner()).insert(token, p);
        }
    }
    result
}

#[tauri::command]
pub fn bible_providers() -> Vec<ProviderInfo> {
    vec![EBible.info()]
}

fn provider(id: &str) -> Result<EBible> {
    match id {
        "ebible" => Ok(EBible),
        _ => Err(Error::validation("Unknown Bible provider.")),
    }
}

#[tauri::command]
pub async fn bible_provider_catalog(state: State<'_, AppState>, provider_id: String, refresh: bool) -> Result<ProviderCatalog> {
    let p = provider(&provider_id)?;
    let dir = state.paths.providers_dir.join(&provider_id);
    p.catalog(&state.http, &dir, refresh).await
}

/// Downloads a translation from a provider and previews it (not yet imported).
#[tauri::command]
pub async fn bible_provider_download(
    state: State<'_, AppState>,
    provider_id: String,
    translation_id: String,
) -> Result<ImportPreviewResponse> {
    let p = provider(&provider_id)?;
    let dir = state.paths.providers_dir.join(&provider_id);
    let catalog = p.catalog(&state.http, &dir, false).await?;
    let t = catalog
        .translations
        .into_iter()
        .find(|t| t.id == translation_id)
        .ok_or_else(|| Error::not_found("That translation is not offered for download."))?;
    let zip = p.download(&state.http, &dir, &t).await?;
    let db = state.db()?;
    let mut suggested = p.metadata(&t);
    let provider_name = p.info().name;
    let (parsed, source, preview, license_text) = blocking(move || {
        let sources = import::read_sources(&zip)?;
        let format = import::detect_format(&sources)?;
        let checksum = import::checksum_sources(&sources);
        let parsed = import::parse_sources(format, &sources)?;
        let name = zip.file_name().and_then(|n| n.to_str()).unwrap_or("download").to_string();
        let preview = db.read(|c| import::build_preview(c, format, &name, checksum.clone(), &parsed))?;
        let source = ImportSource {
            kind: "provider".into(),
            format,
            path: Some(zip.to_string_lossy().into_owned()),
            provider: Some(provider_name),
            checksum: Some(checksum),
        };
        Ok((parsed, source, preview, crate::providers::package_license_text(&zip)))
    })
    .await?;
    if suggested.versification.is_none() {
        suggested.versification = preview.detected.versification.clone();
    }
    suggested.notes = license_text.clone();
    let token = remember(&state, PendingBibleImport { parsed, source, created: Instant::now() });
    Ok(ImportPreviewResponse { token, preview, suggested_metadata: suggested, license_text })
}
