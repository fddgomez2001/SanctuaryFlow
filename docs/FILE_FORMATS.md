# Import file formats

## Bible text

All formats are validated against the 66-book catalog before anything is stored. Book names may be English names, common abbreviations, USFM codes (`GEN`, `1CO`) or OSIS ids (`Gen`, `1Cor`).

### USFM

One file per book (`.usfm`, `.sfm`), a folder of files, or a `.zip`. `\id` identifies the book; `\h` / `\toc1-3` give the translation's own book names; `\c` and `\v` give chapters and verses. Combined verses (`\v 1-2`) are stored once with a verse range. Segments (`\v 5a`, `\v 5b`) are joined. Headings, introductions, footnotes (`\f … \f*`), cross references (`\x … \x*`), figures and alternate verse numbers are not verse text. Word attributes (`\w word|strong="H1"\w*`) keep only the word; `\nd` (divine name) is shown in capitals.

### USX (2 and 3)

`<book code="GEN">`, `<chapter number="1"/>`, `<verse number="1" sid="…"/>`. Paragraph styles for headings and introductions, `<note>` and `<figure>` are excluded.

### OSIS XML

`<div type="book" osisID="Gen">`, container chapters/verses or milestones (`sID`/`eID`). `osisID="Gen.1.1 Gen.1.2"` is a combined verse. `<note>`, `<title>` and `<rdg>` are excluded; `<divineName>` is shown in capitals. The `<work>` header supplies the title, language, rights and versification.

### SanctuaryFlow JSON

```json
{
  "format": "sanctuaryflow-bible",
  "version": 1,
  "translation": { "code": "ABC", "name": "Example Translation", "language": "en", "license": "…" },
  "books": [
    { "id": "GEN", "name": "Genesis", "chapters": [
      { "chapter": 1, "verses": [ { "verse": 1, "text": "…" }, { "verse": 2, "verseEnd": 3, "text": "…" } ] }
    ] }
  ]
}
```

Also accepted: a flat list `[{"book": "Genesis", "chapter": 1, "verse": 1, "text": "…"}]` (or `{"verses": [...]}`), a list of books with chapter arrays `[{"name": "Genesis", "chapters": [["v1", "v2"], …]}]`, and book-keyed objects `{"Genesis": {"1": {"1": "…"}}}`. Numeric books are read in Protestant order (1 = Genesis).

### CSV

A header row with `book`, `chapter`, `verse`, `text` (aliases `b`, `c`, `v`, `t`; optional `verse_end`). The verse column may hold a range such as `2-3`. Comma, semicolon and tab separators are detected. Save as UTF-8.

## Songs

### SanctuaryFlow songs JSON

```json
{ "format": "sanctuaryflow-songs", "version": 1, "songs": [
  { "title": "…", "artist": "…", "language": "en", "tags": ["…"], "copyrightHolder": "…", "ccliNumber": "…",
    "sections": [ { "kind": "verse", "label": "Verse 1", "lyrics": "line\nline\n\nnew slide" } ],
    "arrangement": null }
] }
```

Section kinds: `intro`, `verse`, `prechorus`, `chorus`, `bridge`, `interlude`, `tag`, `outro`, `ending`, `custom`.

### Songs CSV

Header row with `title` (required) and any of `artist, original_key, tempo, language, category, tags, copyright_holder, copyright_year, ccli_number, source, license, notes, lyrics`. Separate tags with `;`. In `lyrics`, use `[Section]` headers and blank lines for slide breaks. Exports include a UTF-8 byte-order mark so spreadsheet programs keep accents.

## Services and libraries

- **Service file** (`*.sfservice.json`, format `sanctuaryflow-service`): the plan plus the songs, slide decks and custom themes it uses. Media is referenced by checksum and matched to local files.
- **Library file** (format `sanctuaryflow-library`): all songs, services, templates, slide decks and custom themes. Importing adds what is missing and never overwrites.
- **Backup** (`*.sfbackup`): a zip with `manifest.json`, `database.sqlite3` and optional `media/`. Use Backup & Restore to create and restore these.
