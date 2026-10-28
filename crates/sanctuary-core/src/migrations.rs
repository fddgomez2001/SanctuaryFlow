use rusqlite::{Connection, OptionalExtension, params};

use crate::error::{Error, Result};
use crate::util::{now_iso, sha256_hex};

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

/// Ordered, append-only list of schema migrations. Never edit a released
/// migration; add a new one instead.
pub const MIGRATIONS: &[Migration] = &[
    Migration { version: 1, name: "initial", sql: include_str!("../migrations/0001_initial.sql") },
    Migration {
        version: 2,
        name: "section_lines_per_slide",
        sql: include_str!("../migrations/0002_section_lines_per_slide.sql"),
    },
    Migration { version: 3, name: "media_purpose", sql: include_str!("../migrations/0003_media_purpose.sql") },
    Migration { version: 4, name: "stay_within_items", sql: include_str!("../migrations/0004_stay_within_items.sql") },
    Migration { version: 5, name: "song_music", sql: include_str!("../migrations/0005_song_music.sql") },
    Migration { version: 6, name: "light_interface", sql: include_str!("../migrations/0006_light_interface.sql") },
    Migration { version: 7, name: "media_folders", sql: include_str!("../migrations/0007_media_folders.sql") },
    Migration { version: 8, name: "metallic_gold_songs", sql: include_str!("../migrations/0008_metallic_gold_songs.sql") },
];

pub fn latest_version() -> i64 {
    MIGRATIONS.last().map(|m| m.version).unwrap_or(0)
}

fn ensure_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version     INTEGER PRIMARY KEY,
            name        TEXT NOT NULL,
            checksum    TEXT NOT NULL,
            applied_at  TEXT NOT NULL
        );",
    )?;
    Ok(())
}

pub fn current_version(conn: &Connection) -> Result<i64> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations')",
        [],
        |r| r.get(0),
    )?;
    if !exists {
        return Ok(0);
    }
    Ok(conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get::<_, Option<i64>>(0))
        .optional()?
        .flatten()
        .unwrap_or(0))
}

pub fn pending_count(conn: &Connection) -> Result<usize> {
    let current = current_version(conn)?;
    Ok(MIGRATIONS.iter().filter(|m| m.version > current).count())
}

/// Applies pending migrations, each in its own transaction. Refuses to open a
/// database written by a newer application version.
pub fn migrate(conn: &mut Connection) -> Result<Vec<i64>> {
    ensure_table(conn)?;
    let current = current_version(conn)?;
    if current > latest_version() {
        return Err(Error::Unsupported(format!(
            "This library was created by a newer version of SanctuaryFlow (schema {current}, \
             this app supports up to {}). Please update the application.",
            latest_version()
        )));
    }
    verify_checksums(conn)?;

    let mut applied = Vec::new();
    for m in MIGRATIONS.iter().filter(|m| m.version > current) {
        let tx = conn.transaction()?;
        tx.execute_batch(m.sql)
            .map_err(|e| Error::Other(format!("Migration {} ({}) failed: {e}", m.version, m.name)))?;
        tx.execute(
            "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?1, ?2, ?3, ?4)",
            params![m.version, m.name, sha256_hex(m.sql.as_bytes()), now_iso()],
        )?;
        tx.commit()?;
        log::info!("applied migration {} ({})", m.version, m.name);
        applied.push(m.version);
    }
    Ok(applied)
}

fn verify_checksums(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("SELECT version, checksum FROM schema_migrations")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (version, checksum) = row?;
        if let Some(m) = MIGRATIONS.iter().find(|m| m.version == version) {
            if sha256_hex(m.sql.as_bytes()) != checksum {
                log::warn!("migration {version} checksum differs from the applied migration");
            }
        }
    }
    Ok(())
}
