//! Import, validation and lookup tests. Fixture text below is synthetic test
//! data, not Scripture, except where noted as public-domain KJV wording.

use super::*;
use crate::bible::validate::ValidationStatus;
use crate::bible::{self, BibleSearchQuery, PassageRef};
use crate::db::Database;

fn src(name: &str, text: &str) -> Vec<SourceText> {
    vec![SourceText { name: name.into(), text: text.into() }]
}

fn meta(code: &str) -> TranslationMetadataInput {
    TranslationMetadataInput {
        code: code.into(),
        name: format!("{code} Test Translation"),
        language: "en".into(),
        license_name: Some("Public Domain".into()),
        offline_permitted: Some(true),
        ..Default::default()
    }
}

fn opts(code: &str) -> ImportOptions {
    ImportOptions { metadata: meta(code), replace_existing: false, acknowledge_exclusions: true }
}

fn source(format: SourceFormat) -> ImportSource {
    ImportSource { kind: "file".into(), format, path: Some("test".into()), provider: None, checksum: None }
}

fn import(db: &Database, parsed: &ParsedBible, format: SourceFormat, options: ImportOptions) -> Result<ImportResult> {
    db.write(|c| commit(c, parsed, &source(format), options, &|_, _| {}))
}

fn passage(book: &str, ch: u32, vs: Option<u32>, ve: Option<u32>) -> PassageRef {
    PassageRef { book_id: book.into(), chapter: ch, verse_start: vs, chapter_end: None, verse_end: ve }
}

const SF_JSON: &str = r#"{
  "format": "sanctuaryflow-bible",
  "version": 1,
  "translation": { "code": "TST", "name": "Test Bible", "language": "en", "license": "CC0" },
  "books": [
    { "id": "JHN", "name": "John", "chapters": [
      { "chapter": 3, "verses": [
        { "verse": 16, "text": "Test text for three sixteen." },
        { "verse": 17, "text": "Test text for three seventeen." }
      ] }
    ] },
    { "id": "PSA", "name": "Psalms", "chapters": [
      { "chapter": 23, "verses": [
        { "verse": 1, "text": "Psalm line one." },
        { "verse": 2, "verseEnd": 3, "text": "Psalm lines two and three combined." },
        { "verse": 4, "text": "Psalm line four." }
      ] }
    ] }
  ]
}"#;

#[test]
fn json_sanctuaryflow_format_round_trip() {
    let sources = src("bible.json", SF_JSON);
    assert_eq!(detect_format(&sources).unwrap(), SourceFormat::Json);
    let parsed = parse_sources(SourceFormat::Json, &sources).unwrap();
    assert_eq!(parsed.metadata.code.as_deref(), Some("TST"));
    assert_eq!(parsed.verses.len(), 5);

    let db = Database::open_in_memory().unwrap();
    let preview = db.read(|c| build_preview(c, SourceFormat::Json, "bible.json", "x".into(), &parsed)).unwrap();
    assert_eq!(preview.report.status, ValidationStatus::Incomplete, "two books are not a complete Bible");
    assert_eq!(preview.report.missing_books.len(), 64);

    let r = import(&db, &parsed, SourceFormat::Json, opts("TST")).unwrap();
    assert_eq!(r.verses_imported, 5);
    let t = db.read(|c| bible::get_translation(c, &r.translation_id)).unwrap();
    assert_eq!(t.validation_status, "incomplete");
    assert_eq!(t.import_status, "imported");
    assert_eq!((t.book_count, t.verse_count), (2, 5));

    // Single verse, range, and a combined source verse inside a range.
    let p = db.read(|c| bible::get_passage(c, &r.translation_id, &passage("JHN", 3, Some(16), None))).unwrap();
    assert_eq!(p.verses.len(), 1);
    assert_eq!(p.book_name, "John");
    let p = db.read(|c| bible::get_passage(c, &r.translation_id, &passage("PSA", 23, Some(3), Some(4)))).unwrap();
    assert_eq!(p.verses.iter().map(|v| v.verse).collect::<Vec<_>>(), vec![2, 4], "verse 3 lives in the combined 2-3 record");
    let whole = db.read(|c| bible::get_passage(c, &r.translation_id, &passage("PSA", 23, None, None))).unwrap();
    assert_eq!(whole.verses.len(), 3);
    // Missing text is a clear error, not an empty passage.
    let missing = db.read(|c| bible::get_passage(c, &r.translation_id, &passage("GEN", 1, Some(1), None)));
    assert_eq!(missing.unwrap_err().code(), "not_found");
    let backwards = db.read(|c| bible::get_passage(c, &r.translation_id, &passage("PSA", 23, Some(4), Some(1))));
    assert_eq!(backwards.unwrap_err().code(), "validation");
}

#[test]
fn json_flat_and_nested_layouts() {
    let flat = r#"{"metadata": {"name": "Flat"}, "verses": [
        {"book_name": "Genesis", "book": 1, "chapter": 1, "verse": 1, "text": "a"},
        {"book_name": "Genesis", "book": 1, "chapter": 1, "verse": 2, "text": "b"},
        {"book": 43, "chapter": 1, "verse": 1, "text": "c"}
    ]}"#;
    let p = parse_sources(SourceFormat::Json, &src("f.json", flat)).unwrap();
    assert_eq!(p.verses.len(), 3);
    assert_eq!(p.verses[2].book_id, "JHN");
    assert!(p.issues.iter().any(|i| i.code == "numeric_books"));

    let nested = r#"[{"abbrev": "gn", "name": "Genesis", "chapters": [["one", "two"], ["three"]]}]"#;
    let p = parse_sources(SourceFormat::Json, &src("n.json", nested)).unwrap();
    assert_eq!(p.verses.iter().map(|v| (v.chapter, v.verse)).collect::<Vec<_>>(), vec![(1, 1), (1, 2), (2, 1)]);

    let keyed = r#"{"Ruth": {"1": {"1": "r1", "2": "r2"}, "2": {"1": "r3"}}}"#;
    let p = parse_sources(SourceFormat::Json, &src("k.json", keyed)).unwrap();
    assert_eq!(p.verses.len(), 3);
    assert_eq!(p.verses[0].book_id, "RUT");

    assert!(parse_sources(SourceFormat::Json, &src("bad.json", "{\"hello\": 1}")).is_err());
    assert!(parse_sources(SourceFormat::Json, &src("bad.json", "{not json")).is_err());
}

#[test]
fn csv_with_semicolons_ranges_and_bad_rows() {
    let csv = "Book;Chapter;Verse;Text\nGEN;1;1;Alpha\nGEN;1;2-3;Beta gamma\nGenesis;1;x;Bad row\n1 John;1;1;\"Quoted; text\"\n";
    let sources = src("bible.csv", csv);
    assert_eq!(detect_format(&sources).unwrap(), SourceFormat::Csv);
    let p = parse_sources(SourceFormat::Csv, &sources).unwrap();
    assert_eq!(p.verses.len(), 3);
    assert_eq!(p.verses[1].verse_end, Some(3));
    assert_eq!(p.verses[2].book_id, "1JN");
    assert_eq!(p.verses[2].text, "Quoted; text");
    assert!(p.issues.iter().any(|i| i.code == "bad_row" && i.severity == Severity::Error));

    let missing_cols = "Book,Text\nGEN,hello\n";
    assert!(parse_sources(SourceFormat::Csv, &src("x.csv", missing_cols)).is_err());
}

const OSIS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">
<osisText osisIDWork="KJVT" xml:lang="en">
<header>
  <work osisWork="KJVT">
    <title>King James Test Edition</title>
    <rights>Public Domain</rights>
    <refSystem>Bible.KJV</refSystem>
  </work>
</header>
<div type="book" osisID="Gen">
  <title type="main">GENESIS</title>
  <chapter osisID="Gen.1">
    <verse osisID="Gen.1.1">In the beginning God created the heaven and the earth.</verse>
    <verse sID="Gen.1.2" osisID="Gen.1.2"/>And the earth was without form<note type="study">A note that must not appear</note>, and void.<verse eID="Gen.1.2"/>
    <verse osisID="Gen.1.3 Gen.1.4">Combined &amp; joined <divineName>Lord</divineName> text&#x2019;s here.</verse>
  </chapter>
</div>
<div type="book" osisID="Tob">
  <chapter osisID="Tob.1"><verse osisID="Tob.1.1">Not in the catalog.</verse></chapter>
</div>
</osisText>
</osis>"#;

#[test]
fn osis_container_milestone_and_combined_verses() {
    let sources = src("kjv.xml", OSIS);
    assert_eq!(detect_format(&sources).unwrap(), SourceFormat::Osis);
    let p = parse_sources(SourceFormat::Osis, &sources).unwrap();
    assert_eq!(p.metadata.code.as_deref(), Some("KJVT"));
    assert_eq!(p.metadata.name.as_deref(), Some("King James Test Edition"));
    assert_eq!(p.metadata.copyright_notice.as_deref(), Some("Public Domain"));
    assert_eq!(p.metadata.versification.as_deref(), Some("Bible.KJV"));
    assert_eq!(p.verses.len(), 3);
    assert_eq!(p.verses[0].text, "In the beginning God created the heaven and the earth.");
    assert_eq!(p.verses[1].text, "And the earth was without form, and void.");
    assert_eq!(p.verses[2].verse, 3);
    assert_eq!(p.verses[2].verse_end, Some(4));
    assert_eq!(p.verses[2].text, "Combined & joined LORD text\u{2019}s here.");
    assert_eq!(p.unknown_books.get("Tob"), Some(&1));

    let report = validate::validate(&p, canon::protestant());
    assert_eq!(report.excluded_verses, 1);
    assert!(report.issues.iter().any(|i| i.code == "book_not_in_canon"));

    // Exclusions must be acknowledged before import.
    let db = Database::open_in_memory().unwrap();
    let mut o = opts("KJVT");
    o.acknowledge_exclusions = false;
    assert_eq!(import(&db, &p, SourceFormat::Osis, o).unwrap_err().code(), "validation");
    assert!(import(&db, &p, SourceFormat::Osis, opts("KJVT")).is_ok());
}

const USFM_GEN: &str = "\\id GEN Test Edition\n\\h Genesis\n\\toc1 The First Book of Moses\n\\toc2 Genesis\n\\toc3 Gen\n\\mt1 GENESIS\n\\c 1\n\\s1 The Creation\n\\p\n\\v 1 In the \\w beginning|strong=\"H7225\"\\w* \\nd Lord\\nd* made\\f + \\fr 1:1 \\ft A footnote.\\f* all.\n\\q1 \\v 2-3 Second and third\n\\q2 joined.\n\\v 4a Part one\n\\v 4b part two.\n\\c 2\n\\p\n\\v 1 Chapter two\\x - \\xo 2:1 \\xt John 1:1\\x* text.\n";
const USFM_TOB: &str = "\\id TOB\n\\c 1\n\\v 1 Deuterocanonical text.\n\\v 2 More.\n";

#[test]
fn usfm_markers_notes_names_and_segments() {
    let sources = vec![
        SourceText { name: "01-GEN.usfm".into(), text: USFM_GEN.into() },
        SourceText { name: "TOB.usfm".into(), text: USFM_TOB.into() },
    ];
    assert_eq!(detect_format(&sources).unwrap(), SourceFormat::Usfm);
    let p = parse_sources(SourceFormat::Usfm, &sources).unwrap();
    assert_eq!(p.books.len(), 1);
    assert_eq!(p.books[0].name.as_deref(), Some("Genesis"));
    assert_eq!(p.books[0].abbreviation.as_deref(), Some("Gen"));
    let texts: Vec<(u32, u32, Option<u32>, &str)> =
        p.verses.iter().map(|v| (v.chapter, v.verse, v.verse_end, v.text.as_str())).collect();
    assert_eq!(
        texts,
        vec![
            (1, 1, None, "In the beginning LORD made all."),
            (1, 2, Some(3), "Second and third joined."),
            (1, 4, None, "Part one part two."),
            (2, 1, None, "Chapter two text."),
        ]
    );
    assert_eq!(p.unknown_books.get("TOB"), Some(&2));
    assert!(p.issues.iter().any(|i| i.code == "headings_skipped"));
    assert!(p.issues.iter().any(|i| i.code == "notes_skipped"));
    assert!(p.issues.iter().any(|i| i.code == "merged_segments"));
}

const USX: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<usx version="3.0">
  <book code="MRK" style="id">Test Edition</book>
  <para style="h">Mark</para>
  <para style="toc2">Mark</para>
  <para style="mt1">MARK</para>
  <chapter number="1" style="c" sid="MRK 1"/>
  <para style="s1">A heading</para>
  <para style="p">
    <verse number="1" style="v" sid="MRK 1:1"/>The beginning of the <char style="nd">Lord</char>'s test.<note caller="+" style="f"><char style="ft">Note.</char></note><verse eid="MRK 1:1"/>
    <verse number="2" style="v" sid="MRK 1:2"/>Second <char style="w" strong="G1">verse</char>.<verse eid="MRK 1:2"/>
  </para>
  <chapter eid="MRK 1"/>
  <chapter number="2" style="c" sid="MRK 2"/>
  <para style="p"><verse number="1" style="v"/>USX two style verse.</para>
</usx>"#;

#[test]
fn usx_milestones_names_and_notes() {
    let sources = src("MRK.usx", USX);
    assert_eq!(detect_format(&sources).unwrap(), SourceFormat::Usx);
    let p = parse_sources(SourceFormat::Usx, &sources).unwrap();
    assert_eq!(p.books[0].book_id, "MRK");
    assert_eq!(p.books[0].name.as_deref(), Some("Mark"));
    let texts: Vec<&str> = p.verses.iter().map(|v| v.text.as_str()).collect();
    assert_eq!(texts, vec!["The beginning of the LORD's test.", "Second verse.", "USX two style verse."]);
}

#[test]
fn duplicate_verses_make_a_source_invalid() {
    let json = r#"[{"book":"GEN","chapter":1,"verse":1,"text":"a"},{"book":"GEN","chapter":1,"verse":2,"text":"b"},
                  {"book":"GEN","chapter":1,"verse":1,"text":"different"}]"#;
    let p = parse_sources(SourceFormat::Json, &src("d.json", json)).unwrap();
    let report = validate::validate(&p, canon::protestant());
    assert_eq!(report.status, ValidationStatus::Invalid);
    assert_eq!(report.duplicate_verses, 1);
    let db = Database::open_in_memory().unwrap();
    assert_eq!(import(&db, &p, SourceFormat::Json, opts("DUP")).unwrap_err().code(), "validation");
    assert!(db.read(bible::list_translations).unwrap().is_empty());
}

#[test]
fn missing_verses_and_chapters_are_reported() {
    let json = r#"[{"book":"OBA","chapter":1,"verse":1,"text":"a"},{"book":"OBA","chapter":1,"verse":4,"text":"d"},
                  {"book":"JUD","chapter":1,"verse":1,"text":"x"},{"book":"JUD","chapter":2,"verse":1,"text":"y"},
                  {"book":"RUT","chapter":1,"verse":1,"text":"r"},{"book":"RUT","chapter":1,"verse":2,"text":""}]"#;
    let p = parse_sources(SourceFormat::Json, &src("m.json", json)).unwrap();
    let r = validate::validate(&p, canon::protestant());
    assert_eq!(r.missing_verse_numbers, 2);
    assert!(r.issues.iter().any(|i| i.code == "missing_verse_numbers" && i.message.starts_with("Obadiah 1:2-3")));
    assert!(r.issues.iter().any(|i| i.code == "extra_chapters" && i.message.starts_with("Jude")));
    assert!(r.issues.iter().any(|i| i.code == "missing_chapters" && i.message.starts_with("Ruth")));
    assert_eq!(r.empty_verses, 1);
    assert_eq!(r.excluded_verses, 1);
    assert_eq!(r.status, ValidationStatus::Incomplete);
}

/// One synthetic verse in every chapter of the catalog.
fn full_canon(label: &str) -> ParsedBible {
    let mut c = Collector::new();
    for b in &canon::protestant().books {
        c.start_book(&b.id);
        for ch in 1..=b.chapters {
            c.start_chapter(ch);
            c.start_verse(1, None, None);
            c.push_text(&format!("{label} {} {ch}:1", b.id));
            c.end_verse();
        }
    }
    c.finish()
}

#[test]
fn complete_only_when_every_book_and_chapter_is_present() {
    let full = full_canon("Alpha");
    let r = validate::validate(&full, canon::protestant());
    assert_eq!(r.status, ValidationStatus::Complete);
    assert_eq!((r.books_found, r.chapters_found, r.verses_found), (66, 1189, 1189));

    let mut partial = full_canon("Alpha");
    partial.verses.retain(|v| !(v.book_id == "PSA" && v.chapter == 119));
    let r = validate::validate(&partial, canon::protestant());
    assert_eq!(r.status, ValidationStatus::Incomplete);
    assert_eq!(r.books.iter().find(|b| b.book_id == "PSA").unwrap().missing_chapters, vec![119]);
}

#[test]
fn offline_permission_is_required() {
    let p = full_canon("Alpha");
    let db = Database::open_in_memory().unwrap();
    let mut o = opts("ALP");
    o.metadata.offline_permitted = None;
    assert_eq!(import(&db, &p, SourceFormat::Json, o.clone()).unwrap_err().code(), "validation");
    o.metadata.offline_permitted = Some(false);
    assert_eq!(import(&db, &p, SourceFormat::Json, o).unwrap_err().code(), "validation");
    assert!(db.read(bible::list_translations).unwrap().is_empty());
}

#[test]
fn translations_coexist_and_switch() {
    let db = Database::open_in_memory().unwrap();
    let a = import(&db, &full_canon("Alpha"), SourceFormat::Json, opts("ALP")).unwrap();
    let b = import(&db, &full_canon("Beta"), SourceFormat::Json, opts("BET")).unwrap();
    assert_eq!(db.read(bible::list_translations).unwrap().len(), 2);
    let r = passage("JHN", 3, Some(1), None);
    let pa = db.read(|c| bible::get_passage(c, &a.translation_id, &r)).unwrap();
    let pb = db.read(|c| bible::get_passage(c, &b.translation_id, &r)).unwrap();
    assert_eq!(pa.verses[0].text, "Alpha JHN 3:1");
    assert_eq!(pb.verses[0].text, "Beta JHN 3:1");
    assert_eq!(pb.translation_code, "BET");
    let t = db.read(|c| bible::get_translation(c, &a.translation_id)).unwrap();
    assert_eq!(t.validation_status, "complete");
    assert_eq!((t.book_count, t.chapter_count, t.verse_count), (66, 1189, 1189));

    // Same code again requires an explicit replace.
    let err = import(&db, &full_canon("Gamma"), SourceFormat::Json, opts("ALP")).unwrap_err();
    assert_eq!(err.code(), "conflict");
    assert_eq!(db.read(|c| bible::get_passage(c, &a.translation_id, &r)).unwrap().verses[0].text, "Alpha JHN 3:1");
}

#[test]
fn failed_replacement_rolls_back_to_previous_text() {
    let db = Database::open_in_memory().unwrap();
    let a = import(&db, &full_canon("Alpha"), SourceFormat::Json, opts("ALP")).unwrap();
    // Force a failure part-way through the verse inserts.
    db.write(|c| {
        c.execute_batch(
            "CREATE TRIGGER fail_import BEFORE INSERT ON bible_verses WHEN new.text LIKE 'Broken REV%'
             BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;",
        )?;
        Ok(())
    })
    .unwrap();
    let mut o = opts("ALP");
    o.replace_existing = true;
    let err = import(&db, &full_canon("Broken"), SourceFormat::Json, o).unwrap_err();
    assert!(err.to_string().contains("simulated disk failure"), "{err}");

    // The original translation and all of its verses are untouched.
    let t = db.read(|c| bible::get_translation(c, &a.translation_id)).unwrap();
    assert_eq!(t.verse_count, 1189);
    assert_eq!(t.import_status, "imported");
    let count: u32 = db
        .read(|c| Ok(c.query_row("SELECT COUNT(*) FROM bible_verses WHERE translation_id = ?1", [&a.translation_id], |r| r.get(0))?))
        .unwrap();
    assert_eq!(count, 1189);
    let p = db.read(|c| bible::get_passage(c, &a.translation_id, &passage("GEN", 1, Some(1), None))).unwrap();
    assert_eq!(p.verses[0].text, "Alpha GEN 1:1");
    let jobs = db.read(|c| bible::list_import_jobs(c, 10)).unwrap();
    assert_eq!(jobs[0].status, "failed");
    assert!(jobs[0].error_message.as_deref().unwrap_or("").contains("simulated"));
    assert_eq!(jobs[1].status, "completed");
}

#[test]
fn replace_keeps_translation_id() {
    let db = Database::open_in_memory().unwrap();
    let a = import(&db, &full_canon("Alpha"), SourceFormat::Json, opts("ALP")).unwrap();
    let mut o = opts("ALP");
    o.replace_existing = true;
    let b = import(&db, &full_canon("Second"), SourceFormat::Json, o).unwrap();
    assert_eq!(a.translation_id, b.translation_id);
    let p = db.read(|c| bible::get_passage(c, &a.translation_id, &passage("REV", 22, Some(1), None))).unwrap();
    assert_eq!(p.verses[0].text, "Second REV 22:1");
    let report = db.read(|c| latest_report(c, &a.translation_id)).unwrap().unwrap();
    assert_eq!(report.status, ValidationStatus::Complete);
    let re = db.write(|c| revalidate(c, &a.translation_id)).unwrap();
    assert_eq!(re.status, ValidationStatus::Complete);
}

#[test]
fn offline_search_with_filters_and_diacritics() {
    let db = Database::open_in_memory().unwrap();
    let json = r#"[{"book":"JHN","chapter":3,"verse":16,"text":"Sapagka't gayon na lamang ang pagsinta ng Diyós"},
                  {"book":"GEN","chapter":1,"verse":1,"text":"Nang pasimula ay nilikha ng Diyos"},
                  {"book":"ROM","chapter":8,"verse":28,"text":"At ating nalalaman"}]"#;
    let p = parse_sources(SourceFormat::Json, &src("tl.json", json)).unwrap();
    let mut o = opts("TLT");
    o.metadata.language = "tl".into();
    let r = import(&db, &p, SourceFormat::Json, o).unwrap();
    let q = |text: &str| BibleSearchQuery { translation_id: r.translation_id.clone(), text: text.into(), ..Default::default() };
    let res = db.read(|c| bible::search(c, &q("diyos"))).unwrap();
    assert_eq!(res.total, 2);
    assert_eq!(res.hits[0].book_id, "GEN", "results follow canonical order");
    assert!(res.hits[0].highlighted.contains('\u{e000}'));
    let nt = BibleSearchQuery { testament: Some(canon::Testament::NT), ..q("diyos") };
    assert_eq!(db.read(|c| bible::search(c, &nt)).unwrap().total, 1);
    assert_eq!(db.read(|c| bible::search(c, &q("pasim"))).unwrap().total, 1, "prefix search");
    assert_eq!(db.read(|c| bible::search(c, &q("  "))).unwrap().total, 0);
    assert_eq!(db.read(|c| bible::search(c, &q("\"OR NEAR("))).unwrap().total, 0);
}

#[test]
fn books_list_and_saved_passages() {
    let db = Database::open_in_memory().unwrap();
    let parsed = parse_sources(SourceFormat::Json, &src("b.json", SF_JSON)).unwrap();
    let r = import(&db, &parsed, SourceFormat::Json, opts("TST")).unwrap();
    let books = db.read(|c| bible::list_books(c, Some(&r.translation_id))).unwrap();
    assert_eq!(books.len(), 66);
    let jhn = books.iter().find(|b| b.id == "JHN").unwrap();
    assert!(jhn.available);
    assert_eq!(jhn.verse_count, 2);
    assert!(!books.iter().find(|b| b.id == "GEN").unwrap().available);

    let input = bible::SavePassageInput {
        reference: "John 3:16".into(),
        translation_id: Some(r.translation_id.clone()),
        passage: passage("JHN", 3, Some(16), None),
    };
    db.write(|c| bible::record_passage_use(c, &input)).unwrap();
    db.write(|c| bible::record_passage_use(c, &input)).unwrap();
    db.write(|c| bible::set_passage_favorite(c, &input, true)).unwrap();
    let recent = db.read(|c| bible::list_saved_passages(c, false, 10)).unwrap();
    assert_eq!(recent.len(), 1);
    assert_eq!(recent[0].use_count, 2);
    assert_eq!(db.read(|c| bible::list_saved_passages(c, true, 10)).unwrap().len(), 1);

    // Deleting a translation removes its text but keeps saved references.
    db.write(|c| bible::delete_translation(c, &r.translation_id)).unwrap();
    assert!(db.read(bible::list_translations).unwrap().is_empty());
    let n: u32 = db.read(|c| Ok(c.query_row("SELECT COUNT(*) FROM bible_verses", [], |r| r.get(0))?)).unwrap();
    assert_eq!(n, 0);
    let fts: u32 = db
        .read(|c| Ok(c.query_row("SELECT COUNT(*) FROM bible_verses_fts WHERE bible_verses_fts MATCH 'psalm'", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(fts, 0, "full-text index is cleaned up");
    assert_eq!(db.read(|c| bible::list_saved_passages(c, true, 10)).unwrap()[0].translation_id, None);
}

#[test]
fn decodes_utf16_and_rejects_invalid_utf8() {
    let mut bytes = vec![0xFF, 0xFE];
    for u in "\\id GEN".encode_utf16() {
        bytes.extend_from_slice(&u.to_le_bytes());
    }
    assert_eq!(decode_text("x", &bytes).unwrap(), "\\id GEN");
    assert!(decode_text("x", &[0x66, 0xFF, 0x67]).is_err());
}

/// Real-world check against a full public-domain source. Run with
/// `SANCTUARY_BIBLE_FIXTURE=<path to eng-web_usfm.zip or kjv osis>`.
#[test]
fn external_fixture_if_available() {
    let Ok(path) = std::env::var("SANCTUARY_BIBLE_FIXTURE") else { return };
    let sources = read_sources(Path::new(&path)).unwrap();
    let format = detect_format(&sources).unwrap();
    let parsed = parse_sources(format, &sources).unwrap();
    let report = validate::validate(&parsed, canon::protestant());
    eprintln!(
        "format={format:?} status={:?} books={} chapters={} verses={} excluded={} gaps={} issues={}",
        report.status,
        report.books_found,
        report.chapters_found,
        report.verses_found,
        report.excluded_verses,
        report.missing_verse_numbers,
        report.issues.len()
    );
    for i in report.issues.iter().filter(|i| i.severity != Severity::Info).take(40) {
        eprintln!("  {:?} {}: {}", i.severity, i.code, i.message);
    }
    for v in parsed.verses.iter().filter(|v| (v.book_id == "JHN" && v.chapter == 3 && v.verse == 16) || (v.book_id == "GEN" && v.chapter == 1 && v.verse == 1)) {
        eprintln!("  {} {}:{} {}", v.book_id, v.chapter, v.verse, v.text);
    }
    assert_ne!(report.status, ValidationStatus::Invalid);
}
