//! Custom slide decks: announcements, sermon slides and free-form slides
//! built in the slide editor. Slide content is a JSON document owned by the
//! frontend editor; the core validates its shape and size.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::sync;
use crate::util::{clean_opt, is_valid_uuid, new_id, now_iso};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum DeckCategory {
    Announcement,
    Sermon,
    #[default]
    Custom,
    Template,
}

impl DeckCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            DeckCategory::Announcement => "announcement",
            DeckCategory::Sermon => "sermon",
            DeckCategory::Custom => "custom",
            DeckCategory::Template => "template",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "announcement" => DeckCategory::Announcement,
            "sermon" => DeckCategory::Sermon,
            "template" => DeckCategory::Template,
            _ => DeckCategory::Custom,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SlideDeck {
    pub id: String,
    pub title: String,
    pub category: DeckCategory,
    pub theme_id: Option<String>,
    #[ts(type = "unknown[]")]
    pub slides: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
    #[ts(type = "number")]
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SlideDeckDocument {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub category: DeckCategory,
    #[serde(default)]
    pub theme_id: Option<String>,
    #[ts(type = "unknown[]")]
    pub slides: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SlideDeckSummary {
    pub id: String,
    pub title: String,
    pub category: DeckCategory,
    pub slide_count: u32,
    pub updated_at: String,
}

const MAX_SLIDES: usize = 500;
const MAX_DECK_BYTES: usize = 4 * 1024 * 1024;

fn deck_from_row(r: &Row) -> rusqlite::Result<SlideDeck> {
    let category: String = r.get(2)?;
    let slides: String = r.get(4)?;
    Ok(SlideDeck {
        id: r.get(0)?,
        title: r.get(1)?,
        category: DeckCategory::parse(&category),
        theme_id: r.get(3)?,
        slides: serde_json::from_str(&slides).unwrap_or_else(|_| serde_json::json!([])),
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
        revision: r.get(7)?,
    })
}

const COLUMNS: &str = "id, title, category, theme_id, slides, created_at, updated_at, revision";

pub fn list_decks(conn: &Connection, category: Option<DeckCategory>) -> Result<Vec<SlideDeckSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, category, json_array_length(slides), updated_at FROM custom_slides
         WHERE deleted_at IS NULL AND (?1 IS NULL OR category = ?1)
         ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([category.map(|c| c.as_str())], |r| {
        let c: String = r.get(2)?;
        Ok(SlideDeckSummary {
            id: r.get(0)?,
            title: r.get(1)?,
            category: DeckCategory::parse(&c),
            slide_count: r.get(3)?,
            updated_at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get_deck(conn: &Connection, id: &str) -> Result<SlideDeck> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM custom_slides WHERE id = ?1 AND deleted_at IS NULL"), [id], deck_from_row)
        .optional()?
        .ok_or_else(|| Error::not_found("The slide deck was not found."))
}

pub fn save_deck(conn: &mut Connection, doc: SlideDeckDocument) -> Result<SlideDeck> {
    let tx = conn.transaction()?;
    let id = save_deck_tx(&tx, doc)?;
    tx.commit()?;
    get_deck(conn, &id)
}

pub(crate) fn save_deck_tx(tx: &Connection, mut doc: SlideDeckDocument) -> Result<String> {
    doc.title = doc.title.trim().to_string();
    if doc.title.is_empty() {
        return Err(Error::validation("A slide deck needs a title."));
    }
    let Some(slides) = doc.slides.as_array() else {
        return Err(Error::validation("Slides must be a list."));
    };
    if slides.len() > MAX_SLIDES {
        return Err(Error::validation(format!("A deck can contain at most {MAX_SLIDES} slides.")));
    }
    if slides.iter().any(|s| !s.is_object()) {
        return Err(Error::validation("Every slide must be an object."));
    }
    let slides_json = doc.slides.to_string();
    if slides_json.len() > MAX_DECK_BYTES {
        return Err(Error::validation("The slide deck is too large. Use media files for images instead of inline data."));
    }
    if let Some(id) = &doc.id {
        if !is_valid_uuid(id) {
            return Err(Error::validation("Invalid slide deck id."));
        }
    }
    doc.theme_id = clean_opt(doc.theme_id);
    let now = now_iso();
    let existing: Option<i64> = match &doc.id {
        Some(id) => tx.query_row("SELECT revision FROM custom_slides WHERE id = ?1", [id], |r| r.get(0)).optional()?,
        None => None,
    };
    let id = doc.id.clone().unwrap_or_else(new_id);
    let revision = match existing {
        Some(rev) => {
            let current: Option<(String, String, Option<String>, String)> = tx
                .query_row(
                    "SELECT title, category, theme_id, slides FROM custom_slides WHERE id = ?1 AND deleted_at IS NULL",
                    [&id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()?;
            if let Some((title, category, theme_id, slides)) = current {
                let unchanged = title == doc.title
                    && category == doc.category.as_str()
                    && theme_id == doc.theme_id
                    && serde_json::from_str::<serde_json::Value>(&slides).ok().as_ref() == Some(&doc.slides);
                if unchanged {
                    return Ok(id);
                }
            }
            tx.execute(
                "UPDATE custom_slides SET title = ?2, category = ?3, theme_id = ?4, slides = ?5, updated_at = ?6,
                   deleted_at = NULL, revision = ?7 WHERE id = ?1",
                params![id, doc.title, doc.category.as_str(), doc.theme_id, slides_json, now, rev + 1],
            )?;
            rev + 1
        }
        None => {
            tx.execute(
                "INSERT INTO custom_slides (id, title, category, theme_id, slides, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![id, doc.title, doc.category.as_str(), doc.theme_id, slides_json, now],
            )?;
            1
        }
    };
    sync::enqueue(tx, sync::ENTITY_SLIDE_DECK, &id, sync::OP_UPSERT, revision)?;
    Ok(id)
}

pub fn duplicate_deck(conn: &mut Connection, id: &str) -> Result<SlideDeck> {
    let d = get_deck(conn, id)?;
    // Give every slide a fresh id so copies can be edited independently.
    let mut slides = d.slides.clone();
    if let Some(arr) = slides.as_array_mut() {
        for s in arr.iter_mut() {
            if let Some(obj) = s.as_object_mut() {
                obj.insert("id".into(), serde_json::Value::String(new_id()));
            }
        }
    }
    save_deck(
        conn,
        SlideDeckDocument {
            id: None,
            title: format!("{} (Copy)", d.title),
            category: if d.category == DeckCategory::Template { DeckCategory::Custom } else { d.category },
            theme_id: d.theme_id,
            slides,
        },
    )
}

pub fn delete_deck(conn: &mut Connection, id: &str) -> Result<()> {
    let tx = conn.transaction()?;
    let rev: i64 = tx
        .query_row("SELECT revision FROM custom_slides WHERE id = ?1 AND deleted_at IS NULL", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| Error::not_found("The slide deck was not found."))?;
    let now = now_iso();
    tx.execute(
        "UPDATE custom_slides SET deleted_at = ?2, updated_at = ?2, revision = ?3 WHERE id = ?1",
        params![id, now, rev + 1],
    )?;
    sync::enqueue(&tx, sync::ENTITY_SLIDE_DECK, id, sync::OP_DELETE, rev + 1)?;
    tx.commit()?;
    Ok(())
}

pub fn to_document(d: &SlideDeck) -> SlideDeckDocument {
    SlideDeckDocument {
        id: Some(d.id.clone()),
        title: d.title.clone(),
        category: d.category,
        theme_id: d.theme_id.clone(),
        slides: d.slides.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use serde_json::json;

    #[test]
    fn deck_crud_and_duplicate() {
        let db = Database::open_in_memory().unwrap();
        let deck = db
            .write(|c| {
                save_deck(
                    c,
                    SlideDeckDocument {
                        id: None,
                        title: "Announcements".into(),
                        category: DeckCategory::Announcement,
                        theme_id: None,
                        slides: json!([{ "id": "a", "elements": [] }, { "id": "b", "elements": [] }]),
                    },
                )
            })
            .unwrap();
        let summaries = db.read(|c| list_decks(c, Some(DeckCategory::Announcement))).unwrap();
        assert_eq!(summaries[0].slide_count, 2);
        let copy = db.write(|c| duplicate_deck(c, &deck.id)).unwrap();
        assert_ne!(copy.slides[0]["id"], "a");
        db.write(|c| delete_deck(c, &deck.id)).unwrap();
        assert_eq!(db.read(|c| list_decks(c, None)).unwrap().len(), 1);
        let bad = SlideDeckDocument { id: None, title: "x".into(), category: DeckCategory::Custom, theme_id: None, slides: json!({}) };
        assert!(db.write(|c| save_deck(c, bad)).is_err());
    }
}
