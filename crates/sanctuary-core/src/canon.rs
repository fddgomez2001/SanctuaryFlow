//! The canonical Bible book catalog. It is kept separate from translation text
//! so translations with different versification or extra books can coexist.

use std::collections::HashMap;
use std::sync::OnceLock;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Testament {
    OT,
    NT,
    DC,
}

impl Testament {
    pub fn as_str(self) -> &'static str {
        match self {
            Testament::OT => "OT",
            Testament::NT => "NT",
            Testament::DC => "DC",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CanonBook {
    /// USFM book code, e.g. "GEN".
    pub id: String,
    /// OSIS book id, e.g. "Gen".
    pub osis: String,
    pub name: String,
    pub testament: Testament,
    pub chapters: u32,
    pub abbreviations: Vec<String>,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CanonDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub books: Vec<CanonBook>,
}

impl CanonDefinition {
    pub fn book(&self, id: &str) -> Option<&CanonBook> {
        self.books.iter().find(|b| b.id == id)
    }

    pub fn book_order(&self, id: &str) -> Option<usize> {
        self.books.iter().position(|b| b.id == id).map(|i| i + 1)
    }

    pub fn total_chapters(&self) -> u32 {
        self.books.iter().map(|b| b.chapters).sum()
    }

    pub fn count_testament(&self, t: Testament) -> usize {
        self.books.iter().filter(|b| b.testament == t).count()
    }
}

pub const PROTESTANT_CANON_ID: &str = "protestant";

pub fn protestant() -> &'static CanonDefinition {
    static CANON: OnceLock<CanonDefinition> = OnceLock::new();
    CANON.get_or_init(|| {
        serde_json::from_str(include_str!("../../../shared/bible/canon-protestant.json"))
            .expect("embedded canon catalog is valid JSON")
    })
}

/// Every canon known to this build of the application.
pub fn all() -> Vec<&'static CanonDefinition> {
    vec![protestant()]
}

pub fn by_id(id: &str) -> Option<&'static CanonDefinition> {
    all().into_iter().find(|c| c.id == id)
}

/// Normalizes a book name for lookup: lowercase, ordinal words and Roman
/// numerals converted to digits, punctuation and spaces removed.
pub fn normalize_book_key(input: &str) -> String {
    let lower = input.trim().to_lowercase().replace(['.', '_', '-'], " ");
    let words: Vec<&str> = lower.split_whitespace().collect();
    let mut parts: Vec<String> = Vec::with_capacity(words.len());
    for (i, w) in words.iter().enumerate() {
        let mapped = if i == 0 && words.len() > 1 {
            match *w {
                "i" | "first" | "1st" => "1",
                "ii" | "second" | "2nd" => "2",
                "iii" | "third" | "3rd" => "3",
                other => other,
            }
        } else {
            w
        };
        parts.push(mapped.to_string());
    }
    let mut key: String = parts.concat().chars().filter(|c| c.is_alphanumeric()).collect();
    // Common leading words in formal titles.
    for prefix in ["thebookof", "thegospelaccordingto", "gospelaccordingto", "thefirstbookof", "the"] {
        if key.starts_with(prefix) && key.len() > prefix.len() + 1 {
            key = key[prefix.len()..].to_string();
            break;
        }
    }
    key
}

/// Lookup from normalized names, codes and abbreviations to book ids.
pub struct BookResolver {
    keys: HashMap<String, String>,
}

impl BookResolver {
    pub fn new(canons: &[&CanonDefinition]) -> Self {
        let mut keys = HashMap::new();
        for canon in canons {
            for b in &canon.books {
                let names = [b.id.as_str(), b.osis.as_str(), b.name.as_str()]
                    .into_iter()
                    .chain(b.abbreviations.iter().map(String::as_str))
                    .chain(b.aliases.iter().map(String::as_str));
                for n in names {
                    keys.entry(normalize_book_key(n)).or_insert_with(|| b.id.clone());
                }
            }
        }
        for (alias, id) in EXTRA_ALIASES {
            keys.entry(normalize_book_key(alias)).or_insert_with(|| id.to_string());
        }
        Self { keys }
    }

    pub fn standard() -> &'static BookResolver {
        static R: OnceLock<BookResolver> = OnceLock::new();
        R.get_or_init(|| BookResolver::new(&all()))
    }

    pub fn resolve(&self, name: &str) -> Option<&str> {
        self.keys.get(&normalize_book_key(name)).map(String::as_str)
    }
}

/// Book names that appear in common source files but not in the catalog.
const EXTRA_ALIASES: &[(&str, &str)] = &[
    ("Revelation of John", "REV"),
    ("Revelation of St John", "REV"),
    ("Canticle of Canticles", "SNG"),
    ("Qoheleth", "ECC"),
    ("Psalm", "PSA"),
    ("Paralipomenon", "1CH"),
    ("Mark", "MRK"),
    ("Luke", "LUK"),
    ("John", "JHN"),
];

/// Seeds the built-in canons and their books. Safe to run on every start.
pub fn seed(conn: &Connection) -> Result<()> {
    for canon in all() {
        conn.execute(
            "INSERT INTO bible_canons (id, name, description, is_builtin) VALUES (?1, ?2, ?3, 1)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description",
            params![canon.id, canon.name, canon.description],
        )?;
        for (i, b) in canon.books.iter().enumerate() {
            conn.execute(
                "INSERT INTO bible_books (id, osis_id, name, testament, abbreviations, aliases)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET osis_id = excluded.osis_id, name = excluded.name,
                   testament = excluded.testament, abbreviations = excluded.abbreviations,
                   aliases = excluded.aliases",
                params![
                    b.id,
                    b.osis,
                    b.name,
                    b.testament.as_str(),
                    serde_json::to_string(&b.abbreviations)?,
                    serde_json::to_string(&b.aliases)?
                ],
            )?;
            conn.execute(
                "INSERT INTO bible_canon_books (canon_id, book_id, book_order, chapter_count)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(canon_id, book_id) DO UPDATE SET book_order = excluded.book_order,
                   chapter_count = excluded.chapter_count",
                params![canon.id, b.id, (i + 1) as i64, b.chapters],
            )?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CanonSummary {
    pub canon_id: String,
    pub book_count: u32,
    pub old_testament_books: u32,
    pub new_testament_books: u32,
    pub chapter_count: u32,
}

/// Reads the seeded catalog back from the database.
pub fn summary_from_db(conn: &Connection, canon_id: &str) -> Result<CanonSummary> {
    let (book_count, ot, nt, chapters): (u32, u32, u32, u32) = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(b.testament = 'OT'), 0),
                COALESCE(SUM(b.testament = 'NT'), 0),
                COALESCE(SUM(cb.chapter_count), 0)
         FROM bible_canon_books cb JOIN bible_books b ON b.id = cb.book_id
         WHERE cb.canon_id = ?1",
        [canon_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    Ok(CanonSummary {
        canon_id: canon_id.to_string(),
        book_count,
        old_testament_books: ot,
        new_testament_books: nt,
        chapter_count: chapters,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn protestant_catalog_counts() {
        let c = protestant();
        assert_eq!(c.books.len(), 66);
        assert_eq!(c.count_testament(Testament::OT), 39);
        assert_eq!(c.count_testament(Testament::NT), 27);
        assert_eq!(c.total_chapters(), 1189);
        let ot: u32 = c.books.iter().filter(|b| b.testament == Testament::OT).map(|b| b.chapters).sum();
        assert_eq!(ot, 929);
        assert_eq!(c.books.first().unwrap().id, "GEN");
        assert_eq!(c.books.last().unwrap().id, "REV");
        assert_eq!(c.book("PSA").unwrap().chapters, 150);
        assert_eq!(c.book_order("MAT"), Some(40));
    }

    #[test]
    fn catalog_ids_are_unique() {
        let c = protestant();
        let mut ids: Vec<_> = c.books.iter().map(|b| b.id.clone()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 66);
        let mut osis: Vec<_> = c.books.iter().map(|b| b.osis.clone()).collect();
        osis.sort();
        osis.dedup();
        assert_eq!(osis.len(), 66);
    }

    #[test]
    fn names_and_abbreviations_never_collide_between_books() {
        let c = protestant();
        let mut seen: HashMap<String, String> = HashMap::new();
        for b in &c.books {
            let names = [b.id.as_str(), b.osis.as_str(), b.name.as_str()]
                .into_iter()
                .chain(b.abbreviations.iter().map(String::as_str))
                .chain(b.aliases.iter().map(String::as_str));
            for n in names {
                let key = normalize_book_key(n);
                if let Some(other) = seen.get(&key) {
                    assert_eq!(other, &b.id, "'{n}' maps to both {other} and {}", b.id);
                }
                seen.insert(key, b.id.clone());
            }
        }
    }

    #[test]
    fn resolver_handles_common_spellings() {
        let r = BookResolver::standard();
        for (input, id) in [
            ("Genesis", "GEN"),
            ("GEN", "GEN"),
            ("gen", "GEN"),
            ("1 Samuel", "1SA"),
            ("1Sam", "1SA"),
            ("I Samuel", "1SA"),
            ("First Samuel", "1SA"),
            ("II Kings", "2KI"),
            ("Psalm", "PSA"),
            ("Psalms", "PSA"),
            ("Song of Songs", "SNG"),
            ("Song of Solomon", "SNG"),
            ("Revelation of John", "REV"),
            ("1John", "1JN"),
            ("III John", "3JN"),
            ("Mga Awit", "PSA"),
            ("Juan", "JHN"),
            ("The Gospel According to Matthew", "MAT"),
            ("Isaiah", "ISA"),
            ("Phlm", "PHM"),
            ("Phil", "PHP"),
        ] {
            assert_eq!(r.resolve(input), Some(id), "{input}");
        }
        assert_eq!(r.resolve("Tobit"), None);
        assert_eq!(r.resolve(""), None);
    }

    #[test]
    fn seeded_catalog_matches_definition() {
        let db = Database::open_in_memory().unwrap();
        let s = db.read(|c| summary_from_db(c, PROTESTANT_CANON_ID)).unwrap();
        assert_eq!(s.book_count, 66);
        assert_eq!(s.old_testament_books, 39);
        assert_eq!(s.new_testament_books, 27);
        assert_eq!(s.chapter_count, 1189);
        // Seeding twice is idempotent.
        db.write(|c| seed(c)).unwrap();
        let s2 = db.read(|c| summary_from_db(c, PROTESTANT_CANON_ID)).unwrap();
        assert_eq!(s2.book_count, 66);
    }
}
