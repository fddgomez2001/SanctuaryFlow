use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::{Error, Result};
use crate::migrations;
use crate::seed;

const READER_COUNT: usize = 3;

/// Outcome of opening the library database.
#[derive(Debug, Default)]
pub struct OpenReport {
    pub applied_migrations: Vec<i64>,
    pub pre_migration_backup: Option<PathBuf>,
}

/// SQLite database with one writer connection and a small pool of read-only
/// connections. WAL mode lets reads continue while a long import is writing.
pub struct Database {
    path: Option<PathBuf>,
    writer: Mutex<Connection>,
    readers: Vec<Mutex<Connection>>,
}

fn lock(m: &Mutex<Connection>) -> MutexGuard<'_, Connection> {
    // A panic while holding the lock leaves the connection itself usable.
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn configure(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA synchronous = NORMAL;",
    )?;
    Ok(())
}

impl Database {
    /// Opens (or creates) the database at `path`, applies migrations and seeds
    /// built-in data. An existing database with pending migrations is copied to
    /// `<dir>/backups/` first so a failed upgrade can be recovered.
    pub fn open(path: &Path) -> Result<(Self, OpenReport)> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let existed = path.exists();
        let mut writer = Connection::open(path)?;
        let mode: String = writer.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
        if !mode.eq_ignore_ascii_case("wal") {
            log::warn!("database journal mode is {mode}, expected WAL");
        }
        configure(&writer)?;

        let integrity: String = writer.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if integrity != "ok" {
            return Err(Error::Other(format!(
                "The library database failed its integrity check ({integrity}). Restore it from a backup."
            )));
        }

        let mut report = OpenReport::default();
        if existed && migrations::current_version(&writer)? > 0 && migrations::pending_count(&writer)? > 0 {
            report.pre_migration_backup = Some(pre_migration_backup(&writer, path)?);
        }
        report.applied_migrations = migrations::migrate(&mut writer)?;
        seed::seed_all(&mut writer)?;
        if let Some(backup) = &report.pre_migration_backup {
            crate::backup::record_history(&writer, "pre_migration", backup, false, None)?;
        }

        let mut readers = Vec::with_capacity(READER_COUNT);
        for _ in 0..READER_COUNT {
            let r = Connection::open(path)?;
            configure(&r)?;
            r.execute_batch("PRAGMA query_only = ON;")?;
            readers.push(Mutex::new(r));
        }

        Ok((Self { path: Some(path.to_path_buf()), writer: Mutex::new(writer), readers }, report))
    }

    /// In-memory database for tests; reads share the writer connection.
    pub fn open_in_memory() -> Result<Self> {
        let mut writer = Connection::open_in_memory()?;
        configure(&writer)?;
        migrations::migrate(&mut writer)?;
        seed::seed_all(&mut writer)?;
        Ok(Self { path: None, writer: Mutex::new(writer), readers: Vec::new() })
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn write<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        let mut conn = lock(&self.writer);
        f(&mut conn)
    }

    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        if self.readers.is_empty() {
            let conn = lock(&self.writer);
            return f(&conn);
        }
        for r in &self.readers {
            if let Ok(conn) = r.try_lock() {
                return f(&conn);
            }
        }
        let conn = lock(&self.readers[0]);
        f(&conn)
    }

    /// Writes a consistent snapshot of the database to `dest` using
    /// `VACUUM INTO` on a dedicated connection, so the writer is not blocked.
    pub fn snapshot_to(&self, dest: &Path) -> Result<()> {
        if dest.exists() {
            std::fs::remove_file(dest)?;
        }
        let dest_str = dest.to_str().ok_or_else(|| Error::validation("Backup path is not valid UTF-8"))?;
        match &self.path {
            Some(path) => {
                let conn = Connection::open(path)?;
                configure(&conn)?;
                conn.execute("VACUUM INTO ?1", [dest_str])?;
            }
            None => {
                lock(&self.writer).execute("VACUUM INTO ?1", [dest_str])?;
            }
        }
        Ok(())
    }
}

fn pre_migration_backup(conn: &Connection, db_path: &Path) -> Result<PathBuf> {
    let dir = db_path.parent().unwrap_or_else(|| Path::new(".")).join("backups");
    std::fs::create_dir_all(&dir)?;
    let version = migrations::current_version(conn)?;
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let dest = dir.join(format!("pre-migration-v{version}-{stamp}.sqlite3"));
    let dest_str = dest.to_str().ok_or_else(|| Error::validation("Backup path is not valid UTF-8"))?;
    conn.execute("VACUUM INTO ?1", [dest_str])?;
    log::info!("pre-migration backup written to {}", dest.display());
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_file_database_with_wal_and_readers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite3");
        let (db, report) = Database::open(&path).unwrap();
        assert_eq!(report.applied_migrations, (1..=migrations::latest_version()).collect::<Vec<_>>());
        assert!(report.pre_migration_backup.is_none());
        let mode: String = db.read(|c| Ok(c.query_row("PRAGMA journal_mode", [], |r| r.get(0))?)).unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        // Readers are query-only.
        let err = db.read(|c| Ok(c.execute("DELETE FROM app_settings", [])?));
        assert!(err.is_err());
        drop(db);

        // Re-opening applies nothing and keeps data.
        let (_db, report) = Database::open(&path).unwrap();
        assert!(report.applied_migrations.is_empty());
    }

    #[test]
    fn upgrades_an_existing_library_and_backs_it_up_first() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite3");
        {
            // A library created by the first release (schema version 1).
            let mut conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);",
            )
            .unwrap();
            let tx = conn.transaction().unwrap();
            tx.execute_batch(migrations::MIGRATIONS[0].sql).unwrap();
            tx.execute(
                "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (1, 'initial', ?1, 'then')",
                [crate::util::sha256_hex(migrations::MIGRATIONS[0].sql.as_bytes())],
            )
            .unwrap();
            tx.execute("INSERT INTO songs (id, title, created_at, updated_at) VALUES ('s1', 'Old Song', 'then', 'then')", []).unwrap();
            tx.execute(
                "INSERT INTO song_sections (id, song_id, kind, label, position, lyrics) VALUES ('x1', 's1', 'verse', 'Verse 1', 0, 'Line')",
                [],
            )
            .unwrap();
            // An imported presentation: page 1 is a whole slide, page 2 was
            // never used, and the logo is a background behind text.
            for (id, title) in [("m1", "Talk - page 1"), ("m2", "Talk - page 2"), ("m3", "Logo")] {
                tx.execute(
                    "INSERT INTO media_assets (id, kind, title, original_filename, stored_path, mime_type, size_bytes, checksum_sha256, created_at, updated_at)
                     VALUES (?1, 'image', ?2, 'x.jpg', 'images/x.jpg', 'image/jpeg', 1, ?1, 'then', 'then')",
                    [id, title],
                )
                .unwrap();
            }
            let slides = serde_json::json!([
                { "id": "a", "background": { "type": "image", "mediaId": "m1" }, "elements": [] },
                { "id": "b", "background": { "type": "image", "mediaId": "m3" }, "elements": [{ "type": "text", "text": "Hi" }] },
            ]);
            tx.execute(
                "INSERT INTO custom_slides (id, title, slides, created_at, updated_at) VALUES ('d1', 'Talk', ?1, 'then', 'then')",
                [slides.to_string()],
            )
            .unwrap();
            tx.execute("INSERT INTO app_settings (key, value, updated_at) VALUES ('presentation.advanceAcrossItems', 'true', 'then')", []).unwrap();
            tx.execute("INSERT INTO app_settings (key, value, updated_at) VALUES ('general.uiTheme', '\"dark\"', 'then')", []).unwrap();
            tx.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES ('presentation.defaultSongThemeId', '\"00000000-0000-4000-8000-000000000002\"', 'then')",
                [],
            )
            .unwrap();
            tx.commit().unwrap();
        }
        let (db, report) = Database::open(&path).unwrap();
        assert_eq!(report.applied_migrations, (2..=migrations::latest_version()).collect::<Vec<_>>());
        let backup = report.pre_migration_backup.expect("a backup is made before upgrading");
        assert!(backup.exists());
        let old = Connection::open(&backup).unwrap();
        assert_eq!(migrations::current_version(&old).unwrap(), 1);
        let song = db.read(|c| crate::songs::get_song(c, "s1")).unwrap();
        assert_eq!(song.sections[0].lines_per_slide, None);
        let purpose = |id: &str| db.read(|c| Ok(c.query_row("SELECT purpose FROM media_assets WHERE id = ?1", [id], |r| r.get::<_, String>(0))?)).unwrap();
        assert_eq!((purpose("m1").as_str(), purpose("m2").as_str(), purpose("m3").as_str()), ("slide", "library", "library"));
        // Next now stays within each item.
        let advance = db.read(|c| crate::settings::get(c, "presentation.advanceAcrossItems")).unwrap();
        assert_eq!(advance, Some(serde_json::json!(false)));
        // The console's old Dark default becomes Light.
        let ui = db.read(|c| crate::settings::get(c, "general.uiTheme")).unwrap();
        assert_eq!(ui, Some(serde_json::json!("light")));
        // Songs move from a built-in default to Metallic Gold, which is seeded.
        let song_theme = db.read(|c| crate::settings::get(c, "presentation.defaultSongThemeId")).unwrap();
        assert_eq!(song_theme, Some(serde_json::json!(crate::seed::THEME_METALLIC_GOLD)));
        assert!(db.read(|c| crate::themes::get_theme(c, crate::seed::THEME_METALLIC_GOLD)).is_ok());
    }

    #[test]
    fn metallic_gold_replaces_only_built_in_song_defaults() {
        let db = Database::open_in_memory().unwrap();
        let sql = migrations::MIGRATIONS.iter().find(|m| m.version == 8).unwrap().sql;
        let run = |value: &str| {
            db.write(|c| {
                c.execute("UPDATE app_settings SET value = ?1 WHERE key = 'presentation.defaultSongThemeId'", [value])?;
                c.execute_batch(sql)?;
                Ok(())
            })
            .unwrap();
            db.read(|c| crate::settings::get(c, "presentation.defaultSongThemeId")).unwrap().unwrap()
        };
        let gold = serde_json::json!(crate::seed::THEME_METALLIC_GOLD);
        assert_eq!(run("\"00000000-0000-4000-8000-000000000001\""), gold);
        assert_eq!(run("null"), gold);
        assert_eq!(run("\"5f0c2a8e-1111-4222-8333-944455556666\""), serde_json::json!("5f0c2a8e-1111-4222-8333-944455556666"));
    }

    #[test]
    fn refuses_newer_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.sqlite3");
        {
            let (db, _) = Database::open(&path).unwrap();
            db.write(|c| {
                c.execute(
                    "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (999, 'future', 'x', 'now')",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        }
        let err = Database::open(&path).err().expect("should refuse");
        assert_eq!(err.code(), "unsupported");
    }

    #[test]
    fn snapshot_produces_openable_copy() {
        let dir = tempfile::tempdir().unwrap();
        let (db, _) = Database::open(&dir.path().join("a.sqlite3")).unwrap();
        let copy = dir.path().join("copy.sqlite3");
        db.snapshot_to(&copy).unwrap();
        let conn = Connection::open(&copy).unwrap();
        assert_eq!(migrations::current_version(&conn).unwrap(), migrations::latest_version());
    }
}
