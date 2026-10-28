//! JSON Bible sources. Supported layouts:
//!
//! 1. SanctuaryFlow format: `{ "format": "sanctuaryflow-bible", "translation": {...},
//!    "books": [{ "id": "GEN", "name": "Genesis", "chapters": [{ "chapter": 1,
//!    "verses": [{ "verse": 1, "text": "..." }] }] }] }`
//! 2. Flat verse lists: `[{ "book": "Genesis", "chapter": 1, "verse": 1, "text": "..." }]`
//!    or `{ "metadata": {...}, "verses": [...] }`.
//! 3. Nested chapter arrays: `[{ "name": "Genesis", "chapters": [["v1", "v2"], ...] }]`
//!    and book-keyed objects `{ "Genesis": { "1": { "1": "..." } } }`.

use serde_json::{Map, Value};

use super::collector::parse_verse_number;
use super::{Collector, ParsedBible, Severity, SourceText};
use crate::canon::{self, BookResolver};
use crate::error::{Error, Result};

pub fn parse(sources: &[SourceText]) -> Result<ParsedBible> {
    let mut c = Collector::new();
    for s in sources {
        let v: Value = serde_json::from_str(s.text.trim_start_matches('\u{feff}'))
            .map_err(|e| Error::validation(format!("{} is not valid JSON: {e}", s.name)))?;
        parse_value(&mut c, &v, &s.name)?;
    }
    Ok(c.finish())
}

fn get_ci<'a>(obj: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    for k in keys {
        if let Some(v) = obj.get(*k) {
            return Some(v);
        }
    }
    obj.iter().find(|(k, _)| keys.iter().any(|w| k.eq_ignore_ascii_case(w))).map(|(_, v)| v)
}

fn as_u32(v: &Value) -> Option<u32> {
    match v {
        Value::Number(n) => n.as_u64().and_then(|n| u32::try_from(n).ok()),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn as_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn read_metadata(c: &mut Collector, meta: &Value) {
    let Some(obj) = meta.as_object() else { return };
    let s = |keys: &[&str]| get_ci(obj, keys).and_then(as_text).map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    let m = c.metadata();
    m.code = s(&["code", "shortname", "abbreviation", "id"]).or(m.code.take());
    m.name = s(&["name", "title"]).or(m.name.take());
    m.language = s(&["language", "lang"]).or(m.language.take());
    m.publisher = s(&["publisher"]).or(m.publisher.take());
    m.copyright_notice = s(&["copyright", "copyrightNotice", "copyright_notice"]).or(m.copyright_notice.take());
    m.license_name = s(&["license", "licenseName", "license_name"]).or(m.license_name.take());
    m.license_url = s(&["licenseUrl", "license_url"]).or(m.license_url.take());
    m.source_url = s(&["sourceUrl", "source_url", "url"]).or(m.source_url.take());
    m.versification = s(&["versification"]).or(m.versification.take());
}

/// Resolves a book from a name/code, or from a 1-based number in the
/// Protestant order when only a number is given.
fn start_book(c: &mut Collector, label: &Value, position_fallback: Option<usize>, numeric_used: &mut bool) {
    match label {
        Value::Number(_) => {
            let n = as_u32(label).unwrap_or(0) as usize;
            let canon = canon::protestant();
            if n >= 1 && n <= canon.books.len() {
                *numeric_used = true;
                let b = &canon.books[n - 1];
                c.start_book_id(&b.id, &n.to_string());
            } else {
                c.start_book(&format!("Book {n}"));
            }
        }
        _ => {
            let text = as_text(label).unwrap_or_default();
            if BookResolver::standard().resolve(&text).is_none() {
                if let Some(pos) = position_fallback {
                    let canon = canon::protestant();
                    if let Some(b) = canon.books.get(pos) {
                        c.start_book_id(&b.id, &text);
                        return;
                    }
                }
            }
            c.start_book(&text);
        }
    }
}

fn parse_value(c: &mut Collector, v: &Value, name: &str) -> Result<()> {
    let mut numeric = false;
    match v {
        Value::Object(obj) => {
            if let Some(meta) = get_ci(obj, &["translation", "metadata", "info"]) {
                read_metadata(c, meta);
            }
            if let Some(Value::Array(books)) = get_ci(obj, &["books"]) {
                parse_books(c, books, &mut numeric)?;
            } else if let Some(Value::Array(verses)) = get_ci(obj, &["verses"]) {
                parse_flat(c, verses, &mut numeric)?;
            } else if obj.keys().any(|k| BookResolver::standard().resolve(k).is_some()) {
                parse_keyed(c, obj)?;
            } else {
                return Err(unsupported(name));
            }
        }
        Value::Array(items) => {
            let first = items.iter().find_map(Value::as_object);
            match first {
                Some(f) if get_ci(f, &["chapters"]).is_some() => parse_books(c, items, &mut numeric)?,
                Some(f) if get_ci(f, &["chapter", "c", "ch"]).is_some() => parse_flat(c, items, &mut numeric)?,
                _ => return Err(unsupported(name)),
            }
        }
        _ => return Err(unsupported(name)),
    }
    if numeric {
        c.issue(
            Severity::Info,
            "numeric_books",
            "Book numbers were interpreted in the standard 66-book Protestant order (1 = Genesis).",
            None,
        );
    }
    Ok(())
}

fn unsupported(name: &str) -> Error {
    Error::validation(format!(
        "{name}: the JSON layout was not recognized. Use the SanctuaryFlow Bible JSON format described in the documentation."
    ))
}

fn parse_books(c: &mut Collector, books: &[Value], numeric: &mut bool) -> Result<()> {
    let positional = books.len() == canon::protestant().books.len();
    for (i, b) in books.iter().enumerate() {
        let Some(obj) = b.as_object() else { continue };
        let display = get_ci(obj, &["name", "bookName", "book_name"]).and_then(as_text);
        let label = get_ci(obj, &["id", "code", "osis", "book"])
            .cloned()
            .or_else(|| display.clone().map(Value::String))
            .or_else(|| get_ci(obj, &["abbrev", "abbreviation"]).cloned())
            .unwrap_or(Value::Null);
        // Prefer a resolvable display name over an unrecognized abbreviation.
        let label = match (&label, &display) {
            (Value::String(l), Some(d))
                if BookResolver::standard().resolve(l).is_none() && BookResolver::standard().resolve(d).is_some() =>
            {
                Value::String(d.clone())
            }
            _ => label,
        };
        start_book(c, &label, positional.then_some(i), numeric);
        c.set_book_names(display, get_ci(obj, &["abbrev", "abbreviation"]).and_then(as_text));
        let Some(Value::Array(chapters)) = get_ci(obj, &["chapters"]) else { continue };
        for (ci, ch) in chapters.iter().enumerate() {
            match ch {
                Value::Array(verses) => {
                    c.start_chapter(ci as u32 + 1);
                    for (vi, text) in verses.iter().enumerate() {
                        c.start_verse(vi as u32 + 1, None, None);
                        c.push_text(&as_text(text).unwrap_or_default());
                        c.end_verse();
                    }
                }
                Value::Object(cobj) => {
                    let number = get_ci(cobj, &["chapter", "number", "c"]).and_then(as_u32).unwrap_or(ci as u32 + 1);
                    c.start_chapter(number);
                    if let Some(Value::Array(verses)) = get_ci(cobj, &["verses"]) {
                        for (vi, verse) in verses.iter().enumerate() {
                            match verse {
                                Value::Object(vobj) => {
                                    let (n, end) = verse_number(vobj).unwrap_or((vi as u32 + 1, None));
                                    c.start_verse(n, end, None);
                                    c.push_text(&get_ci(vobj, &["text", "t", "content"]).and_then(as_text).unwrap_or_default());
                                    c.end_verse();
                                }
                                other => {
                                    c.start_verse(vi as u32 + 1, None, None);
                                    c.push_text(&as_text(other).unwrap_or_default());
                                    c.end_verse();
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}

fn verse_number(obj: &Map<String, Value>) -> Option<(u32, Option<u32>)> {
    let v = get_ci(obj, &["verse", "v", "vs", "number"])?;
    let (start, end) = match v {
        Value::String(s) => parse_verse_number(s)?,
        other => (as_u32(other)?, None),
    };
    let end = end.or_else(|| get_ci(obj, &["verseEnd", "verse_end"]).and_then(as_u32).filter(|e| *e > start));
    Some((start, end))
}

fn parse_flat(c: &mut Collector, verses: &[Value], numeric: &mut bool) -> Result<()> {
    let mut current_book: Option<Value> = None;
    let mut current_chapter = 0u32;
    for (row, v) in verses.iter().enumerate() {
        let Some(obj) = v.as_object() else {
            c.issue(Severity::Error, "bad_row", format!("Entry {} is not an object.", row + 1), None);
            continue;
        };
        let book = get_ci(obj, &["book_name", "bookName", "book", "book_id", "bookId", "b"]).cloned();
        let chapter = get_ci(obj, &["chapter", "c", "ch"]).and_then(as_u32);
        let verse = verse_number(obj);
        let (Some(book), Some(chapter), Some((verse, end))) = (book, chapter, verse) else {
            c.issue(Severity::Error, "bad_row", format!("Entry {} is missing its book, chapter or verse.", row + 1), None);
            continue;
        };
        if current_book.as_ref() != Some(&book) {
            start_book(c, &book, None, numeric);
            current_book = Some(book);
            current_chapter = 0;
        }
        if chapter != current_chapter {
            c.start_chapter(chapter);
            current_chapter = chapter;
        }
        c.start_verse(verse, end, None);
        c.push_text(&get_ci(obj, &["text", "t", "content", "scripture"]).and_then(as_text).unwrap_or_default());
        c.end_verse();
    }
    Ok(())
}

fn parse_keyed(c: &mut Collector, obj: &Map<String, Value>) -> Result<()> {
    for (book, chapters) in obj {
        let Some(chapters) = chapters.as_object() else { continue };
        c.start_book(book);
        let mut ch_list: Vec<(u32, &Value)> = chapters.iter().filter_map(|(k, v)| k.trim().parse().ok().map(|n| (n, v))).collect();
        ch_list.sort_by_key(|(n, _)| *n);
        for (n, verses) in ch_list {
            c.start_chapter(n);
            let Some(verses) = verses.as_object() else { continue };
            let mut v_list: Vec<((u32, Option<u32>), &Value)> =
                verses.iter().filter_map(|(k, v)| parse_verse_number(k).map(|n| (n, v))).collect();
            v_list.sort_by_key(|((n, _), _)| *n);
            for ((vn, end), text) in v_list {
                c.start_verse(vn, end, None);
                c.push_text(&as_text(text).unwrap_or_default());
                c.end_verse();
            }
        }
    }
    Ok(())
}
