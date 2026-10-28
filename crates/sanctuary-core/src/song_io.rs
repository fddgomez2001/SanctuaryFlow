//! Song import and export (JSON and CSV), with duplicate detection.
//!
//! JSON export: `{ "format": "sanctuaryflow-songs", "version": 1, "songs": [SongDocument] }`.
//! A bare array of song documents is also accepted on import.
//!
//! CSV columns: title, artist, original_key, tempo, language, category, tags
//! (separated by `;`), copyright_holder, copyright_year, ccli_number, source,
//! license, notes, lyrics. Lyrics use `[Section]` headers and blank lines
//! for slide breaks.

use std::path::Path;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::songs::{self, DuplicateIndex, SongDocument, SongQuery};
use crate::util::{now_iso, sha256_hex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SongFileFormat {
    Json,
    Csv,
}

fn format_for(path: &Path) -> Result<SongFileFormat> {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() {
        Some("json") => Ok(SongFileFormat::Json),
        Some("csv") => Ok(SongFileFormat::Csv),
        _ => Err(Error::Unsupported("Songs can be imported from .json or .csv files.".into())),
    }
}

/// Renders sections as `[Label]` blocks, the same text format the editor accepts.
pub fn lyrics_to_text(doc: &SongDocument) -> String {
    doc.sections.iter().map(|s| format!("[{}]\n{}", s.label, s.lyrics)).collect::<Vec<_>>().join("\n\n")
}

const CSV_HEADERS: [&str; 14] = [
    "title",
    "artist",
    "original_key",
    "tempo",
    "language",
    "category",
    "tags",
    "copyright_holder",
    "copyright_year",
    "ccli_number",
    "source",
    "license",
    "notes",
    "lyrics",
];

pub fn export_songs(conn: &Connection, ids: Option<&[String]>, path: &Path) -> Result<u32> {
    let format = format_for(path)?;
    let docs: Vec<SongDocument> = match ids {
        Some(ids) => ids.iter().map(|id| songs::get_song(conn, id).map(|s| songs::to_document(&s))).collect::<Result<_>>()?,
        None => {
            let all = songs::list_songs(conn, &SongQuery { include_archived: true, limit: Some(1000), ..Default::default() })?;
            let mut out = Vec::new();
            let mut offset = 0;
            let mut page = all;
            loop {
                for s in &page.items {
                    out.push(songs::to_document(&songs::get_song(conn, &s.id)?));
                }
                offset += page.items.len() as u32;
                if offset >= page.total || page.items.is_empty() {
                    break;
                }
                page = songs::list_songs(
                    conn,
                    &SongQuery { include_archived: true, limit: Some(1000), offset: Some(offset), ..Default::default() },
                )?;
            }
            out
        }
    };
    let bytes = match format {
        SongFileFormat::Json => serde_json::to_vec_pretty(&serde_json::json!({
            "format": "sanctuaryflow-songs",
            "version": 1,
            "exportedAt": now_iso(),
            "songs": docs,
        }))?,
        SongFileFormat::Csv => {
            let mut w = csv::Writer::from_writer(Vec::new());
            w.write_record(CSV_HEADERS)?;
            for d in &docs {
                let o = |v: &Option<String>| v.clone().unwrap_or_default();
                w.write_record([
                    d.title.clone(),
                    o(&d.artist),
                    o(&d.original_key),
                    o(&d.tempo),
                    o(&d.language),
                    o(&d.category),
                    d.tags.join("; "),
                    o(&d.copyright_holder),
                    o(&d.copyright_year),
                    o(&d.ccli_number),
                    o(&d.source),
                    o(&d.license),
                    o(&d.notes),
                    lyrics_to_text(d),
                ])?;
            }
            // UTF-8 BOM so spreadsheet applications detect the encoding.
            let mut bytes = vec![0xEF, 0xBB, 0xBF];
            bytes.extend(w.into_inner().map_err(|e| Error::Other(e.to_string()))?);
            bytes
        }
    };
    let tmp = path.with_extension("partial");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(docs.len() as u32)
}

fn parse_file(path: &Path) -> Result<(Vec<SongDocument>, Vec<String>, String)> {
    let format = format_for(path)?;
    let bytes = std::fs::read(path)?;
    let checksum = sha256_hex(&bytes);
    let text = crate::bible::import::decode_text(&path.to_string_lossy(), &bytes)?;
    let mut warnings = Vec::new();
    let docs = match format {
        SongFileFormat::Json => {
            let v: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
                .map_err(|e| Error::validation(format!("The file is not valid JSON: {e}")))?;
            let list = match &v {
                serde_json::Value::Array(a) => a.clone(),
                serde_json::Value::Object(o) => match o.get("songs") {
                    Some(serde_json::Value::Array(a)) => a.clone(),
                    _ => return Err(Error::validation("The JSON file does not contain a \"songs\" list.")),
                },
                _ => return Err(Error::validation("The JSON file does not contain songs.")),
            };
            let mut docs = Vec::new();
            for (i, item) in list.into_iter().enumerate() {
                match serde_json::from_value::<SongDocument>(item) {
                    Ok(d) => docs.push(d),
                    Err(e) => warnings.push(format!("Song {} was skipped: {e}", i + 1)),
                }
            }
            docs
        }
        SongFileFormat::Csv => {
            let mut r = csv::ReaderBuilder::new().flexible(true).from_reader(text.trim_start_matches('\u{feff}').as_bytes());
            let headers: Vec<String> = r.headers()?.iter().map(|h| h.trim().to_lowercase()).collect();
            let col = |name: &str| headers.iter().position(|h| h == name);
            let Some(title_col) = col("title") else {
                return Err(Error::validation("The CSV file needs a 'title' column."));
            };
            let mut docs = Vec::new();
            for (i, rec) in r.records().enumerate() {
                let rec = rec?;
                let get = |name: &str| col(name).and_then(|c| rec.get(c)).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
                let title = rec.get(title_col).unwrap_or("").trim().to_string();
                if title.is_empty() {
                    warnings.push(format!("Row {} has no title and was skipped.", i + 2));
                    continue;
                }
                docs.push(SongDocument {
                    id: None,
                    title,
                    artist: get("artist"),
                    original_key: get("original_key").or_else(|| get("key")),
                    tempo: get("tempo"),
                    language: get("language"),
                    category: get("category"),
                    copyright_holder: get("copyright_holder").or_else(|| get("copyright")),
                    copyright_year: get("copyright_year"),
                    ccli_number: get("ccli_number").or_else(|| get("ccli")),
                    source: get("source"),
                    license: get("license"),
                    notes: get("notes"),
                    arrangement: None,
                    theme_id: None,
                    audio_media_id: None,
                    cover_media_id: None,
                    lyric_sync: None,
                    tags: get("tags").map(|t| t.split([';', ',']).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()).unwrap_or_default(),
                    sections: get("lyrics").map(|l| songs::parse_lyrics_text(&l)).unwrap_or_default(),
                });
            }
            docs
        }
    };
    if docs.is_empty() {
        return Err(Error::validation("No songs were found in the file."));
    }
    Ok((docs, warnings, checksum))
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DuplicateMatch {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongImportCandidate {
    pub index: u32,
    pub title: String,
    pub artist: Option<String>,
    pub section_count: u32,
    pub first_line: Option<String>,
    pub duplicates: Vec<DuplicateMatch>,
    pub missing_copyright: bool,
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongImportPreview {
    pub checksum: String,
    pub candidates: Vec<SongImportCandidate>,
    pub warnings: Vec<String>,
}

pub fn preview_import(conn: &Connection, path: &Path) -> Result<SongImportPreview> {
    let (docs, warnings, checksum) = parse_file(path)?;
    let index = DuplicateIndex::load(conn)?;
    let candidates = docs
        .into_iter()
        .enumerate()
        .map(|(i, d)| {
            let problem = songs::normalize_document(d.clone()).err().map(|e| e.to_string());
            SongImportCandidate {
                index: i as u32,
                title: d.title.clone(),
                artist: d.artist.clone(),
                section_count: d.sections.len() as u32,
                first_line: d.sections.first().and_then(|s| s.lyrics.lines().find(|l| !l.trim().is_empty()).map(str::to_string)),
                duplicates: index.matches(&d).into_iter().map(|(id, title)| DuplicateMatch { id, title }).collect(),
                missing_copyright: d.copyright_holder.is_none() && d.ccli_number.is_none() && d.license.is_none(),
                problem,
            }
        })
        .collect();
    Ok(SongImportPreview { checksum, candidates, warnings })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ImportAction {
    Create,
    Skip,
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongImportDecision {
    pub index: u32,
    pub action: ImportAction,
    /// The existing song to overwrite when the action is `replace`.
    pub replace_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongImportResult {
    pub created: u32,
    pub replaced: u32,
    pub skipped: u32,
}

/// Applies the operator's per-song decisions in one transaction. Fails if
/// the file changed since the preview.
pub fn commit_import(
    conn: &mut Connection,
    path: &Path,
    checksum: &str,
    decisions: &[SongImportDecision],
) -> Result<SongImportResult> {
    let (docs, _, current) = parse_file(path)?;
    if current != checksum {
        return Err(Error::Conflict("The file changed after it was previewed. Preview it again.".into()));
    }
    let tx = conn.transaction()?;
    let mut result = SongImportResult { created: 0, replaced: 0, skipped: 0 };
    for (i, doc) in docs.into_iter().enumerate() {
        let decision = decisions.iter().find(|d| d.index == i as u32);
        match decision.map(|d| (d.action, d.replace_id.clone())) {
            None | Some((ImportAction::Skip, _)) => result.skipped += 1,
            Some((ImportAction::Create, _)) => {
                let mut d = doc;
                if d.id.as_deref().map(|id| songs::song_exists(&tx, id)).transpose()?.unwrap_or(false) {
                    d.id = None;
                }
                songs::reassign_section_ids(&mut d);
                songs::save_song_tx(&tx, songs::normalize_document(d)?)?;
                result.created += 1;
            }
            Some((ImportAction::Replace, target)) => {
                let target = target.ok_or_else(|| Error::validation("Choose which song to replace."))?;
                let existing = songs::get_song(&tx, &target)?;
                let mut d = doc;
                d.id = Some(existing.id.clone());
                songs::reassign_section_ids(&mut d);
                songs::save_song_tx(&tx, songs::normalize_document(d)?)?;
                result.replaced += 1;
            }
        }
    }
    tx.commit()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::songs::{SectionKind, SongSectionInput, save_song};

    fn doc(title: &str, first: &str) -> SongDocument {
        SongDocument {
            id: None,
            title: title.into(),
            artist: Some("Writer".into()),
            original_key: Some("G".into()),
            tempo: None,
            language: Some("en".into()),
            category: None,
            copyright_holder: None,
            copyright_year: None,
            ccli_number: Some("1234567".into()),
            source: None,
            license: None,
            notes: None,
            arrangement: None,
            theme_id: None,
            audio_media_id: None,
            cover_media_id: None,
            lyric_sync: None,
            tags: vec!["Opening".into(), "Praise".into()],
            sections: vec![
                SongSectionInput::new(SectionKind::Verse, String::new(), format!("{first}\nline two\n\nline three")),
                SongSectionInput::new(SectionKind::Chorus, String::new(), "Chorus line, with comma\n“Quotes” and ñ"),
            ],
        }
    }

    #[test]
    fn json_and_csv_round_trip_with_duplicate_detection() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        db.write(|c| save_song(c, doc("Song One", "The first lyric line"))).unwrap();
        db.write(|c| save_song(c, doc("Awit Dalawa", "Ang unang linya ng awit"))).unwrap();

        for name in ["songs.json", "songs.csv"] {
            let path = dir.path().join(name);
            assert_eq!(db.read(|c| export_songs(c, None, &path)).unwrap(), 2);

            let target = Database::open_in_memory().unwrap();
            target.write(|c| save_song(c, doc("Song One", "Different start entirely"))).unwrap();
            let preview = target.read(|c| preview_import(c, &path)).unwrap();
            assert_eq!(preview.candidates.len(), 2);
            let one = preview.candidates.iter().find(|c| c.title == "Song One").unwrap();
            assert_eq!(one.duplicates.len(), 1, "{name}: title duplicate detected");
            let two = preview.candidates.iter().find(|c| c.title == "Awit Dalawa").unwrap();
            assert!(two.duplicates.is_empty());

            let decisions = vec![
                SongImportDecision { index: one.index, action: ImportAction::Skip, replace_id: None },
                SongImportDecision { index: two.index, action: ImportAction::Create, replace_id: None },
            ];
            let r = target.write(|c| commit_import(c, &path, &preview.checksum, &decisions)).unwrap();
            assert_eq!((r.created, r.replaced, r.skipped), (1, 0, 1));
            let imported = target
                .read(|c| crate::songs::list_songs(c, &SongQuery { text: Some("Dalawa".into()), ..Default::default() }))
                .unwrap();
            let song = target.read(|c| crate::songs::get_song(c, &imported.items[0].id)).unwrap();
            assert_eq!(song.sections.len(), 2, "{name}");
            assert_eq!(song.sections[0].lyrics, "Ang unang linya ng awit\nline two\n\nline three");
            assert_eq!(song.sections[1].lyrics, "Chorus line, with comma\n“Quotes” and ñ");
            assert_eq!(song.tags, vec!["Opening".to_string(), "Praise".to_string()]);
            assert_eq!(song.ccli_number.as_deref(), Some("1234567"));

            // Replace the duplicate.
            let decisions = vec![SongImportDecision { index: one.index, action: ImportAction::Replace, replace_id: Some(one.duplicates[0].id.clone()) }];
            let r = target.write(|c| commit_import(c, &path, &preview.checksum, &decisions)).unwrap();
            assert_eq!(r.replaced, 1);
            let replaced = target.read(|c| crate::songs::get_song(c, &one.duplicates[0].id)).unwrap();
            assert!(replaced.sections[0].lyrics.starts_with("The first lyric line"));
        }
    }

    #[test]
    fn rejects_changed_file_and_bad_input() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        let path = dir.path().join("in.csv");
        std::fs::write(&path, "title,lyrics\nHello,\"[Chorus]\nSing\"\n,missing title\n").unwrap();
        let p = db.read(|c| preview_import(c, &path)).unwrap();
        assert_eq!(p.candidates.len(), 1);
        assert_eq!(p.warnings.len(), 1);
        std::fs::write(&path, "title\nChanged\n").unwrap();
        let err = db
            .write(|c| commit_import(c, &path, &p.checksum, &[SongImportDecision { index: 0, action: ImportAction::Create, replace_id: None }]))
            .unwrap_err();
        assert_eq!(err.code(), "conflict");
        let bad = dir.path().join("x.txt");
        std::fs::write(&bad, "hi").unwrap();
        assert_eq!(db.read(|c| preview_import(c, &bad)).unwrap_err().code(), "unsupported");
    }
}
