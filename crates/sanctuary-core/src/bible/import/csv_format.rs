//! CSV Bible sources. A header row is required. Recognized columns
//! (case-insensitive):
//!
//! | column      | aliases                     | required |
//! |-------------|-----------------------------|----------|
//! | `book`      | `book_id`, `book_name`, `b` | yes — name, USFM/OSIS code or 1-66 |
//! | `chapter`   | `c`, `ch`                   | yes |
//! | `verse`     | `v`, `vs`                   | yes — may be a range such as `1-2` |
//! | `text`      | `t`, `content`, `scripture` | yes |
//! | `verse_end` |                             | no  |
//!
//! Comma, semicolon and tab delimiters are detected from the header row.

use super::collector::parse_verse_number;
use super::{Collector, ParsedBible, Severity, SourceText};
use crate::canon;
use crate::error::{Error, Result};

fn find(headers: &[String], names: &[&str]) -> Option<usize> {
    headers.iter().position(|h| names.iter().any(|n| h.eq_ignore_ascii_case(n)))
}

pub fn parse(sources: &[SourceText]) -> Result<ParsedBible> {
    let mut c = Collector::new();
    let mut numeric = false;
    for s in sources {
        let text = s.text.trim_start_matches('\u{feff}');
        let header_line = text.lines().next().unwrap_or("");
        let delimiter = b"\t;,"
            .iter()
            .copied()
            .max_by_key(|d| header_line.matches(*d as char).count())
            .unwrap_or(b',');
        let mut reader = csv::ReaderBuilder::new().delimiter(delimiter).flexible(true).from_reader(text.as_bytes());
        let headers: Vec<String> = reader.headers()?.iter().map(|h| h.trim().to_string()).collect();
        let (Some(b), Some(ch), Some(v), Some(t)) = (
            find(&headers, &["book", "book_id", "bookid", "book_name", "bookname", "b"]),
            find(&headers, &["chapter", "c", "ch"]),
            find(&headers, &["verse", "v", "vs"]),
            find(&headers, &["text", "t", "content", "scripture"]),
        ) else {
            return Err(Error::validation(format!(
                "{}: the header row must contain book, chapter, verse and text columns (found: {}).",
                s.name,
                headers.join(", ")
            )));
        };
        let end_col = find(&headers, &["verse_end", "verseend", "end_verse"]);

        let mut current_book = String::new();
        let mut current_chapter = 0u32;
        for (i, rec) in reader.records().enumerate() {
            let row = i + 2;
            let rec = rec?;
            let get = |idx: usize| rec.get(idx).unwrap_or("").trim();
            let book = get(b);
            let (Ok(chapter), Some((verse, mut end))) = (get(ch).parse::<u32>(), parse_verse_number(get(v))) else {
                c.issue(
                    Severity::Error,
                    "bad_row",
                    format!("{} row {row}: the chapter or verse is not a number.", s.name),
                    Some(format!("row {row}")),
                );
                continue;
            };
            if let Some(e) = end_col.and_then(|idx| get(idx).parse::<u32>().ok()).filter(|e| *e > verse) {
                end = Some(e);
            }
            if book != current_book {
                match book.parse::<usize>() {
                    Ok(n) if n >= 1 && n <= canon::protestant().books.len() => {
                        numeric = true;
                        c.start_book_id(&canon::protestant().books[n - 1].id, book);
                    }
                    _ => c.start_book(book),
                }
                current_book = book.to_string();
                current_chapter = 0;
            }
            if chapter != current_chapter {
                c.start_chapter(chapter);
                current_chapter = chapter;
            }
            c.start_verse(verse, end, None);
            c.push_text(get(t));
            c.end_verse();
        }
    }
    if numeric {
        c.issue(
            Severity::Info,
            "numeric_books",
            "Book numbers were interpreted in the standard 66-book Protestant order (1 = Genesis).",
            None,
        );
    }
    Ok(c.finish())
}
