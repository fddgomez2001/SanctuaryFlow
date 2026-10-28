import { describe, expect, it } from "vitest";
import { formatReference, matchBook, parseReference, parseReferences } from "@/lib/bible/reference";
import { PROTESTANT_CANON, referenceBooks } from "@/lib/bible/canon";

const books = referenceBooks();

function ok(input: string) {
  const r = parseReference(input, books);
  if (!r.ok) throw new Error(`${input}: ${r.error}`);
  return r;
}

describe("canonical catalog", () => {
  it("has 66 books, 39 OT, 27 NT and 1,189 chapters", () => {
    const b = PROTESTANT_CANON.books;
    expect(b).toHaveLength(66);
    expect(b.filter((x) => x.testament === "OT")).toHaveLength(39);
    expect(b.filter((x) => x.testament === "NT")).toHaveLength(27);
    expect(b.reduce((n, x) => n + x.chapters, 0)).toBe(1189);
  });
});

describe("parseReference", () => {
  it("parses the documented examples", () => {
    expect(ok("John 3:16").ref).toEqual({ bookId: "JHN", chapter: 3, verseStart: 16, chapterEnd: null, verseEnd: null });
    expect(ok("Psalm 23").ref).toEqual({ bookId: "PSA", chapter: 23, verseStart: null, chapterEnd: null, verseEnd: null });
    expect(ok("Psalm 23:1-6").ref).toMatchObject({ bookId: "PSA", chapter: 23, verseStart: 1, verseEnd: 6 });
    expect(ok("Romans 8:28-30").ref).toMatchObject({ bookId: "ROM", chapter: 8, verseStart: 28, verseEnd: 30 });
  });

  it("supports abbreviations, numbered books and separators", () => {
    expect(ok("Jn 3:16").ref.bookId).toBe("JHN");
    expect(ok("1 Cor 13").ref).toMatchObject({ bookId: "1CO", chapter: 13 });
    expect(ok("1Cor 13:4-7").ref.bookId).toBe("1CO");
    expect(ok("I John 1:9").ref.bookId).toBe("1JN");
    expect(ok("First John 1:9").ref.bookId).toBe("1JN");
    expect(ok("Ps 23").ref.bookId).toBe("PSA");
    expect(ok("ps23").ref).toMatchObject({ bookId: "PSA", chapter: 23 });
    expect(ok("John 3 16").ref.verseStart).toBe(16);
    expect(ok("John 3.16").ref.verseStart).toBe(16);
    expect(ok("Rom 8:28–30").ref.verseEnd).toBe(30);
    expect(ok("Song of Solomon 2:1").ref.bookId).toBe("SNG");
    expect(ok("Phil 4:13").ref.bookId).toBe("PHP");
    expect(ok("Philem 1").ref.bookId).toBe("PHM");
    expect(ok("Mga Awit 23").ref.bookId).toBe("PSA");
    expect(ok("Juan 3:16").ref.bookId).toBe("JHN");
  });

  it("handles cross-chapter and chapter ranges", () => {
    expect(ok("Gen 1:26-2:3").ref).toEqual({ bookId: "GEN", chapter: 1, verseStart: 26, chapterEnd: 2, verseEnd: 3 });
    expect(ok("Matthew 5-7").ref).toMatchObject({ chapter: 5, chapterEnd: 7, verseStart: null });
  });

  it("treats a lone number in a one-chapter book as a verse", () => {
    expect(ok("Jude 5").ref).toMatchObject({ bookId: "JUD", chapter: 1, verseStart: 5 });
    expect(ok("Jude 3-5").ref).toMatchObject({ chapter: 1, verseStart: 3, verseEnd: 5 });
    expect(ok("Obadiah").ref).toMatchObject({ bookId: "OBA", chapter: 1, verseStart: null });
  });

  it("rejects invalid references with helpful messages", () => {
    const bad = (s: string) => {
      const r = parseReference(s, books);
      expect(r.ok, s).toBe(false);
      return r.ok ? "" : r.error;
    };
    expect(bad("John 22:1")).toMatch(/21 chapters/);
    expect(bad("Psalm 151")).toMatch(/150 chapters/);
    expect(bad("Romans 8:30-28")).toMatch(/ends before/);
    expect(bad("Hezekiah 1:1")).toMatch(/No book/);
    expect(bad("John")).toMatch(/chapter number/);
    expect(bad("")).toMatch(/Type a reference/);
    expect(bad("3:16")).toBeTruthy();
    expect(bad("John 3:16-")).toMatch(/missing its end/);
  });

  it("refuses ambiguous abbreviations and lists the options", () => {
    const r = parseReference("Ju 1", books);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.suggestions).toEqual(expect.arrayContaining(["Judges", "Jude"]));
    }
    const short = matchBook("J", books);
    expect("error" in short).toBe(true);
  });

  it("parses lists of references", () => {
    const all = parseReferences("John 3:16, 18; Rom 8:28", books);
    expect(all.map((r) => (r.ok ? r.display : r.error))).toEqual(["John 3:16", "John 3:18", "Romans 8:28"]);
  });
});

describe("formatReference", () => {
  it("formats single verses, ranges and chapters", () => {
    expect(formatReference("John", { bookId: "JHN", chapter: 3, verseStart: 16, chapterEnd: null, verseEnd: 17 })).toBe("John 3:16–17");
    expect(formatReference("Genesis", { bookId: "GEN", chapter: 1, verseStart: 26, chapterEnd: 2, verseEnd: 3 })).toBe("Genesis 1:26–2:3");
    expect(formatReference("Psalms", { bookId: "PSA", chapter: 23, verseStart: null, chapterEnd: null, verseEnd: null })).toBe("Psalms 23");
  });
});
