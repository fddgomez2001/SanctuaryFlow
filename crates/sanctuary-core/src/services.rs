use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Row, ToSql, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::sync;
use crate::util::{clean_opt, is_valid_uuid, new_id, now_iso};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ServiceItemType {
    Song,
    Scripture,
    Announcement,
    Sermon,
    Image,
    Video,
    Custom,
    Heading,
    Blank,
}

impl ServiceItemType {
    pub fn as_str(self) -> &'static str {
        match self {
            ServiceItemType::Song => "song",
            ServiceItemType::Scripture => "scripture",
            ServiceItemType::Announcement => "announcement",
            ServiceItemType::Sermon => "sermon",
            ServiceItemType::Image => "image",
            ServiceItemType::Video => "video",
            ServiceItemType::Custom => "custom",
            ServiceItemType::Heading => "heading",
            ServiceItemType::Blank => "blank",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "song" => ServiceItemType::Song,
            "scripture" => ServiceItemType::Scripture,
            "announcement" => ServiceItemType::Announcement,
            "sermon" => ServiceItemType::Sermon,
            "image" => ServiceItemType::Image,
            "video" => ServiceItemType::Video,
            "custom" => ServiceItemType::Custom,
            "heading" => ServiceItemType::Heading,
            "blank" => ServiceItemType::Blank,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ServiceStatus {
    #[default]
    Draft,
    Ready,
    Completed,
    Archived,
}

impl ServiceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ServiceStatus::Draft => "draft",
            ServiceStatus::Ready => "ready",
            ServiceStatus::Completed => "completed",
            ServiceStatus::Archived => "archived",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "ready" => ServiceStatus::Ready,
            "completed" => ServiceStatus::Completed,
            "archived" => ServiceStatus::Archived,
            _ => ServiceStatus::Draft,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServiceItem {
    pub id: String,
    pub item_type: ServiceItemType,
    pub title: String,
    pub ref_id: Option<String>,
    /// Item-type specific settings (scripture passages, theme override, media options).
    #[ts(type = "Record<string, unknown>")]
    pub settings: serde_json::Value,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServicePlan {
    pub id: String,
    pub title: String,
    pub service_date: Option<String>,
    pub service_time: Option<String>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub status: ServiceStatus,
    pub is_template: bool,
    pub theme_id: Option<String>,
    pub last_opened_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[ts(type = "number")]
    pub revision: i64,
    pub items: Vec<ServiceItem>,
}

/// Portable content of a service plan: export files and sync payloads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServicePlanDocument {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub service_date: Option<String>,
    #[serde(default)]
    pub service_time: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub status: ServiceStatus,
    #[serde(default)]
    pub is_template: bool,
    #[serde(default)]
    pub theme_id: Option<String>,
    #[serde(default)]
    pub items: Vec<ServiceItemInput>,
}

pub type ServicePlanInput = ServicePlanDocument;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServiceItemInput {
    #[serde(default)]
    pub id: Option<String>,
    pub item_type: ServiceItemType,
    pub title: String,
    #[serde(default)]
    pub ref_id: Option<String>,
    #[serde(default = "empty_object")]
    #[ts(type = "Record<string, unknown>")]
    pub settings: serde_json::Value,
    #[serde(default)]
    pub notes: Option<String>,
}

fn empty_object() -> serde_json::Value {
    serde_json::json!({})
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServicePlanSummary {
    pub id: String,
    pub title: String,
    pub service_date: Option<String>,
    pub service_time: Option<String>,
    pub status: ServiceStatus,
    pub is_template: bool,
    pub item_count: u32,
    pub last_opened_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ServicePlanQuery {
    pub text: Option<String>,
    pub status: Option<ServiceStatus>,
    pub templates: bool,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub sort: Option<ServiceSort>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ServiceSort {
    DateDesc,
    DateAsc,
    RecentlyOpened,
    Updated,
}

fn valid_date(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

fn valid_time(s: &str) -> bool {
    chrono::NaiveTime::parse_from_str(s, "%H:%M").is_ok()
}

pub fn normalize_document(mut doc: ServicePlanDocument) -> Result<ServicePlanDocument> {
    doc.title = doc.title.trim().to_string();
    if doc.title.is_empty() {
        return Err(Error::validation("A service plan needs a title."));
    }
    if let Some(id) = &doc.id {
        if !is_valid_uuid(id) {
            return Err(Error::validation("Invalid service plan id."));
        }
    }
    doc.service_date = clean_opt(doc.service_date);
    doc.service_time = clean_opt(doc.service_time);
    doc.description = clean_opt(doc.description);
    doc.notes = clean_opt(doc.notes);
    doc.theme_id = clean_opt(doc.theme_id);
    if let Some(d) = &doc.service_date {
        if !valid_date(d) {
            return Err(Error::validation("The service date must be in YYYY-MM-DD format."));
        }
    }
    if let Some(t) = &doc.service_time {
        if !valid_time(t) {
            return Err(Error::validation("The service time must be in HH:MM format."));
        }
    }
    let mut ids = HashSet::new();
    for item in doc.items.iter_mut() {
        let id = match item.id.take().filter(|i| !i.is_empty()) {
            Some(i) if is_valid_uuid(&i) => i,
            Some(_) => return Err(Error::validation("Invalid service item id.")),
            None => new_id(),
        };
        if !ids.insert(id.clone()) {
            return Err(Error::validation("Two service items share the same id."));
        }
        item.id = Some(id);
        item.title = item.title.trim().to_string();
        if item.title.is_empty() {
            item.title = match item.item_type {
                ServiceItemType::Blank => "Blank".into(),
                ServiceItemType::Heading => "Section".into(),
                _ => "Untitled item".into(),
            };
        }
        item.ref_id = clean_opt(item.ref_id.take());
        item.notes = clean_opt(item.notes.take());
        if item.settings.is_null() {
            item.settings = empty_object();
        }
        if !item.settings.is_object() {
            return Err(Error::validation("Service item settings must be an object."));
        }
        let needs_ref = matches!(item.item_type, ServiceItemType::Song | ServiceItemType::Image | ServiceItemType::Video);
        if needs_ref && item.ref_id.is_none() {
            return Err(Error::validation(format!("The item '{}' is missing its content reference.", item.title)));
        }
    }
    Ok(doc)
}

const PLAN_COLUMNS: &str = "id, title, service_date, service_time, description, notes, status, is_template, \
    theme_id, last_opened_at, created_at, updated_at, revision";

fn plan_from_row(r: &Row) -> rusqlite::Result<ServicePlan> {
    let status: String = r.get(6)?;
    Ok(ServicePlan {
        id: r.get(0)?,
        title: r.get(1)?,
        service_date: r.get(2)?,
        service_time: r.get(3)?,
        description: r.get(4)?,
        notes: r.get(5)?,
        status: ServiceStatus::parse(&status),
        is_template: r.get(7)?,
        theme_id: r.get(8)?,
        last_opened_at: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
        revision: r.get(12)?,
        items: Vec::new(),
    })
}

fn read_items(conn: &Connection, plan_id: &str) -> Result<Vec<ServiceItem>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, item_type, title, ref_id, settings, notes FROM service_items WHERE plan_id = ?1 ORDER BY position",
    )?;
    let rows = stmt.query_map([plan_id], |r| {
        let t: String = r.get(1)?;
        let settings: String = r.get(4)?;
        Ok(ServiceItem {
            id: r.get(0)?,
            item_type: ServiceItemType::parse(&t).unwrap_or(ServiceItemType::Custom),
            title: r.get(2)?,
            ref_id: r.get(3)?,
            settings: serde_json::from_str(&settings).unwrap_or_else(|_| empty_object()),
            notes: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get_plan(conn: &Connection, id: &str) -> Result<ServicePlan> {
    let mut plan = conn
        .query_row(
            &format!("SELECT {PLAN_COLUMNS} FROM service_plans WHERE id = ?1 AND deleted_at IS NULL"),
            [id],
            plan_from_row,
        )
        .optional()?
        .ok_or_else(|| Error::not_found("The service plan was not found. It may have been deleted."))?;
    plan.items = read_items(conn, id)?;
    Ok(plan)
}

pub fn to_document(plan: &ServicePlan) -> ServicePlanDocument {
    ServicePlanDocument {
        id: Some(plan.id.clone()),
        title: plan.title.clone(),
        service_date: plan.service_date.clone(),
        service_time: plan.service_time.clone(),
        description: plan.description.clone(),
        notes: plan.notes.clone(),
        status: plan.status,
        is_template: plan.is_template,
        theme_id: plan.theme_id.clone(),
        items: plan
            .items
            .iter()
            .map(|i| ServiceItemInput {
                id: Some(i.id.clone()),
                item_type: i.item_type,
                title: i.title.clone(),
                ref_id: i.ref_id.clone(),
                settings: i.settings.clone(),
                notes: i.notes.clone(),
            })
            .collect(),
    }
}

/// Creates or updates a plan and its ordered items atomically. Items missing
/// from the input are removed; positions follow the input order.
pub fn save_plan(conn: &mut Connection, input: ServicePlanInput) -> Result<ServicePlan> {
    let doc = normalize_document(input)?;
    let tx = conn.transaction()?;
    let id = save_plan_tx(&tx, doc)?;
    tx.commit()?;
    get_plan(conn, &id)
}

pub(crate) fn save_plan_tx(tx: &Connection, doc: ServicePlanDocument) -> Result<String> {
    let now = now_iso();
    let existing: Option<(i64, Option<String>)> = match &doc.id {
        Some(id) => tx
            .query_row("SELECT revision, deleted_at FROM service_plans WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?,
        None => None,
    };
    let id = doc.id.clone().unwrap_or_else(new_id);
    let revision = match existing {
        Some((revision, deleted_at)) => {
            if deleted_at.is_none() && to_document(&get_plan(tx, &id)?) == doc {
                return Ok(id);
            }
            tx.execute(
                "UPDATE service_plans SET title = ?2, service_date = ?3, service_time = ?4, description = ?5,
                   notes = ?6, status = ?7, is_template = ?8, theme_id = ?9, updated_at = ?10, deleted_at = NULL,
                   revision = ?11
                 WHERE id = ?1",
                params![
                    id,
                    doc.title,
                    doc.service_date,
                    doc.service_time,
                    doc.description,
                    doc.notes,
                    doc.status.as_str(),
                    doc.is_template,
                    doc.theme_id,
                    now,
                    revision + 1
                ],
            )?;
            revision + 1
        }
        None => {
            tx.execute(
                "INSERT INTO service_plans (id, title, service_date, service_time, description, notes, status,
                   is_template, theme_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                params![
                    id,
                    doc.title,
                    doc.service_date,
                    doc.service_time,
                    doc.description,
                    doc.notes,
                    doc.status.as_str(),
                    doc.is_template,
                    doc.theme_id,
                    now
                ],
            )?;
            1
        }
    };

    let keep: Vec<String> = doc.items.iter().filter_map(|i| i.id.clone()).collect();
    {
        let mut existing_ids = tx.prepare_cached("SELECT id FROM service_items WHERE plan_id = ?1")?;
        let current: Vec<String> =
            existing_ids.query_map([&id], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        for old in current.iter().filter(|c| !keep.contains(c)) {
            tx.execute("DELETE FROM service_items WHERE id = ?1", [old])?;
        }
    }
    {
        let mut upsert = tx.prepare_cached(
            "INSERT INTO service_items (id, plan_id, position, item_type, title, ref_id, settings, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
             ON CONFLICT(id) DO UPDATE SET position = excluded.position, item_type = excluded.item_type,
               title = excluded.title, ref_id = excluded.ref_id, settings = excluded.settings,
               notes = excluded.notes, updated_at = excluded.updated_at
             WHERE service_items.plan_id = excluded.plan_id",
        )?;
        for (pos, item) in doc.items.iter().enumerate() {
            let changed = upsert.execute(params![
                item.id,
                id,
                pos as i64,
                item.item_type.as_str(),
                item.title,
                item.ref_id,
                item.settings.to_string(),
                item.notes,
                now
            ])?;
            if changed == 0 {
                return Err(Error::Conflict("A service item id already belongs to another service plan.".into()));
            }
        }
    }
    sync::enqueue(tx, sync::ENTITY_SERVICE_PLAN, &id, sync::OP_UPSERT, revision)?;
    Ok(id)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct DuplicatePlanOptions {
    pub title: Option<String>,
    pub as_template: bool,
    pub service_date: Option<String>,
}

/// Copies a plan (or template) with fresh ids for the plan and every item.
pub fn duplicate_plan(conn: &mut Connection, id: &str, opts: DuplicatePlanOptions) -> Result<ServicePlan> {
    let plan = get_plan(conn, id)?;
    let mut doc = to_document(&plan);
    doc.id = None;
    doc.is_template = opts.as_template;
    doc.title = opts.title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| {
        if opts.as_template || plan.is_template { plan.title.clone() } else { format!("{} (Copy)", plan.title) }
    });
    doc.service_date = if opts.as_template { None } else { opts.service_date.or(doc.service_date) };
    doc.status = ServiceStatus::Draft;
    for item in doc.items.iter_mut() {
        item.id = None;
    }
    save_plan(conn, doc)
}

pub fn delete_plan(conn: &mut Connection, id: &str) -> Result<()> {
    let tx = conn.transaction()?;
    let revision: i64 = tx
        .query_row("SELECT revision FROM service_plans WHERE id = ?1 AND deleted_at IS NULL", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error::not_found("The service plan was not found."))?;
    let now = now_iso();
    tx.execute(
        "UPDATE service_plans SET deleted_at = ?2, updated_at = ?2, revision = ?3 WHERE id = ?1",
        params![id, now, revision + 1],
    )?;
    sync::enqueue(&tx, sync::ENTITY_SERVICE_PLAN, id, sync::OP_DELETE, revision + 1)?;
    tx.commit()?;
    Ok(())
}

pub fn mark_opened(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("UPDATE service_plans SET last_opened_at = ?2 WHERE id = ?1", params![id, now_iso()])?;
    Ok(())
}

fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

pub fn list_plans(conn: &Connection, q: &ServicePlanQuery) -> Result<Vec<ServicePlanSummary>> {
    let mut where_sql = vec!["p.deleted_at IS NULL".to_string(), format!("p.is_template = {}", q.templates as i32)];
    let mut args: Vec<Box<dyn ToSql>> = Vec::new();
    if let Some(text) = q.text.as_ref().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        args.push(Box::new(format!("%{}%", escape_like(text))));
        let n = args.len();
        where_sql.push(format!(
            "(p.title LIKE ?{n} ESCAPE '\\' OR p.description LIKE ?{n} ESCAPE '\\' OR p.notes LIKE ?{n} ESCAPE '\\'
              OR EXISTS (SELECT 1 FROM service_items i WHERE i.plan_id = p.id AND i.title LIKE ?{n} ESCAPE '\\'))"
        ));
    }
    if let Some(s) = q.status {
        args.push(Box::new(s.as_str()));
        where_sql.push(format!("p.status = ?{}", args.len()));
    }
    if let Some(d) = q.from_date.as_ref().filter(|d| valid_date(d)) {
        args.push(Box::new(d.clone()));
        where_sql.push(format!("p.service_date >= ?{}", args.len()));
    }
    if let Some(d) = q.to_date.as_ref().filter(|d| valid_date(d)) {
        args.push(Box::new(d.clone()));
        where_sql.push(format!("p.service_date <= ?{}", args.len()));
    }
    let order = match q.sort.unwrap_or(ServiceSort::DateDesc) {
        ServiceSort::DateDesc => "p.service_date IS NULL, p.service_date DESC, p.service_time DESC, p.updated_at DESC",
        ServiceSort::DateAsc => "p.service_date IS NULL, p.service_date ASC, p.service_time ASC",
        ServiceSort::RecentlyOpened => "p.last_opened_at IS NULL, p.last_opened_at DESC",
        ServiceSort::Updated => "p.updated_at DESC",
    };
    let limit = q.limit.unwrap_or(200).min(1000);
    let sql = format!(
        "SELECT p.id, p.title, p.service_date, p.service_time, p.status, p.is_template,
                (SELECT COUNT(*) FROM service_items i WHERE i.plan_id = p.id), p.last_opened_at, p.updated_at
         FROM service_plans p WHERE {} ORDER BY {order} LIMIT {limit}",
        where_sql.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())), |r| {
        let status: String = r.get(4)?;
        Ok(ServicePlanSummary {
            id: r.get(0)?,
            title: r.get(1)?,
            service_date: r.get(2)?,
            service_time: r.get(3)?,
            status: ServiceStatus::parse(&status),
            is_template: r.get(5)?,
            item_count: r.get(6)?,
            last_opened_at: r.get(7)?,
            updated_at: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use serde_json::json;

    fn item(t: ServiceItemType, title: &str, ref_id: Option<&str>) -> ServiceItemInput {
        ServiceItemInput {
            id: None,
            item_type: t,
            title: title.into(),
            ref_id: ref_id.map(str::to_string),
            settings: json!({}),
            notes: None,
        }
    }

    fn plan(title: &str) -> ServicePlanDocument {
        let song = new_id();
        ServicePlanDocument {
            id: None,
            title: title.into(),
            service_date: Some("2026-11-01".into()),
            service_time: Some("09:30".into()),
            description: None,
            notes: Some("Communion Sunday".into()),
            status: ServiceStatus::Draft,
            is_template: false,
            theme_id: None,
            items: vec![
                item(ServiceItemType::Heading, "Worship", None),
                item(ServiceItemType::Song, "Opening Song", Some(&song)),
                item(ServiceItemType::Scripture, "John 3:16", None),
                item(ServiceItemType::Announcement, "Announcements", None),
            ],
        }
    }

    #[test]
    fn create_reorder_delete_and_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lib.sqlite3");
        let plan_id;
        {
            let (db, _) = Database::open(&path).unwrap();
            let p = db.write(|c| save_plan(c, plan("Sunday Service"))).unwrap();
            assert_eq!(p.items.len(), 4);
            plan_id = p.id.clone();

            // Reorder and remove an item.
            let mut doc = to_document(&p);
            doc.items.swap(1, 2);
            doc.items.remove(3);
            let saved = db.write(|c| save_plan(c, doc)).unwrap();
            assert_eq!(saved.items.iter().map(|i| i.title.as_str()).collect::<Vec<_>>(), ["Worship", "John 3:16", "Opening Song"]);
            assert_eq!(saved.revision, 2);
            // Item ids are stable across saves.
            assert_eq!(saved.items[1].id, p.items[2].id);
        }
        // The plan survives a restart.
        let (db, _) = Database::open(&path).unwrap();
        let reloaded = db.read(|c| get_plan(c, &plan_id)).unwrap();
        assert_eq!(reloaded.items.len(), 3);
        assert_eq!(reloaded.items[2].title, "Opening Song");
    }

    #[test]
    fn duplicate_and_templates() {
        let db = Database::open_in_memory().unwrap();
        let p = db.write(|c| save_plan(c, plan("Morning Service"))).unwrap();
        let copy = db.write(|c| duplicate_plan(c, &p.id, DuplicatePlanOptions::default())).unwrap();
        assert_eq!(copy.title, "Morning Service (Copy)");
        assert_eq!(copy.items.len(), 4);
        assert!(copy.items.iter().all(|i| p.items.iter().all(|o| o.id != i.id)));

        let tpl = db
            .write(|c| duplicate_plan(c, &p.id, DuplicatePlanOptions { as_template: true, ..Default::default() }))
            .unwrap();
        assert!(tpl.is_template);
        assert!(tpl.service_date.is_none());
        let templates = db.read(|c| list_plans(c, &ServicePlanQuery { templates: true, ..Default::default() })).unwrap();
        assert_eq!(templates.len(), 1);
        let services = db.read(|c| list_plans(c, &ServicePlanQuery::default())).unwrap();
        assert_eq!(services.len(), 2);

        let from_tpl = db
            .write(|c| {
                duplicate_plan(
                    c,
                    &tpl.id,
                    DuplicatePlanOptions { service_date: Some("2026-11-08".into()), ..Default::default() },
                )
            })
            .unwrap();
        assert!(!from_tpl.is_template);
        assert_eq!(from_tpl.title, "Morning Service");
        assert_eq!(from_tpl.service_date.as_deref(), Some("2026-11-08"));
    }

    #[test]
    fn search_filter_and_delete() {
        let db = Database::open_in_memory().unwrap();
        let p = db.write(|c| save_plan(c, plan("Prayer Meeting"))).unwrap();
        db.write(|c| save_plan(c, plan("Youth Night"))).unwrap();
        let q = |t: &str| ServicePlanQuery { text: Some(t.into()), ..Default::default() };
        assert_eq!(db.read(|c| list_plans(c, &q("prayer"))).unwrap().len(), 1);
        assert_eq!(db.read(|c| list_plans(c, &q("communion"))).unwrap().len(), 2);
        assert_eq!(db.read(|c| list_plans(c, &q("100%"))).unwrap().len(), 0);
        db.write(|c| delete_plan(c, &p.id)).unwrap();
        assert_eq!(db.read(|c| list_plans(c, &ServicePlanQuery::default())).unwrap().len(), 1);
        assert!(db.read(|c| get_plan(c, &p.id)).is_err());
    }

    #[test]
    fn validation_errors() {
        let db = Database::open_in_memory().unwrap();
        let mut bad = plan("x");
        bad.service_date = Some("11/01/2026".into());
        assert!(db.write(|c| save_plan(c, bad)).is_err());
        let mut no_ref = plan("x");
        no_ref.items.push(item(ServiceItemType::Song, "Missing", None));
        assert!(db.write(|c| save_plan(c, no_ref)).is_err());
        let mut empty = plan("  ");
        empty.title = "  ".into();
        assert!(db.write(|c| save_plan(c, empty)).is_err());
    }

    #[test]
    fn item_cannot_be_stolen_from_another_plan() {
        let db = Database::open_in_memory().unwrap();
        let a = db.write(|c| save_plan(c, plan("A"))).unwrap();
        let mut b = plan("B");
        b.items[0].id = Some(a.items[0].id.clone());
        let err = db.write(|c| save_plan(c, b)).unwrap_err();
        assert_eq!(err.code(), "conflict");
        // Plan A is untouched.
        assert_eq!(db.read(|c| get_plan(c, &a.id)).unwrap().items.len(), 4);
    }
}
