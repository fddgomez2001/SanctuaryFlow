//! USX (Unified Scripture XML) 2 and 3. Verses are milestones
//! (`<verse number="1" sid="GEN 1:1"/>`); USX 3 also closes them with `eid`.
//! Headings, introductions, notes and figures are excluded from verse text.

use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::collector::parse_verse_number;
use super::osis::{attr, general_ref_text};
use super::usfm::{is_heading_style, is_skipped_char_style};
use super::{Collector, ParsedBible, SourceText};
use crate::error::{Error, Result};

#[derive(Default)]
struct BookNames {
    h: Option<String>,
    toc1: Option<String>,
    toc2: Option<String>,
    toc3: Option<String>,
}

impl BookNames {
    fn apply(&mut self, c: &mut Collector) {
        let name = self.toc2.take().or(self.h.take()).or(self.toc1.take());
        c.set_book_names(name, self.toc3.take());
        *self = BookNames::default();
    }
}

pub fn parse(sources: &[SourceText]) -> Result<ParsedBible> {
    let mut c = Collector::new();
    for s in sources {
        parse_one(&mut c, s)?;
    }
    Ok(c.finish())
}

fn parse_one(c: &mut Collector, s: &SourceText) -> Result<()> {
    let mut reader = Reader::from_str(&s.text);
    reader.config_mut().trim_text(false);
    let mut skip_depth = 0usize;
    let mut upper = 0usize;
    let mut capture: Option<(String, String)> = None; // (style, text) for book-name paragraphs
    let mut names = BookNames::default();

    loop {
        let event = reader
            .read_event()
            .map_err(|e| Error::validation(format!("{}: invalid XML near byte {}: {e}", s.name, reader.buffer_position())))?;
        match event {
            Event::Start(e) => {
                if skip_depth > 0 {
                    skip_depth += 1;
                    continue;
                }
                match e.local_name().as_ref() {
                    "book" => {
                        names.apply(c);
                        if let Some(code) = attr(&e, "code") {
                            c.start_book(&code);
                        }
                        skip_depth = 1;
                    }
                    "para" => {
                        let style = attr(&e, "style").unwrap_or_default();
                        if matches!(style.as_str(), "h" | "toc1" | "toc2" | "toc3") {
                            capture = Some((style, String::new()));
                        } else if is_heading_style(&style) {
                            skip_depth = 1;
                            c.note_heading();
                        } else {
                            c.push_break();
                        }
                    }
                    "note" | "figure" | "sidebar" => {
                        skip_depth = 1;
                        c.note_footnote();
                    }
                    "char" => {
                        let style = attr(&e, "style").unwrap_or_default();
                        if is_skipped_char_style(&style) {
                            skip_depth = 1;
                        } else if style == "nd" {
                            upper += 1;
                        }
                    }
                    "chapter" => handle_chapter(c, &e, &mut names),
                    "verse" => handle_verse(c, &e),
                    "row" | "cell" | "table" => c.push_break(),
                    _ => {}
                }
            }
            Event::Empty(e) => {
                if skip_depth > 0 {
                    continue;
                }
                match e.local_name().as_ref() {
                    "chapter" => handle_chapter(c, &e, &mut names),
                    "verse" => handle_verse(c, &e),
                    "optbreak" | "ms" | "para" => c.push_break(),
                    _ => {}
                }
            }
            Event::End(e) => {
                if skip_depth > 0 {
                    skip_depth -= 1;
                    continue;
                }
                match e.local_name().as_ref() {
                    "para" => {
                        if let Some((style, text)) = capture.take() {
                            let text = Some(text.trim().to_string()).filter(|t| !t.is_empty());
                            match style.as_str() {
                                "h" => names.h = text,
                                "toc1" => names.toc1 = text,
                                "toc2" => names.toc2 = text,
                                _ => names.toc3 = text,
                            }
                        } else {
                            c.push_break();
                        }
                    }
                    "char" if upper > 0 => upper -= 1,
                    _ => {}
                }
            }
            Event::Text(t) => {
                if skip_depth > 0 {
                    continue;
                }
                let text = t.xml10_content();
                if let Some((_, buf)) = capture.as_mut() {
                    buf.push_str(&text);
                } else if upper > 0 {
                    c.push_text(&text.to_uppercase());
                } else {
                    c.push_text(&text);
                }
            }
            Event::GeneralRef(r) => {
                if skip_depth > 0 {
                    continue;
                }
                let text = general_ref_text(&r);
                if let Some((_, buf)) = capture.as_mut() {
                    buf.push_str(&text);
                } else {
                    c.push_text(&text);
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    names.apply(c);
    c.end_verse();
    Ok(())
}

fn handle_chapter(c: &mut Collector, e: &BytesStart, names: &mut BookNames) {
    if attr(e, "eid").is_some() {
        c.end_verse();
        return;
    }
    names.apply(c);
    if let Some(n) = attr(e, "number").and_then(|n| n.trim().parse().ok()) {
        c.start_chapter(n);
    }
}

fn handle_verse(c: &mut Collector, e: &BytesStart) {
    if attr(e, "eid").is_some() {
        c.end_verse();
        return;
    }
    if let Some((v, end)) = attr(e, "number").as_deref().and_then(parse_verse_number) {
        c.start_verse(v, end, attr(e, "sid"));
    }
}
