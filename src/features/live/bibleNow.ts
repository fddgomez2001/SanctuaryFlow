/**
 * The Bible view on the Live page: a whole chapter opened from Present now,
 * whose verses are shown on the output when clicked (several at once with
 * Ctrl/Shift or "Select several"). Shown verses never join the lineup.
 * Next and Previous move verse by verse once a passage's slides run out.
 */
import { create } from "zustand";
import type { PassageRef } from "@/types/generated/PassageRef";
import { toast } from "@/components/ui/Toast";
import { newId } from "@/lib/slides/deck";
import { canonBook } from "@/lib/bible/canon";
import { formatReference } from "@/lib/bible/reference";
import { setting } from "@/hooks/useSettings";
import type { SettingsMap } from "@/services/api";
import { currentItem } from "@/services/presentation-engine/engine";
import { BIBLE_NOW_PREFIX, isBibleNow, useLive } from "@/services/presentation-engine/store";

/** The theme for verses shown from Present now (Settings → Presentation); the built-in Gold Scripture unless changed. */
export const BIBLE_NOW_THEME_KEY = "presentation.bibleNowThemeId";
export const GOLD_SCRIPTURE_THEME_ID = "00000000-0000-4000-8000-000000000008";
export const bibleNowThemeId = (settings: SettingsMap | undefined) => setting<string | null>(settings, BIBLE_NOW_THEME_KEY, GOLD_SCRIPTURE_THEME_ID) || GOLD_SCRIPTURE_THEME_ID;

export interface BibleChapterRef {
  translationId: string;
  bookId: string;
  chapter: number;
}

interface BibleNowState {
  chapter: BibleChapterRef | null;
  /** The view is showing (it stays remembered when the operator looks at another item). */
  open: boolean;
  /** Verses shown on the output, ascending. */
  selected: number[];
  /** Where a Shift+click range starts. */
  anchor: number | null;
  /** Verses in the open chapter, once loaded. */
  verseCount: number;
  /** Clicks add verses instead of replacing them. */
  several: boolean;
  /** Opens a chapter and shows the given verses (none: just open it). */
  show: (chapter: BibleChapterRef, verses: number[]) => Promise<void>;
  /** Shows these verses of the open chapter. */
  select: (verses: number[], anchor?: number | null, opts?: { followLock?: boolean }) => Promise<void>;
  /** The item the chosen verses were last sent as (to tell whether they are what is on screen). */
  itemId: string | null;
  setOpen: (open: boolean) => void;
  setSeveral: (several: boolean) => void;
  setVerseCount: (n: number) => void;
  /** Verses being dragged towards the lineup, and whether they are over it. */
  drag: { title: string; x: number; y: number; overLineup: boolean } | null;
  setDrag: (drag: BibleNowState["drag"]) => void;
  /** Verses about to be added to the service (the dialog asks for a note). */
  adding: { title: string; translationId: string; references: PassageRef[]; afterId: string | null } | null;
  startAdding: (verses: number[], afterId?: string | null) => void;
  stopAdding: () => void;
}

/** Characters on one slide for a passage from the Bible view: a long verse goes over several slides. */
export const BIBLE_SLIDE_CHARS = 220;

/** Runs of consecutive verses as passage references: 16, 17, 18, 20 → 16–18 and 20. */
export function versesToRefs(bookId: string, chapter: number, verses: number[]): PassageRef[] {
  const sorted = [...new Set(verses)].sort((a, b) => a - b);
  const refs: PassageRef[] = [];
  for (const v of sorted) {
    const last = refs[refs.length - 1];
    if (last && (last.verseEnd ?? last.verseStart) === v - 1) last.verseEnd = v;
    else refs.push({ bookId, chapter, verseStart: v, chapterEnd: null, verseEnd: null });
  }
  return refs;
}

export function passageTitle(bookId: string, refs: PassageRef[]): string {
  const name = canonBook(bookId)?.name ?? bookId;
  return refs.map((r, i) => (i === 0 ? formatReference(name, r) : formatReference(name, r).replace(/^.* \d+:/, ""))).join(", ");
}

export const useBibleNow = create<BibleNowState>((set, get) => ({
  chapter: null,
  open: false,
  selected: [],
  anchor: null,
  verseCount: 0,
  several: false,

  async show(chapter, verses) {
    const same = get().chapter;
    const changed = !same || same.translationId !== chapter.translationId || same.bookId !== chapter.bookId || same.chapter !== chapter.chapter;
    set({ chapter, open: true, ...(changed ? { selected: [], anchor: null, verseCount: 0 } : {}) });
    if (verses.length) await get().select(verses, verses[0] ?? null);
  },

  itemId: null,

  async select(verses, anchor, opts) {
    const chapter = get().chapter;
    if (!chapter) return;
    const sorted = [...new Set(verses)].filter((v) => v > 0).sort((a, b) => a - b);
    set({ selected: sorted, ...(anchor !== undefined ? { anchor } : {}) });
    if (!sorted.length) return;
    const references = versesToRefs(chapter.bookId, chapter.chapter, sorted);
    const title = passageTitle(chapter.bookId, references);
    const id = `${BIBLE_NOW_PREFIX}${newId()}`;
    set({ itemId: id });
    try {
      await useLive.getState().presentBible(
        {
          id,
          itemType: "scripture",
          title,
          refId: null,
          settings: { translationId: chapter.translationId, references, maxChars: BIBLE_SLIDE_CHARS, themeId: bibleNowThemeId(useLive.getState().settings) },
          notes: null,
        },
        opts,
      );
    } catch (e) {
      toast.error(`${title} could not be shown`, e);
    }
  },

  setOpen: (open) => set({ open }),
  setSeveral: (several) => set({ several }),
  setVerseCount: (verseCount) => set({ verseCount }),
  drag: null,
  setDrag: (drag) => set({ drag }),
  adding: null,
  startAdding(verses, afterId = null) {
    const chapter = get().chapter;
    if (!chapter || !verses.length) return;
    const references = versesToRefs(chapter.bookId, chapter.chapter, verses);
    set({ adding: { title: passageTitle(chapter.bookId, references), translationId: chapter.translationId, references, afterId } });
  },
  stopAdding: () => set({ adding: null }),
}));

/** Next/Previous past the end of the shown passage move to the next/previous verse. */
function step(direction: 1 | -1): boolean {
  const { chapter, selected, verseCount, select } = useBibleNow.getState();
  if (!chapter || !selected.length) return false;
  const engine = useLive.getState().engine;
  const item = currentItem(engine);
  // Only the passage on screen steps on; verses prepared under a lock wait.
  if (!item || !isBibleNow(item.id) || item.id !== useBibleNow.getState().itemId || !engine.live) return false;
  if (direction > 0 && engine.live.slideIndex < item.slides.length - 1) return false;
  if (direction < 0 && engine.live.slideIndex > 0) return false;
  const target = direction > 0 ? Math.max(...selected) + 1 : Math.min(...selected) - 1;
  if (target < 1 || (verseCount > 0 && target > verseCount)) return false;
  // Locked on this passage: the lock follows it to the next verse.
  void select([target], target, { followLock: useLive.getState().locked === item.id });
  return true;
}

useLive.setState({ stepHook: step });
