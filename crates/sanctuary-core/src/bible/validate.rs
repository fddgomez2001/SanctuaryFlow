//! Completeness and integrity checks for Bible text against a canon catalog.
//!
//! A translation is only reported `complete` when every book and chapter of
//! the canon is present and no structural errors were found. Chapter-count
//! differences are reported (they usually mean a different versification)
//! rather than silently accepted.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::import::{ImportIssue, ParsedBible, ParsedVerse, Severity};
use crate::canon::CanonDefinition;
use crate::error::Result;
use crate::util::{new_id, now_iso};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ValidationStatus {
    Complete,
    Incomplete,
    Invalid,
}

impl ValidationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ValidationStatus::Complete => "complete",
            ValidationStatus::Incomplete => "incomplete",
            ValidationStatus::Invalid => "invalid",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BookCoverage {
    pub book_id: String,
    pub expected_chapters: u32,
    pub found_chapters: u32,
    pub missing_chapters: Vec<u32>,
    pub extra_chapters: Vec<u32>,
    pub verse_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ValidationReport {
    pub status: ValidationStatus,
    pub canon_id: String,
    pub books_expected: u32,
    pub books_found: u32,
    pub chapters_expected: u32,
    pub chapters_found: u32,
    pub verses_found: u32,
    pub excluded_verses: u32,
    pub missing_books: Vec<String>,
    pub duplicate_verses: u32,
    pub missing_verse_numbers: u32,
    pub empty_verses: u32,
    pub books: Vec<BookCoverage>,
    pub issues: Vec<ImportIssue>,
    pub issue_overflow: u32,
    pub created_at: String,
}

const MAX_ISSUES: usize = 400;
/// Modern translations legitimately omit a handful of verse numbers (e.g.
/// Matthew 17:21). Many more gaps than that suggests missing text.
const GAP_TOLERANCE: u32 = 50;

struct Issues {
    list: Vec<ImportIssue>,
    overflow: u32,
}

impl Issues {
    fn push(&mut self, issue: ImportIssue) {
        if self.list.len() < MAX_ISSUES {
            self.list.push(issue);
        } else {
            self.overflow += 1;
        }
    }
}

fn label(canon: &CanonDefinition, v: &ParsedVerse) -> String {
    let name = canon.book(&v.book_id).map(|b| b.name.as_str()).unwrap_or(v.book_id.as_str());
    match v.verse_end {
        Some(e) => format!("{name} {}:{}-{e}", v.chapter, v.verse),
        None => format!("{name} {}:{}", v.chapter, v.verse),
    }
}

/// The verses that will be written: in the canon and with text.
pub fn importable_verses<'a>(parsed: &'a ParsedBible, canon: &CanonDefinition) -> Vec<&'a ParsedVerse> {
    parsed.verses.iter().filter(|v| canon.book(&v.book_id).is_some() && !v.text.trim().is_empty()).collect()
}

pub fn validate(parsed: &ParsedBible, canon: &CanonDefinition) -> ValidationReport {
    let mut issues = Issues { list: Vec::new(), overflow: 0 };
    let mut has_error = false;
    for i in &parsed.issues {
        has_error |= i.severity == Severity::Error;
        issues.push(i.clone());
    }

    let mut excluded = 0u32;
    for (book, count) in &parsed.unknown_books {
        excluded += *count as u32;
        issues.push(ImportIssue::new(
            Severity::Warning,
            "book_not_in_canon",
            format!(
                "{count} verses in \"{book}\" will not be imported because the book is not part of the {} catalog.",
                canon.name
            ),
            Some(book.clone()),
        ));
    }

    // Group verses by book and chapter in canonical order.
    let mut chapters: BTreeMap<(usize, u32), Vec<&ParsedVerse>> = BTreeMap::new();
    let mut empty = 0u32;
    // Verse numbers that exist in the source without text; reported once as
    // empty rather than again as missing.
    let mut empty_keys: BTreeSet<(usize, u32, u32)> = BTreeSet::new();
    for v in &parsed.verses {
        let Some(order) = canon.book_order(&v.book_id) else {
            excluded += 1;
            continue;
        };
        if v.text.trim().is_empty() {
            empty += 1;
            empty_keys.insert((order, v.chapter, v.verse));
            excluded += 1;
            issues.push(ImportIssue::new(
                Severity::Warning,
                "empty_verse",
                format!("{} has no text in the source and will not be stored.", label(canon, v)),
                Some(label(canon, v)),
            ));
            continue;
        }
        chapters.entry((order, v.chapter)).or_default().push(v);
    }

    let mut duplicates = 0u32;
    let mut gaps = 0u32;
    let mut verses_found = 0u32;
    let mut per_book: BTreeMap<usize, (BTreeSet<u32>, u32)> = BTreeMap::new();
    for ((order, chapter), verses) in chapters.iter_mut() {
        verses.sort_by_key(|v| v.verse);
        let entry = per_book.entry(*order).or_default();
        entry.0.insert(*chapter);
        entry.1 += verses.len() as u32;
        verses_found += verses.len() as u32;

        let mut covered_to: u32 = 0;
        let mut first = true;
        for v in verses.iter() {
            let end = v.verse_end.unwrap_or(v.verse);
            if !first && v.verse <= covered_to {
                duplicates += 1;
                has_error = true;
                issues.push(ImportIssue::new(
                    Severity::Error,
                    "duplicate_verse",
                    format!("{} appears more than once (or overlaps a combined verse).", label(canon, v)),
                    Some(label(canon, v)),
                ));
            } else {
                let mut expected = if first { 1 } else { covered_to + 1 };
                while expected < v.verse && empty_keys.contains(&(*order, *chapter, expected)) {
                    expected += 1;
                }
                if v.verse > expected {
                    let missing = v.verse - expected;
                    gaps += missing;
                    let name = canon.book(&v.book_id).map(|b| b.name.as_str()).unwrap_or(&v.book_id);
                    let range = if missing == 1 {
                        format!("{name} {chapter}:{expected}")
                    } else {
                        format!("{name} {chapter}:{expected}-{}", v.verse - 1)
                    };
                    issues.push(ImportIssue::new(
                        Severity::Warning,
                        "missing_verse_numbers",
                        format!("{range} is not in the source. Some translations intentionally omit verses."),
                        Some(range),
                    ));
                }
            }
            covered_to = covered_to.max(end);
            first = false;
        }
    }

    let mut books = Vec::new();
    let mut missing_books = Vec::new();
    let mut chapters_found = 0u32;
    let mut chapter_mismatch = false;
    for (i, b) in canon.books.iter().enumerate() {
        let order = i + 1;
        match per_book.get(&order) {
            None => missing_books.push(b.id.clone()),
            Some((found, verse_count)) => {
                let missing: Vec<u32> = (1..=b.chapters).filter(|c| !found.contains(c)).collect();
                let extra: Vec<u32> = found.iter().copied().filter(|c| *c > b.chapters).collect();
                if !missing.is_empty() {
                    chapter_mismatch = true;
                    issues.push(ImportIssue::new(
                        Severity::Warning,
                        "missing_chapters",
                        format!(
                            "{} is missing chapter{} {} (the catalog lists {} chapters).",
                            b.name,
                            if missing.len() == 1 { "" } else { "s" },
                            compact_list(&missing),
                            b.chapters
                        ),
                        Some(b.name.clone()),
                    ));
                }
                if !extra.is_empty() {
                    chapter_mismatch = true;
                    issues.push(ImportIssue::new(
                        Severity::Warning,
                        "extra_chapters",
                        format!(
                            "{} has chapter{} {} beyond the catalog's {} chapters. This usually means a different versification.",
                            b.name,
                            if extra.len() == 1 { "" } else { "s" },
                            compact_list(&extra),
                            b.chapters
                        ),
                        Some(b.name.clone()),
                    ));
                }
                chapters_found += found.len() as u32;
                books.push(BookCoverage {
                    book_id: b.id.clone(),
                    expected_chapters: b.chapters,
                    found_chapters: found.len() as u32,
                    missing_chapters: missing,
                    extra_chapters: extra,
                    verse_count: *verse_count,
                });
            }
        }
    }
    if !missing_books.is_empty() {
        let names: Vec<&str> =
            missing_books.iter().filter_map(|id| canon.book(id).map(|b| b.name.as_str())).collect();
        issues.push(ImportIssue::new(
            Severity::Warning,
            "missing_books",
            format!("{} of {} books are not in the source: {}.", names.len(), canon.books.len(), summarize_names(&names)),
            None,
        ));
    }
    if gaps > GAP_TOLERANCE {
        issues.push(ImportIssue::new(
            Severity::Warning,
            "many_missing_verses",
            format!("{gaps} verse numbers are missing, which suggests the source is incomplete."),
            None,
        ));
    }
    if verses_found == 0 {
        has_error = true;
        issues.push(ImportIssue::new(Severity::Error, "no_verses", "No importable verses were found.", None));
    }

    let status = if has_error {
        ValidationStatus::Invalid
    } else if !missing_books.is_empty() || chapter_mismatch || gaps > GAP_TOLERANCE {
        ValidationStatus::Incomplete
    } else {
        ValidationStatus::Complete
    };

    ValidationReport {
        status,
        canon_id: canon.id.clone(),
        books_expected: canon.books.len() as u32,
        books_found: per_book.len() as u32,
        chapters_expected: canon.total_chapters(),
        chapters_found,
        verses_found,
        excluded_verses: excluded,
        missing_books,
        duplicate_verses: duplicates,
        missing_verse_numbers: gaps,
        empty_verses: empty,
        books,
        issues: issues.list,
        issue_overflow: issues.overflow,
        created_at: now_iso(),
    }
}

fn summarize_names(names: &[&str]) -> String {
    if names.len() <= 12 {
        names.join(", ")
    } else {
        format!("{} and {} more", names[..10].join(", "), names.len() - 10)
    }
}

/// Formats [1,2,3,5,7,8] as "1-3, 5, 7-8".
fn compact_list(nums: &[u32]) -> String {
    let mut parts = Vec::new();
    let mut i = 0;
    while i < nums.len() {
        let start = nums[i];
        let mut end = start;
        while i + 1 < nums.len() && nums[i + 1] == end + 1 {
            end = nums[i + 1];
            i += 1;
        }
        parts.push(if start == end { start.to_string() } else { format!("{start}-{end}") });
        i += 1;
    }
    parts.join(", ")
}

pub fn store_report(conn: &Connection, translation_id: &str, job_id: Option<&str>, report: &ValidationReport) -> Result<()> {
    conn.execute(
        "INSERT INTO bible_validation_reports (id, translation_id, import_job_id, created_at, status, summary, issues)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            new_id(),
            translation_id,
            job_id,
            report.created_at,
            report.status.as_str(),
            serde_json::to_string(report)?,
            serde_json::to_string(&report.issues)?
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact() {
        assert_eq!(compact_list(&[1, 2, 3, 5, 7, 8]), "1-3, 5, 7-8");
        assert_eq!(compact_list(&[4]), "4");
    }
}
