//! Managed media library. Files are copied into the managed media directory
//! (originals are never modified), identified by content checksum, and
//! validated by both extension and file signature.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::sync;
use crate::util::{new_id, now_iso};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum MediaKind {
    Image,
    Video,
    Audio,
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaKind::Image => "image",
            MediaKind::Video => "video",
            MediaKind::Audio => "audio",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "image" => Some(MediaKind::Image),
            "video" => Some(MediaKind::Video),
            "audio" => Some(MediaKind::Audio),
            _ => None,
        }
    }

    fn folder(self) -> &'static str {
        match self {
            MediaKind::Image => "images",
            MediaKind::Video => "videos",
            MediaKind::Audio => "audio",
        }
    }
}

/// Why a file is in the library. Pictures made from an imported presentation
/// belong to its slides and are kept out of the Media Library list.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum MediaPurpose {
    #[default]
    Library,
    Slide,
}

impl MediaPurpose {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaPurpose::Library => "library",
            MediaPurpose::Slide => "slide",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "library" => Some(MediaPurpose::Library),
            "slide" => Some(MediaPurpose::Slide),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaAsset {
    pub id: String,
    pub kind: MediaKind,
    pub title: String,
    pub original_filename: String,
    pub stored_path: String,
    pub mime_type: String,
    #[ts(type = "number")]
    pub size_bytes: i64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[ts(type = "number | null")]
    pub duration_ms: Option<i64>,
    pub checksum_sha256: String,
    pub thumbnail_path: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub purpose: MediaPurpose,
    /// The Media Library folder it is kept in, if any.
    pub folder: Option<String>,
    /// True when the managed file is no longer on disk.
    pub missing: bool,
    /// Absolute path of the managed file (for playback via the asset protocol).
    pub absolute_path: String,
    pub thumbnail_absolute_path: Option<String>,
}

/// Recognized formats: (extension, kind, mime type).
const FORMATS: &[(&str, MediaKind, &str)] = &[
    ("jpg", MediaKind::Image, "image/jpeg"),
    ("jpeg", MediaKind::Image, "image/jpeg"),
    ("png", MediaKind::Image, "image/png"),
    ("gif", MediaKind::Image, "image/gif"),
    ("webp", MediaKind::Image, "image/webp"),
    ("bmp", MediaKind::Image, "image/bmp"),
    ("avif", MediaKind::Image, "image/avif"),
    ("mp4", MediaKind::Video, "video/mp4"),
    ("m4v", MediaKind::Video, "video/mp4"),
    ("mov", MediaKind::Video, "video/quicktime"),
    ("webm", MediaKind::Video, "video/webm"),
    ("mkv", MediaKind::Video, "video/x-matroska"),
    ("mp3", MediaKind::Audio, "audio/mpeg"),
    ("m4a", MediaKind::Audio, "audio/mp4"),
    ("aac", MediaKind::Audio, "audio/aac"),
    ("wav", MediaKind::Audio, "audio/wav"),
    ("ogg", MediaKind::Audio, "audio/ogg"),
    ("opus", MediaKind::Audio, "audio/ogg"),
    ("flac", MediaKind::Audio, "audio/flac"),
];

pub fn supported_extensions() -> Vec<&'static str> {
    FORMATS.iter().map(|(e, _, _)| *e).collect()
}

/// Checks the file signature against what the extension claims.
fn signature_matches(ext: &str, head: &[u8]) -> bool {
    let at = |offset: usize, sig: &[u8]| head.len() >= offset + sig.len() && &head[offset..offset + sig.len()] == sig;
    let ftyp_brand = || if at(4, b"ftyp") && head.len() >= 12 { Some(&head[8..12]) } else { None };
    match ext {
        "jpg" | "jpeg" => at(0, &[0xFF, 0xD8, 0xFF]),
        "png" => at(0, &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        "gif" => at(0, b"GIF87a") || at(0, b"GIF89a"),
        "webp" => at(0, b"RIFF") && at(8, b"WEBP"),
        "bmp" => at(0, b"BM"),
        "avif" => matches!(ftyp_brand(), Some(b"avif") | Some(b"avis") | Some(b"mif1")),
        "mp4" | "m4v" | "mov" | "m4a" => {
            ftyp_brand().is_some() || at(4, b"moov") || at(4, b"mdat") || at(4, b"wide") || at(4, b"free")
        }
        "webm" | "mkv" => at(0, &[0x1A, 0x45, 0xDF, 0xA3]),
        "mp3" => at(0, b"ID3") || (head.len() >= 2 && head[0] == 0xFF && head[1] & 0xE0 == 0xE0),
        "aac" => at(0, b"ID3") || (head.len() >= 2 && head[0] == 0xFF && head[1] & 0xF6 == 0xF0),
        "wav" => at(0, b"RIFF") && at(8, b"WAVE"),
        "ogg" | "opus" => at(0, b"OggS"),
        "flac" => at(0, b"fLaC"),
        _ => false,
    }
}

/// Returns the media kind and mime type for a file, or a clear error.
pub fn detect(path: &Path) -> Result<(MediaKind, &'static str, String)> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let Some((ext, kind, mime)) = FORMATS.iter().find(|(e, _, _)| *e == ext) else {
        return Err(Error::Unsupported(format!(
            "'.{ext}' files are not supported. Supported types: {}.",
            supported_extensions().join(", ")
        )));
    };
    let mut head = [0u8; 64];
    let mut f = File::open(path)?;
    let n = f.read(&mut head)?;
    if !signature_matches(ext, &head[..n]) {
        return Err(Error::validation(format!(
            "The contents of {} do not look like a .{ext} file. It may be damaged or misnamed.",
            path.file_name().and_then(|n| n.to_str()).unwrap_or("the file")
        )));
    }
    Ok((*kind, mime, ext.to_string()))
}

/// Joins a stored relative path onto the media root, refusing anything that
/// could escape it (absolute paths, `..`, drive prefixes).
pub fn resolve_stored_path(root: &Path, rel: &str) -> Result<PathBuf> {
    let rel_path = Path::new(rel);
    if rel.is_empty() || !rel_path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(Error::validation("Invalid media path."));
    }
    Ok(root.join(rel_path))
}

fn asset_from_row(r: &Row, root: &Path) -> rusqlite::Result<MediaAsset> {
    let kind: String = r.get(1)?;
    let stored: String = r.get(4)?;
    let tags: String = r.get(12)?;
    let thumb: Option<String> = r.get(11)?;
    let abs = resolve_stored_path(root, &stored).ok();
    let thumb_abs = thumb.as_deref().and_then(|t| resolve_stored_path(root, t).ok()).filter(|p| p.exists());
    Ok(MediaAsset {
        id: r.get(0)?,
        kind: MediaKind::parse(&kind).unwrap_or(MediaKind::Image),
        title: r.get(2)?,
        original_filename: r.get(3)?,
        missing: abs.as_ref().map(|p| !p.is_file()).unwrap_or(true),
        absolute_path: abs.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        stored_path: stored,
        mime_type: r.get(5)?,
        size_bytes: r.get(6)?,
        width: r.get(7)?,
        height: r.get(8)?,
        duration_ms: r.get(9)?,
        checksum_sha256: r.get(10)?,
        thumbnail_absolute_path: thumb_abs.map(|p| p.to_string_lossy().into_owned()),
        thumbnail_path: thumb,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
        purpose: MediaPurpose::parse(&r.get::<_, String>(15)?).unwrap_or_default(),
        folder: r.get(16)?,
    })
}

const COLUMNS: &str = "id, kind, title, original_filename, stored_path, mime_type, size_bytes, width, height, \
    duration_ms, checksum_sha256, thumbnail_path, tags, created_at, updated_at, purpose, folder";

pub fn get_media(conn: &Connection, root: &Path, id: &str) -> Result<MediaAsset> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM media_assets WHERE id = ?1 AND deleted_at IS NULL"), [id], |r| {
        asset_from_row(r, root)
    })
    .optional()?
    .ok_or_else(|| Error::not_found("The media file was not found in the library."))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct MediaQuery {
    pub kind: Option<MediaKind>,
    pub text: Option<String>,
    /// Also list pictures that belong to imported presentations.
    #[ts(optional)]
    pub include_slide_pictures: Option<bool>,
    /// Only files in this folder.
    #[ts(optional)]
    pub folder: Option<String>,
}

pub fn list_media(conn: &Connection, root: &Path, q: &MediaQuery) -> Result<Vec<MediaAsset>> {
    let text = q.text.as_ref().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty());
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM media_assets WHERE deleted_at IS NULL AND (?1 IS NULL OR kind = ?1)
         AND (?2 IS NULL OR instr(lower(title), ?2) > 0 OR instr(lower(tags), ?2) > 0)
         AND (?3 OR purpose = 'library')
         AND (?4 IS NULL OR folder = ?4)
         ORDER BY created_at DESC"
    ))?;
    let all = q.include_slide_pictures.unwrap_or(false);
    let rows = stmt.query_map(params![q.kind.map(|k| k.as_str()), text, all, q.folder], |r| asset_from_row(r, root))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaImportResult {
    pub asset: MediaAsset,
    /// The same file content was already in the library; no copy was made.
    pub duplicate: bool,
}

const MAX_MEDIA_BYTES: u64 = 16 * 1024 * 1024 * 1024;

/// Copies a file into the managed library, hashing while copying so large
/// videos are never loaded into memory. Identical content is detected and the
/// existing asset returned instead of storing a second copy.
pub fn import_file(conn: &mut Connection, root: &Path, source: &Path) -> Result<MediaImportResult> {
    import_file_as(conn, root, source, MediaPurpose::Library)
}

/// [`import_file`] for a given purpose. A picture already in the Media
/// Library stays there; importing a slide picture into the library moves it
/// into the list.
pub fn import_file_as(conn: &mut Connection, root: &Path, source: &Path, purpose: MediaPurpose) -> Result<MediaImportResult> {
    let meta = std::fs::metadata(source).map_err(|_| Error::not_found(format!("{} could not be opened.", source.display())))?;
    if !meta.is_file() {
        return Err(Error::validation("Only files can be imported."));
    }
    if meta.len() == 0 {
        return Err(Error::validation("The file is empty."));
    }
    if meta.len() > MAX_MEDIA_BYTES {
        return Err(Error::validation("The file is too large to import."));
    }
    let (kind, mime, ext) = detect(source)?;
    let id = new_id();
    let rel = format!("{}/{}.{}", kind.folder(), id, ext);
    let dest = resolve_stored_path(root, &rel)?;
    std::fs::create_dir_all(dest.parent().expect("has parent"))?;
    let tmp = dest.with_extension(format!("{ext}.partial"));

    let checksum = {
        let mut reader = BufReader::new(File::open(source)?);
        let mut writer = BufWriter::new(File::create(&tmp)?);
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1024 * 1024];
        let copy = (|| -> Result<()> {
            loop {
                let n = reader.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
                writer.write_all(&buf[..n])?;
            }
            writer.flush()?;
            writer.get_ref().sync_all()?;
            Ok(())
        })();
        if let Err(e) = copy {
            drop(writer);
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        hex::encode(hasher.finalize())
    };

    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM media_assets WHERE checksum_sha256 = ?1 AND deleted_at IS NULL LIMIT 1",
            [&checksum],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(existing) = existing {
        if purpose == MediaPurpose::Library {
            let tx = conn.transaction()?;
            let rev: Option<i64> = tx
                .query_row("SELECT revision FROM media_assets WHERE id = ?1 AND purpose = 'slide'", [&existing], |r| r.get(0))
                .optional()?;
            if let Some(rev) = rev {
                tx.execute(
                    "UPDATE media_assets SET purpose = 'library', updated_at = ?2, revision = ?3 WHERE id = ?1",
                    params![existing, now_iso(), rev + 1],
                )?;
                sync::enqueue(&tx, sync::ENTITY_MEDIA_ASSET, &existing, sync::OP_UPSERT, rev + 1)?;
            }
            tx.commit()?;
        }
        let asset = get_media(conn, root, &existing)?;
        if !asset.missing {
            std::fs::remove_file(&tmp)?;
            return Ok(MediaImportResult { asset, duplicate: true });
        }
        // The library record exists but its file is gone: restore the file.
        let target = resolve_stored_path(root, &asset.stored_path)?;
        std::fs::create_dir_all(target.parent().expect("has parent"))?;
        std::fs::rename(&tmp, &target)?;
        return Ok(MediaImportResult { asset: get_media(conn, root, &existing)?, duplicate: true });
    }
    std::fs::rename(&tmp, &dest)?;

    let original = source.file_name().and_then(|n| n.to_str()).unwrap_or("media").to_string();
    let title = Path::new(&original).file_stem().and_then(|s| s.to_str()).unwrap_or(&original).to_string();
    let now = now_iso();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO media_assets (id, kind, title, original_filename, stored_path, mime_type, size_bytes,
           checksum_sha256, created_at, updated_at, purpose)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)",
        params![id, kind.as_str(), title, original, rel, mime, meta.len() as i64, checksum, now, purpose.as_str()],
    )?;
    sync::enqueue(&tx, sync::ENTITY_MEDIA_ASSET, &id, sync::OP_UPSERT, 1)?;
    if let Err(e) = tx.commit() {
        let _ = std::fs::remove_file(&dest);
        return Err(e.into());
    }
    Ok(MediaImportResult { asset: get_media(conn, root, &id)?, duplicate: false })
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaDetailsInput {
    pub title: String,
    pub tags: Vec<String>,
}

pub fn update_details(conn: &mut Connection, root: &Path, id: &str, input: MediaDetailsInput) -> Result<MediaAsset> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(Error::validation("Enter a title for the media file."));
    }
    let tags: Vec<String> = input.tags.iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
    let tx = conn.transaction()?;
    let rev: i64 = tx
        .query_row("SELECT revision FROM media_assets WHERE id = ?1 AND deleted_at IS NULL", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error::not_found("The media file was not found in the library."))?;
    tx.execute(
        "UPDATE media_assets SET title = ?2, tags = ?3, updated_at = ?4, revision = ?5 WHERE id = ?1",
        params![id, title, serde_json::to_string(&tags)?, now_iso(), rev + 1],
    )?;
    sync::enqueue(&tx, sync::ENTITY_MEDIA_ASSET, id, sync::OP_UPSERT, rev + 1)?;
    tx.commit()?;
    get_media(conn, root, id)
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaProbe {
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[ts(type = "number | null")]
    pub duration_ms: Option<i64>,
}

/// A folder name as stored: trimmed, single spaces, 1–80 characters. None
/// (or an empty name) means no folder.
pub fn normalize_folder(name: Option<&str>) -> Result<Option<String>> {
    let Some(name) = name.map(|n| n.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|n| !n.is_empty()) else {
        return Ok(None);
    };
    if name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(Error::validation("Folder names can have up to 80 letters, numbers and symbols."));
    }
    Ok(Some(name))
}

/// Puts files into a folder (or takes them out of any with None).
pub fn set_folder(conn: &mut Connection, ids: &[String], folder: Option<&str>) -> Result<usize> {
    let folder = normalize_folder(folder)?;
    let tx = conn.transaction()?;
    let mut changed = 0;
    for id in ids {
        let row: Option<(i64, Option<String>)> = tx
            .query_row("SELECT revision, folder FROM media_assets WHERE id = ?1 AND deleted_at IS NULL", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        let Some((rev, current)) = row else { continue };
        if current == folder {
            continue;
        }
        tx.execute(
            "UPDATE media_assets SET folder = ?2, updated_at = ?3, revision = ?4 WHERE id = ?1",
            params![id, folder, now_iso(), rev + 1],
        )?;
        sync::enqueue(&tx, sync::ENTITY_MEDIA_ASSET, id, sync::OP_UPSERT, rev + 1)?;
        changed += 1;
    }
    tx.commit()?;
    Ok(changed)
}

/// Renames a folder; renaming onto an existing folder merges the two.
pub fn rename_folder(conn: &mut Connection, from: &str, to: &str) -> Result<usize> {
    let from = normalize_folder(Some(from))?.ok_or_else(|| Error::validation("Choose a folder."))?;
    let to = normalize_folder(Some(to))?.ok_or_else(|| Error::validation("Enter a folder name."))?;
    let ids: Vec<String> = conn
        .prepare("SELECT id FROM media_assets WHERE folder = ?1 AND deleted_at IS NULL")?
        .query_map([&from], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    set_folder(conn, &ids, Some(&to))
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaFolder {
    pub name: String,
    pub count: u32,
    /// Up to four pictures (or video stills) for the folder's cover.
    pub cover_ids: Vec<String>,
}

/// Folders in use in the Media Library, A–Z.
pub fn list_folders(conn: &Connection) -> Result<Vec<MediaFolder>> {
    let mut folders: Vec<MediaFolder> = conn
        .prepare(
            "SELECT folder, COUNT(*) FROM media_assets WHERE folder IS NOT NULL AND deleted_at IS NULL AND purpose = 'library'
             GROUP BY folder ORDER BY folder COLLATE NOCASE",
        )?
        .query_map([], |r| Ok(MediaFolder { name: r.get(0)?, count: r.get(1)?, cover_ids: Vec::new() }))?
        .collect::<std::result::Result<_, _>>()?;
    let mut covers = conn.prepare(
        "SELECT id FROM media_assets WHERE folder = ?1 AND deleted_at IS NULL AND purpose = 'library' AND kind IN ('image', 'video')
         ORDER BY kind = 'video', created_at DESC LIMIT 4",
    )?;
    for f in &mut folders {
        f.cover_ids = covers.query_map([&f.name], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
    }
    Ok(folders)
}

/// Stores dimensions / duration measured by the media player. Local only.
pub fn set_probe(conn: &Connection, id: &str, probe: &MediaProbe) -> Result<()> {
    conn.execute(
        "UPDATE media_assets SET width = COALESCE(?2, width), height = COALESCE(?3, height),
           duration_ms = COALESCE(?4, duration_ms) WHERE id = ?1",
        params![id, probe.width, probe.height, probe.duration_ms],
    )?;
    Ok(())
}

const MAX_THUMBNAIL_BYTES: usize = 4 * 1024 * 1024;

/// Saves a thumbnail rendered by the UI (PNG, JPEG or WebP).
pub fn set_thumbnail(conn: &Connection, root: &Path, id: &str, bytes: &[u8]) -> Result<String> {
    if bytes.is_empty() || bytes.len() > MAX_THUMBNAIL_BYTES {
        return Err(Error::validation("The thumbnail image is empty or too large."));
    }
    let ext = if signature_matches("png", bytes) {
        "png"
    } else if signature_matches("jpg", bytes) {
        "jpg"
    } else if signature_matches("webp", bytes) {
        "webp"
    } else {
        return Err(Error::validation("Thumbnails must be PNG, JPEG or WebP images."));
    };
    let exists: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM media_assets WHERE id = ?1)", [id], |r| r.get(0))?;
    if !exists {
        return Err(Error::not_found("The media file was not found in the library."));
    }
    let rel = format!("thumbnails/{id}.{ext}");
    let path = resolve_stored_path(root, &rel)?;
    std::fs::create_dir_all(path.parent().expect("has parent"))?;
    let tmp = path.with_extension("partial");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &path)?;
    conn.execute("UPDATE media_assets SET thumbnail_path = ?2 WHERE id = ?1", params![id, rel])?;
    Ok(path.to_string_lossy().into_owned())
}

/// Places that use a media file, shown to the operator before deleting it.
pub fn references(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let pattern = format!("%{id}%");
    let mut out = Vec::new();
    let mut q = |sql: &str, label: &str| -> Result<()> {
        let mut stmt = conn.prepare(sql)?;
        let names: Vec<String> = stmt.query_map([&pattern], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        out.extend(names.into_iter().map(|n| format!("{label}: {n}")));
        Ok(())
    };
    q("SELECT name FROM presentation_themes WHERE deleted_at IS NULL AND settings LIKE ?1", "Theme")?;
    q("SELECT title FROM custom_slides WHERE deleted_at IS NULL AND slides LIKE ?1", "Slides")?;
    q("SELECT title FROM songs WHERE deleted_at IS NULL AND (audio_media_id LIKE ?1 OR cover_media_id LIKE ?1)", "Song")?;
    q(
        "SELECT p.title || ' — ' || i.title FROM service_items i JOIN service_plans p ON p.id = i.plan_id
         WHERE p.deleted_at IS NULL AND (i.ref_id LIKE ?1 OR i.settings LIKE ?1)",
        "Service",
    )?;
    q("SELECT key FROM app_settings WHERE value LIKE ?1", "Setting")?;
    Ok(out)
}

/// Removes a media file from the library and deletes the managed copy.
pub fn delete_media(conn: &mut Connection, root: &Path, id: &str) -> Result<()> {
    let asset = get_media(conn, root, id)?;
    let tx = conn.transaction()?;
    let rev: i64 = tx.query_row("SELECT revision FROM media_assets WHERE id = ?1", [id], |r| r.get(0))?;
    tx.execute(
        "UPDATE media_assets SET deleted_at = ?2, updated_at = ?2, revision = ?3 WHERE id = ?1",
        params![id, now_iso(), rev + 1],
    )?;
    sync::enqueue(&tx, sync::ENTITY_MEDIA_ASSET, id, sync::OP_DELETE, rev + 1)?;
    tx.commit()?;
    for rel in [Some(asset.stored_path), asset.thumbnail_path].into_iter().flatten() {
        if let Ok(p) = resolve_stored_path(root, &rel) {
            if p.exists() {
                if let Err(e) = std::fs::remove_file(&p) {
                    log::warn!("could not remove media file {}: {e}", p.display());
                }
            }
        }
    }
    Ok(())
}

/// Media ids used by a slide deck's slides (backgrounds and pictures).
pub fn deck_media_ids(slides: &serde_json::Value) -> Vec<String> {
    let mut ids = Vec::new();
    for slide in slides.as_array().into_iter().flatten() {
        if let Some(id) = slide.pointer("/background/mediaId").and_then(|v| v.as_str()) {
            ids.push(id.to_string());
        }
        for el in slide.get("elements").and_then(|e| e.as_array()).into_iter().flatten() {
            if let Some(id) = el.get("mediaId").and_then(|v| v.as_str()) {
                ids.push(id.to_string());
            }
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

/// Deletes slide pictures (from imported presentations) that nothing uses
/// any more, for example after their slide deck was deleted. Pictures in the
/// Media Library are never touched. Returns how many were removed.
pub fn delete_unused_slide_pictures(conn: &mut Connection, root: &Path, ids: &[String]) -> Result<usize> {
    let mut removed = 0;
    for id in ids {
        let is_slide = conn
            .query_row("SELECT 1 FROM media_assets WHERE id = ?1 AND purpose = 'slide' AND deleted_at IS NULL", [id], |_| Ok(()))
            .optional()?
            .is_some();
        if is_slide && references(conn, id)?.is_empty() {
            delete_media(conn, root, id)?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Ids of library entries whose files are missing from disk.
pub fn missing_files(conn: &Connection, root: &Path) -> Result<Vec<String>> {
    let all = MediaQuery { include_slide_pictures: Some(true), ..Default::default() };
    Ok(list_media(conn, root, &all)?.into_iter().filter(|a| a.missing).map(|a| a.id).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn png_bytes() -> Vec<u8> {
        let mut v = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        v.extend_from_slice(&[0u8; 100]);
        v
    }

    #[test]
    fn folders_group_media_and_can_be_renamed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("media");
        let db = Database::open_in_memory().unwrap();
        let mut ids = Vec::new();
        for (name, extra) in [("a.png", 1u8), ("b.png", 2), ("c.png", 3)] {
            let src = dir.path().join(name);
            let mut bytes = png_bytes();
            bytes.push(extra);
            std::fs::write(&src, bytes).unwrap();
            ids.push(db.write(|c| import_file(c, &root, &src)).unwrap().asset.id);
        }
        assert_eq!(normalize_folder(Some("  Youth   Camp ")).unwrap().as_deref(), Some("Youth Camp"));
        assert_eq!(normalize_folder(Some("   ")).unwrap(), None);
        assert!(normalize_folder(Some(&"x".repeat(81))).is_err());

        assert_eq!(db.write(|c| set_folder(c, &ids[..2], Some(" Youth  Camp"))).unwrap(), 2);
        // Setting the same folder again changes nothing.
        assert_eq!(db.write(|c| set_folder(c, &ids[..1], Some("Youth Camp"))).unwrap(), 0);
        let folders = db.read(list_folders).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!((folders[0].name.as_str(), folders[0].count, folders[0].cover_ids.len()), ("Youth Camp", 2, 2));
        let in_folder = |name: &str| {
            db.read(|c| list_media(c, &root, &MediaQuery { folder: Some(name.into()), ..Default::default() })).unwrap().len()
        };
        assert_eq!(in_folder("Youth Camp"), 2);
        assert_eq!(db.read(|c| list_media(c, &root, &MediaQuery::default())).unwrap().len(), 3);

        assert_eq!(db.write(|c| rename_folder(c, "Youth Camp", "Camp 2026")).unwrap(), 2);
        assert_eq!(in_folder("Camp 2026"), 2);
        assert_eq!(in_folder("Youth Camp"), 0);
        assert_eq!(db.read(|c| get_media(c, &root, &ids[0])).unwrap().folder.as_deref(), Some("Camp 2026"));
        // Out of the folder again.
        db.write(|c| set_folder(c, &ids, None)).unwrap();
        assert!(db.read(list_folders).unwrap().is_empty());
    }

    #[test]
    fn imports_validates_dedupes_and_deletes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("media");
        let db = Database::open_in_memory().unwrap();

        let src = dir.path().join("Sunrise Background.png");
        std::fs::write(&src, png_bytes()).unwrap();
        let r = db.write(|c| import_file(c, &root, &src)).unwrap();
        assert!(!r.duplicate);
        assert_eq!(r.asset.kind, MediaKind::Image);
        assert_eq!(r.asset.title, "Sunrise Background");
        assert!(!r.asset.missing);
        assert!(src.exists(), "the original is preserved");

        // Same content under another name is detected as a duplicate.
        let copy = dir.path().join("copy.png");
        std::fs::write(&copy, png_bytes()).unwrap();
        let dup = db.write(|c| import_file(c, &root, &copy)).unwrap();
        assert!(dup.duplicate);
        assert_eq!(dup.asset.id, r.asset.id);

        // A misnamed file is rejected by signature.
        let fake = dir.path().join("fake.mp4");
        std::fs::write(&fake, b"this is not a video at all").unwrap();
        assert_eq!(db.write(|c| import_file(c, &root, &fake)).unwrap_err().code(), "validation");
        let exe = dir.path().join("tool.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        assert_eq!(db.write(|c| import_file(c, &root, &exe)).unwrap_err().code(), "unsupported");

        // Missing files are detected.
        std::fs::remove_file(root.join(&r.asset.stored_path)).unwrap();
        assert_eq!(db.read(|c| missing_files(c, &root)).unwrap(), vec![r.asset.id.clone()]);
        // Re-importing the same content restores the file.
        let restored = db.write(|c| import_file(c, &root, &src)).unwrap();
        assert!(!restored.asset.missing);

        db.write(|c| delete_media(c, &root, &r.asset.id)).unwrap();
        assert!(db.read(|c| list_media(c, &root, &MediaQuery::default())).unwrap().is_empty());
        assert!(!root.join(&r.asset.stored_path).exists());
    }

    #[test]
    fn slide_pictures_stay_out_of_the_list_and_go_with_their_deck() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("media");
        let db = Database::open_in_memory().unwrap();
        let page = dir.path().join("Sunday - page 1.png");
        std::fs::write(&page, png_bytes()).unwrap();
        let pic = db.write(|c| import_file_as(c, &root, &page, MediaPurpose::Slide)).unwrap().asset;
        assert_eq!(pic.purpose, MediaPurpose::Slide);
        assert!(db.read(|c| list_media(c, &root, &MediaQuery::default())).unwrap().is_empty());
        let all = MediaQuery { include_slide_pictures: Some(true), ..Default::default() };
        assert_eq!(db.read(|c| list_media(c, &root, &all)).unwrap().len(), 1);

        let slides = serde_json::json!([{ "id": "s1", "background": { "type": "image", "mediaId": pic.id }, "elements": [] }]);
        let doc = crate::slides::SlideDeckDocument {
            id: None,
            title: "Sunday".into(),
            category: crate::slides::DeckCategory::Custom,
            theme_id: None,
            slides: slides.clone(),
        };
        let deck = db.write(|c| crate::slides::save_deck(c, doc)).unwrap();
        assert_eq!(deck_media_ids(&slides), vec![pic.id.clone()]);
        // Still used by the deck: kept.
        assert_eq!(db.write(|c| delete_unused_slide_pictures(c, &root, std::slice::from_ref(&pic.id))).unwrap(), 0);
        db.write(|c| crate::slides::delete_deck(c, &deck.id)).unwrap();
        assert_eq!(db.write(|c| delete_unused_slide_pictures(c, &root, std::slice::from_ref(&pic.id))).unwrap(), 1);
        assert!(db.read(|c| get_media(c, &root, &pic.id)).is_err());

        // A library picture is never removed this way, and importing a slide
        // picture into the library moves it into the list.
        let logo = dir.path().join("logo.png");
        let mut other = png_bytes();
        other.push(7);
        std::fs::write(&logo, &other).unwrap();
        let slide_copy = db.write(|c| import_file_as(c, &root, &logo, MediaPurpose::Slide)).unwrap().asset;
        let promoted = db.write(|c| import_file(c, &root, &logo)).unwrap();
        assert!(promoted.duplicate);
        assert_eq!(promoted.asset.id, slide_copy.id);
        assert_eq!(promoted.asset.purpose, MediaPurpose::Library);
        assert_eq!(db.write(|c| delete_unused_slide_pictures(c, &root, std::slice::from_ref(&slide_copy.id))).unwrap(), 0);
    }

    #[test]
    fn rejects_path_traversal() {
        let root = Path::new("C:/media");
        assert!(resolve_stored_path(root, "../secret.txt").is_err());
        assert!(resolve_stored_path(root, "images/../../x").is_err());
        assert!(resolve_stored_path(root, "C:/Windows/x").is_err());
        assert!(resolve_stored_path(root, "").is_err());
        assert!(resolve_stored_path(root, "images/a.png").is_ok());
    }

    #[test]
    fn video_signatures() {
        let mut mp4 = vec![0, 0, 0, 0x20];
        mp4.extend_from_slice(b"ftypisom");
        assert!(signature_matches("mp4", &mp4));
        assert!(signature_matches("webm", &[0x1A, 0x45, 0xDF, 0xA3, 0]));
        assert!(!signature_matches("mp4", b"hello world!"));
    }

    #[test]
    fn thumbnails_and_references() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("media");
        let db = Database::open_in_memory().unwrap();
        let src = dir.path().join("logo.png");
        std::fs::write(&src, png_bytes()).unwrap();
        let a = db.write(|c| import_file(c, &root, &src)).unwrap().asset;
        db.write(|c| set_thumbnail(c, &root, &a.id, &png_bytes())).unwrap();
        assert!(db.write(|c| set_thumbnail(c, &root, &a.id, b"<svg/>")).is_err());
        let with_thumb = db.read(|c| get_media(c, &root, &a.id)).unwrap();
        assert!(with_thumb.thumbnail_absolute_path.is_some());
        db.write(|c| crate::settings::set(c, "presentation.logoMediaId", &serde_json::json!(a.id))).unwrap();
        let refs = db.read(|c| references(c, &a.id)).unwrap();
        assert_eq!(refs, vec!["Setting: presentation.logoMediaId".to_string()]);
        db.write(|c| set_probe(c, &a.id, &MediaProbe { width: Some(1920), height: Some(1080), duration_ms: None })).unwrap();
        assert_eq!(db.read(|c| get_media(c, &root, &a.id)).unwrap().width, Some(1920));
    }
}
