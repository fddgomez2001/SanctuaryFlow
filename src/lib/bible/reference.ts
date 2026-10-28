import type { PassageRef } from "@/types/generated/PassageRef";

/** A book the parser can match, with every name it may be typed as. */
export interface ReferenceBook {
  id: string;
  /** Display name used in formatted references (e.g. the translation's own name). */
  name: string;
  /** Canonical name, abbreviations, aliases and translation-specific names. */
  names: string[];
  chapters: number;
}

export type ParseResult =
  | { ok: true; ref: PassageRef; book: ReferenceBook; display: string }
  | { ok: false; error: string; suggestions?: string[] };

const ORDINALS: Record<string, string> = {
  i: "1",
  first: "1",
  "1st": "1",
  ii: "2",
  second: "2",
  "2nd": "2",
  iii: "3",
  third: "3",
  "3rd": "3",
};

/** Lowercase, strip punctuation/spaces and turn leading ordinals into digits. */
export function normalizeBookKey(input: string): string {
  const words = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[._-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 1 && words[0]! in ORDINALS) words[0] = ORDINALS[words[0]!]!;
  return words.join("").replace(/[^\p{L}\p{N}]/gu, "");
}

interface Indexed {
  book: ReferenceBook;
  keys: string[];
}

function index(books: ReferenceBook[]): Indexed[] {
  return books.map((book) => ({
    book,
    keys: Array.from(new Set([book.name, ...book.names].map(normalizeBookKey).filter(Boolean))),
  }));
}

/** Matches a typed book name: exact name/abbreviation first, then an unambiguous prefix. */
export function matchBook(
  input: string,
  books: ReferenceBook[],
): { book: ReferenceBook } | { error: string; suggestions?: string[] } {
  const key = normalizeBookKey(input);
  if (!key) return { error: "Type a book name, for example “John 3:16”." };
  const idx = index(books);
  const exact = idx.filter((b) => b.keys.includes(key));
  if (exact.length === 1) return { book: exact[0]!.book };
  const letters = key.replace(/\d/g, "");
  if (letters.length < 2) {
    return { error: `“${input.trim()}” is too short to identify a book.` };
  }
  const prefix = idx.filter((b) => b.keys.some((k) => k.startsWith(key)));
  if (prefix.length === 1) return { book: prefix[0]!.book };
  if (prefix.length > 1) {
    const names = prefix.map((b) => b.book.name);
    return {
      error: `“${input.trim()}” could mean ${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}. Type more of the name.`,
      suggestions: names,
    };
  }
  return { error: `No book named “${input.trim()}” was found.` };
}

function num(s: string): number | null {
  const m = /^(\d+)[a-z]?$/i.exec(s.trim());
  return m ? Number(m[1]) : null;
}

/** Formats a passage like "John 3:16", "Psalm 23", "Romans 8:28–30" or "Genesis 1:26–2:3". */
export function formatReference(bookName: string, r: PassageRef): string {
  const endCh = r.chapterEnd ?? r.chapter;
  let s = `${bookName} ${r.chapter}`;
  if (r.verseStart != null) s += `:${r.verseStart}`;
  if (endCh !== r.chapter) {
    s += `–${endCh}`;
    if (r.verseEnd != null) s += `:${r.verseEnd}`;
  } else if (r.verseEnd != null && r.verseEnd !== r.verseStart) {
    s += `–${r.verseEnd}`;
  }
  return s;
}

/**
 * Parses one reference such as `John 3:16`, `Psalm 23`, `Ps 23:1-6`,
 * `Romans 8:28-30`, `Gen 1:26-2:3`, `1 Cor 13` or `Jude 5`.
 */
export function parseReference(input: string, books: ReferenceBook[]): ParseResult {
  const text = input
    .trim()
    .replace(/[‒-―−]/g, "-")
    .replace(/：/g, ":")
    .replace(/\s+/g, " ");
  if (!text) return { ok: false, error: "Type a reference, for example “John 3:16”." };

  // The book is everything before the first digit that follows a letter.
  const m = /^(.*?\p{L}[\p{L}\s.'’-]*?)\s*(\d.*)?$/u.exec(text);
  if (!m) return { ok: false, error: "Start the reference with a book name, for example “John 3:16”." };
  const bookPart = m[1]!.trim();
  // "John 3 16" and "John 3.16" mean John 3:16.
  const rest = (m[2] ?? "")
    .trim()
    .replace(/^(\d+)\s+(\d+)/, "$1:$2")
    .replace(/\s+/g, "")
    .replace(/v(?=\d)/gi, ":")
    .replace(/\./g, ":");

  const matched = matchBook(bookPart, books);
  if ("error" in matched) {
    return matched.suggestions
      ? { ok: false, error: matched.error, suggestions: matched.suggestions }
      : { ok: false, error: matched.error };
  }
  const book = matched.book;
  const single = book.chapters === 1;

  let ref: PassageRef;
  if (!rest) {
    if (!single) return { ok: false, error: `Add a chapter number, for example “${book.name} 1”.` };
    ref = { bookId: book.id, chapter: 1, verseStart: null, chapterEnd: null, verseEnd: null };
  } else {
    const [startPart, endPart, extra] = rest.split("-");
    if (extra !== undefined) return { ok: false, error: "Use one dash for a range, for example “Romans 8:28-30”." };
    const [sc, sv, sx] = startPart!.split(":");
    if (sx !== undefined) return { ok: false, error: "That reference has too many colons." };
    let chapter = num(sc ?? "");
    let verseStart = sv !== undefined ? num(sv) : null;
    if (chapter == null || (sv !== undefined && verseStart == null)) {
      return { ok: false, error: "Chapters and verses must be numbers." };
    }
    // "Jude 5" means verse 5 of the only chapter.
    if (single && sv === undefined && endPart === undefined && chapter > 1) {
      verseStart = chapter;
      chapter = 1;
    }
    let chapterEnd: number | null = null;
    let verseEnd: number | null = null;
    if (endPart !== undefined) {
      if (!endPart) return { ok: false, error: "The range is missing its end, for example “Psalm 23:1-6”." };
      const [ec, ev] = endPart.split(":");
      if (ev !== undefined) {
        chapterEnd = num(ec ?? "");
        verseEnd = num(ev);
        if (chapterEnd == null || verseEnd == null) return { ok: false, error: "Chapters and verses must be numbers." };
        if (verseStart == null) return { ok: false, error: "Give a starting verse for a range that ends at a verse." };
      } else if (verseStart != null) {
        verseEnd = num(ec ?? "");
        if (verseEnd == null) return { ok: false, error: "Chapters and verses must be numbers." };
      } else if (single) {
        // "Jude 3-5": verses of the only chapter.
        verseStart = chapter;
        chapter = 1;
        verseEnd = num(ec ?? "");
        if (verseEnd == null) return { ok: false, error: "Chapters and verses must be numbers." };
      } else {
        chapterEnd = num(ec ?? "");
        if (chapterEnd == null) return { ok: false, error: "Chapters must be numbers." };
      }
    }
    if (chapterEnd != null && chapterEnd === chapter) chapterEnd = null;
    ref = { bookId: book.id, chapter, verseStart, chapterEnd, verseEnd };
  }

  const lastChapter = ref.chapterEnd ?? ref.chapter;
  if (ref.chapter < 1) return { ok: false, error: "Chapter numbers start at 1." };
  if (ref.chapter > book.chapters || lastChapter > book.chapters) {
    return {
      ok: false,
      error: `${book.name} has ${book.chapters} chapter${book.chapters === 1 ? "" : "s"}.`,
    };
  }
  if (ref.verseStart != null && ref.verseStart < 1) return { ok: false, error: "Verse numbers start at 1." };
  if (lastChapter < ref.chapter) return { ok: false, error: "The passage ends before it starts." };
  if (
    ref.chapterEnd == null &&
    ref.verseStart != null &&
    ref.verseEnd != null &&
    ref.verseEnd < ref.verseStart
  ) {
    return { ok: false, error: "The passage ends before it starts." };
  }
  if (ref.verseEnd != null && ref.verseEnd === ref.verseStart && ref.chapterEnd == null) ref.verseEnd = null;
  return { ok: true, ref, book, display: formatReference(book.name, ref) };
}

/**
 * Parses several references separated by `;`. Within one item, commas add
 * verses in the same chapter: `John 3:16, 18` → John 3:16 and John 3:18.
 */
export function parseReferences(input: string, books: ReferenceBook[]): ParseResult[] {
  const out: ParseResult[] = [];
  for (const part of input.split(";").map((p) => p.trim()).filter(Boolean)) {
    const [first, ...more] = part.split(",").map((p) => p.trim());
    const head = parseReference(first ?? "", books);
    out.push(head);
    if (!head.ok) continue;
    for (const extra of more.filter(Boolean)) {
      const withBook = /\p{L}/u.test(extra.replace(/^\d+[a-z]?/i, ""))
        ? extra
        : extra.includes(":")
          ? `${head.book.name} ${extra}`
          : `${head.book.name} ${head.ref.chapter}:${extra}`;
      out.push(parseReference(withBook, books));
    }
  }
  return out;
}
