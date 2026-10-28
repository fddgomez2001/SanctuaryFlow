use super::{ImportIssue, ParsedBible, ParsedBook, ParsedVerse, Severity};
use crate::canon::BookResolver;

/// Accumulates verse text while a format adapter walks its source. It owns the
/// current book / chapter / verse position, merges verse segments that a
/// source splits into parts (e.g. 5a/5b), and keeps counts of content that is
/// intentionally not treated as verse text (headings, notes).
pub struct Collector {
    resolver: &'static BookResolver,
    out: ParsedBible,
    book: Option<String>,
    book_label: String,
    chapter: u32,
    verse: Option<(u32, Option<u32>, Option<String>)>,
    text: String,
    merged_segments: u32,
    skipped_headings: u32,
    skipped_notes: u32,
    verses_without_chapter: u32,
}

impl Default for Collector {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn collapse_whitespace(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for ch in s.chars() {
        if matches!(ch, ' ' | '\t' | '\n' | '\r') {
            space = true;
        } else {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.push(ch);
        }
    }
    out
}

/// Parses "1", "1-2", "1a" or "1b" into (verse, verse_end).
pub(crate) fn parse_verse_number(s: &str) -> Option<(u32, Option<u32>)> {
    let s = s.trim();
    let digits = |p: &str| -> Option<u32> {
        let d: String = p.chars().take_while(|c| c.is_ascii_digit()).collect();
        if d.is_empty() { None } else { d.parse().ok() }
    };
    if let Some((a, b)) = s.split_once(['-', '–', ',']) {
        let start = digits(a)?;
        let end = digits(b)?;
        return Some((start, if end > start { Some(end) } else { None }));
    }
    digits(s).map(|v| (v, None))
}

impl Collector {
    pub fn new() -> Self {
        Self {
            resolver: BookResolver::standard(),
            out: ParsedBible::default(),
            book: None,
            book_label: String::new(),
            chapter: 0,
            verse: None,
            text: String::new(),
            merged_segments: 0,
            skipped_headings: 0,
            skipped_notes: 0,
            verses_without_chapter: 0,
        }
    }

    pub fn metadata(&mut self) -> &mut super::DetectedMetadata {
        &mut self.out.metadata
    }

    pub fn issue(&mut self, severity: Severity, code: &str, message: impl Into<String>, location: Option<String>) {
        self.out.issues.push(ImportIssue::new(severity, code, message, location));
    }

    pub fn current_book_label(&self) -> &str {
        &self.book_label
    }

    pub fn current_book(&self) -> Option<&str> {
        self.book.as_deref()
    }

    pub fn current_chapter(&self) -> u32 {
        self.chapter
    }

    /// Starts a book identified by a code or name. Unknown books are tracked
    /// so their verses can be reported instead of silently dropped.
    pub fn start_book(&mut self, label: &str) {
        self.flush();
        let label = label.trim();
        self.book_label = label.to_string();
        self.chapter = 0;
        self.book = self.resolver.resolve(label).map(str::to_string);
        if let Some(id) = &self.book {
            if !self.out.books.iter().any(|b| &b.book_id == id) {
                self.out.books.push(ParsedBook { book_id: id.clone(), name: None, abbreviation: None });
            }
        }
    }

    /// Starts a book whose identity is already resolved (e.g. by position).
    pub fn start_book_id(&mut self, id: &str, label: &str) {
        self.flush();
        self.book_label = label.to_string();
        self.chapter = 0;
        self.book = Some(id.to_string());
        if !self.out.books.iter().any(|b| b.book_id == id) {
            self.out.books.push(ParsedBook { book_id: id.to_string(), name: None, abbreviation: None });
        }
    }

    /// Records the translation's own name / abbreviation for the current book.
    pub fn set_book_names(&mut self, name: Option<String>, abbreviation: Option<String>) {
        let Some(id) = self.book.clone() else { return };
        if let Some(b) = self.out.books.iter_mut().find(|b| b.book_id == id) {
            if let Some(n) = name.map(|n| collapse_whitespace(&n)).filter(|n| !n.is_empty()) {
                b.name = Some(n);
            }
            if let Some(a) = abbreviation.map(|a| collapse_whitespace(&a)).filter(|a| !a.is_empty()) {
                b.abbreviation = Some(a);
            }
        }
    }

    pub fn book_has_name(&self) -> bool {
        self.book.as_ref().and_then(|id| self.out.books.iter().find(|b| &b.book_id == id)).and_then(|b| b.name.as_ref()).is_some()
    }

    pub fn start_chapter(&mut self, chapter: u32) {
        self.flush();
        self.chapter = chapter;
    }

    pub fn start_verse(&mut self, verse: u32, verse_end: Option<u32>, source_ref: Option<String>) {
        if let Some((current, _, _)) = &self.verse {
            if *current == verse {
                // Another segment of the verse that is already open.
                self.merged_segments += 1;
                self.text.push(' ');
                return;
            }
        }
        self.flush();
        // A segment of the verse that was just closed (container formats).
        if let (Some(book), Some(last)) = (&self.book, self.out.verses.last()) {
            if &last.book_id == book && last.chapter == self.chapter && last.verse == verse {
                let last = self.out.verses.pop().expect("checked above");
                self.text = last.text;
                self.text.push(' ');
                self.verse = Some((verse, last.verse_end.or(verse_end), last.source_ref));
                self.merged_segments += 1;
                return;
            }
        }
        self.verse = Some((verse, verse_end, source_ref));
    }

    pub fn end_verse(&mut self) {
        self.flush();
    }

    pub fn in_verse(&self) -> bool {
        self.verse.is_some()
    }

    pub fn push_text(&mut self, s: &str) {
        if self.verse.is_some() {
            self.text.push_str(s);
        }
    }

    /// Inserts a word break (paragraph or line boundary) inside a verse.
    pub fn push_break(&mut self) {
        if self.verse.is_some() && !self.text.ends_with(' ') {
            self.text.push(' ');
        }
    }

    pub fn note_heading(&mut self) {
        self.skipped_headings += 1;
    }

    pub fn note_footnote(&mut self) {
        self.skipped_notes += 1;
    }

    fn flush(&mut self) {
        let Some((verse, verse_end, source_ref)) = self.verse.take() else {
            self.text.clear();
            return;
        };
        let text = collapse_whitespace(&self.text);
        self.text.clear();
        match &self.book {
            Some(book) if self.chapter > 0 => self.out.verses.push(ParsedVerse {
                book_id: book.clone(),
                chapter: self.chapter,
                verse,
                verse_end,
                text,
                source_ref,
            }),
            Some(_) => self.verses_without_chapter += 1,
            None => *self.out.unknown_books.entry(self.book_label.clone()).or_default() += 1,
        }
    }

    pub fn finish(mut self) -> ParsedBible {
        self.flush();
        if self.merged_segments > 0 {
            self.issue(
                Severity::Info,
                "merged_segments",
                format!("{} verse segments (such as 5a/5b) were joined into their verses.", self.merged_segments),
                None,
            );
        }
        if self.skipped_headings > 0 {
            self.issue(
                Severity::Info,
                "headings_skipped",
                format!(
                    "{} section headings, titles or introductions are not verse text and were not imported.",
                    self.skipped_headings
                ),
                None,
            );
        }
        if self.skipped_notes > 0 {
            self.issue(
                Severity::Info,
                "notes_skipped",
                format!("{} footnotes and cross references were not imported.", self.skipped_notes),
                None,
            );
        }
        if self.verses_without_chapter > 0 {
            self.issue(
                Severity::Error,
                "verse_without_chapter",
                format!("{} verses appear before any chapter marker.", self.verses_without_chapter),
                None,
            );
        }
        self.out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verse_numbers() {
        assert_eq!(parse_verse_number("3"), Some((3, None)));
        assert_eq!(parse_verse_number("3-4"), Some((3, Some(4))));
        assert_eq!(parse_verse_number("5a"), Some((5, None)));
        assert_eq!(parse_verse_number("x"), None);
        assert_eq!(parse_verse_number("4-4"), Some((4, None)));
    }

    #[test]
    fn segments_merge_and_unknown_books_are_counted() {
        let mut c = Collector::new();
        c.start_book("GEN");
        c.start_chapter(1);
        c.start_verse(1, None, None);
        c.push_text("In the  beginning\n");
        c.start_verse(1, None, None);
        c.push_text("God created");
        c.end_verse();
        c.start_verse(2, None, None);
        c.push_text("Part a");
        c.end_verse();
        c.start_verse(2, None, None);
        c.push_text("part b");
        c.start_book("Tobit");
        c.start_chapter(1);
        c.start_verse(1, None, None);
        c.push_text("x");
        let p = c.finish();
        assert_eq!(p.verses.len(), 2);
        assert_eq!(p.verses[0].text, "In the beginning God created");
        assert_eq!(p.verses[1].text, "Part a part b");
        assert_eq!(p.unknown_books.get("Tobit"), Some(&1));
        assert!(p.issues.iter().any(|i| i.code == "merged_segments"));
    }
}
