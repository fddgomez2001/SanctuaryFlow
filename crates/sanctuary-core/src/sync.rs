//! Local side of offline-first synchronization: the outbox of pending uploads,
//! applying remote changes, conflict records and sync metadata. The network
//! transport (Supabase) lives in the app; it drives these functions.
//!
//! Rules:
//! - Every local change to a synchronized aggregate bumps its `revision` and
//!   queues one outbox operation (newer edits replace a pending one).
//! - A remote change is applied directly only when the entity has no unsynced
//!   local edits. Otherwise a conflict is recorded and nothing is overwritten
//!   until the operator chooses how to resolve it.
//! - Deletions are tombstones (`deleted_at`), so they synchronize too.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::util::{new_id, now_iso};
use crate::{services, slides, songs, themes};

pub const ENTITY_SONG: &str = "song";
pub const ENTITY_SERVICE_PLAN: &str = "service_plan";
pub const ENTITY_THEME: &str = "theme";
pub const ENTITY_SLIDE_DECK: &str = "slide_deck";
pub const ENTITY_MEDIA_ASSET: &str = "media_asset";

pub const OP_UPSERT: &str = "upsert";
pub const OP_DELETE: &str = "delete";

pub const META_LAST_SYNC_AT: &str = "last_sync_at";
pub const META_PULL_CURSOR: &str = "pull_cursor";
pub const META_LAST_ERROR: &str = "last_error";
pub const META_ACCOUNT: &str = "account";

/// Entity type → table name. Only these tables are ever touched by sync.
fn table(entity_type: &str) -> Result<&'static str> {
    Ok(match entity_type {
        ENTITY_SONG => "songs",
        ENTITY_SERVICE_PLAN => "service_plans",
        ENTITY_THEME => "presentation_themes",
        ENTITY_SLIDE_DECK => "custom_slides",
        ENTITY_MEDIA_ASSET => "media_assets",
        other => return Err(Error::validation(format!("Unknown sync entity type '{other}'."))),
    })
}

const ALL_TYPES: [&str; 5] = [ENTITY_SONG, ENTITY_SERVICE_PLAN, ENTITY_THEME, ENTITY_SLIDE_DECK, ENTITY_MEDIA_ASSET];

/// Records that an entity changed locally. There is at most one open
/// operation per entity: a newer edit replaces a pending one with a fresh
/// operation id, so a retried upload of the old operation can never be
/// mistaken for the new content.
pub fn enqueue(conn: &Connection, entity_type: &str, entity_id: &str, operation: &str, local_revision: i64) -> Result<()> {
    let now = now_iso();
    let open: Option<(String, String)> = conn
        .query_row(
            "SELECT id, status FROM sync_outbox WHERE entity_type = ?1 AND entity_id = ?2 AND status != 'done'",
            params![entity_type, entity_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match open {
        Some((id, status)) if status == "conflict" => {
            // Keep the conflict visible until the operator resolves it.
            conn.execute(
                "UPDATE sync_outbox SET operation = ?2, local_revision = ?3, updated_at = ?4 WHERE id = ?1",
                params![id, operation, local_revision, now],
            )?;
        }
        Some((id, _)) => {
            conn.execute("DELETE FROM sync_outbox WHERE id = ?1", [&id])?;
            insert_op(conn, entity_type, entity_id, operation, local_revision, &now)?;
        }
        None => insert_op(conn, entity_type, entity_id, operation, local_revision, &now)?,
    }
    Ok(())
}

fn insert_op(conn: &Connection, entity_type: &str, entity_id: &str, operation: &str, rev: i64, now: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_outbox (id, entity_type, entity_id, operation, local_revision, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6)",
        params![new_id(), entity_type, entity_id, operation, rev, now],
    )?;
    Ok(())
}

pub fn get_metadata(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM sync_metadata WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

pub fn set_metadata(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_metadata (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now_iso()],
    )?;
    Ok(())
}

pub fn open_operation_count(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM sync_outbox WHERE status IN ('pending', 'failed')", [], |r| r.get(0))?)
}

pub fn open_conflict_count(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM sync_conflicts WHERE resolved_at IS NULL", [], |r| r.get(0))?)
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SyncStatus {
    #[ts(type = "number")]
    pub pending: i64,
    #[ts(type = "number")]
    pub failed: i64,
    #[ts(type = "number")]
    pub conflicts: i64,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub device_id: String,
}

pub fn status(conn: &Connection) -> Result<SyncStatus> {
    let n = |sql: &str| -> Result<i64> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };
    Ok(SyncStatus {
        pending: n("SELECT COUNT(*) FROM sync_outbox WHERE status = 'pending'")?,
        failed: n("SELECT COUNT(*) FROM sync_outbox WHERE status = 'failed'")?,
        conflicts: open_conflict_count(conn)?,
        last_sync_at: get_metadata(conn, META_LAST_SYNC_AT)?,
        last_error: get_metadata(conn, META_LAST_ERROR)?.filter(|e| !e.is_empty()),
        device_id: crate::seed::device_id(conn)?,
    })
}

/// The portable payload of an entity (what other devices receive).
pub fn entity_payload(conn: &Connection, entity_type: &str, id: &str) -> Result<Option<serde_json::Value>> {
    let value = match entity_type {
        ENTITY_SONG => songs::get_song(conn, id).ok().map(|s| serde_json::to_value(songs::to_document(&s))).transpose()?,
        ENTITY_SERVICE_PLAN => {
            services::get_plan(conn, id).ok().map(|p| serde_json::to_value(services::to_document(&p))).transpose()?
        }
        ENTITY_THEME => themes::get_theme(conn, id).ok().map(|t| serde_json::to_value(themes::to_document(&t))).transpose()?,
        ENTITY_SLIDE_DECK => slides::get_deck(conn, id).ok().map(|d| serde_json::to_value(slides::to_document(&d))).transpose()?,
        ENTITY_MEDIA_ASSET => conn
            .query_row(
                "SELECT id, kind, title, original_filename, mime_type, size_bytes, width, height, duration_ms,
                        checksum_sha256, tags, purpose, folder FROM media_assets WHERE id = ?1 AND deleted_at IS NULL",
                [id],
                |r| {
                    let tags: String = r.get(10)?;
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?,
                        "kind": r.get::<_, String>(1)?,
                        "title": r.get::<_, String>(2)?,
                        "originalFilename": r.get::<_, String>(3)?,
                        "mimeType": r.get::<_, String>(4)?,
                        "sizeBytes": r.get::<_, i64>(5)?,
                        "width": r.get::<_, Option<u32>>(6)?,
                        "height": r.get::<_, Option<u32>>(7)?,
                        "durationMs": r.get::<_, Option<i64>>(8)?,
                        "checksumSha256": r.get::<_, String>(9)?,
                        "tags": serde_json::from_str::<serde_json::Value>(&tags).unwrap_or(serde_json::json!([])),
                        "purpose": r.get::<_, String>(11)?,
                        "folder": r.get::<_, Option<String>>(12)?,
                    }))
                },
            )
            .optional()?,
        other => return Err(Error::validation(format!("Unknown sync entity type '{other}'."))),
    };
    Ok(value)
}

struct EntityMeta {
    revision: i64,
    synced_revision: i64,
    remote_version: Option<i64>,
    deleted: bool,
}

fn entity_meta(conn: &Connection, entity_type: &str, id: &str) -> Result<Option<EntityMeta>> {
    let t = table(entity_type)?;
    Ok(conn
        .query_row(
            &format!("SELECT revision, synced_revision, remote_version, deleted_at IS NOT NULL FROM {t} WHERE id = ?1"),
            [id],
            |r| Ok(EntityMeta { revision: r.get(0)?, synced_revision: r.get(1)?, remote_version: r.get(2)?, deleted: r.get(3)? }),
        )
        .optional()?)
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PendingChange {
    pub op_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub operation: String,
    #[ts(type = "number")]
    pub local_revision: i64,
    /// The server version this local edit was based on (`null` for new entities).
    #[ts(type = "number | null")]
    pub base_version: Option<i64>,
    pub payload: Option<serde_json::Value>,
    #[ts(type = "number")]
    pub retry_count: i64,
}

/// Song details that stay on this computer: its music, album cover and the
/// lyric timings made for that recording. They are never uploaded.
const LOCAL_ONLY_SONG_FIELDS: [&str; 3] = ["audioMediaId", "coverMediaId", "lyricSync"];

/// Music files (and their details) stay on this computer.
fn is_local_only(conn: &Connection, entity_type: &str, id: &str) -> Result<bool> {
    if entity_type != ENTITY_MEDIA_ASSET {
        return Ok(false);
    }
    let kind: Option<String> = conn.query_row("SELECT kind FROM media_assets WHERE id = ?1", [id], |r| r.get(0)).optional()?;
    Ok(kind.as_deref() == Some("audio"))
}

/// The content that is uploaded for an entity: everything except what stays local.
fn upload_payload(entity_type: &str, mut payload: serde_json::Value) -> serde_json::Value {
    if entity_type == ENTITY_SONG {
        if let Some(o) = payload.as_object_mut() {
            for key in LOCAL_ONLY_SONG_FIELDS {
                o.remove(key);
            }
        }
    }
    payload
}

/// Operations ready to upload (pending, or failed and due for retry).
pub fn pending_batch(conn: &Connection, limit: u32, now: &str) -> Result<Vec<PendingChange>> {
    let mut stmt = conn.prepare(
        "SELECT id, entity_type, entity_id, operation, local_revision, retry_count FROM sync_outbox
         WHERE status = 'pending' OR (status = 'failed' AND (next_attempt_at IS NULL OR next_attempt_at <= ?1))
         ORDER BY created_at LIMIT ?2",
    )?;
    let ops: Vec<(String, String, String, String, i64, i64)> = stmt
        .query_map(params![now, limit], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
        .collect::<std::result::Result<_, _>>()?;
    let mut out = Vec::with_capacity(ops.len());
    for (op_id, entity_type, entity_id, operation, local_revision, retry_count) in ops {
        if is_local_only(conn, &entity_type, &entity_id)? {
            conn.execute("UPDATE sync_outbox SET status = 'done', updated_at = ?2 WHERE id = ?1", params![op_id, now])?;
            continue;
        }
        let meta = entity_meta(conn, &entity_type, &entity_id)?;
        let payload = if operation == OP_UPSERT { entity_payload(conn, &entity_type, &entity_id)?.map(|p| upload_payload(&entity_type, p)) } else { None };
        if operation == OP_UPSERT && payload.is_none() {
            // The entity vanished locally (e.g. hard-deleted); nothing to send.
            conn.execute("UPDATE sync_outbox SET status = 'done', updated_at = ?2 WHERE id = ?1", params![op_id, now])?;
            continue;
        }
        out.push(PendingChange {
            op_id,
            entity_type,
            entity_id,
            operation,
            local_revision,
            base_version: meta.and_then(|m| m.remote_version),
            payload,
            retry_count,
        });
    }
    Ok(out)
}

/// Marks an upload as accepted by the server at `remote_version`.
pub fn mark_pushed(conn: &Connection, op_id: &str, remote_version: i64) -> Result<()> {
    let op: Option<(String, String, i64)> = conn
        .query_row("SELECT entity_type, entity_id, local_revision FROM sync_outbox WHERE id = ?1", [op_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    // The operation may have been replaced by a newer local edit meanwhile;
    // the entity's remote version still advances.
    let Some((entity_type, entity_id, local_revision)) = op else { return Ok(()) };
    let t = table(&entity_type)?;
    conn.execute(
        &format!("UPDATE {t} SET remote_version = ?2, synced_revision = MAX(synced_revision, ?3) WHERE id = ?1"),
        params![entity_id, remote_version, local_revision],
    )?;
    conn.execute(
        "UPDATE sync_outbox SET status = 'done', last_error = NULL, updated_at = ?2 WHERE id = ?1",
        params![op_id, now_iso()],
    )?;
    Ok(())
}

pub fn mark_failed(conn: &Connection, op_id: &str, error: &str, next_attempt_at: &str) -> Result<()> {
    conn.execute(
        "UPDATE sync_outbox SET status = 'failed', retry_count = retry_count + 1, last_error = ?2,
           next_attempt_at = ?3, updated_at = ?4 WHERE id = ?1",
        params![op_id, error, next_attempt_at, now_iso()],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteRecord {
    pub entity_type: String,
    pub entity_id: String,
    #[ts(type = "number")]
    pub version: i64,
    pub deleted: bool,
    pub payload: Option<serde_json::Value>,
    pub updated_by_device: Option<String>,
    pub updated_at: Option<String>,
}

fn record_conflict(conn: &Connection, remote: &RemoteRecord, local_payload: Option<serde_json::Value>) -> Result<()> {
    conn.execute(
        "UPDATE sync_conflicts SET resolved_at = ?3, resolution = 'keep_remote'
         WHERE entity_type = ?1 AND entity_id = ?2 AND resolved_at IS NULL",
        params![remote.entity_type, remote.entity_id, now_iso()],
    )?;
    conn.execute(
        "INSERT INTO sync_conflicts (id, entity_type, entity_id, local_payload, remote_payload, remote_version,
           remote_deleted, detected_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            new_id(),
            remote.entity_type,
            remote.entity_id,
            local_payload.map(|p| p.to_string()),
            remote.payload.as_ref().map(|p| p.to_string()),
            remote.version,
            remote.deleted,
            now_iso()
        ],
    )?;
    conn.execute(
        "UPDATE sync_outbox SET status = 'conflict', updated_at = ?3
         WHERE entity_type = ?1 AND entity_id = ?2 AND status != 'done'",
        params![remote.entity_type, remote.entity_id, now_iso()],
    )?;
    Ok(())
}

/// Called when the server rejected an upload because it has a newer version.
pub fn mark_conflict(conn: &mut Connection, op_id: &str, remote: &RemoteRecord) -> Result<()> {
    let tx = conn.transaction()?;
    let local = entity_payload(&tx, &remote.entity_type, &remote.entity_id)?;
    record_conflict(&tx, remote, local)?;
    tx.execute("UPDATE sync_outbox SET status = 'conflict' WHERE id = ?1", [op_id])?;
    tx.commit()?;
    Ok(())
}

/// Writes remote content into the local tables without creating outbox
/// traffic, then records the entity as in sync with `version`.
fn write_remote(conn: &Connection, remote: &RemoteRecord) -> Result<()> {
    let t = table(&remote.entity_type)?;
    if remote.deleted {
        conn.execute(
            &format!("UPDATE {t} SET deleted_at = COALESCE(deleted_at, ?2), updated_at = ?2 WHERE id = ?1"),
            params![remote.entity_id, now_iso()],
        )?;
        if remote.entity_type == ENTITY_SONG {
            conn.execute("DELETE FROM songs_fts WHERE song_id = ?1", [&remote.entity_id])?;
        }
    } else {
        let payload = remote.payload.clone().ok_or_else(|| Error::validation("Remote change has no content."))?;
        let mut with_id = payload;
        if let Some(o) = with_id.as_object_mut() {
            o.insert("id".into(), serde_json::Value::String(remote.entity_id.clone()));
        }
        match remote.entity_type.as_str() {
            ENTITY_SONG => {
                let mut doc: songs::SongDocument = serde_json::from_value(with_id)?;
                // The other computer never sends music; keep this computer's.
                if let Ok(local) = songs::get_song(conn, &remote.entity_id) {
                    doc.audio_media_id = local.audio_media_id;
                    doc.cover_media_id = local.cover_media_id;
                    doc.lyric_sync = local.lyric_sync;
                }
                songs::save_song_tx(conn, songs::normalize_document(doc)?)?;
            }
            ENTITY_SERVICE_PLAN => {
                let doc: services::ServicePlanDocument = serde_json::from_value(with_id)?;
                services::save_plan_tx(conn, services::normalize_document(doc)?)?;
            }
            ENTITY_THEME => {
                themes::save_theme_tx(conn, serde_json::from_value(with_id)?)?;
            }
            ENTITY_SLIDE_DECK => {
                slides::save_deck_tx(conn, serde_json::from_value(with_id)?)?;
            }
            ENTITY_MEDIA_ASSET => {
                // Only metadata of media already present locally is updated;
                // file content synchronizes separately.
                let title = with_id.get("title").and_then(|v| v.as_str()).unwrap_or("Media").to_string();
                let tags = with_id.get("tags").cloned().unwrap_or(serde_json::json!([]));
                let purpose = with_id.get("purpose").and_then(|v| v.as_str()).and_then(crate::media::MediaPurpose::parse).map(|p| p.as_str());
                // Older versions send no folder; then the local one is kept.
                let has_folder = with_id.get("folder").is_some();
                let folder = crate::media::normalize_folder(with_id.get("folder").and_then(|v| v.as_str())).unwrap_or(None);
                conn.execute(
                    "UPDATE media_assets SET title = ?2, tags = ?3, purpose = COALESCE(?4, purpose),
                       folder = CASE WHEN ?5 THEN ?6 ELSE folder END, deleted_at = NULL WHERE id = ?1",
                    params![remote.entity_id, title, tags.to_string(), purpose, has_folder, folder],
                )?;
            }
            _ => unreachable!("validated by table()"),
        }
    }
    // Saving above may have queued an operation and bumped the revision;
    // neither applies to content that came from the server.
    conn.execute(
        "DELETE FROM sync_outbox WHERE entity_type = ?1 AND entity_id = ?2 AND status != 'done'",
        params![remote.entity_type, remote.entity_id],
    )?;
    conn.execute(
        &format!("UPDATE {t} SET remote_version = ?2, synced_revision = revision WHERE id = ?1"),
        params![remote.entity_id, remote.version],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ApplyOutcome {
    Applied,
    Skipped,
    Conflict,
}

/// Applies one change pulled from the server.
pub fn apply_remote(conn: &mut Connection, remote: &RemoteRecord) -> Result<ApplyOutcome> {
    table(&remote.entity_type)?;
    let tx = conn.transaction()?;
    let meta = entity_meta(&tx, &remote.entity_type, &remote.entity_id)?;
    let outcome = match meta {
        Some(m) if m.remote_version.map(|v| v >= remote.version).unwrap_or(false) => ApplyOutcome::Skipped,
        None if remote.deleted => ApplyOutcome::Skipped,
        None if remote.entity_type == ENTITY_MEDIA_ASSET => ApplyOutcome::Skipped,
        None => {
            write_remote(&tx, remote)?;
            ApplyOutcome::Applied
        }
        Some(m) if m.revision > m.synced_revision => {
            let local = entity_payload(&tx, &remote.entity_type, &remote.entity_id)?;
            let same_content = match (&local, &remote.payload) {
                (Some(l), Some(r)) => strip_id(l) == strip_id(r),
                (None, None) => m.deleted && remote.deleted,
                _ => false,
            };
            if same_content || (m.deleted && remote.deleted) {
                write_remote(&tx, remote)?;
                ApplyOutcome::Applied
            } else {
                record_conflict(&tx, remote, local)?;
                ApplyOutcome::Conflict
            }
        }
        Some(_) => {
            write_remote(&tx, remote)?;
            ApplyOutcome::Applied
        }
    };
    tx.commit()?;
    Ok(outcome)
}

fn strip_id(v: &serde_json::Value) -> serde_json::Value {
    let mut v = v.clone();
    if let Some(o) = v.as_object_mut() {
        o.remove("id");
    }
    v
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SyncConflict {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub title: String,
    pub local_payload: Option<serde_json::Value>,
    pub remote_payload: Option<serde_json::Value>,
    #[ts(type = "number")]
    pub remote_version: i64,
    pub remote_deleted: bool,
    pub detected_at: String,
}

fn payload_title(p: &Option<serde_json::Value>) -> Option<String> {
    p.as_ref().and_then(|v| v.get("title").or_else(|| v.get("name"))).and_then(|t| t.as_str()).map(str::to_string)
}

pub fn list_conflicts(conn: &Connection) -> Result<Vec<SyncConflict>> {
    let mut stmt = conn.prepare(
        "SELECT id, entity_type, entity_id, local_payload, remote_payload, remote_version, remote_deleted, detected_at
         FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY detected_at",
    )?;
    let rows = stmt.query_map([], |r| {
        let local: Option<String> = r.get(3)?;
        let remote: Option<String> = r.get(4)?;
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, local, remote, r.get::<_, i64>(5)?, r.get::<_, bool>(6)?, r.get::<_, String>(7)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, entity_type, entity_id, local, remote, remote_version, remote_deleted, detected_at) = row?;
        let local_payload = local.and_then(|s| serde_json::from_str(&s).ok());
        let remote_payload = remote.and_then(|s| serde_json::from_str(&s).ok());
        let title = payload_title(&local_payload).or_else(|| payload_title(&remote_payload)).unwrap_or_else(|| entity_id.clone());
        out.push(SyncConflict { id, entity_type, entity_id, title, local_payload, remote_payload, remote_version, remote_deleted, detected_at });
    }
    Ok(out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ConflictResolution {
    KeepLocal,
    KeepRemote,
    KeepBoth,
}

impl ConflictResolution {
    fn as_str(self) -> &'static str {
        match self {
            ConflictResolution::KeepLocal => "keep_local",
            ConflictResolution::KeepRemote => "keep_remote",
            ConflictResolution::KeepBoth => "keep_both",
        }
    }
}

/// Resolves a conflict explicitly:
/// - keep local: the local version is uploaded over the server version;
/// - keep remote: the server version replaces the local one;
/// - keep both: the local version is saved as a new copy, then the server
///   version replaces the original.
pub fn resolve_conflict(conn: &mut Connection, conflict_id: &str, resolution: ConflictResolution) -> Result<()> {
    let tx = conn.transaction()?;
    let (entity_type, entity_id, remote_payload, remote_version, remote_deleted): (String, String, Option<String>, i64, bool) = tx
        .query_row(
            "SELECT entity_type, entity_id, remote_payload, remote_version, remote_deleted FROM sync_conflicts
             WHERE id = ?1 AND resolved_at IS NULL",
            [conflict_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?
        .ok_or_else(|| Error::not_found("The conflict was already resolved."))?;
    let remote = RemoteRecord {
        entity_type: entity_type.clone(),
        entity_id: entity_id.clone(),
        version: remote_version,
        deleted: remote_deleted,
        payload: remote_payload.as_deref().map(serde_json::from_str).transpose()?,
        updated_by_device: None,
        updated_at: None,
    };
    let t = table(&entity_type)?;
    match resolution {
        ConflictResolution::KeepLocal => {
            // Base the next upload on the server's version so it is accepted.
            tx.execute(&format!("UPDATE {t} SET remote_version = ?2 WHERE id = ?1"), params![entity_id, remote_version])?;
            let meta = entity_meta(&tx, &entity_type, &entity_id)?.ok_or_else(|| Error::not_found("The item no longer exists."))?;
            tx.execute(
                "DELETE FROM sync_outbox WHERE entity_type = ?1 AND entity_id = ?2 AND status != 'done'",
                params![entity_type, entity_id],
            )?;
            enqueue(&tx, &entity_type, &entity_id, if meta.deleted { OP_DELETE } else { OP_UPSERT }, meta.revision)?;
        }
        ConflictResolution::KeepRemote => write_remote(&tx, &remote)?,
        ConflictResolution::KeepBoth => {
            if let Some(mut local) = entity_payload(&tx, &entity_type, &entity_id)? {
                if let Some(o) = local.as_object_mut() {
                    o.remove("id");
                    let key = if o.contains_key("title") { "title" } else { "name" };
                    if let Some(serde_json::Value::String(title)) = o.get(key).cloned() {
                        o.insert(key.into(), serde_json::Value::String(format!("{title} (my copy)")));
                    }
                }
                match entity_type.as_str() {
                    ENTITY_SONG => {
                        let mut doc: songs::SongDocument = serde_json::from_value(local)?;
                        songs::reassign_section_ids(&mut doc);
                        songs::save_song_tx(&tx, songs::normalize_document(doc)?)?;
                    }
                    ENTITY_SERVICE_PLAN => {
                        let mut doc: services::ServicePlanDocument = serde_json::from_value(local)?;
                        doc.items.iter_mut().for_each(|i| i.id = None);
                        services::save_plan_tx(&tx, services::normalize_document(doc)?)?;
                    }
                    ENTITY_THEME => {
                        themes::save_theme_tx(&tx, serde_json::from_value(local)?)?;
                    }
                    ENTITY_SLIDE_DECK => {
                        slides::save_deck_tx(&tx, serde_json::from_value(local)?)?;
                    }
                    _ => return Err(Error::validation("This kind of item cannot be duplicated.")),
                }
            }
            write_remote(&tx, &remote)?;
        }
    }
    tx.execute(
        "UPDATE sync_conflicts SET resolved_at = ?2, resolution = ?3 WHERE id = ?1",
        params![conflict_id, now_iso(), resolution.as_str()],
    )?;
    tx.commit()?;
    Ok(())
}

/// Queues every entity with unsynced changes that has no open operation.
/// Used when synchronization is first enabled.
pub fn backfill(conn: &mut Connection) -> Result<u32> {
    let tx = conn.transaction()?;
    let mut n = 0;
    for entity_type in ALL_TYPES {
        let t = table(entity_type)?;
        let rows: Vec<(String, i64, bool)> = {
            let mut stmt = tx.prepare(&format!(
                "SELECT e.id, e.revision, e.deleted_at IS NOT NULL FROM {t} e
                 WHERE e.revision > e.synced_revision
                   AND NOT EXISTS (SELECT 1 FROM sync_outbox o WHERE o.entity_type = ?1 AND o.entity_id = e.id AND o.status != 'done')"
            ))?;
            stmt.query_map([entity_type], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<std::result::Result<_, _>>()?
        };
        for (id, rev, deleted) in rows {
            if deleted && rev <= 1 {
                continue;
            }
            enqueue(&tx, entity_type, &id, if deleted { OP_DELETE } else { OP_UPSERT }, rev)?;
            n += 1;
        }
    }
    tx.commit()?;
    Ok(n)
}

/// Forgets everything known about the server (used when switching account
/// or workspace). Local content is untouched and will upload again.
pub fn reset(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    for entity_type in ALL_TYPES {
        let t = table(entity_type)?;
        tx.execute(&format!("UPDATE {t} SET remote_version = NULL, synced_revision = 0"), [])?;
    }
    // Unedited built-in themes are the same everywhere and never need uploading.
    tx.execute("UPDATE presentation_themes SET synced_revision = revision WHERE is_builtin = 1 AND revision = 1", [])?;
    // So are unedited built-in songs.
    tx.execute(
        "UPDATE songs SET synced_revision = revision WHERE id LIKE ?1 || '%' AND revision = 1",
        [crate::seed::BUILTIN_SONG_ID_PREFIX],
    )?;
    tx.execute("DELETE FROM sync_outbox", [])?;
    tx.execute("DELETE FROM sync_conflicts", [])?;
    tx.execute("DELETE FROM sync_metadata", [])?;
    tx.commit()?;
    backfill(conn)?;
    Ok(())
}

/// Removes completed operations older than the given timestamp.
pub fn purge_done(conn: &Connection, before: &str) -> Result<usize> {
    Ok(conn.execute("DELETE FROM sync_outbox WHERE status = 'done' AND updated_at < ?1", [before])?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::songs::{SectionKind, SongDocument, SongSectionInput, save_song};

    #[test]
    fn media_folders_are_shared() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("media");
        let db = Database::open_in_memory().unwrap();
        let png = dir.path().join("photo.png");
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(&[0u8; 64]);
        std::fs::write(&png, &bytes).unwrap();
        let asset = db.write(|c| crate::media::import_file(c, &root, &png)).unwrap().asset;
        db.write(|c| crate::media::set_folder(c, std::slice::from_ref(&asset.id), Some("Youth Camp"))).unwrap();
        let batch = db.read(|c| pending_batch(c, 50, "9999")).unwrap();
        let up = batch.iter().rev().find(|p| p.entity_id == asset.id).unwrap();
        assert_eq!(up.payload.as_ref().unwrap()["folder"], "Youth Camp");

        // Another computer moves it; an older version (no folder field) keeps it where it is.
        let mut payload = up.payload.clone().unwrap();
        let remote = |version: i64, payload: serde_json::Value| RemoteRecord {
            entity_type: ENTITY_MEDIA_ASSET.into(),
            entity_id: asset.id.clone(),
            version,
            deleted: false,
            payload: Some(payload),
            updated_by_device: None,
            updated_at: Some("now".into()),
        };
        let op = up.op_id.clone();
        payload["folder"] = "Easter".into();
        db.write(|c| {
            mark_pushed(c, &op, 3)?;
            apply_remote(c, &remote(4, payload.clone()))
        })
        .unwrap();
        let folder = || db.read(|c| crate::media::get_media(c, &root, &asset.id)).unwrap().folder;
        assert_eq!(folder().as_deref(), Some("Easter"));
        payload.as_object_mut().unwrap().remove("folder");
        db.write(|c| apply_remote(c, &remote(5, payload.clone()))).unwrap();
        assert_eq!(folder().as_deref(), Some("Easter"));
    }

    #[test]
    fn music_stays_on_this_computer() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("media");
        let db = Database::open_in_memory().unwrap();
        let wav = dir.path().join("song.wav");
        let mut bytes = b"RIFF\x24\x00\x00\x00WAVEfmt ".to_vec();
        bytes.extend_from_slice(&[0u8; 64]);
        std::fs::write(&wav, &bytes).unwrap();
        let audio = db.write(|c| crate::media::import_file(c, &root, &wav)).unwrap().asset;
        let mut doc = song("With Music");
        doc.audio_media_id = Some(audio.id.clone());
        doc.lyric_sync = Some(vec![crate::songs::LyricLine { id: "l1".into(), section: "Verse 1".into(), text: "line".into(), start_ms: Some(500), end_ms: None }]);
        let saved = db.write(|c| save_song(c, doc)).unwrap();

        let batch = db.read(|c| pending_batch(c, 50, "9999")).unwrap();
        // The music file's details are not uploaded at all.
        assert!(batch.iter().all(|p| p.entity_id != audio.id));
        // The song is, without its music.
        let up = batch.iter().find(|p| p.entity_id == saved.id).unwrap();
        let payload = up.payload.as_ref().unwrap().as_object().unwrap();
        assert_eq!(payload["title"], "With Music");
        for key in ["audioMediaId", "coverMediaId", "lyricSync"] {
            assert!(!payload.contains_key(key), "{key} must stay local");
        }

        // A change from another computer keeps this computer's music.
        let mut remote_doc = serde_json::to_value(crate::songs::to_document(&saved)).unwrap();
        remote_doc.as_object_mut().unwrap().retain(|k, _| !["audioMediaId", "coverMediaId", "lyricSync"].contains(&k.as_str()));
        remote_doc["title"] = "Renamed Elsewhere".into();
        let remote = RemoteRecord { entity_type: ENTITY_SONG.into(), entity_id: saved.id.clone(), version: 7, deleted: false, payload: Some(remote_doc), updated_by_device: None, updated_at: Some("now".into()) };
        db.write(|c| { mark_pushed(c, &up.op_id, 6)?; apply_remote(c, &remote) }).unwrap();
        let after = db.read(|c| crate::songs::get_song(c, &saved.id)).unwrap();
        assert_eq!(after.title, "Renamed Elsewhere");
        assert_eq!(after.audio_media_id.as_deref(), Some(audio.id.as_str()));
        assert_eq!(after.lyric_sync.map(|l| l.len()), Some(1));
    }

    fn song(title: &str) -> SongDocument {
        SongDocument {
            id: None,
            title: title.into(),
            artist: None,
            original_key: None,
            tempo: None,
            language: None,
            category: None,
            copyright_holder: None,
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
            sections: vec![SongSectionInput::new(SectionKind::Verse, String::new(), "line")],
        }
    }

    const NOW: &str = "2999-01-01T00:00:00.000Z";

    #[test]
    fn offline_edits_queue_and_push_marks_synced() {
        let db = Database::open_in_memory().unwrap();
        let s = db.write(|c| save_song(c, song("Offline Song"))).unwrap();
        let batch = db.read(|c| pending_batch(c, 50, NOW)).unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].base_version, None);
        assert_eq!(batch[0].payload.as_ref().unwrap()["title"], "Offline Song");

        // A failed attempt is retried later (backoff respected).
        db.write(|c| mark_failed(c, &batch[0].op_id, "network down", "2999-06-01T00:00:00.000Z")).unwrap();
        assert!(db.read(|c| pending_batch(c, 50, NOW)).unwrap().is_empty());
        let retry = db.read(|c| pending_batch(c, 50, "2999-07-01T00:00:00.000Z")).unwrap();
        assert_eq!(retry.len(), 1);
        assert_eq!(retry[0].retry_count, 1);

        db.write(|c| mark_pushed(c, &retry[0].op_id, 1)).unwrap();
        // Idempotent: confirming the same operation twice is harmless.
        db.write(|c| mark_pushed(c, &retry[0].op_id, 1)).unwrap();
        assert!(db.read(|c| pending_batch(c, 50, "2999-07-01T00:00:00.000Z")).unwrap().is_empty());
        let st = db.read(status).unwrap();
        assert_eq!((st.pending, st.failed, st.conflicts), (0, 0, 0));

        // The next edit is based on server version 1.
        let mut doc = songs::to_document(&db.read(|c| songs::get_song(c, &s.id)).unwrap());
        doc.notes = Some("edited".into());
        db.write(|c| save_song(c, doc)).unwrap();
        let next = db.read(|c| pending_batch(c, 50, NOW)).unwrap();
        assert_eq!(next[0].base_version, Some(1));
        assert_eq!(next[0].local_revision, 2);
    }

    #[test]
    fn remote_changes_apply_or_conflict() {
        let db = Database::open_in_memory().unwrap();
        let s = db.write(|c| save_song(c, song("Shared"))).unwrap();
        let op = db.read(|c| pending_batch(c, 10, NOW)).unwrap().remove(0);
        db.write(|c| mark_pushed(c, &op.op_id, 1)).unwrap();

        // Remote edit while nothing changed locally → applied.
        let mut remote_doc = songs::to_document(&s);
        remote_doc.title = "Shared (edited elsewhere)".into();
        let remote = RemoteRecord {
            entity_type: ENTITY_SONG.into(),
            entity_id: s.id.clone(),
            version: 2,
            deleted: false,
            payload: Some(serde_json::to_value(&remote_doc).unwrap()),
            updated_by_device: Some("other".into()),
            updated_at: None,
        };
        assert_eq!(db.write(|c| apply_remote(c, &remote)).unwrap(), ApplyOutcome::Applied);
        assert_eq!(db.read(|c| songs::get_song(c, &s.id)).unwrap().title, "Shared (edited elsewhere)");
        assert!(db.read(|c| pending_batch(c, 10, NOW)).unwrap().is_empty(), "remote content is not re-uploaded");
        // Re-delivery of the same version is skipped.
        assert_eq!(db.write(|c| apply_remote(c, &remote)).unwrap(), ApplyOutcome::Skipped);

        // Local edit, then a different remote edit → conflict, nothing overwritten.
        let mut local = songs::to_document(&db.read(|c| songs::get_song(c, &s.id)).unwrap());
        local.title = "Local title".into();
        db.write(|c| save_song(c, local)).unwrap();
        let mut remote_doc2 = remote_doc.clone();
        remote_doc2.title = "Remote title".into();
        let remote2 = RemoteRecord { version: 3, payload: Some(serde_json::to_value(&remote_doc2).unwrap()), ..remote.clone() };
        assert_eq!(db.write(|c| apply_remote(c, &remote2)).unwrap(), ApplyOutcome::Conflict);
        assert_eq!(db.read(|c| songs::get_song(c, &s.id)).unwrap().title, "Local title");
        let conflicts = db.read(list_conflicts).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].title, "Local title");
        assert!(db.read(|c| pending_batch(c, 10, NOW)).unwrap().is_empty(), "conflicted ops wait for a decision");

        // Keep both: local saved as a copy, remote replaces the original.
        db.write(|c| resolve_conflict(c, &conflicts[0].id, ConflictResolution::KeepBoth)).unwrap();
        assert_eq!(db.read(|c| songs::get_song(c, &s.id)).unwrap().title, "Remote title");
        let copies = db.read(|c| songs::list_songs(c, &songs::SongQuery { text: Some("my copy".into()), ..Default::default() })).unwrap();
        assert_eq!(copies.total, 1);
        assert_eq!(db.read(open_conflict_count).unwrap(), 0);
        let pending = db.read(|c| pending_batch(c, 10, NOW)).unwrap();
        assert_eq!(pending.len(), 1, "only the new copy uploads");
        assert_ne!(pending[0].entity_id, s.id);
    }

    #[test]
    fn keep_local_reuploads_on_top_of_remote() {
        let db = Database::open_in_memory().unwrap();
        let s = db.write(|c| save_song(c, song("Mine"))).unwrap();
        let op = db.read(|c| pending_batch(c, 10, NOW)).unwrap().remove(0);
        // Server says someone else already wrote version 5.
        let mut theirs = songs::to_document(&s);
        theirs.title = "Theirs".into();
        let remote = RemoteRecord {
            entity_type: ENTITY_SONG.into(),
            entity_id: s.id.clone(),
            version: 5,
            deleted: false,
            payload: Some(serde_json::to_value(&theirs).unwrap()),
            updated_by_device: Some("other".into()),
            updated_at: None,
        };
        db.write(|c| mark_conflict(c, &op.op_id, &remote)).unwrap();
        let c = db.read(list_conflicts).unwrap().remove(0);
        db.write(|conn| resolve_conflict(conn, &c.id, ConflictResolution::KeepLocal)).unwrap();
        let pending = db.read(|c| pending_batch(c, 10, NOW)).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].base_version, Some(5));
        assert_eq!(pending[0].payload.as_ref().unwrap()["title"], "Mine");
    }

    #[test]
    fn deletions_propagate_both_ways() {
        let db = Database::open_in_memory().unwrap();
        let s = db.write(|c| save_song(c, song("To Delete"))).unwrap();
        let op = db.read(|c| pending_batch(c, 10, NOW)).unwrap().remove(0);
        db.write(|c| mark_pushed(c, &op.op_id, 1)).unwrap();
        db.write(|c| songs::delete_song(c, &s.id)).unwrap();
        let del = db.read(|c| pending_batch(c, 10, NOW)).unwrap().remove(0);
        assert_eq!(del.operation, OP_DELETE);
        assert!(del.payload.is_none());
        db.write(|c| mark_pushed(c, &del.op_id, 2)).unwrap();

        // Remote deletion of another song.
        let other = db.write(|c| save_song(c, song("Remote Deleted"))).unwrap();
        let op = db.read(|c| pending_batch(c, 10, NOW)).unwrap().remove(0);
        db.write(|c| mark_pushed(c, &op.op_id, 1)).unwrap();
        let remote = RemoteRecord {
            entity_type: ENTITY_SONG.into(),
            entity_id: other.id.clone(),
            version: 2,
            deleted: true,
            payload: None,
            updated_by_device: Some("other".into()),
            updated_at: None,
        };
        assert_eq!(db.write(|c| apply_remote(c, &remote)).unwrap(), ApplyOutcome::Applied);
        assert!(db.read(|c| songs::get_song(c, &other.id)).is_err());
        assert_eq!(db.read(|c| songs::list_songs(c, &songs::SongQuery { text: Some("Remote".into()), ..Default::default() })).unwrap().total, 0);
    }

    #[test]
    fn new_remote_entities_are_created_and_backfill_queues_unsynced() {
        let db = Database::open_in_memory().unwrap();
        let mut doc = song("From Another Device");
        doc.id = Some(new_id());
        let remote = RemoteRecord {
            entity_type: ENTITY_SONG.into(),
            entity_id: doc.id.clone().unwrap(),
            version: 1,
            deleted: false,
            payload: Some(serde_json::to_value(&doc).unwrap()),
            updated_by_device: Some("other".into()),
            updated_at: None,
        };
        assert_eq!(db.write(|c| apply_remote(c, &remote)).unwrap(), ApplyOutcome::Applied);
        assert_eq!(db.read(|c| songs::get_song(c, doc.id.as_ref().unwrap())).unwrap().title, "From Another Device");

        db.write(|c| save_song(c, song("Local only"))).unwrap();
        db.write(|c| Ok(c.execute("DELETE FROM sync_outbox", [])?)).unwrap();
        assert_eq!(db.write(backfill).unwrap(), 1);
        db.write(reset).unwrap();
        assert_eq!(db.read(|c| pending_batch(c, 10, NOW)).unwrap().len(), 2, "after reset everything uploads again");
        assert!(db.write(|c| apply_remote(c, &RemoteRecord { entity_type: "bogus".into(), ..remote.clone() })).is_err());
    }
}
