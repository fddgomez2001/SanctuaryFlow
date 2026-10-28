import type { Verse } from "@/types/generated/Verse";
import { formatReference } from "@/lib/bible/reference";
import type { ScriptureVerseText, Slide } from "./types";

export type ScriptureSplit = "fit" | "verse";

export interface ScriptureOptions {
  /** "verse": one verse per slide; "fit": as many whole verses as fit. */
  split: ScriptureSplit;
  /** Approximate characters that fit comfortably on one slide. */
  maxChars: number;
  /** Remove source paragraph marks (¶) from displayed text. */
  hideParagraphMarks: boolean;
}

export interface PassageForSlides {
  bookName: string;
  translationCode: string | null;
  verses: Verse[];
}

/** Verse text as shown: paragraph marks removed if asked, spacing tidied. */
export function cleanText(text: string, hideMarks: boolean): string {
  const t = hideMarks ? text.replace(/¶\s*/g, "") : text;
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Splits text that is too long for one slide at sentence, then clause, then
 * word boundaries. Pieces stay in order and nothing is dropped.
 */
export function splitLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    const candidates = [/[.!?]["'’”)]*\s/g, /[;:]\s/g, /,\s/g, /\s/g];
    let cut = -1;
    for (const re of candidates) {
      let m: RegExpExecArray | null;
      let last = -1;
      while ((m = re.exec(window)) !== null) {
        const end = m.index + m[0].length;
        if (end >= maxChars * 0.4) last = end;
      }
      if (last > 0) {
        cut = last;
        break;
      }
    }
    if (cut <= 0) cut = maxChars;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

function verseNumber(v: Verse): string {
  return v.verseEnd != null ? `${v.verse}–${v.verseEnd}` : String(v.verse);
}

function rangeLabel(bookName: string, verses: Verse[]): string {
  const first = verses[0]!;
  const last = verses[verses.length - 1]!;
  const lastVerse = last.verseEnd ?? last.verse;
  return formatReference(bookName, {
    bookId: first.bookId,
    chapter: first.chapter,
    verseStart: first.verse,
    chapterEnd: last.chapter !== first.chapter ? last.chapter : null,
    verseEnd: last.chapter !== first.chapter || lastVerse !== first.verse ? lastVerse : null,
  });
}

/** Builds Scripture slides with a reference label for each slide. */
export function passageToSlides(passage: PassageForSlides, itemId: string, opts: ScriptureOptions): Slide[] {
  const maxChars = Math.max(60, opts.maxChars);
  type Group = { verses: Verse[]; texts: ScriptureVerseText[]; part?: [number, number] };
  const groups: Group[] = [];
  let current: Group = { verses: [], texts: [] };
  let currentLen = 0;
  const flush = () => {
    if (current.verses.length) groups.push(current);
    current = { verses: [], texts: [] };
    currentLen = 0;
  };

  for (const v of passage.verses) {
    const text = cleanText(v.text, opts.hideParagraphMarks);
    if (!text) continue;
    const num = verseNumber(v);
    if (text.length > maxChars * 1.15) {
      // A single verse that cannot fit: give it its own slides, split in order.
      flush();
      const parts = splitLongText(text, maxChars);
      parts.forEach((p, i) => groups.push({ verses: [v], texts: [{ number: i === 0 ? num : "", text: p }], part: [i + 1, parts.length] }));
      continue;
    }
    if (opts.split === "verse" || (currentLen > 0 && currentLen + text.length > maxChars)) flush();
    current.verses.push(v);
    current.texts.push({ number: num, text });
    currentLen += text.length + num.length + 1;
  }
  flush();

  return groups.map((g, i) => {
    const reference = rangeLabel(passage.bookName, g.verses);
    return {
      id: `${itemId}:${i}`,
      itemId,
      label: g.part ? `${reference} (${g.part[0]}/${g.part[1]})` : reference,
      content: { kind: "scripture", verses: g.texts, reference, translation: passage.translationCode },
    };
  });
}
