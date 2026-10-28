//! OSIS XML. Handles both container verses (`<verse osisID="Gen.1.1">…</verse>`)
//! and milestone verses (`<verse sID="Gen.1.1" …/> … <verse eID="Gen.1.1"/>`),
//! chapter containers and milestones, and combined verses (`osisID="Gen.1.1 Gen.1.2"`).
//! Notes, headings and alternate readings are excluded from verse text;
//! `<divineName>` is rendered in capitals (LORD).

use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::{Collector, ParsedBible, Severity, SourceText};
use crate::error::{Error, Result};

pub(crate) fn attr(e: &BytesStart, name: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == name)
        .and_then(|a| a.normalized_value(quick_xml::XmlVersion::Implicit1_0).ok().map(|v| v.into_owned()))
}

pub(crate) fn general_ref_text(r: &quick_xml::events::BytesRef) -> String {
    if let Ok(Some(ch)) = r.resolve_char_ref() {
        return ch.to_string();
    }
    let name = r.xml10_content();
    quick_xml::escape::resolve_predefined_entity(&name).map(str::to_string).unwrap_or_else(|| format!("&{name};"))
}

/// Parses "Gen.1.1" (optionally with "!a" sub-identifiers) into (book, chapter, verse).
fn parse_osis_ref(r: &str) -> Option<(String, u32, Option<u32>)> {
    let r = r.split('!').next()?.trim();
    let r = r.rsplit(':').next()?; // strip work prefix such as "KJV:Gen.1.1"
    let mut parts = r.split('.');
    let book = parts.next()?.to_string();
    let chapter = parts.next()?.parse().ok()?;
    let verse = parts.next().and_then(|v| v.parse().ok());
    Some((book, chapter, verse))
}

#[derive(Default)]
struct Header {
    in_header: bool,
    in_work: bool,
    work_done: bool,
    field: Option<String>,
    text: String,
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
    let mut header = Header::default();
    let mut depth = 0usize;
    let mut skip_depth = 0usize;
    let mut container_verse_depth: Option<usize> = None;
    let mut upper = 0usize;
    let mut saw_osis = false;

    loop {
        let event = reader.read_event().map_err(|e| {
            Error::validation(format!("{}: invalid XML near byte {}: {e}", s.name, reader.buffer_position()))
        })?;
        match event {
            Event::Start(e) => {
                depth += 1;
                if skip_depth > 0 {
                    skip_depth += 1;
                    continue;
                }
                let name = e.local_name().as_ref().to_string();
                match name.as_str() {
                    "osis" => saw_osis = true,
                    "osisText" => {
                        if let Some(work) = attr(&e, "osisIDWork") {
                            c.metadata().code.get_or_insert(work);
                        }
                        if let Some(lang) = attr(&e, "xml:lang") {
                            c.metadata().language.get_or_insert(lang);
                        }
                    }
                    "header" => header.in_header = true,
                    "work" if header.in_header && !header.work_done => header.in_work = true,
                    "title" | "language" | "rights" | "publisher" | "description" | "identifier" | "refSystem"
                        if header.in_work =>
                    {
                        header.field = Some(name.clone());
                        header.text.clear();
                    }
                    "div" => handle_div(c, &e),
                    "chapter" => handle_chapter(c, &e),
                    "verse" => {
                        if handle_verse(c, &e) {
                            container_verse_depth = Some(depth);
                        }
                    }
                    "note" | "rdg" | "figure" => {
                        skip_depth = 1;
                        c.note_footnote();
                    }
                    "title" => {
                        skip_depth = 1;
                        c.note_heading();
                    }
                    "divineName" => upper += 1,
                    "l" | "lg" | "p" | "lb" | "item" | "list" | "q" => c.push_break(),
                    _ => {}
                }
            }
            Event::Empty(e) => {
                if skip_depth > 0 {
                    continue;
                }
                match e.local_name().as_ref() {
                    "div" => handle_div(c, &e),
                    "chapter" => handle_chapter(c, &e),
                    "verse" => {
                        handle_verse(c, &e);
                    }
                    "lb" | "l" | "milestone" | "p" | "lg" => c.push_break(),
                    _ => {}
                }
            }
            Event::End(e) => {
                if skip_depth > 0 {
                    skip_depth -= 1;
                    depth = depth.saturating_sub(1);
                    continue;
                }
                let name = e.local_name().as_ref().to_string();
                match name.as_str() {
                    "verse" if container_verse_depth == Some(depth) => {
                        c.end_verse();
                        container_verse_depth = None;
                    }
                    "header" => header.in_header = false,
                    "work" if header.in_work => {
                        header.in_work = false;
                        header.work_done = true;
                    }
                    "divineName" => upper = upper.saturating_sub(1),
                    "l" | "lg" | "p" | "item" | "q" => c.push_break(),
                    other if header.field.as_deref() == Some(other) => {
                        let value = super::collector::collapse_whitespace(&header.text);
                        if !value.is_empty() {
                            let m = c.metadata();
                            match other {
                                "title" => {
                                    m.name.get_or_insert(value);
                                }
                                "language" => {
                                    m.language.get_or_insert(value);
                                }
                                "rights" => {
                                    m.copyright_notice.get_or_insert(value);
                                }
                                "publisher" => {
                                    m.publisher.get_or_insert(value);
                                }
                                "refSystem" => {
                                    m.versification.get_or_insert(value);
                                }
                                _ => {}
                            }
                        }
                        header.field = None;
                    }
                    _ => {}
                }
                depth = depth.saturating_sub(1);
            }
            Event::Text(t) => {
                if skip_depth > 0 {
                    continue;
                }
                let text = t.xml10_content();
                if header.field.is_some() {
                    header.text.push_str(&text);
                } else if upper > 0 {
                    c.push_text(&text.to_uppercase());
                } else {
                    c.push_text(&text);
                }
            }
            Event::CData(t) => {
                if skip_depth == 0 {
                    c.push_text(&t.xml10_content());
                }
            }
            Event::GeneralRef(r) => {
                if skip_depth > 0 {
                    continue;
                }
                let text = general_ref_text(&r);
                if header.field.is_some() {
                    header.text.push_str(&text);
                } else {
                    c.push_text(&text);
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    c.end_verse();
    if !saw_osis {
        c.issue(Severity::Warning, "no_osis_root", format!("{} has no <osis> root element.", s.name), None);
    }
    Ok(())
}

fn handle_div(c: &mut Collector, e: &BytesStart) {
    if attr(e, "type").as_deref() == Some("book") {
        if let Some(id) = attr(e, "osisID").or_else(|| attr(e, "sID")) {
            c.start_book(id.split_whitespace().next().unwrap_or(""));
        }
    }
}

fn handle_chapter(c: &mut Collector, e: &BytesStart) {
    if attr(e, "eID").is_some() {
        return;
    }
    let Some(id) = attr(e, "osisID").or_else(|| attr(e, "sID")) else { return };
    if let Some((book, chapter, _)) = parse_osis_ref(id.split_whitespace().next().unwrap_or("")) {
        ensure_book(c, &book);
        c.start_chapter(chapter);
    }
}

/// Returns true when this is a container verse (its text is the element body).
fn handle_verse(c: &mut Collector, e: &BytesStart) -> bool {
    if attr(e, "eID").is_some() {
        c.end_verse();
        return false;
    }
    let Some(ids) = attr(e, "osisID").or_else(|| attr(e, "sID")) else { return false };
    let refs: Vec<(String, u32, Option<u32>)> = ids.split_whitespace().filter_map(parse_osis_ref).collect();
    let Some((book, chapter, Some(first))) = refs.first().cloned() else { return false };
    let last = refs.iter().filter(|(b, ch, _)| *b == book && *ch == chapter).filter_map(|(_, _, v)| *v).max();
    ensure_book(c, &book);
    if c.current_chapter() != chapter {
        c.start_chapter(chapter);
    }
    let end = last.filter(|l| *l > first);
    c.start_verse(first, end, Some(ids.clone()));
    attr(e, "sID").is_none()
}

fn ensure_book(c: &mut Collector, book: &str) {
    if c.current_book_label() != book {
        c.start_book(book);
    }
}
