//! Backups are zip archives (`.sfbackup`) containing:
//! - `manifest.json` — format, versions, checksums and record counts
//! - `database.sqlite3` — a consistent snapshot taken with `VACUUM INTO`
//! - `media/**` — managed media files, when requested
//!
//! A backup is written to a temporary file and renamed into place only after
//! it is complete. Restores validate the archive (checksums, SQLite integrity,
//! schema version) before anything is replaced, and swap files in a way that
//! can be rolled back.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;
use zip::write::SimpleFileOptions;

use crate::db::Database;
use crate::error::{Error, Result};
use crate::media::resolve_stored_path;
use crate::migrations;
use crate::util::{new_id, now_iso, sha256_file};

pub const BACKUP_EXTENSION: &str = "sfbackup";
const FORMAT: &str = "sanctuaryflow-backup";
const DB_ENTRY: &str = "database.sqlite3";
const MANIFEST_ENTRY: &str = "manifest.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LibraryCounts {
    pub songs: u32,
    pub service_plans: u32,
    pub translations: u32,
    pub verses: u32,
    pub media: u32,
    pub themes: u32,
    pub slide_decks: u32,
}

pub fn counts(conn: &Connection) -> Result<LibraryCounts> {
    let n = |sql: &str| -> Result<u32> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };
    Ok(LibraryCounts {
        songs: n("SELECT COUNT(*) FROM songs WHERE deleted_at IS NULL")?,
        service_plans: n("SELECT COUNT(*) FROM service_plans WHERE deleted_at IS NULL")?,
        translations: n("SELECT COUNT(*) FROM bible_translations")?,
        verses: n("SELECT COUNT(*) FROM bible_verses")?,
        media: n("SELECT COUNT(*) FROM media_assets WHERE deleted_at IS NULL")?,
        themes: n("SELECT COUNT(*) FROM presentation_themes WHERE deleted_at IS NULL")?,
        slide_decks: n("SELECT COUNT(*) FROM custom_slides WHERE deleted_at IS NULL")?,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaManifestEntry {
    pub path: String,
    #[ts(type = "number")]
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackupManifest {
    pub format: String,
    pub format_version: u32,
    pub app_version: String,
    #[ts(type = "number")]
    pub schema_version: i64,
    pub created_at: String,
    pub device_id: String,
    pub kind: String,
    pub include_media: bool,
    pub database_sha256: String,
    #[ts(type = "number")]
    pub database_size: u64,
    pub counts: LibraryCounts,
    pub media: Vec<MediaManifestEntry>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackupInfo {
    pub path: String,
    #[ts(type = "number")]
    pub size_bytes: u64,
    pub manifest: BackupManifest,
}

/// Records a backup attempt in `backup_history`.
pub fn record_history(conn: &Connection, kind: &str, path: &Path, include_media: bool, error: Option<&str>) -> Result<()> {
    let size = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
    conn.execute(
        "INSERT INTO backup_history (id, kind, path, size_bytes, include_media, created_at, status, error_message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            new_id(),
            kind,
            path.to_string_lossy(),
            size,
            include_media,
            now_iso(),
            if error.is_some() { "failed" } else { "completed" },
            error
        ],
    )?;
    Ok(())
}

fn media_files(root: &Path) -> Result<Vec<(String, PathBuf)>> {
    let mut out = Vec::new();
    if !root.exists() {
        return Ok(out);
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                stack.push(path);
            } else if !path.extension().map(|e| e == "partial").unwrap_or(false) {
                let rel = path.strip_prefix(root).expect("under root").components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
                out.push((rel, path));
            }
        }
    }
    out.sort();
    Ok(out)
}

pub fn backup_file_name() -> String {
    format!("SanctuaryFlow-backup-{}.{BACKUP_EXTENSION}", chrono::Local::now().format("%Y%m%d-%H%M%S"))
}

/// Creates a backup archive at `dest`. Nothing is left behind on failure.
pub fn create_backup(
    db: &Database,
    media_root: &Path,
    dest: &Path,
    include_media: bool,
    kind: &str,
    app_version: &str,
) -> Result<BackupInfo> {
    let dir = dest.parent().ok_or_else(|| Error::validation("Choose a folder for the backup."))?;
    std::fs::create_dir_all(dir)?;
    let result = (|| -> Result<BackupInfo> {
        let staging = tempfile::Builder::new().prefix(".sf-backup-").tempdir_in(dir)?;
        let snapshot = staging.path().join(DB_ENTRY);
        db.snapshot_to(&snapshot)?;
        let (db_sha, db_size) = sha256_file(&snapshot)?;
        let (schema_version, counts, device_id) = {
            let conn = Connection::open_with_flags(&snapshot, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            (migrations::current_version(&conn)?, counts(&conn)?, crate::seed::device_id(&conn)?)
        };

        let partial = dest.with_extension(format!("{BACKUP_EXTENSION}.partial"));
        let file = File::create(&partial)?;
        let mut zip = zip::ZipWriter::new(BufWriter::new(file));
        let deflated = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
        let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored).large_file(true);

        zip.start_file(DB_ENTRY, deflated)?;
        std::io::copy(&mut BufReader::new(File::open(&snapshot)?), &mut zip)?;

        let mut media = Vec::new();
        if include_media {
            for (rel, path) in media_files(media_root)? {
                zip.start_file(format!("media/{rel}"), stored)?;
                let mut reader = BufReader::new(File::open(&path)?);
                let mut hasher = Sha256::new();
                let mut buf = vec![0u8; 1024 * 1024];
                let mut size = 0u64;
                loop {
                    let n = reader.read(&mut buf)?;
                    if n == 0 {
                        break;
                    }
                    hasher.update(&buf[..n]);
                    zip.write_all(&buf[..n])?;
                    size += n as u64;
                }
                media.push(MediaManifestEntry { path: rel, size, sha256: hex::encode(hasher.finalize()) });
            }
        }

        let manifest = BackupManifest {
            format: FORMAT.into(),
            format_version: 1,
            app_version: app_version.into(),
            schema_version,
            created_at: now_iso(),
            device_id,
            kind: kind.into(),
            include_media,
            database_sha256: db_sha,
            database_size: db_size,
            counts,
            media,
        };
        zip.start_file(MANIFEST_ENTRY, deflated)?;
        zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
        let mut writer = zip.finish()?;
        writer.flush()?;
        writer.get_ref().sync_all()?;
        drop(writer);
        if let Err(e) = std::fs::rename(&partial, dest) {
            let _ = std::fs::remove_file(&partial);
            return Err(e.into());
        }
        let size = std::fs::metadata(dest)?.len();
        Ok(BackupInfo { path: dest.to_string_lossy().into_owned(), size_bytes: size, manifest })
    })();

    let partial = dest.with_extension(format!("{BACKUP_EXTENSION}.partial"));
    if partial.exists() {
        let _ = std::fs::remove_file(&partial);
    }
    let _ = db.write(|c| record_history(c, kind, dest, include_media, result.as_ref().err().map(|e| e.to_string()).as_deref()));
    result
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackupValidation {
    pub path: String,
    pub valid: bool,
    pub manifest: Option<BackupManifest>,
    /// Counts read from the backed-up database itself.
    pub counts: Option<LibraryCounts>,
    pub issues: Vec<String>,
}

fn read_manifest(archive: &mut zip::ZipArchive<BufReader<File>>) -> Result<BackupManifest> {
    let mut f = archive.by_name(MANIFEST_ENTRY).map_err(|_| Error::validation("The backup has no manifest."))?;
    let mut s = String::new();
    f.read_to_string(&mut s)?;
    let m: BackupManifest = serde_json::from_str(&s).map_err(|e| Error::validation(format!("The backup manifest is unreadable: {e}")))?;
    if m.format != FORMAT {
        return Err(Error::validation("This file is not a SanctuaryFlow backup."));
    }
    Ok(m)
}

/// Extracts the database to `dest` and returns its checksum.
fn extract_db(archive: &mut zip::ZipArchive<BufReader<File>>, dest: &Path) -> Result<String> {
    let mut entry = archive.by_name(DB_ENTRY).map_err(|_| Error::validation("The backup has no database."))?;
    let mut out = BufWriter::new(File::create(dest)?);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = entry.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n])?;
    }
    out.flush()?;
    Ok(hex::encode(hasher.finalize()))
}

/// Checks a backup without changing anything: manifest, database checksum,
/// SQLite integrity, schema compatibility and media checksums.
pub fn validate_backup(path: &Path, deep_media_check: bool) -> BackupValidation {
    let mut v = BackupValidation { path: path.to_string_lossy().into_owned(), valid: false, manifest: None, counts: None, issues: Vec::new() };
    let result = (|| -> Result<()> {
        let mut archive = zip::ZipArchive::new(BufReader::new(File::open(path)?))
            .map_err(|_| Error::validation("The file is not a readable backup archive."))?;
        let manifest = read_manifest(&mut archive)?;
        if manifest.format_version > 1 {
            v.issues.push("The backup was made by a newer version of SanctuaryFlow.".into());
        }
        if manifest.schema_version > migrations::latest_version() {
            v.issues.push(format!(
                "The backup's database (schema {}) is newer than this app supports ({}).",
                manifest.schema_version,
                migrations::latest_version()
            ));
        }
        let staging = tempfile::tempdir()?;
        let db_path = staging.path().join(DB_ENTRY);
        let sha = extract_db(&mut archive, &db_path)?;
        if sha != manifest.database_sha256 {
            v.issues.push("The database checksum does not match the manifest; the backup is damaged.".into());
        } else {
            let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            if integrity != "ok" {
                v.issues.push(format!("The backed-up database failed its integrity check: {integrity}"));
            } else {
                v.counts = Some(counts(&conn)?);
            }
        }
        if manifest.include_media {
            for m in &manifest.media {
                let name = format!("media/{}", m.path);
                match archive.by_name(&name) {
                    Ok(mut entry) => {
                        if entry.size() != m.size {
                            v.issues.push(format!("Media file {} has the wrong size.", m.path));
                        } else if deep_media_check {
                            let (sha, _) = crate::util::sha256_reader(&mut entry)?;
                            if sha != m.sha256 {
                                v.issues.push(format!("Media file {} is damaged.", m.path));
                            }
                        }
                    }
                    Err(_) => v.issues.push(format!("Media file {} is missing from the backup.", m.path)),
                }
            }
        }
        v.manifest = Some(manifest);
        Ok(())
    })();
    if let Err(e) = result {
        v.issues.push(e.to_string());
    }
    v.valid = v.issues.is_empty() && v.manifest.is_some() && v.counts.is_some();
    v
}

/// A validated backup extracted to a staging folder next to the library.
pub struct PreparedRestore {
    pub staging: tempfile::TempDir,
    pub db_file: PathBuf,
    pub media_dir: Option<PathBuf>,
    pub manifest: BackupManifest,
}

/// Validates and extracts a backup. Nothing in the live library is changed.
pub fn prepare_restore(path: &Path, data_dir: &Path, restore_media: bool) -> Result<PreparedRestore> {
    let validation = validate_backup(path, true);
    if !validation.valid {
        return Err(Error::validation(format!("The backup cannot be restored: {}", validation.issues.join(" "))));
    }
    let manifest = validation.manifest.expect("valid backups have a manifest");
    let staging = tempfile::Builder::new().prefix(".sf-restore-").tempdir_in(data_dir)?;
    let mut archive = zip::ZipArchive::new(BufReader::new(File::open(path)?))?;
    let db_file = staging.path().join(DB_ENTRY);
    if extract_db(&mut archive, &db_file)? != manifest.database_sha256 {
        return Err(Error::validation("The backup changed while it was being restored."));
    }
    let media_dir = if restore_media && manifest.include_media {
        let dir = staging.path().join("media");
        std::fs::create_dir_all(&dir)?;
        for m in &manifest.media {
            let target = resolve_stored_path(&dir, &m.path)?;
            std::fs::create_dir_all(target.parent().expect("has parent"))?;
            let mut entry = archive.by_name(&format!("media/{}", m.path))?;
            let mut out = BufWriter::new(File::create(&target)?);
            std::io::copy(&mut entry, &mut out)?;
            out.flush()?;
        }
        Some(dir)
    } else {
        None
    };
    Ok(PreparedRestore { staging, db_file, media_dir, manifest })
}

/// Files moved aside during a restore, so the swap can be undone.
pub struct RestoreSwap {
    moved: Vec<(PathBuf, PathBuf)>,
    placed: Vec<PathBuf>,
}

impl RestoreSwap {
    /// Puts the previous library back. Used when the restored database fails
    /// to open.
    pub fn rollback(self) -> Result<()> {
        for p in &self.placed {
            if p.is_dir() {
                std::fs::remove_dir_all(p)?;
            } else if p.exists() {
                std::fs::remove_file(p)?;
            }
        }
        for (original, aside) in self.moved.iter().rev() {
            if aside.exists() {
                std::fs::rename(aside, original)?;
            }
        }
        Ok(())
    }

    /// Deletes the previous library files once the restore is confirmed good.
    pub fn commit(self) {
        for (_, aside) in &self.moved {
            let r = if aside.is_dir() { std::fs::remove_dir_all(aside) } else { std::fs::remove_file(aside) };
            if let Err(e) = r {
                log::warn!("could not remove {}: {e}", aside.display());
            }
        }
    }
}

/// Swaps the restored files into place. The database must be closed. On
/// failure, everything already moved is put back before returning.
pub fn apply_restore(prepared: &PreparedRestore, db_path: &Path, media_root: &Path) -> Result<RestoreSwap> {
    let stamp = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
    let mut swap = RestoreSwap { moved: Vec::new(), placed: Vec::new() };
    let result = (|| -> Result<()> {
        for suffix in ["", "-wal", "-shm"] {
            let p = PathBuf::from(format!("{}{suffix}", db_path.display()));
            if p.exists() {
                let aside = PathBuf::from(format!("{}.before-restore-{stamp}", p.display()));
                std::fs::rename(&p, &aside)?;
                swap.moved.push((p, aside));
            }
        }
        std::fs::copy(&prepared.db_file, db_path)?;
        swap.placed.push(db_path.to_path_buf());
        if let Some(media) = &prepared.media_dir {
            if media_root.exists() {
                let aside = media_root.with_file_name(format!("media.before-restore-{stamp}"));
                std::fs::rename(media_root, &aside)?;
                swap.moved.push((media_root.to_path_buf(), aside));
            }
            std::fs::rename(media, media_root)?;
            swap.placed.push(media_root.to_path_buf());
        }
        Ok(())
    })();
    match result {
        Ok(()) => Ok(swap),
        Err(e) => {
            if let Err(rollback) = swap.rollback() {
                log::error!("restore rollback failed: {rollback}");
                return Err(Error::Other(format!(
                    "The restore failed ({e}) and the previous library could not be put back automatically ({rollback}). \
                     Your previous files are next to the library with a '.before-restore' suffix."
                )));
            }
            Err(e)
        }
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackupHistoryEntry {
    pub id: String,
    pub kind: String,
    pub path: String,
    #[ts(type = "number")]
    pub size_bytes: i64,
    pub include_media: bool,
    pub created_at: String,
    pub status: String,
    pub error_message: Option<String>,
    pub file_exists: bool,
}

pub fn history(conn: &Connection, limit: u32) -> Result<Vec<BackupHistoryEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, path, size_bytes, include_media, created_at, status, error_message
         FROM backup_history ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit.min(500)], |r| {
        let path: String = r.get(2)?;
        Ok(BackupHistoryEntry {
            id: r.get(0)?,
            kind: r.get(1)?,
            file_exists: Path::new(&path).exists(),
            path,
            size_bytes: r.get(3)?,
            include_media: r.get(4)?,
            created_at: r.get(5)?,
            status: r.get(6)?,
            error_message: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Carries backup history over into a restored database, so the record of
/// backup files on disk survives a restore.
pub fn merge_history(conn: &Connection, entries: &[BackupHistoryEntry]) -> Result<()> {
    for e in entries {
        conn.execute(
            "INSERT OR IGNORE INTO backup_history (id, kind, path, size_bytes, include_media, created_at, status, error_message)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![e.id, e.kind, e.path, e.size_bytes, e.include_media, e.created_at, e.status, e.error_message],
        )?;
    }
    Ok(())
}

pub fn last_successful(conn: &Connection) -> Result<Option<String>> {
    Ok(conn.query_row(
        "SELECT MAX(created_at) FROM backup_history WHERE status = 'completed' AND kind IN ('manual', 'scheduled')",
        [],
        |r| r.get(0),
    )?)
}

/// Deletes all but the newest `keep` scheduled backups.
pub fn prune_scheduled(conn: &Connection, keep: u32) -> Result<u32> {
    let mut stmt = conn.prepare(
        "SELECT id, path FROM backup_history WHERE kind = 'scheduled' AND status = 'completed'
         ORDER BY created_at DESC LIMIT -1 OFFSET ?1",
    )?;
    let old: Vec<(String, String)> = stmt.query_map([keep], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
    let mut removed = 0;
    for (id, path) in old {
        let p = Path::new(&path);
        if p.extension().map(|e| e == BACKUP_EXTENSION).unwrap_or(false) && p.exists() {
            std::fs::remove_file(p)?;
            removed += 1;
        }
        conn.execute("DELETE FROM backup_history WHERE id = ?1", [&id])?;
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::songs::{self, SectionKind, SongDocument, SongSectionInput};

    fn add_song(db: &Database, title: &str) {
        db.write(|c| {
            songs::save_song(
                c,
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
                    sections: vec![SongSectionInput::new(SectionKind::Verse, String::new(), "x")],
                },
            )
        })
        .unwrap();
    }

    fn song_count(db: &Database) -> u32 {
        db.read(|c| Ok(counts(c)?.songs)).unwrap()
    }

    #[test]
    fn create_validate_restore_with_media() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let db_path = data.join("library.sqlite3");
        let media = data.join("media");
        std::fs::create_dir_all(media.join("images")).unwrap();
        std::fs::write(media.join("images/a.png"), b"pretend image").unwrap();

        let (db, _) = Database::open(&db_path).unwrap();
        add_song(&db, "Before Backup");
        let dest = dir.path().join("backups").join(backup_file_name());
        let info = create_backup(&db, &media, &dest, true, "manual", "0.1.0").unwrap();
        assert_eq!(info.manifest.counts.songs, 1);
        assert_eq!(info.manifest.media.len(), 1);
        assert!(dest.exists());
        assert!(!dest.with_extension("sfbackup.partial").exists());

        let v = validate_backup(&dest, true);
        assert!(v.valid, "{:?}", v.issues);
        assert_eq!(v.counts.unwrap().songs, 1);

        // Change the live library after the backup.
        add_song(&db, "After Backup");
        std::fs::write(media.join("images/b.png"), b"new").unwrap();
        assert_eq!(song_count(&db), 2);

        let prepared = prepare_restore(&dest, &data, true).unwrap();
        let old_history = db.read(|c| history(c, 500)).unwrap();
        drop(db);
        let swap = apply_restore(&prepared, &db_path, &media).unwrap();
        let (db, _) = Database::open(&db_path).unwrap();
        db.write(|c| merge_history(c, &old_history)).unwrap();
        assert_eq!(song_count(&db), 1);
        assert!(media.join("images/a.png").exists());
        assert!(!media.join("images/b.png").exists());
        swap.commit();
        let leftovers: Vec<_> = std::fs::read_dir(&data).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.contains("before-restore")).collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        let hist = db.read(|c| history(c, 10)).unwrap();
        assert_eq!(hist[0].kind, "manual");
    }

    #[test]
    fn damaged_backups_are_rejected_and_restore_can_roll_back() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let db_path = data.join("library.sqlite3");
        let media = data.join("media");
        let (db, _) = Database::open(&db_path).unwrap();
        add_song(&db, "Original");
        let dest = dir.path().join("b.sfbackup");
        create_backup(&db, &media, &dest, false, "manual", "0.1.0").unwrap();

        // Corrupt the archive.
        let mut bytes = std::fs::read(&dest).unwrap();
        let mid = bytes.len() / 3;
        for b in &mut bytes[mid..mid + 64] {
            *b ^= 0xFF;
        }
        let broken = dir.path().join("broken.sfbackup");
        std::fs::write(&broken, &bytes).unwrap();
        let v = validate_backup(&broken, true);
        assert!(!v.valid);
        assert!(prepare_restore(&broken, &data, false).is_err());
        assert!(!validate_backup(&dir.path().join("missing.sfbackup"), false).valid);
        let not_zip = dir.path().join("x.sfbackup");
        std::fs::write(&not_zip, b"hello").unwrap();
        assert!(!validate_backup(&not_zip, false).valid);

        // A swap that is rolled back leaves the original library in place.
        add_song(&db, "Second");
        let prepared = prepare_restore(&dest, &data, false).unwrap();
        drop(db);
        let swap = apply_restore(&prepared, &db_path, &media).unwrap();
        swap.rollback().unwrap();
        let (db, _) = Database::open(&db_path).unwrap();
        assert_eq!(song_count(&db), 2);
    }

    #[test]
    fn scheduled_backups_are_pruned() {
        let dir = tempfile::tempdir().unwrap();
        let (db, _) = Database::open(&dir.path().join("l.sqlite3")).unwrap();
        for i in 0..4 {
            let dest = dir.path().join(format!("s{i}.sfbackup"));
            create_backup(&db, &dir.path().join("media"), &dest, false, "scheduled", "0.1.0").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let removed = db.write(|c| prune_scheduled(c, 2)).unwrap();
        assert_eq!(removed, 2);
        assert_eq!(db.read(|c| history(c, 10)).unwrap().len(), 2);
    }
}
