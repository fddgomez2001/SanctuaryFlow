use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Row, ToSql, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::sync;
use crate::util::{clean_opt, fts_query, is_valid_uuid, new_id, normalize_for_compare, now_iso};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SectionKind {
    Intro,
    Verse,
    Prechorus,
    Chorus,
    Bridge,
    Interlude,
    Tag,
    Outro,
    Ending,
    Custom,
}

impl SectionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SectionKind::Intro => "intro",
            SectionKind::Verse => "verse",
            SectionKind::Prechorus => "prechorus",
            SectionKind::Chorus => "chorus",
            SectionKind::Bridge => "bridge",
            SectionKind::Interlude => "interlude",
            SectionKind::Tag => "tag",
            SectionKind::Outro => "outro",
            SectionKind::Ending => "ending",
            SectionKind::Custom => "custom",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "intro" => SectionKind::Intro,
            "verse" => SectionKind::Verse,
            "prechorus" => SectionKind::Prechorus,
            "chorus" => SectionKind::Chorus,
            "bridge" => SectionKind::Bridge,
            "interlude" => SectionKind::Interlude,
            "tag" => SectionKind::Tag,
            "outro" => SectionKind::Outro,
            "ending" => SectionKind::Ending,
            "custom" => SectionKind::Custom,
            _ => return None,
        })
    }

    pub fn display_name(self) -> &'static str {
        match self {
            SectionKind::Intro => "Intro",
            SectionKind::Verse => "Verse",
            SectionKind::Prechorus => "Pre-Chorus",
            SectionKind::Chorus => "Chorus",
            SectionKind::Bridge => "Bridge",
            SectionKind::Interlude => "Interlude",
            SectionKind::Tag => "Tag",
            SectionKind::Outro => "Outro",
            SectionKind::Ending => "Ending",
            SectionKind::Custom => "Section",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongSection {
    pub id: String,
    pub kind: SectionKind,
    pub label: String,
    pub lyrics: String,
    /// Lines per slide for this section; `None` uses the global setting and
    /// `Some(1)` presents the section line by line.
    pub lines_per_slide: Option<u32>,
}

/// One line of lyrics placed in the song's recording, so the words can
/// follow the music. Times are milliseconds from the start of the audio; a
/// line without a start time has not been synchronized yet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LyricLine {
    pub id: String,
    /// The song part it belongs to, e.g. "Chorus".
    #[serde(default)]
    pub section: String,
    pub text: String,
    #[serde(default)]
    pub start_ms: Option<u32>,
    #[serde(default)]
    pub end_ms: Option<u32>,
}

const MAX_LYRIC_LINES: usize = 3000;
const MAX_LYRIC_MS: u32 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Song {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub original_key: Option<String>,
    pub tempo: Option<String>,
    pub language: Option<String>,
    pub category: Option<String>,
    pub copyright_holder: Option<String>,
    pub copyright_year: Option<String>,
    pub ccli_number: Option<String>,
    pub source: Option<String>,
    pub license: Option<String>,
    pub notes: Option<String>,
    /// Presentation order as section ids (sections may repeat). `None` means
    /// the sections are presented in their stored order.
    pub arrangement: Option<Vec<String>>,
    pub theme_id: Option<String>,
    /// The song's recording (an audio file in the media library).
    pub audio_media_id: Option<String>,
    /// Album cover picture; without one the artist's cover is used.
    pub cover_media_id: Option<String>,
    /// Lyrics timed to the recording, in the order they are sung.
    pub lyric_sync: Option<Vec<LyricLine>>,
    pub tags: Vec<String>,
    pub sections: Vec<SongSection>,
    pub is_favorite: bool,
    #[ts(type = "number")]
    pub use_count: i64,
    pub last_used_at: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[ts(type = "number")]
    pub revision: i64,
}

/// The portable content of a song, used for export, import and sync payloads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongDocument {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub original_key: Option<String>,
    #[serde(default)]
    pub tempo: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub copyright_holder: Option<String>,
    #[serde(default)]
    pub copyright_year: Option<String>,
    #[serde(default)]
    pub ccli_number: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub arrangement: Option<Vec<String>>,
    #[serde(default)]
    pub theme_id: Option<String>,
    #[serde(default)]
    pub audio_media_id: Option<String>,
    #[serde(default)]
    pub cover_media_id: Option<String>,
    #[serde(default)]
    pub lyric_sync: Option<Vec<LyricLine>>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub sections: Vec<SongSectionInput>,
}

pub type SongInput = SongDocument;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongSectionInput {
    #[serde(default)]
    pub id: Option<String>,
    pub kind: SectionKind,
    #[serde(default)]
    pub label: String,
    pub lyrics: String,
    #[serde(default)]
    pub lines_per_slide: Option<u32>,
}

impl SongSectionInput {
    pub fn new(kind: SectionKind, label: impl Into<String>, lyrics: impl Into<String>) -> Self {
        Self { id: None, kind, label: label.into(), lyrics: lyrics.into(), lines_per_slide: None }
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongSummary {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub category: Option<String>,
    pub language: Option<String>,
    pub tags: Vec<String>,
    pub first_line: Option<String>,
    pub is_favorite: bool,
    pub archived: bool,
    pub missing_copyright: bool,
    pub last_used_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SongSort {
    #[default]
    Title,
    Recent,
    Updated,
    Relevance,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SongSearchField {
    Title,
    Artist,
    Lyrics,
    Tags,
}

impl SongSearchField {
    fn column(self) -> &'static str {
        match self {
            SongSearchField::Title => "title",
            SongSearchField::Artist => "artist",
            SongSearchField::Lyrics => "lyrics",
            SongSearchField::Tags => "tags",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct SongQuery {
    pub text: Option<String>,
    pub field: Option<SongSearchField>,
    pub tag: Option<String>,
    pub category: Option<String>,
    pub language: Option<String>,
    pub favorites_only: bool,
    pub include_archived: bool,
    pub archived_only: bool,
    pub sort: SongSort,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongListResult {
    pub items: Vec<SongSummary>,
    pub total: u32,
}

const MAX_TITLE: usize = 300;
const MAX_LYRICS: usize = 20_000;

fn first_non_empty_line(text: &str) -> Option<String> {
    text.lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string)
}

fn missing_copyright(holder: &Option<String>, ccli: &Option<String>, license: &Option<String>) -> bool {
    let public_domain = license.as_deref().map(|l| l.to_lowercase().contains("public domain")).unwrap_or(false);
    holder.is_none() && ccli.is_none() && !public_domain
}

/// Validates and normalizes a song document. Section ids are assigned when
/// missing, labels default from the kind, and the arrangement must only refer
/// to sections of this song.
/// Checks timed lyrics: sensible times, ends after starts, and no empty lines.
fn normalize_lyric_sync(lines: Option<Vec<LyricLine>>) -> Result<Option<Vec<LyricLine>>> {
    let Some(lines) = lines else { return Ok(None) };
    if lines.len() > MAX_LYRIC_LINES {
        return Err(Error::validation("A song can have at most 3000 timed lyric lines."));
    }
    let mut out = Vec::with_capacity(lines.len());
    let mut ids = HashSet::new();
    for mut line in lines {
        line.text = line.text.trim().to_string();
        line.section = line.section.trim().chars().take(80).collect();
        if line.text.is_empty() {
            continue;
        }
        if line.text.chars().count() > 500 {
            return Err(Error::validation("A timed lyric line is too long (500 characters at most)."));
        }
        line.id = line.id.trim().to_string();
        if line.id.is_empty() || line.id.len() > 64 || !ids.insert(line.id.clone()) {
            line.id = new_id();
            ids.insert(line.id.clone());
        }
        if line.start_ms.is_some_and(|s| s > MAX_LYRIC_MS) || line.end_ms.is_some_and(|e| e > MAX_LYRIC_MS) {
            return Err(Error::validation("A lyric time is longer than a day."));
        }
        if let (Some(s), Some(e)) = (line.start_ms, line.end_ms) {
            if e < s {
                return Err(Error::validation(format!("“{}” ends before it starts.", line.text)));
            }
        }
        out.push(line);
    }
    Ok(if out.is_empty() { None } else { Some(out) })
}

pub fn normalize_document(mut doc: SongDocument) -> Result<SongDocument> {
    doc.title = doc.title.trim().to_string();
    if doc.title.is_empty() {
        return Err(Error::validation("A song needs a title."));
    }
    if doc.title.chars().count() > MAX_TITLE {
        return Err(Error::validation("The song title is too long."));
    }
    if let Some(id) = &doc.id {
        if !is_valid_uuid(id) {
            return Err(Error::validation("Invalid song id."));
        }
    }
    doc.artist = clean_opt(doc.artist);
    doc.original_key = clean_opt(doc.original_key);
    doc.tempo = clean_opt(doc.tempo);
    doc.language = clean_opt(doc.language);
    doc.category = clean_opt(doc.category);
    doc.copyright_holder = clean_opt(doc.copyright_holder);
    doc.copyright_year = clean_opt(doc.copyright_year);
    doc.ccli_number = clean_opt(doc.ccli_number);
    doc.source = clean_opt(doc.source);
    doc.license = clean_opt(doc.license);
    doc.notes = clean_opt(doc.notes);
    doc.theme_id = clean_opt(doc.theme_id);
    doc.audio_media_id = clean_opt(doc.audio_media_id);
    doc.cover_media_id = clean_opt(doc.cover_media_id);
    doc.lyric_sync = normalize_lyric_sync(doc.lyric_sync.take())?;

    let mut tags: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for t in doc.tags.drain(..) {
        let t = t.trim().to_string();
        if !t.is_empty() && seen.insert(t.to_lowercase()) {
            tags.push(t);
        }
    }
    doc.tags = tags;

    let mut ids = HashSet::new();
    let mut counts: std::collections::HashMap<SectionKind, u32> = Default::default();
    for s in doc.sections.iter_mut() {
        let id = match s.id.take().filter(|i| !i.trim().is_empty()) {
            Some(i) if is_valid_uuid(&i) => i,
            Some(_) => return Err(Error::validation("Invalid section id.")),
            None => new_id(),
        };
        if !ids.insert(id.clone()) {
            return Err(Error::validation("Two sections share the same id."));
        }
        s.id = Some(id);
        // Normalize line endings and trailing whitespace but keep blank lines,
        // which mark slide breaks.
        s.lyrics = s.lyrics.replace("\r\n", "\n").replace('\r', "\n");
        s.lyrics = s.lyrics.lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim_matches('\n').to_string();
        if s.lyrics.chars().count() > MAX_LYRICS {
            return Err(Error::validation("A section's lyrics are too long."));
        }
        if let Some(lines) = s.lines_per_slide {
            if !(1..=12).contains(&lines) {
                return Err(Error::validation("Lines per slide must be between 1 and 12."));
            }
        }
        let n = counts.entry(s.kind).or_insert(0);
        *n += 1;
        s.label = s.label.trim().to_string();
        if s.label.is_empty() {
            s.label = match s.kind {
                SectionKind::Verse => format!("Verse {n}"),
                k => k.display_name().to_string(),
            };
        }
    }
    if let Some(arr) = &doc.arrangement {
        if arr.is_empty() {
            doc.arrangement = None;
        } else if let Some(bad) = arr.iter().find(|id| !ids.contains(*id)) {
            return Err(Error::validation(format!("The arrangement refers to a missing section ({bad}).")));
        }
    }
    Ok(doc)
}

fn read_sections(conn: &Connection, song_id: &str) -> Result<Vec<SongSection>> {
    let mut stmt =
        conn.prepare_cached("SELECT id, kind, label, lyrics, lines_per_slide FROM song_sections WHERE song_id = ?1 ORDER BY position")?;
    let rows = stmt.query_map([song_id], |r| {
        let kind: String = r.get(1)?;
        Ok(SongSection {
            id: r.get(0)?,
            kind: SectionKind::parse(&kind).unwrap_or(SectionKind::Custom),
            label: r.get(2)?,
            lyrics: r.get(3)?,
            lines_per_slide: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

fn read_tags(conn: &Connection, song_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare_cached("SELECT tag FROM song_tags WHERE song_id = ?1 ORDER BY tag COLLATE NOCASE")?;
    let rows = stmt.query_map([song_id], |r| r.get(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

const SONG_COLUMNS: &str = "id, title, artist, original_key, tempo, language, category, copyright_holder, \
    copyright_year, ccli_number, source, license, notes, arrangement, theme_id, is_favorite, use_count, \
    last_used_at, archived_at, created_at, updated_at, revision, audio_media_id, cover_media_id, lyric_sync";

fn song_from_row(r: &Row) -> rusqlite::Result<Song> {
    let arrangement: Option<String> = r.get(13)?;
    let lyric_sync: Option<String> = r.get(24)?;
    Ok(Song {
        id: r.get(0)?,
        title: r.get(1)?,
        artist: r.get(2)?,
        original_key: r.get(3)?,
        tempo: r.get(4)?,
        language: r.get(5)?,
        category: r.get(6)?,
        copyright_holder: r.get(7)?,
        copyright_year: r.get(8)?,
        ccli_number: r.get(9)?,
        source: r.get(10)?,
        license: r.get(11)?,
        notes: r.get(12)?,
        arrangement: arrangement.and_then(|a| serde_json::from_str(&a).ok()),
        theme_id: r.get(14)?,
        audio_media_id: r.get(22)?,
        cover_media_id: r.get(23)?,
        lyric_sync: lyric_sync.and_then(|j| serde_json::from_str(&j).ok()),
        tags: Vec::new(),
        sections: Vec::new(),
        is_favorite: r.get(15)?,
        use_count: r.get(16)?,
        last_used_at: r.get(17)?,
        archived_at: r.get(18)?,
        created_at: r.get(19)?,
        updated_at: r.get(20)?,
        revision: r.get(21)?,
    })
}

pub fn get_song(conn: &Connection, id: &str) -> Result<Song> {
    let mut song = conn
        .query_row(&format!("SELECT {SONG_COLUMNS} FROM songs WHERE id = ?1 AND deleted_at IS NULL"), [id], song_from_row)
        .optional()?
        .ok_or_else(|| Error::not_found("The song was not found. It may have been deleted."))?;
    song.sections = read_sections(conn, id)?;
    song.tags = read_tags(conn, id)?;
    Ok(song)
}

pub fn song_exists(conn: &Connection, id: &str) -> Result<bool> {
    Ok(conn.query_row("SELECT EXISTS (SELECT 1 FROM songs WHERE id = ?1)", [id], |r| r.get(0))?)
}

pub fn to_document(song: &Song) -> SongDocument {
    SongDocument {
        id: Some(song.id.clone()),
        title: song.title.clone(),
        artist: song.artist.clone(),
        original_key: song.original_key.clone(),
        tempo: song.tempo.clone(),
        language: song.language.clone(),
        category: song.category.clone(),
        copyright_holder: song.copyright_holder.clone(),
        copyright_year: song.copyright_year.clone(),
        ccli_number: song.ccli_number.clone(),
        source: song.source.clone(),
        license: song.license.clone(),
        notes: song.notes.clone(),
        arrangement: song.arrangement.clone(),
        theme_id: song.theme_id.clone(),
        audio_media_id: song.audio_media_id.clone(),
        cover_media_id: song.cover_media_id.clone(),
        lyric_sync: song.lyric_sync.clone(),
        tags: song.tags.clone(),
        sections: song
            .sections
            .iter()
            .map(|s| SongSectionInput {
                id: Some(s.id.clone()),
                kind: s.kind,
                label: s.label.clone(),
                lyrics: s.lyrics.clone(),
                lines_per_slide: s.lines_per_slide,
            })
            .collect(),
    }
}

fn write_children(conn: &Connection, id: &str, doc: &SongDocument) -> Result<()> {
    conn.execute("DELETE FROM song_sections WHERE song_id = ?1", [id])?;
    {
        let mut stmt = conn.prepare_cached(
            "INSERT INTO song_sections (id, song_id, kind, label, position, lyrics, lines_per_slide)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for (i, s) in doc.sections.iter().enumerate() {
            stmt.execute(params![s.id, id, s.kind.as_str(), s.label, i as i64, s.lyrics, s.lines_per_slide])?;
        }
    }
    conn.execute("DELETE FROM song_tags WHERE song_id = ?1", [id])?;
    {
        let mut stmt = conn.prepare_cached("INSERT INTO song_tags (song_id, tag) VALUES (?1, ?2)")?;
        for t in &doc.tags {
            stmt.execute(params![id, t])?;
        }
    }
    refresh_fts(conn, id, doc)
}

fn refresh_fts(conn: &Connection, id: &str, doc: &SongDocument) -> Result<()> {
    conn.execute("DELETE FROM songs_fts WHERE song_id = ?1", [id])?;
    let lyrics = doc.sections.iter().map(|s| s.lyrics.as_str()).collect::<Vec<_>>().join("\n");
    conn.execute(
        "INSERT INTO songs_fts (song_id, title, artist, lyrics, tags) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, doc.title, doc.artist.clone().unwrap_or_default(), lyrics, doc.tags.join(" ")],
    )?;
    Ok(())
}

/// Creates or updates a song in one transaction. Saving identical content is
/// a no-op, so auto-save does not create sync traffic.
pub fn save_song(conn: &mut Connection, input: SongInput) -> Result<Song> {
    let doc = normalize_document(input)?;
    let tx = conn.transaction()?;
    let id = save_song_tx(&tx, doc)?;
    tx.commit()?;
    get_song(conn, &id)
}

pub(crate) fn save_song_tx(tx: &Connection, doc: SongDocument) -> Result<String> {
    let now = now_iso();
    let existing: Option<(i64, Option<String>)> = match &doc.id {
        Some(id) => tx
            .query_row("SELECT revision, deleted_at FROM songs WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?,
        None => None,
    };
    let arrangement = doc.arrangement.as_ref().map(serde_json::to_string).transpose()?;
    let lyric_sync = doc.lyric_sync.as_ref().map(serde_json::to_string).transpose()?;

    match existing {
        Some((revision, deleted_at)) => {
            let id = doc.id.clone().unwrap_or_default();
            if deleted_at.is_none() {
                let current = to_document(&get_song(tx, &id)?);
                if current == doc {
                    return Ok(id);
                }
            }
            let revision = revision + 1;
            tx.execute(
                "UPDATE songs SET title = ?2, artist = ?3, original_key = ?4, tempo = ?5, language = ?6,
                   category = ?7, copyright_holder = ?8, copyright_year = ?9, ccli_number = ?10, source = ?11,
                   license = ?12, notes = ?13, arrangement = ?14, theme_id = ?15, updated_at = ?16,
                   deleted_at = NULL, revision = ?17, audio_media_id = ?18, cover_media_id = ?19, lyric_sync = ?20
                 WHERE id = ?1",
                params![
                    id,
                    doc.title,
                    doc.artist,
                    doc.original_key,
                    doc.tempo,
                    doc.language,
                    doc.category,
                    doc.copyright_holder,
                    doc.copyright_year,
                    doc.ccli_number,
                    doc.source,
                    doc.license,
                    doc.notes,
                    arrangement,
                    doc.theme_id,
                    now,
                    revision,
                    doc.audio_media_id,
                    doc.cover_media_id,
                    lyric_sync
                ],
            )?;
            write_children(tx, &id, &doc)?;
            sync::enqueue(tx, sync::ENTITY_SONG, &id, sync::OP_UPSERT, revision)?;
            Ok(id)
        }
        None => {
            let id = doc.id.clone().unwrap_or_else(new_id);
            tx.execute(
                "INSERT INTO songs (id, title, artist, original_key, tempo, language, category, copyright_holder,
                   copyright_year, ccli_number, source, license, notes, arrangement, theme_id, created_at, updated_at,
                   audio_media_id, cover_media_id, lyric_sync)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16, ?17, ?18, ?19)",
                params![
                    id,
                    doc.title,
                    doc.artist,
                    doc.original_key,
                    doc.tempo,
                    doc.language,
                    doc.category,
                    doc.copyright_holder,
                    doc.copyright_year,
                    doc.ccli_number,
                    doc.source,
                    doc.license,
                    doc.notes,
                    arrangement,
                    doc.theme_id,
                    now,
                    doc.audio_media_id,
                    doc.cover_media_id,
                    lyric_sync
                ],
            )?;
            write_children(tx, &id, &doc)?;
            sync::enqueue(tx, sync::ENTITY_SONG, &id, sync::OP_UPSERT, 1)?;
            Ok(id)
        }
    }
}

/// Gives every section a new id and remaps the arrangement to match, so a
/// copied or imported song never shares section rows with another song.
pub fn reassign_section_ids(doc: &mut SongDocument) {
    let mut map = std::collections::HashMap::new();
    for s in doc.sections.iter_mut() {
        let fresh = new_id();
        if let Some(old) = s.id.replace(fresh.clone()) {
            map.insert(old, fresh);
        }
    }
    if let Some(arr) = doc.arrangement.as_mut() {
        arr.retain(|a| map.contains_key(a));
        for a in arr.iter_mut() {
            if let Some(n) = map.get(a) {
                *a = n.clone();
            }
        }
    }
}

pub fn duplicate_song(conn: &mut Connection, id: &str) -> Result<Song> {
    let song = get_song(conn, id)?;
    let mut doc = to_document(&song);
    doc.id = None;
    doc.title = format!("{} (Copy)", song.title);
    reassign_section_ids(&mut doc);
    save_song(conn, doc)
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool) -> Result<()> {
    let n = conn.execute(
        "UPDATE songs SET archived_at = CASE WHEN ?2 THEN ?3 ELSE NULL END, updated_at = ?3
         WHERE id = ?1 AND deleted_at IS NULL",
        params![id, archived, now_iso()],
    )?;
    if n == 0 {
        return Err(Error::not_found("The song was not found."));
    }
    Ok(())
}

pub fn set_favorite(conn: &Connection, id: &str, favorite: bool) -> Result<()> {
    conn.execute("UPDATE songs SET is_favorite = ?2 WHERE id = ?1", params![id, favorite])?;
    Ok(())
}

pub fn record_use(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE songs SET use_count = use_count + 1, last_used_at = ?2 WHERE id = ?1",
        params![id, now_iso()],
    )?;
    Ok(())
}

/// Soft-deletes a song, leaving a tombstone so the deletion can synchronize.
pub fn delete_song(conn: &mut Connection, id: &str) -> Result<()> {
    let tx = conn.transaction()?;
    let revision: Option<i64> = tx
        .query_row("SELECT revision FROM songs WHERE id = ?1 AND deleted_at IS NULL", [id], |r| r.get(0))
        .optional()?;
    let Some(revision) = revision else {
        return Err(Error::not_found("The song was not found."));
    };
    let now = now_iso();
    tx.execute(
        "UPDATE songs SET deleted_at = ?2, updated_at = ?2, revision = ?3 WHERE id = ?1",
        params![id, now, revision + 1],
    )?;
    tx.execute("DELETE FROM songs_fts WHERE song_id = ?1", [id])?;
    sync::enqueue(&tx, sync::ENTITY_SONG, id, sync::OP_DELETE, revision + 1)?;
    tx.commit()?;
    Ok(())
}

pub fn list_songs(conn: &Connection, q: &SongQuery) -> Result<SongListResult> {
    let mut where_sql = vec!["s.deleted_at IS NULL".to_string()];
    let mut args: Vec<Box<dyn ToSql>> = Vec::new();

    if q.archived_only {
        where_sql.push("s.archived_at IS NOT NULL".into());
    } else if !q.include_archived {
        where_sql.push("s.archived_at IS NULL".into());
    }
    if q.favorites_only {
        where_sql.push("s.is_favorite = 1".into());
    }
    if let Some(c) = q.category.as_ref().filter(|c| !c.is_empty()) {
        args.push(Box::new(c.clone()));
        where_sql.push(format!("s.category = ?{}", args.len()));
    }
    if let Some(l) = q.language.as_ref().filter(|l| !l.is_empty()) {
        args.push(Box::new(l.clone()));
        where_sql.push(format!("s.language = ?{}", args.len()));
    }
    if let Some(t) = q.tag.as_ref().filter(|t| !t.is_empty()) {
        args.push(Box::new(t.clone()));
        where_sql.push(format!("EXISTS (SELECT 1 FROM song_tags t WHERE t.song_id = s.id AND t.tag = ?{})", args.len()));
    }

    let mut join = String::new();
    let match_expr = q.text.as_deref().and_then(fts_query).map(|expr| match q.field {
        Some(f) => expr.split(' ').map(|term| format!("{} : {term}", f.column())).collect::<Vec<_>>().join(" "),
        None => expr,
    });
    if let Some(expr) = &match_expr {
        args.push(Box::new(expr.clone()));
        join = format!(
            "JOIN (SELECT song_id, bm25(songs_fts, 0.0, 10.0, 4.0, 1.0, 3.0) AS rank
                   FROM songs_fts WHERE songs_fts MATCH ?{}) f ON f.song_id = s.id",
            args.len()
        );
    }

    let where_clause = where_sql.join(" AND ");
    let order = match q.sort {
        SongSort::Relevance if match_expr.is_some() => "f.rank, s.title COLLATE NOCASE",
        SongSort::Recent => "s.last_used_at IS NULL, s.last_used_at DESC, s.title COLLATE NOCASE",
        SongSort::Updated => "s.updated_at DESC",
        _ => "s.title COLLATE NOCASE",
    };

    let total: u32 = conn.query_row(
        &format!("SELECT COUNT(*) FROM songs s {join} WHERE {where_clause}"),
        rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())),
        |r| r.get(0),
    )?;

    let limit = q.limit.unwrap_or(200).min(1000);
    let offset = q.offset.unwrap_or(0);
    let sql = format!(
        "SELECT s.id, s.title, s.artist, s.category, s.language, s.is_favorite, s.archived_at, s.copyright_holder,
                s.ccli_number, s.license, s.last_used_at, s.updated_at,
                (SELECT lyrics FROM song_sections ss WHERE ss.song_id = s.id ORDER BY ss.position LIMIT 1),
                (SELECT group_concat(tag, char(31)) FROM song_tags st WHERE st.song_id = s.id)
         FROM songs s {join}
         WHERE {where_clause}
         ORDER BY {order}
         LIMIT {limit} OFFSET {offset}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter().map(|a| a.as_ref())), |r| {
        let holder: Option<String> = r.get(7)?;
        let ccli: Option<String> = r.get(8)?;
        let license: Option<String> = r.get(9)?;
        let first: Option<String> = r.get(12)?;
        let tags: Option<String> = r.get(13)?;
        Ok(SongSummary {
            id: r.get(0)?,
            title: r.get(1)?,
            artist: r.get(2)?,
            category: r.get(3)?,
            language: r.get(4)?,
            is_favorite: r.get(5)?,
            archived: r.get::<_, Option<String>>(6)?.is_some(),
            missing_copyright: missing_copyright(&holder, &ccli, &license),
            last_used_at: r.get(10)?,
            updated_at: r.get(11)?,
            first_line: first.as_deref().and_then(first_non_empty_line),
            tags: tags.map(|t| t.split('\u{1f}').map(str::to_string).collect()).unwrap_or_default(),
        })
    })?;
    Ok(SongListResult { items: rows.collect::<std::result::Result<_, _>>()?, total })
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SongFacets {
    pub tags: Vec<String>,
    pub categories: Vec<String>,
    pub languages: Vec<String>,
}

pub fn facets(conn: &Connection) -> Result<SongFacets> {
    let collect = |sql: &str| -> Result<Vec<String>> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    };
    Ok(SongFacets {
        tags: collect(
            "SELECT DISTINCT t.tag FROM song_tags t JOIN songs s ON s.id = t.song_id
             WHERE s.deleted_at IS NULL ORDER BY t.tag COLLATE NOCASE",
        )?,
        categories: collect(
            "SELECT DISTINCT category FROM songs WHERE deleted_at IS NULL AND category IS NOT NULL
             ORDER BY category COLLATE NOCASE",
        )?,
        languages: collect(
            "SELECT DISTINCT language FROM songs WHERE deleted_at IS NULL AND language IS NOT NULL
             ORDER BY language COLLATE NOCASE",
        )?,
    })
}

/// Index of existing songs used to detect duplicates during import.
pub struct DuplicateIndex {
    entries: Vec<(String, String, String, Option<String>)>, // id, title, norm title, norm first line
}

impl DuplicateIndex {
    pub fn load(conn: &Connection) -> Result<Self> {
        let mut stmt = conn.prepare(
            "SELECT s.id, s.title,
                    (SELECT lyrics FROM song_sections ss WHERE ss.song_id = s.id ORDER BY ss.position LIMIT 1)
             FROM songs s WHERE s.deleted_at IS NULL",
        )?;
        let rows = stmt.query_map([], |r| {
            let id: String = r.get(0)?;
            let title: String = r.get(1)?;
            let lyrics: Option<String> = r.get(2)?;
            Ok((id, title.clone(), normalize_for_compare(&title), lyrics.as_deref().and_then(first_non_empty_line).map(|l| normalize_for_compare(&l))))
        })?;
        Ok(Self { entries: rows.collect::<std::result::Result<_, _>>()? })
    }

    /// Existing songs with the same normalized title or the same first lyric line.
    pub fn matches(&self, doc: &SongDocument) -> Vec<(String, String)> {
        let title = normalize_for_compare(&doc.title);
        let first = doc
            .sections
            .first()
            .and_then(|s| first_non_empty_line(&s.lyrics))
            .map(|l| normalize_for_compare(&l))
            .filter(|l| l.len() >= 8);
        self.entries
            .iter()
            .filter(|(id, _, t, f)| {
                doc.id.as_deref() == Some(id.as_str())
                    || *t == title
                    || (first.is_some() && f.is_some() && *f == first)
            })
            .map(|(id, t, _, _)| (id.clone(), t.clone()))
            .collect()
    }

    pub fn add(&mut self, id: &str, doc: &SongDocument) {
        let first = doc.sections.first().and_then(|s| first_non_empty_line(&s.lyrics)).map(|l| normalize_for_compare(&l));
        self.entries.push((id.to_string(), doc.title.clone(), normalize_for_compare(&doc.title), first));
    }
}

/// Parses plain-text lyrics with optional section headers such as
/// `[Verse 1]`, `Chorus:` or `Koro`. Blank lines inside a section are kept as
/// slide breaks.
pub fn parse_lyrics_text(text: &str) -> Vec<SongSectionInput> {
    let mut sections: Vec<SongSectionInput> = Vec::new();
    let mut current: Option<SongSectionInput> = None;
    let mut lines: Vec<String> = Vec::new();

    let flush = |current: &mut Option<SongSectionInput>, lines: &mut Vec<String>, out: &mut Vec<SongSectionInput>| {
        let body = lines.join("\n").trim_matches('\n').to_string();
        lines.clear();
        match current.take() {
            Some(mut s) => {
                s.lyrics = body;
                out.push(s);
            }
            None if !body.trim().is_empty() => {
                out.push(SongSectionInput::new(SectionKind::Verse, String::new(), body));
            }
            None => {}
        }
    };

    for raw in text.replace("\r\n", "\n").lines() {
        let line = raw.trim_end();
        if let Some((kind, label)) = parse_section_header(line) {
            flush(&mut current, &mut lines, &mut sections);
            current = Some(SongSectionInput::new(kind, label, String::new()));
        } else {
            lines.push(line.to_string());
        }
    }
    flush(&mut current, &mut lines, &mut sections);
    // Paragraph-only text (no headers) becomes one verse per paragraph.
    if sections.len() == 1 && sections[0].label.is_empty() && sections[0].lyrics.contains("\n\n") {
        let body = sections.remove(0).lyrics;
        for para in body.split("\n\n").map(str::trim).filter(|p| !p.is_empty()) {
            sections.push(SongSectionInput::new(SectionKind::Verse, String::new(), para));
        }
    }
    sections
}

pub fn kind_from_label(label: &str) -> SectionKind {
    let l = label.trim().to_lowercase();
    let word: String = l.chars().take_while(|c| c.is_alphabetic() || *c == '-' || *c == ' ').collect();
    match word.trim().replace(['-', ' '], "").as_str() {
        "intro" => SectionKind::Intro,
        "verse" | "v" | "berso" | "talata" | "estrofa" | "verso" => SectionKind::Verse,
        "prechorus" | "pre" | "pc" => SectionKind::Prechorus,
        "chorus" | "c" | "refrain" | "koro" | "coro" => SectionKind::Chorus,
        "bridge" | "b" | "tulay" | "puente" => SectionKind::Bridge,
        "interlude" | "instrumental" => SectionKind::Interlude,
        "tag" => SectionKind::Tag,
        "outro" => SectionKind::Outro,
        "ending" | "end" | "coda" => SectionKind::Ending,
        _ => SectionKind::Custom,
    }
}

fn parse_section_header(line: &str) -> Option<(SectionKind, String)> {
    let t = line.trim();
    if t.len() >= 3 && t.starts_with('[') && t.ends_with(']') {
        let label = t[1..t.len() - 1].trim().to_string();
        if label.is_empty() {
            return None;
        }
        return Some((kind_from_label(&label), label));
    }
    // Unbracketed headers must look exactly like "Verse 2", "Chorus:" or "Pre-Chorus 1".
    let label = t.trim_end_matches(':').trim();
    if label.is_empty() || label.len() > 24 {
        return None;
    }
    let mut parts = label.rsplitn(2, ' ');
    let last = parts.next().unwrap_or("");
    let (name, has_number) = if last.chars().all(|c| c.is_ascii_digit()) && !last.is_empty() {
        (parts.next().unwrap_or(""), true)
    } else {
        (label, false)
    };
    let kind = kind_from_label(name);
    let lname = name.trim().to_lowercase().replace(['-', ' '], "");
    let single_letter = lname.len() <= 2;
    if kind == SectionKind::Custom || (single_letter && !has_number && !t.ends_with(':')) {
        return None;
    }
    Some((kind, label.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    pub(crate) fn sample(title: &str) -> SongDocument {
        SongDocument {
            id: None,
            title: title.into(),
            artist: Some("Test Writer".into()),
            original_key: None,
            tempo: None,
            language: Some("en".into()),
            category: Some("Worship".into()),
            copyright_holder: Some("Example Music".into()),
            copyright_year: None,
            ccli_number: None,
            source: None,
            license: None,
            notes: None,
            arrangement: None,
            theme_id: None,
            audio_media_id: None,
            cover_media_id: None,
            lyric_sync: None,
            tags: vec!["Praise".into(), "praise".into(), " Opening ".into()],
            sections: vec![
                SongSectionInput::new(SectionKind::Verse, String::new(), "First line here\nSecond line\n\nThird line"),
                SongSectionInput::new(SectionKind::Chorus, String::new(), "Sing along now\nEveryone"),
                SongSectionInput::new(SectionKind::Verse, String::new(), "Another verse\nfor the test"),
            ],
        }
    }

    #[test]
    fn create_edit_and_reorder_sections() {
        let db = Database::open_in_memory().unwrap();
        let song = db.write(|c| save_song(c, sample("Test Song"))).unwrap();
        assert_eq!(song.sections.len(), 3);
        assert_eq!(song.sections[0].label, "Verse 1");
        assert_eq!(song.sections[2].label, "Verse 2");
        assert_eq!(song.tags, vec!["Opening".to_string(), "Praise".to_string()]);
        assert_eq!(song.revision, 1);

        // Reorder: chorus first, and set an arrangement with a repeat.
        let mut doc = to_document(&song);
        doc.sections.swap(0, 1);
        let chorus = doc.sections[0].id.clone().unwrap();
        let v1 = doc.sections[1].id.clone().unwrap();
        doc.arrangement = Some(vec![v1.clone(), chorus.clone(), chorus.clone()]);
        let updated = db.write(|c| save_song(c, doc.clone())).unwrap();
        assert_eq!(updated.sections[0].kind, SectionKind::Chorus);
        assert_eq!(updated.arrangement.as_ref().unwrap().len(), 3);
        assert_eq!(updated.revision, 2);

        // Saving identical content does not bump the revision.
        let same = db.write(|c| save_song(c, to_document(&updated))).unwrap();
        assert_eq!(same.revision, 2);

        // Unknown section in arrangement is rejected.
        let mut bad = to_document(&updated);
        bad.arrangement = Some(vec![new_id()]);
        assert!(db.write(|c| save_song(c, bad)).is_err());
    }

    #[test]
    fn search_by_title_artist_tag_and_lyrics() {
        let db = Database::open_in_memory().unwrap();
        db.write(|c| save_song(c, sample("Morning Light"))).unwrap();
        let mut other = sample("Ikaw Lamang");
        other.artist = Some("Banda".into());
        other.language = Some("tl".into());
        other.tags = vec!["Pagsamba".into()];
        other.sections[0].lyrics = "Ikaw lamang ang aking sasambahin".into();
        db.write(|c| save_song(c, other)).unwrap();

        let q = |text: &str| SongQuery { text: Some(text.into()), ..Default::default() };
        assert_eq!(db.read(|c| list_songs(c, &q("morn"))).unwrap().total, 1);
        assert_eq!(db.read(|c| list_songs(c, &q("sasambahin"))).unwrap().items[0].title, "Ikaw Lamang");
        assert_eq!(db.read(|c| list_songs(c, &q("banda"))).unwrap().total, 1);
        assert_eq!(db.read(|c| list_songs(c, &q("pagsamba"))).unwrap().total, 1);
        let by_title = SongQuery { text: Some("sing".into()), field: Some(SongSearchField::Title), ..Default::default() };
        assert_eq!(db.read(|c| list_songs(c, &by_title)).unwrap().total, 0);
        let by_lyrics = SongQuery { text: Some("sing".into()), field: Some(SongSearchField::Lyrics), ..Default::default() };
        // Both sample songs share the chorus "Sing along now".
        assert_eq!(db.read(|c| list_songs(c, &by_lyrics)).unwrap().total, 2);
        let tl = SongQuery { language: Some("tl".into()), ..Default::default() };
        assert_eq!(db.read(|c| list_songs(c, &tl)).unwrap().total, 1);
        let tag = SongQuery { tag: Some("praise".into()), ..Default::default() };
        assert_eq!(db.read(|c| list_songs(c, &tag)).unwrap().total, 1);
        let f = db.read(facets).unwrap();
        assert_eq!(f.languages, vec!["en".to_string(), "tl".to_string()]);
    }

    #[test]
    fn archive_favorite_delete_duplicate() {
        let db = Database::open_in_memory().unwrap();
        let song = db.write(|c| save_song(c, sample("Archive Me"))).unwrap();
        db.write(|c| set_favorite(c, &song.id, true)).unwrap();
        let favs = SongQuery { favorites_only: true, ..Default::default() };
        assert_eq!(db.read(|c| list_songs(c, &favs)).unwrap().total, 1);

        db.write(|c| set_archived(c, &song.id, true)).unwrap();
        assert_eq!(db.read(|c| list_songs(c, &SongQuery::default())).unwrap().total, 0);
        let archived = SongQuery { archived_only: true, ..Default::default() };
        assert_eq!(db.read(|c| list_songs(c, &archived)).unwrap().total, 1);
        db.write(|c| set_archived(c, &song.id, false)).unwrap();

        let copy = db.write(|c| duplicate_song(c, &song.id)).unwrap();
        assert_ne!(copy.id, song.id);
        assert_eq!(copy.title, "Archive Me (Copy)");
        assert!(copy.sections.iter().all(|s| !song.sections.iter().any(|o| o.id == s.id)));

        db.write(|c| delete_song(c, &song.id)).unwrap();
        assert!(db.read(|c| get_song(c, &song.id)).is_err());
        let q = SongQuery { text: Some("archive".into()), ..Default::default() };
        assert_eq!(db.read(|c| list_songs(c, &q)).unwrap().total, 1);
        // The deletion was queued for sync.
        let ops: i64 = db
            .read(|c| Ok(c.query_row("SELECT COUNT(*) FROM sync_outbox WHERE entity_id = ?1 AND operation = 'delete'", [&song.id], |r| r.get(0))?))
            .unwrap();
        assert_eq!(ops, 1);
    }

    #[test]
    fn outbox_keeps_one_open_operation_per_song() {
        let db = Database::open_in_memory().unwrap();
        let song = db.write(|c| save_song(c, sample("Outbox"))).unwrap();
        let mut doc = to_document(&song);
        doc.notes = Some("changed".into());
        db.write(|c| save_song(c, doc)).unwrap();
        let (count, rev): (i64, i64) = db
            .read(|c| Ok(c.query_row("SELECT COUNT(*), MAX(local_revision) FROM sync_outbox WHERE entity_id = ?1", [&song.id], |r| Ok((r.get(0)?, r.get(1)?)))?))
            .unwrap();
        assert_eq!((count, rev), (1, 2));
    }

    #[test]
    fn duplicate_index_matches_title_or_first_line() {
        let db = Database::open_in_memory().unwrap();
        db.write(|c| save_song(c, sample("Great Is Your Love"))).unwrap();
        let idx = db.read(DuplicateIndex::load).unwrap();
        assert_eq!(idx.matches(&sample("great is your love!")).len(), 1);
        let mut different_title = sample("Another Name");
        different_title.sections[0].lyrics = "First line here".into();
        assert_eq!(idx.matches(&different_title).len(), 1);
        let mut unrelated = sample("Unrelated");
        unrelated.sections[0].lyrics = "Nothing similar at all".into();
        assert!(idx.matches(&unrelated).is_empty());
    }

    #[test]
    fn songs_keep_their_music_and_timed_lyrics() {
        let db = Database::open_in_memory().unwrap();
        let mut doc = sample("With Music");
        doc.audio_media_id = Some("audio-1".into());
        doc.cover_media_id = Some(" cover-1 ".into());
        doc.lyric_sync = Some(vec![
            LyricLine { id: "a".into(), section: "Verse 1".into(), text: " First line ".into(), start_ms: Some(1200), end_ms: Some(4000) },
            LyricLine { id: "a".into(), section: "Verse 1".into(), text: "Second line".into(), start_ms: None, end_ms: None },
            LyricLine { id: "c".into(), section: "Verse 1".into(), text: "   ".into(), start_ms: None, end_ms: None },
        ]);
        let song = db.write(|c| save_song(c, doc.clone())).unwrap();
        assert_eq!(song.audio_media_id.as_deref(), Some("audio-1"));
        assert_eq!(song.cover_media_id.as_deref(), Some("cover-1"));
        let lines = song.lyric_sync.clone().unwrap();
        assert_eq!(lines.len(), 2, "empty lines are dropped");
        assert_eq!(lines[0].text, "First line");
        assert_ne!(lines[0].id, lines[1].id, "duplicate ids are replaced");
        assert_eq!(lines[0].start_ms, Some(1200));
        // Reloads unchanged and saving the same content is not a change.
        let again = db.write(|c| save_song(c, to_document(&song))).unwrap();
        assert_eq!(again.revision, song.revision);

        doc.lyric_sync = Some(vec![LyricLine { id: "x".into(), section: String::new(), text: "Backwards".into(), start_ms: Some(5000), end_ms: Some(1000) }]);
        assert_eq!(db.write(|c| save_song(c, doc.clone())).unwrap_err().code(), "validation");
    }

    #[test]
    fn lines_per_slide_is_stored_per_section_and_validated() {
        let db = Database::open_in_memory().unwrap();
        let mut doc = sample("Line By Line");
        doc.sections[1].lines_per_slide = Some(1);
        let song = db.write(|c| save_song(c, doc)).unwrap();
        assert_eq!(song.sections[0].lines_per_slide, None);
        assert_eq!(song.sections[1].lines_per_slide, Some(1));
        // Changing only the slide size is a real edit.
        let mut edit = to_document(&song);
        edit.sections[1].lines_per_slide = Some(2);
        assert_eq!(db.write(|c| save_song(c, edit)).unwrap().revision, 2);
        let mut bad = to_document(&song);
        bad.sections[0].lines_per_slide = Some(0);
        assert_eq!(db.write(|c| save_song(c, bad)).unwrap_err().code(), "validation");
        // Older clients that do not send the field are accepted.
        let json = serde_json::json!({ "title": "Older", "sections": [{ "kind": "chorus", "lyrics": "a" }] });
        let parsed: SongDocument = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.sections[0].lines_per_slide, None);
    }

    #[test]
    fn parses_plain_text_lyrics() {
        let text = "[Verse 1]\nLine one\nLine two\n\nLine three\n\nChorus:\nSing it\n\n[Tulay]\nBridge line\nKoro\nAwit\n";
        let s = parse_lyrics_text(text);
        assert_eq!(s.len(), 4);
        assert_eq!(s[0].kind, SectionKind::Verse);
        assert_eq!(s[0].label, "Verse 1");
        assert_eq!(s[0].lyrics, "Line one\nLine two\n\nLine three");
        assert_eq!(s[1].kind, SectionKind::Chorus);
        assert_eq!(s[2].kind, SectionKind::Bridge);
        assert_eq!(s[3].kind, SectionKind::Chorus);

        let plain = parse_lyrics_text("Para one\nline\n\nPara two\nline");
        assert_eq!(plain.len(), 2);
        // A lyric line that merely starts with a section word is not a header.
        let tricky = parse_lyrics_text("[Verse]\nVerse of my heart\nChorus of angels sing");
        assert_eq!(tricky.len(), 1);
    }

    #[test]
    fn unicode_lyrics_round_trip() {
        let db = Database::open_in_memory().unwrap();
        let mut doc = sample("Señor, Ikaw ay Dakila");
        doc.sections[0].lyrics = "Ñandú — “quoted” 你好 🎵".into();
        let song = db.write(|c| save_song(c, doc)).unwrap();
        assert_eq!(song.sections[0].lyrics, "Ñandú — “quoted” 你好 🎵");
        let q = SongQuery { text: Some("senor".into()), ..Default::default() };
        assert_eq!(db.read(|c| list_songs(c, &q)).unwrap().total, 1, "diacritics are folded");
    }
}
