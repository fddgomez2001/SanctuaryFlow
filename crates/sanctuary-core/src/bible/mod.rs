//! Bible library: translations, verse lookup, passages, search, and the
//! recently used / favorite passage lists. All reads come from local SQLite.

pub mod builtin;
pub mod import;
pub mod validate;

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::canon::{self, Testament};
use crate::error::{Error, Result};
use crate::util::{clean_opt, fts_query, new_id, now_iso};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Translation {
    pub id: String,
    pub code: String,
    pub name: String,
    pub language: String,
    pub canon_id: String,
    pub versification: Option<String>,
    pub text_direction: String,
    pub publisher: Option<String>,
    pub source_provider: Option<String>,
    pub source_url: Option<String>,
    pub source_format: Option<String>,
    pub license_name: Option<String>,
    pub license_url: Option<String>,
    pub copyright_notice: Option<String>,
    pub attribution_text: Option<String>,
    pub offline_permitted: Option<bool>,
    pub redistribution_permitted: Option<bool>,
    pub modification_permitted: Option<bool>,
    pub downloaded_at: Option<String>,
    pub imported_at: Option<String>,
    pub last_validated_at: Option<String>,
    pub import_status: String,
    pub validation_status: String,
    pub book_count: u32,
    pub chapter_count: u32,
    pub verse_count: u32,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Editable translation metadata (used on import and when editing details later).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct TranslationMetadataInput {
    pub code: String,
    pub name: String,
    pub language: String,
    pub versification: Option<String>,
    pub text_direction: Option<String>,
    pub publisher: Option<String>,
    pub source_provider: Option<String>,
    pub source_url: Option<String>,
    pub license_name: Option<String>,
    pub license_url: Option<String>,
    pub copyright_notice: Option<String>,
    pub attribution_text: Option<String>,
    pub offline_permitted: Option<bool>,
    pub redistribution_permitted: Option<bool>,
    pub modification_permitted: Option<bool>,
    pub downloaded_at: Option<String>,
    pub notes: Option<String>,
}

impl TranslationMetadataInput {
    pub fn normalized(mut self) -> Result<Self> {
        self.code = self.code.trim().to_uppercase();
        self.name = self.name.trim().to_string();
        self.language = self.language.trim().to_string();
        if self.code.is_empty() || self.code.len() > 24 {
            return Err(Error::validation("Enter a short translation code (1–24 characters), e.g. WEB."));
        }
        if !self.code.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.') {
            return Err(Error::validation("The translation code may only contain letters, digits, '-', '_' and '.'."));
        }
        if self.name.is_empty() {
            return Err(Error::validation("Enter the translation's display name."));
        }
        if self.language.is_empty() {
            return Err(Error::validation("Enter the translation's language (for example 'en' or 'tl')."));
        }
        self.versification = clean_opt(self.versification);
        self.text_direction = clean_opt(self.text_direction).filter(|d| d == "ltr" || d == "rtl");
        self.publisher = clean_opt(self.publisher);
        self.source_provider = clean_opt(self.source_provider);
        self.source_url = clean_opt(self.source_url);
        self.license_name = clean_opt(self.license_name);
        self.license_url = clean_opt(self.license_url);
        self.copyright_notice = clean_opt(self.copyright_notice);
        self.attribution_text = clean_opt(self.attribution_text);
        self.downloaded_at = clean_opt(self.downloaded_at);
        self.notes = clean_opt(self.notes);
        Ok(self)
    }
}

const TRANSLATION_COLUMNS: &str = "id, code, name, language, canon_id, versification, text_direction, publisher, \
    source_provider, source_url, source_format, license_name, license_url, copyright_notice, attribution_text, \
    offline_permitted, redistribution_permitted, modification_permitted, downloaded_at, imported_at, \
    last_validated_at, import_status, validation_status, book_count, chapter_count, verse_count, notes, \
    created_at, updated_at";

fn translation_from_row(r: &Row) -> rusqlite::Result<Translation> {
    Ok(Translation {
        id: r.get(0)?,
        code: r.get(1)?,
        name: r.get(2)?,
        language: r.get(3)?,
        canon_id: r.get(4)?,
        versification: r.get(5)?,
        text_direction: r.get(6)?,
        publisher: r.get(7)?,
        source_provider: r.get(8)?,
        source_url: r.get(9)?,
        source_format: r.get(10)?,
        license_name: r.get(11)?,
        license_url: r.get(12)?,
        copyright_notice: r.get(13)?,
        attribution_text: r.get(14)?,
        offline_permitted: r.get(15)?,
        redistribution_permitted: r.get(16)?,
        modification_permitted: r.get(17)?,
        downloaded_at: r.get(18)?,
        imported_at: r.get(19)?,
        last_validated_at: r.get(20)?,
        import_status: r.get(21)?,
        validation_status: r.get(22)?,
        book_count: r.get(23)?,
        chapter_count: r.get(24)?,
        verse_count: r.get(25)?,
        notes: r.get(26)?,
        created_at: r.get(27)?,
        updated_at: r.get(28)?,
    })
}

pub fn list_translations(conn: &Connection) -> Result<Vec<Translation>> {
    let mut stmt =
        conn.prepare(&format!("SELECT {TRANSLATION_COLUMNS} FROM bible_translations ORDER BY name COLLATE NOCASE"))?;
    let rows = stmt.query_map([], translation_from_row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get_translation(conn: &Connection, id: &str) -> Result<Translation> {
    conn.query_row(&format!("SELECT {TRANSLATION_COLUMNS} FROM bible_translations WHERE id = ?1"), [id], translation_from_row)
        .optional()?
        .ok_or_else(|| Error::not_found("The Bible translation was not found."))
}

pub fn find_translation_by_code(conn: &Connection, code: &str) -> Result<Option<Translation>> {
    Ok(conn
        .query_row(
            &format!("SELECT {TRANSLATION_COLUMNS} FROM bible_translations WHERE code = ?1"),
            [code.trim()],
            translation_from_row,
        )
        .optional()?)
}

/// Updates descriptive and license metadata. Text and validation data are not
/// affected.
pub fn update_translation_metadata(conn: &Connection, id: &str, input: TranslationMetadataInput) -> Result<Translation> {
    let m = input.normalized()?;
    if let Some(other) = find_translation_by_code(conn, &m.code)? {
        if other.id != id {
            return Err(Error::Conflict(format!("Another translation already uses the code {}.", m.code)));
        }
    }
    let n = conn.execute(
        "UPDATE bible_translations SET code = ?2, name = ?3, language = ?4, versification = ?5,
           text_direction = COALESCE(?6, text_direction), publisher = ?7, source_provider = ?8, source_url = ?9,
           license_name = ?10, license_url = ?11, copyright_notice = ?12, attribution_text = ?13,
           offline_permitted = ?14, redistribution_permitted = ?15, modification_permitted = ?16, notes = ?17,
           updated_at = ?18
         WHERE id = ?1",
        params![
            id,
            m.code,
            m.name,
            m.language,
            m.versification,
            m.text_direction,
            m.publisher,
            m.source_provider,
            m.source_url,
            m.license_name,
            m.license_url,
            m.copyright_notice,
            m.attribution_text,
            m.offline_permitted,
            m.redistribution_permitted,
            m.modification_permitted,
            m.notes,
            now_iso()
        ],
    )?;
    if n == 0 {
        return Err(Error::not_found("The Bible translation was not found."));
    }
    get_translation(conn, id)
}

pub fn delete_translation(conn: &mut Connection, id: &str) -> Result<()> {
    let tx = conn.transaction()?;
    let n = tx.execute("DELETE FROM bible_translations WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(Error::not_found("The Bible translation was not found."));
    }
    tx.execute("UPDATE scripture_passages SET translation_id = NULL WHERE translation_id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BibleBookInfo {
    pub id: String,
    pub osis_id: String,
    /// The translation's own book name when available, otherwise the catalog name.
    pub name: String,
    pub canonical_name: String,
    pub abbreviation: Option<String>,
    pub testament: Testament,
    pub book_order: u32,
    pub chapter_count: u32,
    pub canonical_chapter_count: u32,
    pub verse_count: u32,
    pub available: bool,
}

/// Books of the translation's canon (or the default canon), with the
/// translation's own names and chapter counts where it has text.
pub fn list_books(conn: &Connection, translation_id: Option<&str>) -> Result<Vec<BibleBookInfo>> {
    let canon_id = match translation_id {
        Some(id) => get_translation(conn, id)?.canon_id,
        None => canon::PROTESTANT_CANON_ID.to_string(),
    };
    let mut stmt = conn.prepare(
        "SELECT b.id, b.osis_id, COALESCE(tb.name, b.name), b.name, tb.abbreviation, b.testament,
                cb.book_order, COALESCE(tb.chapter_count, cb.chapter_count), cb.chapter_count,
                COALESCE(tb.verse_count, 0), tb.book_id IS NOT NULL
         FROM bible_canon_books cb
         JOIN bible_books b ON b.id = cb.book_id
         LEFT JOIN bible_translation_books tb ON tb.book_id = b.id AND tb.translation_id = ?2
         WHERE cb.canon_id = ?1
         ORDER BY cb.book_order",
    )?;
    let rows = stmt.query_map(params![canon_id, translation_id], |r| {
        let t: String = r.get(5)?;
        Ok(BibleBookInfo {
            id: r.get(0)?,
            osis_id: r.get(1)?,
            name: r.get(2)?,
            canonical_name: r.get(3)?,
            abbreviation: r.get(4)?,
            testament: match t.as_str() {
                "NT" => Testament::NT,
                "DC" => Testament::DC,
                _ => Testament::OT,
            },
            book_order: r.get(6)?,
            chapter_count: r.get(7)?,
            canonical_chapter_count: r.get(8)?,
            verse_count: r.get(9)?,
            available: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Verse {
    pub book_id: String,
    pub chapter: u32,
    pub verse: u32,
    pub verse_end: Option<u32>,
    pub text: String,
}

fn verse_from_row(r: &Row) -> rusqlite::Result<Verse> {
    Ok(Verse { book_id: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)?, verse_end: r.get(3)?, text: r.get(4)? })
}

pub fn get_chapter(conn: &Connection, translation_id: &str, book_id: &str, chapter: u32) -> Result<Vec<Verse>> {
    let mut stmt = conn.prepare_cached(
        "SELECT book_id, chapter, verse, verse_end, text FROM bible_verses
         WHERE translation_id = ?1 AND book_id = ?2 AND chapter = ?3 ORDER BY verse",
    )?;
    let rows = stmt.query_map(params![translation_id, book_id, chapter], verse_from_row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// A passage within one book: `John 3:16`, `Psalm 23`, `Romans 8:28-30` or
/// cross-chapter ranges such as `Genesis 1:26-2:3`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PassageRef {
    pub book_id: String,
    pub chapter: u32,
    pub verse_start: Option<u32>,
    pub chapter_end: Option<u32>,
    pub verse_end: Option<u32>,
}

impl PassageRef {
    pub fn key(&self) -> String {
        let mut k = format!("{} {}", self.book_id, self.chapter);
        if let Some(v) = self.verse_start {
            k.push_str(&format!(":{v}"));
        }
        match (self.chapter_end, self.verse_end) {
            (Some(ce), Some(ve)) if ce != self.chapter => k.push_str(&format!("-{ce}:{ve}")),
            (Some(ce), None) if ce != self.chapter => k.push_str(&format!("-{ce}")),
            (_, Some(ve)) => k.push_str(&format!("-{ve}")),
            _ => {}
        }
        k
    }

    fn validate(&self) -> Result<()> {
        if self.chapter == 0 {
            return Err(Error::validation("Chapter numbers start at 1."));
        }
        let end_ch = self.chapter_end.unwrap_or(self.chapter);
        if end_ch < self.chapter {
            return Err(Error::validation("The passage ends before it starts."));
        }
        if end_ch == self.chapter {
            if let (Some(s), Some(e)) = (self.verse_start, self.verse_end) {
                if e < s {
                    return Err(Error::validation("The passage ends before it starts."));
                }
            }
        }
        if end_ch - self.chapter > 150 {
            return Err(Error::validation("That passage is too long to display."));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Passage {
    pub translation_id: String,
    pub translation_code: String,
    pub book_name: String,
    pub reference: PassageRef,
    pub verses: Vec<Verse>,
}

/// Fetches a passage. Combined source verses (e.g. "1-2") are included when
/// any verse they cover falls inside the requested range.
pub fn get_passage(conn: &Connection, translation_id: &str, r: &PassageRef) -> Result<Passage> {
    r.validate()?;
    let t = get_translation(conn, translation_id)?;
    let book_name: String = conn
        .query_row(
            "SELECT COALESCE(tb.name, b.name) FROM bible_books b
             LEFT JOIN bible_translation_books tb ON tb.book_id = b.id AND tb.translation_id = ?1
             WHERE b.id = ?2",
            params![translation_id, r.book_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| Error::validation(format!("Unknown book '{}'.", r.book_id)))?;

    let end_ch = r.chapter_end.unwrap_or(r.chapter);
    let start_v = r.verse_start.unwrap_or(0);
    let end_v = match (r.verse_start, r.verse_end) {
        (_, Some(ve)) => ve,
        // "John 3:16" is a single verse; "Genesis 1:26-2" runs to the end of chapter 2.
        (Some(vs), None) if end_ch == r.chapter => vs,
        _ => u32::MAX,
    };
    // Encode (chapter, verse) as a single sortable number.
    let start_key = r.chapter as i64 * 1_000 + start_v as i64;
    let end_key = end_ch as i64 * 1_000 + (end_v.min(999)) as i64;
    let mut stmt = conn.prepare_cached(
        "SELECT book_id, chapter, verse, verse_end, text FROM bible_verses
         WHERE translation_id = ?1 AND book_id = ?2 AND chapter BETWEEN ?3 AND ?4
           AND chapter * 1000 + COALESCE(verse_end, verse) >= ?5
           AND chapter * 1000 + verse <= ?6
         ORDER BY chapter, verse",
    )?;
    let verses: Vec<Verse> = stmt
        .query_map(params![translation_id, r.book_id, r.chapter, end_ch, start_key, end_key], verse_from_row)?
        .collect::<std::result::Result<_, _>>()?;
    if verses.is_empty() {
        return Err(Error::NotFound(format!(
            "{} has no text for {} {}{} in this translation.",
            t.code,
            book_name,
            r.chapter,
            r.verse_start.map(|v| format!(":{v}")).unwrap_or_default()
        )));
    }
    Ok(Passage { translation_id: t.id, translation_code: t.code, book_name, reference: r.clone(), verses })
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct BibleSearchQuery {
    pub translation_id: String,
    pub text: String,
    pub testament: Option<Testament>,
    pub book_id: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BibleSearchHit {
    pub book_id: String,
    pub book_name: String,
    pub chapter: u32,
    pub verse: u32,
    pub verse_end: Option<u32>,
    pub text: String,
    /// Text with matches wrapped in U+E000 / U+E001 markers for highlighting.
    pub highlighted: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BibleSearchResult {
    pub hits: Vec<BibleSearchHit>,
    pub total: u32,
}

pub fn search(conn: &Connection, q: &BibleSearchQuery) -> Result<BibleSearchResult> {
    let Some(expr) = fts_query(&q.text) else {
        return Ok(BibleSearchResult { hits: Vec::new(), total: 0 });
    };
    let testament = q.testament.map(|t| t.as_str());
    let filter = "v.translation_id = ?2
        AND (?3 IS NULL OR v.book_id = ?3)
        AND (?4 IS NULL OR b.testament = ?4)";
    let total: u32 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM bible_verses_fts f
             JOIN bible_verses v ON v.id = f.rowid
             JOIN bible_books b ON b.id = v.book_id
             WHERE bible_verses_fts MATCH ?1 AND {filter}"
        ),
        params![expr, q.translation_id, q.book_id, testament],
        |r| r.get(0),
    )?;
    let limit = q.limit.unwrap_or(100).min(500);
    let offset = q.offset.unwrap_or(0);
    let mut stmt = conn.prepare(&format!(
        "SELECT v.book_id, COALESCE(tb.name, b.name), v.chapter, v.verse, v.verse_end, v.text,
                highlight(bible_verses_fts, 0, char(57344), char(57345))
         FROM bible_verses_fts f
         JOIN bible_verses v ON v.id = f.rowid
         JOIN bible_books b ON b.id = v.book_id
         JOIN bible_canon_books cb ON cb.book_id = v.book_id AND cb.canon_id =
              (SELECT canon_id FROM bible_translations WHERE id = ?2)
         LEFT JOIN bible_translation_books tb ON tb.book_id = v.book_id AND tb.translation_id = v.translation_id
         WHERE bible_verses_fts MATCH ?1 AND {filter}
         ORDER BY cb.book_order, v.chapter, v.verse
         LIMIT {limit} OFFSET {offset}"
    ))?;
    let hits = stmt
        .query_map(params![expr, q.translation_id, q.book_id, testament], |r| {
            Ok(BibleSearchHit {
                book_id: r.get(0)?,
                book_name: r.get(1)?,
                chapter: r.get(2)?,
                verse: r.get(3)?,
                verse_end: r.get(4)?,
                text: r.get(5)?,
                highlighted: r.get(6)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(BibleSearchResult { hits, total })
}

// ---------------------------------------------------------------------------
// Recently used and favorite passages
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SavedPassage {
    pub id: String,
    pub reference: String,
    pub translation_id: Option<String>,
    pub passage: PassageRef,
    pub is_favorite: bool,
    pub use_count: u32,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SavePassageInput {
    pub reference: String,
    pub translation_id: Option<String>,
    pub passage: PassageRef,
}

fn upsert_passage(conn: &Connection, input: &SavePassageInput) -> Result<String> {
    input.passage.validate()?;
    let key = input.passage.key();
    let now = now_iso();
    conn.execute(
        "INSERT INTO scripture_passages (id, passage_key, reference, translation_id, book_id, chapter, verse_start,
           chapter_end, verse_end, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(passage_key) DO UPDATE SET reference = excluded.reference,
           translation_id = COALESCE(excluded.translation_id, scripture_passages.translation_id)",
        params![
            new_id(),
            key,
            input.reference.trim(),
            input.translation_id,
            input.passage.book_id,
            input.passage.chapter,
            input.passage.verse_start,
            input.passage.chapter_end,
            input.passage.verse_end,
            now
        ],
    )?;
    Ok(conn.query_row("SELECT id FROM scripture_passages WHERE passage_key = ?1", [key], |r| r.get(0))?)
}

pub fn record_passage_use(conn: &Connection, input: &SavePassageInput) -> Result<()> {
    let id = upsert_passage(conn, input)?;
    conn.execute(
        "UPDATE scripture_passages SET use_count = use_count + 1, last_used_at = ?2 WHERE id = ?1",
        params![id, now_iso()],
    )?;
    Ok(())
}

pub fn set_passage_favorite(conn: &Connection, input: &SavePassageInput, favorite: bool) -> Result<()> {
    let id = upsert_passage(conn, input)?;
    conn.execute("UPDATE scripture_passages SET is_favorite = ?2 WHERE id = ?1", params![id, favorite])?;
    Ok(())
}

pub fn remove_saved_passage(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM scripture_passages WHERE id = ?1", [id])?;
    Ok(())
}

pub fn list_saved_passages(conn: &Connection, favorites: bool, limit: u32) -> Result<Vec<SavedPassage>> {
    let sql = if favorites {
        "SELECT id, reference, translation_id, book_id, chapter, verse_start, chapter_end, verse_end, is_favorite,
                use_count, last_used_at
         FROM scripture_passages WHERE is_favorite = 1 ORDER BY reference COLLATE NOCASE LIMIT ?1"
    } else {
        "SELECT id, reference, translation_id, book_id, chapter, verse_start, chapter_end, verse_end, is_favorite,
                use_count, last_used_at
         FROM scripture_passages WHERE last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT ?1"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([limit.min(200)], |r| {
        Ok(SavedPassage {
            id: r.get(0)?,
            reference: r.get(1)?,
            translation_id: r.get(2)?,
            passage: PassageRef {
                book_id: r.get(3)?,
                chapter: r.get(4)?,
                verse_start: r.get(5)?,
                chapter_end: r.get(6)?,
                verse_end: r.get(7)?,
            },
            is_favorite: r.get(8)?,
            use_count: r.get(9)?,
            last_used_at: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportJob {
    pub id: String,
    pub translation_id: Option<String>,
    pub translation_code: String,
    pub source_kind: String,
    pub source_format: String,
    pub source_path: Option<String>,
    pub source_provider: Option<String>,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub verses_imported: u32,
    pub error_message: Option<String>,
}

pub fn list_import_jobs(conn: &Connection, limit: u32) -> Result<Vec<ImportJob>> {
    let mut stmt = conn.prepare(
        "SELECT id, translation_id, translation_code, source_kind, source_format, source_path, source_provider,
                status, started_at, finished_at, verses_imported, error_message
         FROM bible_import_jobs ORDER BY started_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit.min(200)], |r| {
        Ok(ImportJob {
            id: r.get(0)?,
            translation_id: r.get(1)?,
            translation_code: r.get(2)?,
            source_kind: r.get(3)?,
            source_format: r.get(4)?,
            source_path: r.get(5)?,
            source_provider: r.get(6)?,
            status: r.get(7)?,
            started_at: r.get(8)?,
            finished_at: r.get(9)?,
            verses_imported: r.get(10)?,
            error_message: r.get(11)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}
