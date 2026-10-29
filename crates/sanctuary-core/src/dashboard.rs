//! Home dashboard data, read from the local library (no fabricated values).

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::backup::{self, LibraryCounts};
use crate::bible::{self, SavedPassage};
use crate::error::Result;
use crate::seed;
use crate::services::{self, ServicePlanQuery, ServicePlanSummary, ServiceSort};
use crate::songs::{self, SongQuery, SongSort, SongSummary};
use crate::sync;
use crate::themes::{self, Theme};

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DashboardSummary {
    pub counts: LibraryCounts,
    pub recent_songs: Vec<SongSummary>,
    pub recent_passages: Vec<SavedPassage>,
    pub upcoming_services: Vec<ServicePlanSummary>,
    pub recent_services: Vec<ServicePlanSummary>,
    pub themes: Vec<Theme>,
    pub last_backup_at: Option<String>,
    pub last_sync_at: Option<String>,
    #[ts(type = "number")]
    pub pending_sync_operations: i64,
    #[ts(type = "number")]
    pub sync_conflicts: i64,
    pub incomplete_translations: Vec<String>,
    /// Services dated in each month around today (four before, this one, the next), oldest first.
    pub services_by_month: Vec<MonthCount>,
    /// Songs added to the library in each of the last six months, oldest first.
    pub songs_by_month: Vec<MonthCount>,
    /// The songs presented most often.
    pub top_songs: Vec<SongUse>,
    /// What the planned services are made of: items of each type.
    pub item_mix: Vec<ItemTypeCount>,
    /// Times songs and Scripture passages were presented, in total.
    pub song_uses: u32,
    pub scripture_uses: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MonthCount {
    /// "2026-10"
    pub month: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongUse {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub use_count: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ItemTypeCount {
    pub item_type: String,
    pub count: u32,
}

/// The month `offset` months from the one in `today` ("2026-10-28", -1 → "2026-09").
fn month_from(today: &str, offset: i32) -> String {
    let year: i32 = today.get(0..4).and_then(|y| y.parse().ok()).unwrap_or(2000);
    let month: i32 = today.get(5..7).and_then(|m| m.parse().ok()).unwrap_or(1);
    let index = year * 12 + (month - 1) + offset;
    format!("{:04}-{:02}", index.div_euclid(12), index.rem_euclid(12) + 1)
}

/// Counts per month for `months`, from a query returning (month, count) rows.
fn per_month(conn: &Connection, sql: &str, months: Vec<String>) -> Result<Vec<MonthCount>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(months
        .into_iter()
        .map(|month| {
            let count = rows.iter().find(|(m, _)| *m == month).map_or(0, |(_, c)| *c);
            MonthCount { month, count }
        })
        .collect())
}

pub fn summary(conn: &Connection, today: &str) -> Result<DashboardSummary> {
    let recent_songs = songs::list_songs(conn, &SongQuery { sort: SongSort::Recent, limit: Some(8), ..Default::default() })?
        .items
        .into_iter()
        .filter(|s| s.last_used_at.is_some())
        .collect();
    let upcoming = services::list_plans(
        conn,
        &ServicePlanQuery { from_date: Some(today.to_string()), sort: Some(ServiceSort::DateAsc), limit: Some(5), ..Default::default() },
    )?;
    let recent = services::list_plans(conn, &ServicePlanQuery { sort: Some(ServiceSort::RecentlyOpened), limit: Some(5), ..Default::default() })?
        .into_iter()
        .filter(|p| p.last_opened_at.is_some())
        .collect();
    let incomplete = bible::list_translations(conn)?
        .into_iter()
        .filter(|t| t.validation_status != "complete")
        .map(|t| t.code)
        .collect();
    let mut all_themes = themes::list_themes(conn)?;
    all_themes.truncate(6);
    let services_by_month = per_month(
        conn,
        "SELECT substr(service_date, 1, 7) AS m, COUNT(*) FROM service_plans
         WHERE deleted_at IS NULL AND is_template = 0 AND service_date IS NOT NULL GROUP BY m",
        (-4..=1).map(|o| month_from(today, o)).collect(),
    )?;
    // Songs the church added; the built-in hymns came with the app.
    let songs_by_month = per_month(
        conn,
        &format!(
            "SELECT substr(created_at, 1, 7) AS m, COUNT(*) FROM songs
             WHERE deleted_at IS NULL AND id NOT LIKE '{}%' GROUP BY m",
            seed::BUILTIN_SONG_ID_PREFIX
        ),
        (-5..=0).map(|o| month_from(today, o)).collect(),
    )?;
    let top_songs = conn
        .prepare(
            "SELECT id, title, artist, use_count FROM songs
             WHERE deleted_at IS NULL AND archived_at IS NULL AND use_count > 0
             ORDER BY use_count DESC, last_used_at DESC LIMIT 5",
        )?
        .query_map([], |r| Ok(SongUse { id: r.get(0)?, title: r.get(1)?, artist: r.get(2)?, use_count: r.get(3)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let item_mix = conn
        .prepare(
            "SELECT i.item_type, COUNT(*) AS n FROM service_items i JOIN service_plans p ON p.id = i.plan_id
             WHERE p.deleted_at IS NULL AND p.is_template = 0 AND i.item_type NOT IN ('heading', 'blank')
             GROUP BY i.item_type ORDER BY n DESC, i.item_type",
        )?
        .query_map([], |r| Ok(ItemTypeCount { item_type: r.get(0)?, count: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let total = |sql: &str| -> Result<u32> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };
    Ok(DashboardSummary {
        counts: backup::counts(conn)?,
        recent_songs,
        recent_passages: bible::list_saved_passages(conn, false, 6)?,
        upcoming_services: upcoming,
        recent_services: recent,
        themes: all_themes,
        last_backup_at: backup::last_successful(conn)?,
        last_sync_at: sync::get_metadata(conn, sync::META_LAST_SYNC_AT)?,
        pending_sync_operations: sync::open_operation_count(conn)?,
        sync_conflicts: sync::open_conflict_count(conn)?,
        incomplete_translations: incomplete,
        services_by_month,
        songs_by_month,
        top_songs,
        item_mix,
        song_uses: total("SELECT COALESCE(SUM(use_count), 0) FROM songs WHERE deleted_at IS NULL")?,
        scripture_uses: total("SELECT COALESCE(SUM(use_count), 0) FROM scripture_passages")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn empty_library_reports_zeroes() {
        let db = Database::open_in_memory().unwrap();
        let s = db.read(|c| summary(c, "2026-10-27")).unwrap();
        assert_eq!(s.counts.songs, 0);
        assert_eq!(s.counts.translations, 0);
        assert!(s.recent_songs.is_empty());
        assert!(s.upcoming_services.is_empty());
        assert!(s.last_backup_at.is_none());
        assert!(s.last_sync_at.is_none());
        assert_eq!(s.pending_sync_operations, 0);
        assert!(!s.themes.is_empty(), "built-in themes are available");
        assert_eq!(
            s.services_by_month.iter().map(|m| m.month.as_str()).collect::<Vec<_>>(),
            ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]
        );
        assert_eq!(s.songs_by_month.len(), 6);
        assert!(s.services_by_month.iter().chain(&s.songs_by_month).all(|m| m.count == 0));
        assert!(s.top_songs.is_empty() && s.item_mix.is_empty());
        assert_eq!((s.song_uses, s.scripture_uses), (0, 0));
    }

    #[test]
    fn months_wrap_across_years() {
        assert_eq!(month_from("2026-01-15", -1), "2025-12");
        assert_eq!(month_from("2026-12-01", 1), "2027-01");
        assert_eq!(month_from("2026-10-28", -5), "2026-05");
    }

    #[test]
    fn insights_count_services_songs_and_items() {
        let db = Database::open_in_memory().unwrap();
        db.write(|c| {
            c.execute_batch(
                "INSERT INTO songs (id, title, use_count, created_at, updated_at) VALUES
                   ('s1', 'Song One', 3, '2026-10-02T10:00:00Z', '2026-10-02T10:00:00Z'),
                   ('s2', 'Song Two', 0, '2026-09-12T10:00:00Z', '2026-09-12T10:00:00Z'),
                   ('s3', 'Song Three', 5, '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z');
                 INSERT INTO service_plans (id, title, service_date, created_at, updated_at) VALUES
                   ('p1', 'Sunday', '2026-10-04', 'x', 'x'),
                   ('p2', 'Sunday', '2026-11-01', 'x', 'x'),
                   ('p3', 'Long ago', '2025-01-05', 'x', 'x');
                 INSERT INTO service_plans (id, title, service_date, is_template, created_at, updated_at) VALUES
                   ('t1', 'Template', '2026-10-11', 1, 'x', 'x');
                 INSERT INTO service_items (id, plan_id, position, item_type, title, created_at, updated_at) VALUES
                   ('i1', 'p1', 0, 'song', 'Song One', 'x', 'x'),
                   ('i2', 'p1', 1, 'song', 'Song Three', 'x', 'x'),
                   ('i3', 'p1', 2, 'scripture', 'John 3:16', 'x', 'x'),
                   ('i4', 'p1', 3, 'heading', 'Worship', 'x', 'x'),
                   ('i5', 't1', 0, 'announcement', 'Template item', 'x', 'x');",
            )?;
            Ok(())
        })
        .unwrap();
        let s = db.read(|c| summary(c, "2026-10-28")).unwrap();
        let counts = |v: &[MonthCount]| v.iter().map(|m| m.count).collect::<Vec<_>>();
        assert_eq!(counts(&s.services_by_month), [0, 0, 0, 0, 1, 1]);
        assert_eq!(counts(&s.songs_by_month), [0, 0, 0, 0, 1, 2]);
        assert_eq!(s.top_songs.iter().map(|x| (x.id.as_str(), x.use_count)).collect::<Vec<_>>(), [("s3", 5), ("s1", 3)]);
        assert_eq!(s.item_mix.iter().map(|x| (x.item_type.as_str(), x.count)).collect::<Vec<_>>(), [("song", 2), ("scripture", 1)]);
        assert_eq!(s.song_uses, 8);
    }
}
