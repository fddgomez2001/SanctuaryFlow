use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::sync;
use crate::util::{is_valid_uuid, new_id, now_iso};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ThemeCategory {
    #[default]
    General,
    Song,
    Scripture,
    Announcement,
}

impl ThemeCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            ThemeCategory::General => "general",
            ThemeCategory::Song => "song",
            ThemeCategory::Scripture => "scripture",
            ThemeCategory::Announcement => "announcement",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "song" => ThemeCategory::Song,
            "scripture" => ThemeCategory::Scripture,
            "announcement" => ThemeCategory::Announcement,
            _ => ThemeCategory::General,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub category: ThemeCategory,
    pub is_builtin: bool,
    /// ThemeSettings document; the frontend fills in defaults for missing keys.
    #[ts(type = "Record<string, unknown>")]
    pub settings: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
    #[ts(type = "number")]
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ThemeDocument {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub category: ThemeCategory,
    #[ts(type = "Record<string, unknown>")]
    pub settings: serde_json::Value,
}

fn theme_from_row(r: &Row) -> rusqlite::Result<Theme> {
    let category: String = r.get(2)?;
    let settings: String = r.get(4)?;
    Ok(Theme {
        id: r.get(0)?,
        name: r.get(1)?,
        category: ThemeCategory::parse(&category),
        is_builtin: r.get(3)?,
        settings: serde_json::from_str(&settings).unwrap_or_else(|_| serde_json::json!({})),
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
        revision: r.get(7)?,
    })
}

const COLUMNS: &str = "id, name, category, is_builtin, settings, created_at, updated_at, revision";

pub fn list_themes(conn: &Connection) -> Result<Vec<Theme>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM presentation_themes WHERE deleted_at IS NULL
         ORDER BY is_builtin DESC, name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([], theme_from_row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get_theme(conn: &Connection, id: &str) -> Result<Theme> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM presentation_themes WHERE id = ?1 AND deleted_at IS NULL"),
        [id],
        theme_from_row,
    )
    .optional()?
    .ok_or_else(|| Error::not_found("The theme was not found."))
}

pub fn save_theme(conn: &mut Connection, doc: ThemeDocument) -> Result<Theme> {
    let tx = conn.transaction()?;
    let id = save_theme_tx(&tx, doc)?;
    tx.commit()?;
    get_theme(conn, &id)
}

pub(crate) fn save_theme_tx(tx: &Connection, mut doc: ThemeDocument) -> Result<String> {
    doc.name = doc.name.trim().to_string();
    if doc.name.is_empty() {
        return Err(Error::validation("A theme needs a name."));
    }
    if !doc.settings.is_object() {
        return Err(Error::validation("Theme settings must be an object."));
    }
    if let Some(id) = &doc.id {
        if !is_valid_uuid(id) {
            return Err(Error::validation("Invalid theme id."));
        }
    }
    let now = now_iso();
    let existing: Option<(i64, bool)> = match &doc.id {
        Some(id) => tx
            .query_row("SELECT revision, is_builtin FROM presentation_themes WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?,
        None => None,
    };
    let id = doc.id.clone().unwrap_or_else(new_id);
    let revision = match existing {
        Some((rev, _builtin)) => {
            tx.execute(
                "UPDATE presentation_themes SET name = ?2, category = ?3, settings = ?4, updated_at = ?5,
                   deleted_at = NULL, revision = ?6 WHERE id = ?1",
                params![id, doc.name, doc.category.as_str(), doc.settings.to_string(), now, rev + 1],
            )?;
            rev + 1
        }
        None => {
            tx.execute(
                "INSERT INTO presentation_themes (id, name, category, is_builtin, settings, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 0, ?4, ?5, ?5)",
                params![id, doc.name, doc.category.as_str(), doc.settings.to_string(), now],
            )?;
            1
        }
    };
    sync::enqueue(tx, sync::ENTITY_THEME, &id, sync::OP_UPSERT, revision)?;
    Ok(id)
}

pub fn duplicate_theme(conn: &mut Connection, id: &str, name: Option<String>) -> Result<Theme> {
    let t = get_theme(conn, id)?;
    save_theme(
        conn,
        ThemeDocument {
            id: None,
            name: name.unwrap_or_else(|| format!("{} (Copy)", t.name)),
            category: t.category,
            settings: t.settings,
        },
    )
}

pub fn delete_theme(conn: &mut Connection, id: &str) -> Result<()> {
    let tx = conn.transaction()?;
    let (rev, builtin): (i64, bool) = tx
        .query_row(
            "SELECT revision, is_builtin FROM presentation_themes WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| Error::not_found("The theme was not found."))?;
    if builtin {
        return Err(Error::validation("Built-in themes cannot be deleted. Duplicate it to make your own version."));
    }
    let now = now_iso();
    tx.execute(
        "UPDATE presentation_themes SET deleted_at = ?2, updated_at = ?2, revision = ?3 WHERE id = ?1",
        params![id, now, rev + 1],
    )?;
    sync::enqueue(&tx, sync::ENTITY_THEME, id, sync::OP_DELETE, rev + 1)?;
    tx.commit()?;
    Ok(())
}

pub fn to_document(t: &Theme) -> ThemeDocument {
    ThemeDocument { id: Some(t.id.clone()), name: t.name.clone(), category: t.category, settings: t.settings.clone() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::seed;
    use serde_json::json;

    #[test]
    fn builtin_themes_are_seeded_and_protected() {
        let db = Database::open_in_memory().unwrap();
        let themes = db.read(list_themes).unwrap();
        assert_eq!(themes.len(), seed::builtin_themes().len());
        assert!(themes.iter().all(|t| t.is_builtin));
        let err = db.write(|c| delete_theme(c, seed::THEME_CLASSIC_BLACK)).unwrap_err();
        assert_eq!(err.code(), "validation");
    }

    #[test]
    fn create_duplicate_delete() {
        let db = Database::open_in_memory().unwrap();
        let t = db
            .write(|c| {
                save_theme(
                    c,
                    ThemeDocument {
                        id: None,
                        name: "Easter".into(),
                        category: ThemeCategory::Song,
                        settings: json!({ "fontSize": 80 }),
                    },
                )
            })
            .unwrap();
        let copy = db.write(|c| duplicate_theme(c, &t.id, None)).unwrap();
        assert_eq!(copy.name, "Easter (Copy)");
        assert_eq!(copy.settings["fontSize"], 80);
        db.write(|c| delete_theme(c, &t.id)).unwrap();
        assert!(db.read(|c| get_theme(c, &t.id)).is_err());
    }
}
