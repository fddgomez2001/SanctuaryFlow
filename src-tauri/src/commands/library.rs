use std::path::PathBuf;

use sanctuary_core::media;
use sanctuary_core::service_io::{self, ServiceImportResult};
use sanctuary_core::services::{self, DuplicatePlanOptions, ServicePlan, ServicePlanInput, ServicePlanQuery, ServicePlanSummary};
use sanctuary_core::slides::{self, DeckCategory, SlideDeck, SlideDeckDocument, SlideDeckSummary};
use sanctuary_core::song_io::{self, SongImportDecision, SongImportPreview, SongImportResult};
use sanctuary_core::songs::{self, Song, SongFacets, SongInput, SongListResult, SongQuery, SongSectionInput};
use sanctuary_core::themes::{self, Theme, ThemeDocument};
use sanctuary_core::Result;
use tauri::State;

use crate::state::{AppState, blocking};

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn songs_list(state: State<'_, AppState>, query: SongQuery) -> Result<SongListResult> {
    let db = state.db()?;
    blocking(move || db.read(|c| songs::list_songs(c, &query))).await
}

#[tauri::command]
pub async fn songs_get(state: State<'_, AppState>, id: String) -> Result<Song> {
    let db = state.db()?;
    blocking(move || db.read(|c| songs::get_song(c, &id))).await
}

#[tauri::command]
pub async fn songs_save(state: State<'_, AppState>, song: SongInput) -> Result<Song> {
    let db = state.db()?;
    blocking(move || db.write(|c| songs::save_song(c, song))).await
}

#[tauri::command]
pub async fn songs_duplicate(state: State<'_, AppState>, id: String) -> Result<Song> {
    let db = state.db()?;
    blocking(move || db.write(|c| songs::duplicate_song(c, &id))).await
}

#[tauri::command]
pub async fn songs_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| songs::delete_song(c, &id))).await
}

#[tauri::command]
pub async fn songs_set_archived(state: State<'_, AppState>, id: String, archived: bool) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| songs::set_archived(c, &id, archived))).await
}

#[tauri::command]
pub async fn songs_set_favorite(state: State<'_, AppState>, id: String, favorite: bool) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| songs::set_favorite(c, &id, favorite))).await
}

#[tauri::command]
pub async fn songs_record_use(state: State<'_, AppState>, id: String) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| songs::record_use(c, &id))).await
}

#[tauri::command]
pub async fn songs_facets(state: State<'_, AppState>) -> Result<SongFacets> {
    let db = state.db()?;
    blocking(move || db.read(songs::facets)).await
}

#[tauri::command]
pub fn songs_parse_lyrics(text: String) -> Vec<SongSectionInput> {
    songs::parse_lyrics_text(&text)
}

#[tauri::command]
pub async fn songs_export(state: State<'_, AppState>, ids: Option<Vec<String>>, path: String) -> Result<u32> {
    let db = state.db()?;
    blocking(move || db.read(|c| song_io::export_songs(c, ids.as_deref(), &PathBuf::from(path)))).await
}

#[tauri::command]
pub async fn songs_import_preview(state: State<'_, AppState>, path: String) -> Result<SongImportPreview> {
    let db = state.db()?;
    blocking(move || db.read(|c| song_io::preview_import(c, &PathBuf::from(path)))).await
}

#[tauri::command]
pub async fn songs_import_commit(
    state: State<'_, AppState>,
    path: String,
    checksum: String,
    decisions: Vec<SongImportDecision>,
) -> Result<SongImportResult> {
    let db = state.db()?;
    blocking(move || db.write(|c| song_io::commit_import(c, &PathBuf::from(path), &checksum, &decisions))).await
}

// ---------------------------------------------------------------------------
// Service plans
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn services_list(state: State<'_, AppState>, query: ServicePlanQuery) -> Result<Vec<ServicePlanSummary>> {
    let db = state.db()?;
    blocking(move || db.read(|c| services::list_plans(c, &query))).await
}

#[tauri::command]
pub async fn services_get(state: State<'_, AppState>, id: String) -> Result<ServicePlan> {
    let db = state.db()?;
    blocking(move || db.read(|c| services::get_plan(c, &id))).await
}

#[tauri::command]
pub async fn services_save(state: State<'_, AppState>, plan: ServicePlanInput) -> Result<ServicePlan> {
    let db = state.db()?;
    blocking(move || db.write(|c| services::save_plan(c, plan))).await
}

#[tauri::command]
pub async fn services_duplicate(state: State<'_, AppState>, id: String, options: DuplicatePlanOptions) -> Result<ServicePlan> {
    let db = state.db()?;
    blocking(move || db.write(|c| services::duplicate_plan(c, &id, options))).await
}

#[tauri::command]
pub async fn services_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| services::delete_plan(c, &id))).await
}

#[tauri::command]
pub async fn services_mark_opened(state: State<'_, AppState>, id: String) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| services::mark_opened(c, &id))).await
}

#[tauri::command]
pub async fn services_export(state: State<'_, AppState>, id: String, path: String) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.read(|c| service_io::export_service(c, &id, &PathBuf::from(path)))).await
}

#[tauri::command]
pub async fn services_import(state: State<'_, AppState>, path: String) -> Result<ServiceImportResult> {
    let db = state.db()?;
    blocking(move || db.write(|c| service_io::import_service(c, &PathBuf::from(path)))).await
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn themes_list(state: State<'_, AppState>) -> Result<Vec<Theme>> {
    let db = state.db()?;
    blocking(move || db.read(themes::list_themes)).await
}

#[tauri::command]
pub async fn themes_save(state: State<'_, AppState>, theme: ThemeDocument) -> Result<Theme> {
    let db = state.db()?;
    blocking(move || db.write(|c| themes::save_theme(c, theme))).await
}

#[tauri::command]
pub async fn themes_duplicate(state: State<'_, AppState>, id: String, name: Option<String>) -> Result<Theme> {
    let db = state.db()?;
    blocking(move || db.write(|c| themes::duplicate_theme(c, &id, name))).await
}

#[tauri::command]
pub async fn themes_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    let db = state.db()?;
    blocking(move || db.write(|c| themes::delete_theme(c, &id))).await
}

// ---------------------------------------------------------------------------
// Custom slide decks
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn decks_list(state: State<'_, AppState>, category: Option<DeckCategory>) -> Result<Vec<SlideDeckSummary>> {
    let db = state.db()?;
    blocking(move || db.read(|c| slides::list_decks(c, category))).await
}

#[tauri::command]
pub async fn decks_get(state: State<'_, AppState>, id: String) -> Result<SlideDeck> {
    let db = state.db()?;
    blocking(move || db.read(|c| slides::get_deck(c, &id))).await
}

#[tauri::command]
pub async fn decks_save(state: State<'_, AppState>, deck: SlideDeckDocument) -> Result<SlideDeck> {
    let db = state.db()?;
    let root = state.paths.media_dir.clone();
    blocking(move || {
        db.write(|c| {
            let before = match deck.id.as_deref() {
                Some(id) => slides::get_deck(c, id).map(|d| media::deck_media_ids(&d.slides)).unwrap_or_default(),
                None => Vec::new(),
            };
            let saved = slides::save_deck(c, deck)?;
            // Pictures of imported slides that were removed from the deck.
            let now = media::deck_media_ids(&saved.slides);
            let dropped: Vec<String> = before.into_iter().filter(|id| !now.contains(id)).collect();
            if let Err(e) = media::delete_unused_slide_pictures(c, &root, &dropped) {
                log::warn!("unused slide pictures were not removed: {e}");
            }
            Ok(saved)
        })
    })
    .await
}

#[tauri::command]
pub async fn decks_duplicate(state: State<'_, AppState>, id: String) -> Result<SlideDeck> {
    let db = state.db()?;
    blocking(move || db.write(|c| slides::duplicate_deck(c, &id))).await
}

#[tauri::command]
pub async fn decks_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    let db = state.db()?;
    let root = state.paths.media_dir.clone();
    blocking(move || {
        db.write(|c| {
            let pictures = slides::get_deck(c, &id).map(|d| media::deck_media_ids(&d.slides)).unwrap_or_default();
            slides::delete_deck(c, &id)?;
            if let Err(e) = media::delete_unused_slide_pictures(c, &root, &pictures) {
                log::warn!("slide pictures of the deleted deck were not removed: {e}");
            }
            Ok(())
        })
    })
    .await
}
