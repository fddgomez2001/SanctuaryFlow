//! USFM (Unified Standard Format Markers), typically one file per book.
//!
//! Verse text is everything after `\v N` until the next verse, chapter or
//! book. Paragraph markers become word breaks. Headings, introductions,
//! titles and metadata lines are excluded, as are footnotes (`\f … \f*`),
//! cross references (`\x … \x*`), figures and alternate/published verse
//! numbers. Word-level attributes (`\w word|strong="H1"\w*`) keep only the
//! word. `\nd` (divine name) is rendered in capitals.

use super::collector::parse_verse_number;
use super::{Collector, ParsedBible, Severity, SourceText};
use crate::error::Result;

#[derive(Debug, PartialEq)]
enum Tok<'a> {
    Marker { name: &'a str, closing: bool },
    Text(&'a str),
    Newline,
}

fn tokenize(s: &str) -> Vec<Tok<'_>> {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    let mut text_start = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => {
                if text_start < i {
                    out.push(Tok::Text(&s[text_start..i]));
                }
                i += 1;
                if i < bytes.len() && bytes[i] == b'+' {
                    i += 1;
                }
                let start = i;
                while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'-') {
                    i += 1;
                }
                let name = &s[start..i];
                let closing = i < bytes.len() && bytes[i] == b'*';
                if closing {
                    i += 1;
                } else if i < bytes.len() && bytes[i] == b' ' {
                    i += 1; // the single space that separates a marker from its content
                }
                out.push(Tok::Marker { name, closing });
                text_start = i;
            }
            b'\n' => {
                if text_start < i {
                    out.push(Tok::Text(&s[text_start..i]));
                }
                out.push(Tok::Newline);
                i += 1;
                text_start = i;
            }
            _ => i += 1,
        }
    }
    if text_start < bytes.len() {
        out.push(Tok::Text(&s[text_start..]));
    }
    out
}

/// Paragraph-level styles whose content is not verse text.
pub(crate) fn is_heading_style(style: &str) -> bool {
    let base = style.trim_end_matches(|c: char| c.is_ascii_digit());
    matches!(
        base,
        "mt" | "mte" | "ms" | "mr" | "s" | "sr" | "r" | "d" | "sp" | "sd" | "cl" | "cd" | "rem" | "sts" | "ide"
            | "usfm" | "toc" | "toca" | "h" | "imt" | "imte" | "is" | "ip" | "ipi" | "im" | "imi" | "ipq" | "imq"
            | "ipr" | "iq" | "ib" | "ili" | "iot" | "io" | "iex" | "ie" | "periph" | "cp" | "qa" | "lit" | "restore"
            | "id" | "rq"
    )
}

/// Character / note styles whose content is not verse text.
pub(crate) fn is_skipped_char_style(style: &str) -> bool {
    matches!(style, "f" | "fe" | "x" | "ef" | "ex" | "fig" | "va" | "vp" | "ca" | "rq" | "cat" | "jmp")
}

fn is_book_name_marker(name: &str) -> bool {
    matches!(name, "h" | "toc1" | "toc2" | "toc3")
}

enum Mode<'a> {
    Normal,
    SkipLine,
    SkipUntil(&'a str),
    SkipMilestone,
    ReadId,
    ReadName(&'a str, String),
    ChapterNumber,
    VerseNumber,
}

#[derive(Default)]
struct Names {
    h: Option<String>,
    toc1: Option<String>,
    toc2: Option<String>,
    toc3: Option<String>,
}

impl Names {
    fn apply(&mut self, c: &mut Collector) {
        let name = self.toc2.take().or(self.h.take()).or(self.toc1.take());
        c.set_book_names(name, self.toc3.take());
        *self = Names::default();
    }
}

pub fn parse(sources: &[SourceText]) -> Result<ParsedBible> {
    let mut c = Collector::new();
    let mut files_without_id = Vec::new();
    for s in sources {
        if !parse_one(&mut c, &s.text) {
            files_without_id.push(s.name.clone());
        }
    }
    if !files_without_id.is_empty() {
        c.issue(
            Severity::Warning,
            "missing_id",
            format!("These files have no \\id marker and were skipped: {}", files_without_id.join(", ")),
            None,
        );
    }
    Ok(c.finish())
}

/// Returns false when the file has no `\id` marker.
fn parse_one(c: &mut Collector, text: &str) -> bool {
    let tokens = tokenize(text);
    let mut mode = Mode::Normal;
    let mut upper = 0usize;
    let mut in_char = 0usize;
    let mut names = Names::default();
    let mut has_id = false;

    for tok in tokens {
        match tok {
            Tok::Newline => {
                match std::mem::replace(&mut mode, Mode::Normal) {
                    Mode::ReadName(kind, value) => {
                        let v = Some(value.trim().to_string()).filter(|v| !v.is_empty());
                        match kind {
                            "h" => names.h = v,
                            "toc1" => names.toc1 = v,
                            "toc2" => names.toc2 = v,
                            _ => names.toc3 = v,
                        }
                    }
                    m @ (Mode::SkipUntil(_) | Mode::SkipMilestone) => mode = m,
                    _ => c.push_break(),
                }
            }
            Tok::Marker { name, closing } => {
                if let Mode::SkipUntil(target) = mode {
                    if closing && name == target {
                        mode = Mode::Normal;
                    }
                    continue;
                }
                if let Mode::SkipMilestone = mode {
                    if closing && name.is_empty() {
                        mode = Mode::Normal;
                    }
                    continue;
                }
                if closing {
                    if name == "nd" {
                        upper = upper.saturating_sub(1);
                    }
                    in_char = in_char.saturating_sub(1);
                    continue;
                }
                // A new marker ends any line-scoped mode.
                if let Mode::ReadName(kind, value) = std::mem::replace(&mut mode, Mode::Normal) {
                    let v = Some(value.trim().to_string()).filter(|v| !v.is_empty());
                    match kind {
                        "h" => names.h = v,
                        "toc1" => names.toc1 = v,
                        "toc2" => names.toc2 = v,
                        _ => names.toc3 = v,
                    }
                }
                match name {
                    "id" => {
                        names.apply(c);
                        has_id = true;
                        mode = Mode::ReadId;
                    }
                    "c" => {
                        names.apply(c);
                        (upper, in_char) = (0, 0);
                        mode = Mode::ChapterNumber;
                    }
                    "v" => {
                        (upper, in_char) = (0, 0);
                        mode = Mode::VerseNumber;
                    }
                    n if is_book_name_marker(n) => mode = Mode::ReadName(n, String::new()),
                    n if is_skipped_char_style(n) => {
                        if matches!(n, "f" | "fe" | "x" | "ef" | "ex") {
                            c.note_footnote();
                        }
                        mode = Mode::SkipUntil(n);
                    }
                    n if n.ends_with("-s") || n.ends_with("-e") || n == "ts" => mode = Mode::SkipMilestone,
                    n if is_heading_style(n) => {
                        if matches!(n.trim_end_matches(|ch: char| ch.is_ascii_digit()), "s" | "ms" | "mr" | "d" | "sp" | "r" | "sr" | "qa") {
                            c.note_heading();
                        }
                        mode = Mode::SkipLine;
                    }
                    "nd" => {
                        upper += 1;
                        in_char += 1;
                    }
                    n if is_paragraph(n) => {
                        (upper, in_char) = (0, 0);
                        c.push_break();
                    }
                    _ => in_char += 1,
                }
            }
            Tok::Text(t) => match &mut mode {
                Mode::SkipLine | Mode::SkipUntil(_) | Mode::SkipMilestone => {}
                Mode::ReadName(_, value) => value.push_str(t),
                Mode::ReadId => {
                    let code = t.split_whitespace().next().unwrap_or("");
                    c.start_book(code);
                    mode = Mode::SkipLine;
                }
                Mode::ChapterNumber => {
                    let mut parts = t.trim_start().splitn(2, char::is_whitespace);
                    if let Some(n) = parts.next().and_then(|n| n.parse::<u32>().ok()) {
                        c.start_chapter(n);
                    }
                    mode = Mode::Normal;
                }
                Mode::VerseNumber => {
                    let trimmed = t.trim_start();
                    let mut parts = trimmed.splitn(2, char::is_whitespace);
                    let number = parts.next().unwrap_or("");
                    if let Some((v, end)) = parse_verse_number(number) {
                        c.start_verse(v, end, None);
                    }
                    mode = Mode::Normal;
                    if let Some(rest) = parts.next() {
                        push(c, rest, upper, in_char);
                    }
                }
                Mode::Normal => push(c, t, upper, in_char),
            },
        }
    }
    names.apply(c);
    c.end_verse();
    has_id
}

fn push(c: &mut Collector, text: &str, upper: usize, in_char: usize) {
    // Inside character markers, `|` starts word-level attributes.
    let text = if in_char > 0 { text.split('|').next().unwrap_or("") } else { text };
    if upper > 0 {
        c.push_text(&text.to_uppercase());
    } else {
        c.push_text(text);
    }
}

fn is_paragraph(name: &str) -> bool {
    let base = name.trim_end_matches(|c: char| c.is_ascii_digit());
    matches!(
        base,
        "p" | "m" | "po" | "pr" | "cls" | "pmo" | "pm" | "pmc" | "pmr" | "pi" | "mi" | "nb" | "pc" | "ph" | "b"
            | "q" | "qr" | "qc" | "qm" | "qd" | "li" | "lh" | "lf" | "lim" | "tr" | "tc" | "th" | "tcr" | "thr"
            | "pb"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizer_splits_markers() {
        let t = tokenize("\\v 1 In \\w the|x=\"1\"\\w* \\+nd Lord\\+nd*\n");
        assert_eq!(t[0], Tok::Marker { name: "v", closing: false });
        assert_eq!(t[1], Tok::Text("1 In "));
        assert_eq!(t[2], Tok::Marker { name: "w", closing: false });
        assert!(t.contains(&Tok::Marker { name: "nd", closing: true }));
        assert_eq!(t.last(), Some(&Tok::Newline));
    }
}
