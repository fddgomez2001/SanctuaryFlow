//! Service plan export/import and whole-library JSON datasets.
//!
//! A service export embeds the songs, slide decks and custom themes it uses,
//! so it can be opened on another computer. Media files are referenced by id
//! and checksum; a matching local file is used when one exists.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::services::{self, ServicePlanDocument, ServicePlanQuery};
use crate::slides::{self, SlideDeckDocument};
use crate::songs::{self, SongDocument};
use crate::themes::{self, ThemeDocument};
use crate::util::now_iso;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaReference {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub checksum_sha256: String,
    pub original_filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceExport {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub plan: ServicePlanDocument,
    #[serde(default)]
    pub songs: Vec<SongDocument>,
    #[serde(default)]
    pub decks: Vec<SlideDeckDocument>,
    #[serde(default)]
    pub themes: Vec<ThemeDocument>,
    #[serde(default)]
    pub media: Vec<MediaReference>,
}

const SERVICE_FORMAT: &str = "sanctuaryflow-service";
const LIBRARY_FORMAT: &str = "sanctuaryflow-library";

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let tmp = path.with_extension("partial");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn collect_theme(conn: &Connection, id: Option<&str>, seen: &mut HashSet<String>, out: &mut Vec<ThemeDocument>) -> Result<()> {
    let Some(id) = id else { return Ok(()) };
    if !seen.insert(id.to_string()) {
        return Ok(());
    }
    if let Ok(t) = themes::get_theme(conn, id) {
        if !t.is_builtin {
            out.push(themes::to_document(&t));
        }
    }
    Ok(())
}

fn media_ids_in(value: &serde_json::Value, out: &mut HashSet<String>) {
    match value {
        serde_json::Value::Object(o) => {
            for (k, v) in o {
                if k == "mediaId" {
                    if let Some(s) = v.as_str() {
                        out.insert(s.to_string());
                    }
                }
                media_ids_in(v, out);
            }
        }
        serde_json::Value::Array(a) => a.iter().for_each(|v| media_ids_in(v, out)),
        _ => {}
    }
}

pub fn build_service_export(conn: &Connection, plan_id: &str) -> Result<ServiceExport> {
    let plan = services::get_plan(conn, plan_id)?;
    let mut songs_out = Vec::new();
    let mut decks_out = Vec::new();
    let mut themes_out = Vec::new();
    let mut theme_seen = HashSet::new();
    let mut media_ids = HashSet::new();
    collect_theme(conn, plan.theme_id.as_deref(), &mut theme_seen, &mut themes_out)?;
    for item in &plan.items {
        media_ids_in(&item.settings, &mut media_ids);
        collect_theme(conn, item.settings.get("themeId").and_then(|v| v.as_str()), &mut theme_seen, &mut themes_out)?;
        let Some(ref_id) = item.ref_id.as_deref() else { continue };
        match item.item_type {
            services::ServiceItemType::Song => {
                if let Ok(s) = songs::get_song(conn, ref_id) {
                    collect_theme(conn, s.theme_id.as_deref(), &mut theme_seen, &mut themes_out)?;
                    songs_out.push(songs::to_document(&s));
                }
            }
            services::ServiceItemType::Image | services::ServiceItemType::Video => {
                media_ids.insert(ref_id.to_string());
            }
            _ => {
                if let Ok(d) = slides::get_deck(conn, ref_id) {
                    media_ids_in(&d.slides, &mut media_ids);
                    collect_theme(conn, d.theme_id.as_deref(), &mut theme_seen, &mut themes_out)?;
                    decks_out.push(slides::to_document(&d));
                }
            }
        }
    }
    for t in &themes_out {
        media_ids_in(&t.settings, &mut media_ids);
    }
    let mut media = Vec::new();
    for id in media_ids {
        let row: Option<MediaReference> = conn
            .query_row(
                "SELECT id, title, kind, checksum_sha256, original_filename FROM media_assets WHERE id = ?1",
                [&id],
                |r| {
                    Ok(MediaReference {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        kind: r.get(2)?,
                        checksum_sha256: r.get(3)?,
                        original_filename: r.get(4)?,
                    })
                },
            )
            .optional()?;
        media.extend(row);
    }
    media.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(ServiceExport {
        format: SERVICE_FORMAT.into(),
        version: 1,
        exported_at: now_iso(),
        plan: services::to_document(&plan),
        songs: songs_out,
        decks: decks_out,
        themes: themes_out,
        media,
    })
}

pub fn export_service(conn: &Connection, plan_id: &str, path: &Path) -> Result<()> {
    write_json(path, &build_service_export(conn, plan_id)?)
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServiceImportResult {
    pub plan_id: String,
    pub songs_added: u32,
    pub songs_already_present: u32,
    pub decks_added: u32,
    pub themes_added: u32,
    /// Media referenced by the service that is not in this library.
    pub missing_media: Vec<String>,
}

fn exists(conn: &Connection, table: &str, id: &str) -> Result<bool> {
    Ok(conn.query_row(&format!("SELECT EXISTS (SELECT 1 FROM {table} WHERE id = ?1 AND deleted_at IS NULL)"), [id], |r| r.get(0))?)
}

/// Imports a service export as a new plan. Embedded songs, decks and themes
/// that already exist locally (same id) are left untouched.
pub fn import_service(conn: &mut Connection, path: &Path) -> Result<ServiceImportResult> {
    let bytes = std::fs::read(path)?;
    let data: ServiceExport = serde_json::from_slice(&bytes)
        .map_err(|e| Error::validation(format!("This is not a SanctuaryFlow service file: {e}")))?;
    if data.format != SERVICE_FORMAT {
        return Err(Error::validation("This is not a SanctuaryFlow service file."));
    }
    if data.version > 1 {
        return Err(Error::Unsupported("This service file was made by a newer version of SanctuaryFlow.".into()));
    }
    let tx = conn.transaction()?;
    let mut result = ServiceImportResult::default();
    for t in data.themes {
        if let Some(id) = &t.id {
            if exists(&tx, "presentation_themes", id)? {
                continue;
            }
        }
        themes::save_theme_tx(&tx, t)?;
        result.themes_added += 1;
    }
    for s in data.songs {
        if let Some(id) = &s.id {
            if exists(&tx, "songs", id)? {
                result.songs_already_present += 1;
                continue;
            }
        }
        songs::save_song_tx(&tx, songs::normalize_document(s)?)?;
        result.songs_added += 1;
    }
    for d in data.decks {
        if let Some(id) = &d.id {
            if exists(&tx, "custom_slides", id)? {
                continue;
            }
        }
        slides::save_deck_tx(&tx, d)?;
        result.decks_added += 1;
    }
    // Map media references to local files with the same content.
    let mut plan = data.plan;
    for m in &data.media {
        if exists(&tx, "media_assets", &m.id)? {
            continue;
        }
        let local: Option<String> = tx
            .query_row(
                "SELECT id FROM media_assets WHERE checksum_sha256 = ?1 AND deleted_at IS NULL LIMIT 1",
                [&m.checksum_sha256],
                |r| r.get(0),
            )
            .optional()?;
        match local {
            Some(local_id) => {
                for item in plan.items.iter_mut() {
                    if item.ref_id.as_deref() == Some(m.id.as_str()) {
                        item.ref_id = Some(local_id.clone());
                    }
                    let s = item.settings.to_string().replace(&m.id, &local_id);
                    item.settings = serde_json::from_str(&s)?;
                }
            }
            None => result.missing_media.push(m.title.clone()),
        }
    }
    plan.id = None;
    for item in plan.items.iter_mut() {
        item.id = None;
    }
    result.plan_id = services::save_plan_tx(&tx, services::normalize_document(plan)?)?;
    tx.commit()?;
    Ok(result)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryExport {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    #[serde(default)]
    pub songs: Vec<SongDocument>,
    #[serde(default)]
    pub services: Vec<ServicePlanDocument>,
    #[serde(default)]
    pub decks: Vec<SlideDeckDocument>,
    #[serde(default)]
    pub themes: Vec<ThemeDocument>,
}

/// Writes songs, service plans (including templates), slide decks and custom
/// themes to one JSON file. Bible text and media files are not included.
pub fn export_library(conn: &Connection, path: &Path) -> Result<LibraryExport> {
    let mut songs_out = Vec::new();
    let mut stmt = conn.prepare("SELECT id FROM songs WHERE deleted_at IS NULL ORDER BY title COLLATE NOCASE")?;
    let ids: Vec<String> = stmt.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
    for id in ids {
        songs_out.push(songs::to_document(&songs::get_song(conn, &id)?));
    }
    let mut services_out = Vec::new();
    for templates in [false, true] {
        for s in services::list_plans(conn, &ServicePlanQuery { templates, limit: Some(1000), ..Default::default() })? {
            services_out.push(services::to_document(&services::get_plan(conn, &s.id)?));
        }
    }
    let mut decks_out = Vec::new();
    for d in slides::list_decks(conn, None)? {
        decks_out.push(slides::to_document(&slides::get_deck(conn, &d.id)?));
    }
    let themes_out: Vec<ThemeDocument> =
        themes::list_themes(conn)?.iter().filter(|t| !t.is_builtin).map(themes::to_document).collect();
    let export = LibraryExport {
        format: LIBRARY_FORMAT.into(),
        version: 1,
        exported_at: now_iso(),
        songs: songs_out,
        services: services_out,
        decks: decks_out,
        themes: themes_out,
    };
    write_json(path, &export)?;
    Ok(export)
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LibraryImportResult {
    pub songs_added: u32,
    pub services_added: u32,
    pub decks_added: u32,
    pub themes_added: u32,
    pub skipped_existing: u32,
}

/// Adds everything from a library dataset that is not already present (by
/// id). Existing records are never overwritten.
pub fn import_library(conn: &mut Connection, path: &Path) -> Result<LibraryImportResult> {
    let data: LibraryExport = serde_json::from_slice(&std::fs::read(path)?)
        .map_err(|e| Error::validation(format!("This is not a SanctuaryFlow library file: {e}")))?;
    if data.format != LIBRARY_FORMAT {
        return Err(Error::validation("This is not a SanctuaryFlow library file."));
    }
    if data.version > 1 {
        return Err(Error::Unsupported("This library file was made by a newer version of SanctuaryFlow.".into()));
    }
    let tx = conn.transaction()?;
    let mut r = LibraryImportResult::default();
    for t in data.themes {
        if t.id.as_deref().map(|id| exists(&tx, "presentation_themes", id)).transpose()?.unwrap_or(false) {
            r.skipped_existing += 1;
        } else {
            themes::save_theme_tx(&tx, t)?;
            r.themes_added += 1;
        }
    }
    for s in data.songs {
        if s.id.as_deref().map(|id| exists(&tx, "songs", id)).transpose()?.unwrap_or(false) {
            r.skipped_existing += 1;
        } else {
            songs::save_song_tx(&tx, songs::normalize_document(s)?)?;
            r.songs_added += 1;
        }
    }
    for d in data.decks {
        if d.id.as_deref().map(|id| exists(&tx, "custom_slides", id)).transpose()?.unwrap_or(false) {
            r.skipped_existing += 1;
        } else {
            slides::save_deck_tx(&tx, d)?;
            r.decks_added += 1;
        }
    }
    for p in data.services {
        if p.id.as_deref().map(|id| exists(&tx, "service_plans", id)).transpose()?.unwrap_or(false) {
            r.skipped_existing += 1;
        } else {
            services::save_plan_tx(&tx, services::normalize_document(p)?)?;
            r.services_added += 1;
        }
    }
    tx.commit()?;
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::services::{ServiceItemInput, ServiceItemType, ServiceStatus};
    use crate::slides::DeckCategory;
    use crate::songs::{SectionKind, SongSectionInput};
    use serde_json::json;

    fn setup(db: &Database) -> String {
        let song = db
            .write(|c| {
                songs::save_song(
                    c,
                    SongDocument {
                        id: None,
                        title: "Export Song".into(),
                        artist: None,
                        original_key: None,
                        tempo: None,
                        language: None,
                        category: None,
                        copyright_holder: Some("Holder".into()),
                        copyright_year: None,
                        ccli_number: None,
                        source: None,
                        license: None,
                        notes: None,
                        arrangement: None,
                        theme_id: None,
                        audio_media_id: None,
                        cover_media_id: None,
                        lyric_sync: None,
                        tags: vec![],
                        sections: vec![SongSectionInput::new(SectionKind::Verse, String::new(), "Line")],
                    },
                )
            })
            .unwrap();
        let deck = db
            .write(|c| {
                slides::save_deck(
                    c,
                    SlideDeckDocument {
                        id: None,
                        title: "Notices".into(),
                        category: DeckCategory::Announcement,
                        theme_id: None,
                        slides: json!([{ "id": "s1", "elements": [] }]),
                    },
                )
            })
            .unwrap();
        let plan = db
            .write(|c| {
                services::save_plan(
                    c,
                    ServicePlanDocument {
                        id: None,
                        title: "Export Service".into(),
                        service_date: Some("2026-11-01".into()),
                        service_time: None,
                        description: None,
                        notes: None,
                        status: ServiceStatus::Ready,
                        is_template: false,
                        theme_id: None,
                        items: vec![
                            ServiceItemInput { id: None, item_type: ServiceItemType::Song, title: "Export Song".into(), ref_id: Some(song.id), settings: json!({}), notes: None },
                            ServiceItemInput { id: None, item_type: ServiceItemType::Announcement, title: "Notices".into(), ref_id: Some(deck.id), settings: json!({}), notes: None },
                            ServiceItemInput { id: None, item_type: ServiceItemType::Scripture, title: "John 3:16".into(), ref_id: None, settings: json!({ "passages": [] }), notes: None },
                        ],
                    },
                )
            })
            .unwrap();
        plan.id
    }

    #[test]
    fn service_export_imports_into_another_library() {
        let dir = tempfile::tempdir().unwrap();
        let src = Database::open_in_memory().unwrap();
        let plan_id = setup(&src);
        let path = dir.path().join("service.json");
        src.read(|c| export_service(c, &plan_id, &path)).unwrap();

        let dst = Database::open_in_memory().unwrap();
        let r = dst.write(|c| import_service(c, &path)).unwrap();
        assert_eq!((r.songs_added, r.decks_added), (1, 1));
        let plan = dst.read(|c| services::get_plan(c, &r.plan_id)).unwrap();
        assert_ne!(plan.id, plan_id);
        assert_eq!(plan.items.len(), 3);
        // The song reference resolves in the new library.
        assert!(dst.read(|c| songs::get_song(c, plan.items[0].ref_id.as_deref().unwrap())).is_ok());

        // Importing again reuses the already-present song.
        let again = dst.write(|c| import_service(c, &path)).unwrap();
        assert_eq!((again.songs_added, again.songs_already_present), (0, 1));
    }

    #[test]
    fn library_dataset_round_trip_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let src = Database::open_in_memory().unwrap();
        setup(&src);
        let path = dir.path().join("library.json");
        let export = src.read(|c| export_library(c, &path)).unwrap();
        assert_eq!((export.songs.len(), export.services.len(), export.decks.len()), (1, 1, 1));

        let dst = Database::open_in_memory().unwrap();
        let r = dst.write(|c| import_library(c, &path)).unwrap();
        assert_eq!((r.songs_added, r.services_added, r.decks_added), (1, 1, 1));
        let again = dst.write(|c| import_library(c, &path)).unwrap();
        assert_eq!(again.skipped_existing, 3);
        assert_eq!(again.songs_added, 0);
    }
}
