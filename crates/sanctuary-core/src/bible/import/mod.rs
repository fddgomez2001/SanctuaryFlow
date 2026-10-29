//! Bible import: format adapters turn source files into a [`ParsedBible`],
//! [`super::validate`] checks it against the canon, and [`commit`] writes it
//! inside one transaction so a failed import never leaves partial text behind.

mod collector;
pub mod csv_format;
pub mod json_format;
pub mod osis;
pub mod usfm;
pub mod usx;

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::validate::{self, ValidationReport};
use super::{TranslationMetadataInput, get_translation};
use crate::canon::{self, CanonDefinition};
use crate::error::{Error, Result};
use crate::util::{new_id, now_iso, sha256_hex};

pub use collector::Collector;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SourceFormat {
    Json,
    Csv,
    Osis,
    Usfm,
    Usx,
}

impl SourceFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            SourceFormat::Json => "json",
            SourceFormat::Csv => "csv",
            SourceFormat::Osis => "osis",
            SourceFormat::Usfm => "usfm",
            SourceFormat::Usx => "usx",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Severity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportIssue {
    pub severity: Severity,
    pub code: String,
    pub message: String,
    pub location: Option<String>,
}

impl ImportIssue {
    pub fn new(severity: Severity, code: &str, message: impl Into<String>, location: Option<String>) -> Self {
        Self { severity, code: code.to_string(), message: message.into(), location }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedVerse {
    pub book_id: String,
    pub chapter: u32,
    pub verse: u32,
    pub verse_end: Option<u32>,
    pub text: String,
    pub source_ref: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ParsedBook {
    pub book_id: String,
    pub name: Option<String>,
    pub abbreviation: Option<String>,
}

/// Metadata found inside the source file, used to pre-fill the import form.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DetectedMetadata {
    pub code: Option<String>,
    pub name: Option<String>,
    pub language: Option<String>,
    pub publisher: Option<String>,
    pub copyright_notice: Option<String>,
    pub license_name: Option<String>,
    pub license_url: Option<String>,
    pub source_url: Option<String>,
    pub text_direction: Option<String>,
    pub versification: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedBible {
    pub metadata: DetectedMetadata,
    pub books: Vec<ParsedBook>,
    pub verses: Vec<ParsedVerse>,
    pub issues: Vec<ImportIssue>,
    /// Source books that are not part of any known canon, with verse counts.
    pub unknown_books: BTreeMap<String, usize>,
}

/// A source file (or one member of a zip / directory) decoded to text.
pub struct SourceText {
    pub name: String,
    pub text: String,
}

/// Decodes bytes as UTF-8 (with or without BOM) or BOM-marked UTF-16.
pub fn decode_text(name: &str, bytes: &[u8]) -> Result<String> {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(rest.to_vec())
            .map_err(|_| Error::validation(format!("{name} is not valid UTF-8 text.")));
    }
    let utf16 = |rest: &[u8], le: bool| -> Result<String> {
        if !rest.len().is_multiple_of(2) {
            return Err(Error::validation(format!("{name} is not valid UTF-16 text.")));
        }
        let units: Vec<u16> = rest
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| if le { u16::from_le_bytes(*c) } else { u16::from_be_bytes(*c) })
            .collect();
        String::from_utf16(&units).map_err(|_| Error::validation(format!("{name} is not valid UTF-16 text.")))
    };
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return utf16(rest, true);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return utf16(rest, false);
    }
    String::from_utf8(bytes.to_vec()).map_err(|e| {
        Error::validation(format!(
            "{name} is not UTF-8 encoded (invalid byte at position {}). Re-save the file as UTF-8 and try again.",
            e.utf8_error().valid_up_to()
        ))
    })
}

const MAX_SOURCE_BYTES: u64 = 200 * 1024 * 1024;

fn extension(name: &str) -> String {
    Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

fn is_candidate(name: &str) -> bool {
    matches!(extension(name).as_str(), "usfm" | "sfm" | "ptx" | "usx" | "xml" | "osis" | "json" | "csv" | "tsv" | "txt")
}

/// Reads a file, a directory of files, or a zip archive into decoded texts.
pub fn read_sources(path: &Path) -> Result<Vec<SourceText>> {
    let mut out = Vec::new();
    if path.is_dir() {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(path)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.is_file())
            .collect();
        entries.sort();
        for p in entries {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if is_candidate(&name) {
                out.push(SourceText { text: decode_text(&name, &std::fs::read(&p)?)?, name });
            }
        }
    } else if extension(&path.to_string_lossy()) == "zip" {
        out = read_zip(std::fs::File::open(path)?)?;
    } else {
        let meta = std::fs::metadata(path)?;
        if meta.len() > MAX_SOURCE_BYTES {
            return Err(Error::validation("The file is too large to import."));
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("source").to_string();
        out.push(SourceText { text: decode_text(&name, &std::fs::read(path)?)?, name });
    }
    if out.is_empty() {
        return Err(Error::validation("No Bible source files were found at that location."));
    }
    Ok(out)
}

/// Reads the source files in a zip archive (a file or bytes in memory).
pub fn read_zip(reader: impl Read + std::io::Seek) -> Result<Vec<SourceText>> {
    let mut archive = zip::ZipArchive::new(reader)?;
    let mut out = Vec::new();
    let mut total = 0u64;
    let mut entries: Vec<(String, usize)> = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        entries.push((archive.by_index(i)?.name()?.to_string(), i));
    }
    entries.sort();
    for (name, index) in entries {
        let mut f = archive.by_index(index)?;
        if f.is_dir() || !is_candidate(&name) {
            continue;
        }
        total += f.size();
        if total > MAX_SOURCE_BYTES {
            return Err(Error::validation("The archive is too large to import."));
        }
        let mut bytes = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut bytes)?;
        let short = name.rsplit('/').next().unwrap_or(&name).to_string();
        out.push(SourceText { text: decode_text(&short, &bytes)?, name: short });
    }
    Ok(out)
}

/// Detects the source format from file names and content.
pub fn detect_format(sources: &[SourceText]) -> Result<SourceFormat> {
    let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
    for s in sources {
        let ext = extension(&s.name);
        let head: String = s.text.trim_start_matches('\u{feff}').trim_start().chars().take(4000).collect();
        let fmt = match ext.as_str() {
            "usfm" | "sfm" | "ptx" => Some(SourceFormat::Usfm),
            "usx" => Some(SourceFormat::Usx),
            "osis" => Some(SourceFormat::Osis),
            "json" => Some(SourceFormat::Json),
            "csv" | "tsv" => Some(SourceFormat::Csv),
            _ => {
                if head.contains("<osis") {
                    Some(SourceFormat::Osis)
                } else if head.contains("<usx") {
                    Some(SourceFormat::Usx)
                } else if head.starts_with("\\id ") || head.contains("\n\\id ") || head.starts_with("\\usfm") {
                    Some(SourceFormat::Usfm)
                } else if head.starts_with('{') || head.starts_with('[') {
                    Some(SourceFormat::Json)
                } else if ext == "txt" && head.lines().next().map(|l| l.to_lowercase().contains("chapter")).unwrap_or(false) {
                    Some(SourceFormat::Csv)
                } else {
                    None
                }
            }
        };
        if let Some(f) = fmt {
            *counts.entry(f.as_str()).or_default() += 1;
        }
    }
    let best = counts.into_iter().max_by_key(|(_, n)| *n).map(|(f, _)| f);
    match best {
        Some("usfm") => Ok(SourceFormat::Usfm),
        Some("usx") => Ok(SourceFormat::Usx),
        Some("osis") => Ok(SourceFormat::Osis),
        Some("json") => Ok(SourceFormat::Json),
        Some("csv") => Ok(SourceFormat::Csv),
        _ => Err(Error::Unsupported(
            "The file format was not recognized. Supported formats: SanctuaryFlow JSON, CSV, OSIS XML, USFM and USX."
                .into(),
        )),
    }
}

pub fn parse_sources(format: SourceFormat, sources: &[SourceText]) -> Result<ParsedBible> {
    let parsed = match format {
        SourceFormat::Json => json_format::parse(sources)?,
        SourceFormat::Csv => csv_format::parse(sources)?,
        SourceFormat::Osis => osis::parse(sources)?,
        SourceFormat::Usfm => usfm::parse(sources)?,
        SourceFormat::Usx => usx::parse(sources)?,
    };
    if parsed.verses.is_empty() {
        return Err(Error::validation(
            "No verses were found in the source. Check that the file contains Bible text in the selected format.",
        ));
    }
    Ok(parsed)
}

/// Everything the operator reviews before confirming an import.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportPreview {
    pub format: SourceFormat,
    pub source_name: String,
    pub source_checksum: String,
    pub detected: DetectedMetadata,
    pub books: Vec<ParsedBook>,
    pub verse_count: u32,
    pub report: ValidationReport,
    /// Set when a translation with the detected code already exists.
    pub existing_translation_id: Option<String>,
    pub sample: Vec<SampleVerse>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SampleVerse {
    pub reference: String,
    pub text: String,
}

fn sample_verses(parsed: &ParsedBible, canon: &CanonDefinition) -> Vec<SampleVerse> {
    let wanted = [("GEN", 1, 1), ("PSA", 23, 1), ("JHN", 3, 16), ("ROM", 8, 28)];
    let mut out = Vec::new();
    for (b, c, v) in wanted {
        if let Some(pv) = parsed.verses.iter().find(|pv| pv.book_id == b && pv.chapter == c && pv.verse == v) {
            let name = canon.book(b).map(|bk| bk.name.clone()).unwrap_or_else(|| b.to_string());
            out.push(SampleVerse { reference: format!("{name} {c}:{v}"), text: pv.text.clone() });
        }
    }
    if out.is_empty() {
        if let Some(pv) = parsed.verses.first() {
            out.push(SampleVerse { reference: format!("{} {}:{}", pv.book_id, pv.chapter, pv.verse), text: pv.text.clone() });
        }
    }
    out
}

pub fn checksum_sources(sources: &[SourceText]) -> String {
    let mut all = Vec::new();
    for s in sources {
        all.extend_from_slice(s.name.as_bytes());
        all.push(0);
        all.extend_from_slice(s.text.as_bytes());
        all.push(0);
    }
    sha256_hex(&all)
}

pub fn build_preview(
    conn: &Connection,
    format: SourceFormat,
    source_name: &str,
    checksum: String,
    parsed: &ParsedBible,
) -> Result<ImportPreview> {
    let canon = canon::protestant();
    let report = validate::validate(parsed, canon);
    let existing_translation_id = match &parsed.metadata.code {
        Some(code) => super::find_translation_by_code(conn, code)?.map(|t| t.id),
        None => None,
    };
    Ok(ImportPreview {
        format,
        source_name: source_name.to_string(),
        source_checksum: checksum,
        detected: parsed.metadata.clone(),
        books: parsed.books.clone(),
        verse_count: parsed.verses.len() as u32,
        report,
        existing_translation_id,
        sample: sample_verses(parsed, canon),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportSource {
    /// "file" or "provider".
    pub kind: String,
    pub format: SourceFormat,
    pub path: Option<String>,
    pub provider: Option<String>,
    pub checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportOptions {
    pub metadata: TranslationMetadataInput,
    /// Required when a translation with the same code already exists.
    pub replace_existing: bool,
    /// Required when the report lists content that will not be imported
    /// (books outside the canon, empty verses).
    pub acknowledge_exclusions: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportResult {
    pub translation_id: String,
    pub job_id: String,
    pub verses_imported: u32,
    pub report: ValidationReport,
}

/// Writes a parsed Bible inside a single transaction. On any error the
/// transaction rolls back, the previous text of a replaced translation stays
/// intact, and the import job is recorded as failed.
pub fn commit(
    conn: &mut Connection,
    parsed: &ParsedBible,
    source: &ImportSource,
    options: ImportOptions,
    progress: &dyn Fn(u32, u32),
) -> Result<ImportResult> {
    let meta = options.metadata.clone().normalized()?;
    match meta.offline_permitted {
        Some(true) => {}
        Some(false) => {
            return Err(Error::validation(
                "This translation's license does not permit offline storage, so it cannot be imported.",
            ));
        }
        None => {
            return Err(Error::validation(
                "Confirm that this translation's license permits storing it offline before importing.",
            ));
        }
    }
    let canon = canon::protestant();
    let report = validate::validate(parsed, canon);
    if report.status == validate::ValidationStatus::Invalid {
        return Err(Error::validation(format!(
            "The source has errors that must be fixed before it can be imported: {}",
            report.issues.iter().filter(|i| i.severity == Severity::Error).map(|i| i.message.as_str()).take(3).collect::<Vec<_>>().join("; ")
        )));
    }
    if report.excluded_verses > 0 && !options.acknowledge_exclusions {
        return Err(Error::validation(format!(
            "{} verses will not be imported (see the report). Confirm the exclusions to continue.",
            report.excluded_verses
        )));
    }
    let existing = super::find_translation_by_code(conn, &meta.code)?;
    if existing.is_some() && !options.replace_existing {
        return Err(Error::Conflict(format!(
            "A translation with the code {} is already installed. Choose to replace it or use a different code.",
            meta.code
        )));
    }

    let job_id = new_id();
    conn.execute(
        "INSERT INTO bible_import_jobs (id, translation_id, translation_code, source_kind, source_format, source_path,
           source_provider, source_checksum, status, started_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'running', ?9)",
        params![
            job_id,
            existing.as_ref().map(|t| t.id.clone()),
            meta.code,
            source.kind,
            source.format.as_str(),
            source.path,
            source.provider,
            source.checksum,
            now_iso()
        ],
    )?;

    let result = write_translation(conn, parsed, source, &meta, existing.map(|t| t.id), &job_id, &report, progress);
    match &result {
        Ok(r) => {
            conn.execute(
                "UPDATE bible_import_jobs SET status = 'completed', finished_at = ?2, verses_imported = ?3,
                   translation_id = ?4 WHERE id = ?1",
                params![job_id, now_iso(), r.verses_imported, r.translation_id],
            )?;
        }
        Err(e) => {
            log::warn!("bible import {job_id} failed: {e}");
            conn.execute(
                "UPDATE bible_import_jobs SET status = 'failed', finished_at = ?2, error_message = ?3 WHERE id = ?1",
                params![job_id, now_iso(), e.to_string()],
            )?;
        }
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn write_translation(
    conn: &mut Connection,
    parsed: &ParsedBible,
    source: &ImportSource,
    meta: &TranslationMetadataInput,
    existing_id: Option<String>,
    job_id: &str,
    report: &ValidationReport,
    progress: &dyn Fn(u32, u32),
) -> Result<ImportResult> {
    let tx = conn.transaction()?;
    let now = now_iso();
    let translation_id = existing_id.unwrap_or_else(new_id);
    let canon = canon::protestant();

    // Replacing keeps the translation id stable so services that reference it
    // keep working; only its text and metadata are swapped.
    tx.execute("DELETE FROM bible_verses WHERE translation_id = ?1", [&translation_id])?;
    tx.execute("DELETE FROM bible_translation_books WHERE translation_id = ?1", [&translation_id])?;
    tx.execute(
        "INSERT INTO bible_translations (id, code, name, language, canon_id, versification, text_direction, publisher,
           source_provider, source_url, source_format, license_name, license_url, copyright_notice, attribution_text,
           offline_permitted, redistribution_permitted, modification_permitted, downloaded_at, import_status,
           notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, 'importing',
           ?20, ?21, ?21)
         ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name, language = excluded.language,
           canon_id = excluded.canon_id, versification = excluded.versification,
           text_direction = excluded.text_direction, publisher = excluded.publisher,
           source_provider = excluded.source_provider, source_url = excluded.source_url,
           source_format = excluded.source_format, license_name = excluded.license_name,
           license_url = excluded.license_url, copyright_notice = excluded.copyright_notice,
           attribution_text = excluded.attribution_text, offline_permitted = excluded.offline_permitted,
           redistribution_permitted = excluded.redistribution_permitted,
           modification_permitted = excluded.modification_permitted, downloaded_at = excluded.downloaded_at,
           import_status = 'importing', notes = excluded.notes, updated_at = excluded.updated_at",
        params![
            translation_id,
            meta.code,
            meta.name,
            meta.language,
            canon.id,
            meta.versification,
            meta.text_direction.clone().unwrap_or_else(|| "ltr".into()),
            meta.publisher,
            meta.source_provider,
            meta.source_url,
            source.format.as_str(),
            meta.license_name,
            meta.license_url,
            meta.copyright_notice,
            meta.attribution_text,
            meta.offline_permitted,
            meta.redistribution_permitted,
            meta.modification_permitted,
            meta.downloaded_at,
            meta.notes,
            now
        ],
    )?;

    let importable: Vec<&ParsedVerse> = validate::importable_verses(parsed, canon);
    let total = importable.len() as u32;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO bible_verses (translation_id, book_id, chapter, verse, verse_end, text, source_ref, import_job_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for (i, v) in importable.iter().enumerate() {
            stmt.execute(params![translation_id, v.book_id, v.chapter, v.verse, v.verse_end, v.text, v.source_ref, job_id])
                .map_err(|e| {
                    Error::Other(format!("Could not store {} {}:{} ({e}).", v.book_id, v.chapter, v.verse))
                })?;
            if i % 2000 == 0 {
                progress(i as u32, total);
            }
        }
    }
    progress(total, total);

    // Per-book summary with the translation's own book names.
    let names: BTreeMap<&str, &ParsedBook> = parsed.books.iter().map(|b| (b.book_id.as_str(), b)).collect();
    let mut stmt = tx.prepare(
        "SELECT book_id, MAX(chapter), COUNT(*) FROM bible_verses WHERE translation_id = ?1 GROUP BY book_id",
    )?;
    let per_book: Vec<(String, u32, u32)> = stmt
        .query_map([&translation_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<std::result::Result<_, _>>()?;
    drop(stmt);
    let mut chapters_total = 0u32;
    for (book_id, max_ch, verses) in &per_book {
        let chapters: u32 = tx.query_row(
            "SELECT COUNT(DISTINCT chapter) FROM bible_verses WHERE translation_id = ?1 AND book_id = ?2",
            params![translation_id, book_id],
            |r| r.get(0),
        )?;
        chapters_total += chapters;
        let parsed_book = names.get(book_id.as_str());
        let name = parsed_book
            .and_then(|b| b.name.clone())
            .or_else(|| canon.book(book_id).map(|b| b.name.clone()))
            .unwrap_or_else(|| book_id.clone());
        tx.execute(
            "INSERT INTO bible_translation_books (translation_id, book_id, name, abbreviation, book_order, chapter_count, verse_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                translation_id,
                book_id,
                name,
                parsed_book.and_then(|b| b.abbreviation.clone()),
                canon.book_order(book_id).unwrap_or(999) as i64,
                max_ch,
                verses
            ],
        )?;
    }

    validate::store_report(&tx, &translation_id, Some(job_id), report)?;
    tx.execute(
        "UPDATE bible_translations SET import_status = 'imported', validation_status = ?2, imported_at = ?3,
           last_validated_at = ?3, book_count = ?4, chapter_count = ?5, verse_count = ?6, updated_at = ?3
         WHERE id = ?1",
        params![translation_id, report.status.as_str(), now_iso(), per_book.len() as u32, chapters_total, total],
    )?;
    tx.commit()?;
    let _ = get_translation(conn, &translation_id)?;
    Ok(ImportResult { translation_id, job_id: job_id.to_string(), verses_imported: total, report: report.clone() })
}

/// Re-validates an installed translation from its stored text.
pub fn revalidate(conn: &mut Connection, translation_id: &str) -> Result<ValidationReport> {
    let t = get_translation(conn, translation_id)?;
    let canon = canon::by_id(&t.canon_id).unwrap_or_else(canon::protestant);
    let mut parsed = ParsedBible::default();
    {
        let mut stmt = conn.prepare(
            "SELECT book_id, chapter, verse, verse_end, text, source_ref FROM bible_verses
             WHERE translation_id = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map([translation_id], |r| {
            Ok(ParsedVerse {
                book_id: r.get(0)?,
                chapter: r.get(1)?,
                verse: r.get(2)?,
                verse_end: r.get(3)?,
                text: r.get(4)?,
                source_ref: r.get(5)?,
            })
        })?;
        parsed.verses = rows.collect::<std::result::Result<_, _>>()?;
    }
    let report = validate::validate(&parsed, canon);
    let tx = conn.transaction()?;
    validate::store_report(&tx, translation_id, None, &report)?;
    tx.execute(
        "UPDATE bible_translations SET validation_status = ?2, last_validated_at = ?3 WHERE id = ?1",
        params![translation_id, report.status.as_str(), now_iso()],
    )?;
    tx.commit()?;
    Ok(report)
}

pub fn latest_report(conn: &Connection, translation_id: &str) -> Result<Option<ValidationReport>> {
    let raw: Option<(String, String, String, String)> = conn
        .query_row(
            "SELECT status, summary, issues, created_at FROM bible_validation_reports
             WHERE translation_id = ?1 ORDER BY created_at DESC LIMIT 1",
            [translation_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    Ok(raw.and_then(|(_, summary, _, _)| serde_json::from_str::<ValidationReport>(&summary).ok()))
}

#[cfg(test)]
mod tests;
