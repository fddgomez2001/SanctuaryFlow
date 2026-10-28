import { describe, expect, it } from "vitest";
import type { Song } from "@/types/generated/Song";
import type { Verse } from "@/types/generated/Verse";
import { sectionOrder, songFooter, songToSlides, splitSectionIntoSlides } from "@/lib/slides/lyrics";
import { passageToSlides, splitLongText } from "@/lib/slides/scripture";
import { SECTION_COLORS, slideColor, slideTextLines } from "@/lib/slides/colors";
import { groupSlides } from "@/lib/slides/groups";

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: "song-1",
    title: "Test Song",
    artist: "Writer",
    originalKey: null,
    tempo: null,
    language: "en",
    category: null,
    copyrightHolder: "Example Music",
    copyrightYear: "2020",
    ccliNumber: "123",
    source: null,
    license: null,
    notes: null,
    arrangement: null,
    themeId: null,
    audioMediaId: null,
    coverMediaId: null,
    lyricSync: null,
    tags: [],
    sections: [
      { id: "v1", kind: "verse", label: "Verse 1", lyrics: "a\nb\nc\nd\ne\nf\ng", linesPerSlide: null },
      { id: "c", kind: "chorus", label: "Chorus", lyrics: "x\ny\n\nz", linesPerSlide: null },
    ],
    isFavorite: false,
    useCount: 0,
    lastUsedAt: null,
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
    revision: 1,
    ...overrides,
  };
}

describe("lyric slides", () => {
  it("splits long paragraphs evenly and honours blank-line breaks", () => {
    expect(splitSectionIntoSlides("a\nb\nc\nd\ne\nf\ng", 4)).toEqual([
      ["a", "b", "c", "d"],
      ["e", "f", "g"],
    ]);
    expect(splitSectionIntoSlides("a\nb\nc\nd\ne", 4)).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
    expect(splitSectionIntoSlides("x\ny\n\n\nz\n", 4)).toEqual([["x", "y"], ["z"]]);
    expect(splitSectionIntoSlides("  \n\n", 4)).toEqual([]);
  });

  it("follows the arrangement, including repeats", () => {
    const s = song({ arrangement: ["c", "v1", "c", "missing"] });
    expect(sectionOrder(s)).toEqual(["c", "v1", "c"]);
    const slides = songToSlides(s, "item", { maxLinesPerSlide: 4 });
    expect(slides.map((x) => x.label)).toEqual([
      "Chorus (1/2)",
      "Chorus (2/2)",
      "Verse 1 (1/2)",
      "Verse 1 (2/2)",
      "Chorus (1/2)",
      "Chorus (2/2)",
    ]);
    expect(new Set(slides.map((x) => x.id)).size).toBe(slides.length);
  });

  it("builds a copyright footer", () => {
    expect(songFooter(song(), "999")).toBe("Test Song — Writer · © 2020 Example Music · CCLI Song #123 · CCLI License #999");
    expect(songFooter(song({ copyrightHolder: null, copyrightYear: null, ccliNumber: null, artist: null, license: "Public Domain" }))).toBe(
      "Test Song · Public Domain",
    );
  });

  it("shows a section line by line when it is set to one line per slide", () => {
    const s = song({
      sections: [
        { id: "v1", kind: "verse", label: "Verse 1", lyrics: "a\nb\nc", linesPerSlide: null },
        { id: "c", kind: "chorus", label: "Chorus", lyrics: "Line one\nLine two\nLine three", linesPerSlide: 1 },
      ],
    });
    const slides = songToSlides(s, "item", { maxLinesPerSlide: 4 });
    expect(slides.map((x) => x.label)).toEqual(["Verse 1", "Chorus (1/3)", "Chorus (2/3)", "Chorus (3/3)"]);
    expect(slides.slice(1).map((x) => (x.content.kind === "lyrics" ? x.content.lines : []))).toEqual([["Line one"], ["Line two"], ["Line three"]]);
  });

  it("colours slides by song part and lists their words", () => {
    const slides = songToSlides(song(), "item", { maxLinesPerSlide: 4 });
    expect(slides.map(slideColor)).toEqual([SECTION_COLORS.verse, SECTION_COLORS.verse, SECTION_COLORS.chorus, SECTION_COLORS.chorus]);
    expect(slideTextLines(slides[2]!)).toEqual(["x", "y"]);
    expect(new Set(Object.values(SECTION_COLORS)).size).toBe(Object.keys(SECTION_COLORS).length);
  });

  it("returns no slides for an empty song", () => {
    expect(songToSlides(song({ sections: [] }), "i", { maxLinesPerSlide: 4 })).toEqual([]);
  });
});

const verse = (v: number, text: string, chapter = 3, verseEnd: number | null = null): Verse => ({
  bookId: "JHN",
  chapter,
  verse: v,
  verseEnd,
  text,
});

describe("scripture slides", () => {
  it("fits whole verses onto slides with range labels", () => {
    const slides = passageToSlides(
      { bookName: "John", translationCode: "TST", verses: [verse(16, "a".repeat(100)), verse(17, "b".repeat(100)), verse(18, "c".repeat(100))] },
      "item",
      { split: "fit", maxChars: 220, hideParagraphMarks: true },
    );
    expect(slides.map((s) => s.label)).toEqual(["John 3:16–17", "John 3:18"]);
    expect(slides[0]!.content).toMatchObject({ kind: "scripture", translation: "TST" });
  });

  it("puts one verse per slide when asked and labels combined verses", () => {
    const slides = passageToSlides(
      { bookName: "Psalms", translationCode: null, verses: [verse(1, "one"), verse(2, "two three", 23, 3)].map((v) => ({ ...v, bookId: "PSA", chapter: 23 })) },
      "i",
      { split: "verse", maxChars: 300, hideParagraphMarks: true },
    );
    expect(slides.map((s) => s.label)).toEqual(["Psalms 23:1", "Psalms 23:2–3"]);
    const c = slides[1]!.content;
    expect(c.kind === "scripture" && c.verses[0]!.number).toBe("2–3");
  });

  it("splits a very long verse in order without losing text", () => {
    const long = "First sentence here. Second sentence follows, with a clause; and more words to fill the slide. Third sentence ends it.";
    const parts = splitLongText(long, 50);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long);
    expect(parts.every((p) => p.length <= 50)).toBe(true);
    const slides = passageToSlides({ bookName: "John", translationCode: null, verses: [verse(1, long)] }, "i", {
      split: "fit",
      maxChars: 60,
      hideParagraphMarks: true,
    });
    expect(slides.length).toBeGreaterThan(1);
    expect(slides[0]!.label).toMatch(/John 3:1 \(1\/\d\)/);
  });

  it("removes paragraph marks only when asked", () => {
    const make = (hide: boolean) =>
      passageToSlides({ bookName: "John", translationCode: null, verses: [verse(16, "¶ For God so loved")] }, "i", {
        split: "fit",
        maxChars: 300,
        hideParagraphMarks: hide,
      })[0]!.content;
    const hidden = make(true);
    const shown = make(false);
    expect(hidden.kind === "scripture" && hidden.verses[0]!.text).toBe("For God so loved");
    expect(shown.kind === "scripture" && shown.verses[0]!.text).toBe("¶ For God so loved");
  });
});

describe("slide list groups", () => {
  it("groups consecutive slides by song part, keeping repeats apart", () => {
    const s = song({ arrangement: ["v1", "c", "c"] });
    const groups = groupSlides(songToSlides(s, "item", { maxLinesPerSlide: 4 }));
    expect(groups.map((g) => [g.label, g.slides.map((x) => x.index)])).toEqual([
      ["Verse 1", [0, 1]],
      ["Chorus", [2, 3]],
      ["Chorus", [4, 5]],
    ]);
    expect(groups[1]!.color).toBe(SECTION_COLORS.chorus);
  });
});
