import canonJson from "@shared/bible/canon-protestant.json";
import type { BibleBookInfo } from "@/types/generated/BibleBookInfo";
import type { CanonDefinition } from "@/types/generated/CanonDefinition";
import type { ReferenceBook } from "./reference";

/** The same catalog the Rust core seeds into the database. */
export const PROTESTANT_CANON = canonJson as unknown as CanonDefinition;

/**
 * Books for the reference parser. When a translation is selected its own
 * book names and chapter counts are used in addition to the catalog names.
 */
export function referenceBooks(translationBooks?: BibleBookInfo[]): ReferenceBook[] {
  return PROTESTANT_CANON.books.map((b) => {
    const t = translationBooks?.find((tb) => tb.id === b.id);
    const names = [b.name, b.id, b.osis, ...b.abbreviations, ...b.aliases];
    if (t) {
      names.push(t.name);
      if (t.abbreviation) names.push(t.abbreviation);
    }
    return {
      id: b.id,
      name: t?.available ? t.name : b.name,
      names,
      // A partial translation must not shrink the book; a translation with a
      // different versification may have more chapters than the catalog.
      chapters: Math.max(b.chapters, t?.available ? t.chapterCount : 0),
    };
  });
}

export function canonBook(id: string) {
  return PROTESTANT_CANON.books.find((b) => b.id === id);
}
