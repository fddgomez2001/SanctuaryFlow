/**
 * Pure presentation state machine. The operator window drives it; the
 * resulting state is rendered on the projector. It never performs IO, so
 * navigation can never be blocked by storage or network activity.
 */
import type { ServiceItemType } from "@/types/generated/ServiceItemType";
import type { Slide } from "@/lib/slides/types";
import type { ItemKind } from "@/lib/service-items";

export type OutputMode = "normal" | "black" | "clear" | "logo";

export interface PresentationItem {
  id: string;
  title: string;
  type: ServiceItemType;
  slides: Slide[];
  /** Theme for this item (already resolved from overrides and defaults). */
  themeId: string | null;
  /** What it is, for its icon (defaults to `type`). */
  kind?: ItemKind;
  /** A song's recording and timed lyrics. */
  music?: ItemMusic;
  /** Shown to the operator when the item's content could not be loaded. */
  error?: string;
}

export interface ItemMusic {
  songId: string;
  audioMediaId: string;
  coverMediaId: string | null;
  title: string;
  artist: string | null;
  lines: { text: string; section: string; startMs: number | null; endMs: number | null }[];
}

export interface LivePosition {
  itemIndex: number;
  slideIndex: number;
}

export interface EngineState {
  items: PresentationItem[];
  live: LivePosition | null;
  output: OutputMode;
  /** Item selected in the operator's list (may differ from what is live). */
  selectedItemIndex: number | null;
}

export interface EngineOptions {
  /** Next on the last slide of an item continues into the next item. */
  advanceAcrossItems: boolean;
}

export const initialState: EngineState = { items: [], live: null, output: "normal", selectedItemIndex: null };

/**
 * Output after choosing a slide: Black and Logo give way to the slide, but
 * Clear stays on until the operator turns it off, so the next slide can be
 * lined up without its words appearing.
 */
const outputAfterChoosing = (output: OutputMode): OutputMode => (output === "clear" ? "clear" : "normal");

const firstSlideIndexFrom = (items: PresentationItem[], from: number, step: 1 | -1): number | null => {
  for (let i = from; i >= 0 && i < items.length; i += step) {
    if (items[i]!.slides.length > 0) return i;
  }
  return null;
};

export function currentSlide(s: EngineState): Slide | null {
  if (!s.live) return null;
  return s.items[s.live.itemIndex]?.slides[s.live.slideIndex] ?? null;
}

export function currentItem(s: EngineState): PresentationItem | null {
  return s.live ? (s.items[s.live.itemIndex] ?? null) : null;
}

/** Position after `pos`, or null at the end. */
export function positionAfter(s: EngineState, pos: LivePosition, opts: EngineOptions): LivePosition | null {
  const item = s.items[pos.itemIndex];
  if (item && pos.slideIndex + 1 < item.slides.length) return { itemIndex: pos.itemIndex, slideIndex: pos.slideIndex + 1 };
  if (!opts.advanceAcrossItems) return null;
  const next = firstSlideIndexFrom(s.items, pos.itemIndex + 1, 1);
  return next == null ? null : { itemIndex: next, slideIndex: 0 };
}

export function positionBefore(s: EngineState, pos: LivePosition, opts: EngineOptions): LivePosition | null {
  if (pos.slideIndex > 0) return { itemIndex: pos.itemIndex, slideIndex: pos.slideIndex - 1 };
  if (!opts.advanceAcrossItems) return null;
  const prev = firstSlideIndexFrom(s.items, pos.itemIndex - 1, -1);
  return prev == null ? null : { itemIndex: prev, slideIndex: s.items[prev]!.slides.length - 1 };
}

/** The slide that Next will show (for the operator's "next" preview). */
export function nextSlide(s: EngineState, opts: EngineOptions): Slide | null {
  if (!s.live) {
    const start = s.selectedItemIndex ?? 0;
    const i = firstSlideIndexFrom(s.items, start, 1);
    return i == null ? null : (s.items[i]!.slides[0] ?? null);
  }
  const p = positionAfter(s, s.live, opts);
  return p ? (s.items[p.itemIndex]?.slides[p.slideIndex] ?? null) : null;
}

function validPosition(s: EngineState, p: LivePosition): boolean {
  const item = s.items[p.itemIndex];
  return !!item && p.slideIndex >= 0 && p.slideIndex < item.slides.length;
}

export type EngineAction =
  | { type: "setItems"; items: PresentationItem[] }
  | { type: "select"; itemIndex: number | null }
  | { type: "goLive"; itemIndex: number; slideIndex: number }
  | { type: "next" }
  | { type: "previous" }
  | { type: "first" }
  | { type: "last" }
  | { type: "nextItem" }
  | { type: "previousItem" }
  | { type: "setOutput"; output: OutputMode }
  | { type: "toggleOutput"; output: Exclude<OutputMode, "normal"> }
  | { type: "stop" };

export function reduce(s: EngineState, a: EngineAction, opts: EngineOptions): EngineState {
  switch (a.type) {
    case "setItems":
      return replaceItems(s, a.items);
    case "select":
      return { ...s, selectedItemIndex: a.itemIndex != null && a.itemIndex >= 0 && a.itemIndex < s.items.length ? a.itemIndex : null };
    case "goLive": {
      const p = { itemIndex: a.itemIndex, slideIndex: a.slideIndex };
      if (!validPosition(s, p)) return s;
      return { ...s, live: p, selectedItemIndex: a.itemIndex, output: outputAfterChoosing(s.output) };
    }
    case "next": {
      if (!s.live) {
        const start = s.selectedItemIndex ?? 0;
        const i = firstSlideIndexFrom(s.items, start, 1);
        return i == null ? s : { ...s, live: { itemIndex: i, slideIndex: 0 }, selectedItemIndex: i };
      }
      const p = positionAfter(s, s.live, opts);
      return p ? { ...s, live: p, selectedItemIndex: p.itemIndex } : s;
    }
    case "previous": {
      if (!s.live) return s;
      const p = positionBefore(s, s.live, opts);
      return p ? { ...s, live: p, selectedItemIndex: p.itemIndex } : s;
    }
    case "first":
      return s.live && validPosition(s, { ...s.live, slideIndex: 0 }) ? { ...s, live: { ...s.live, slideIndex: 0 } } : s;
    case "last": {
      if (!s.live) return s;
      const n = s.items[s.live.itemIndex]?.slides.length ?? 0;
      return n > 0 ? { ...s, live: { ...s.live, slideIndex: n - 1 } } : s;
    }
    case "nextItem": {
      const from = (s.live?.itemIndex ?? s.selectedItemIndex ?? -1) + 1;
      const i = firstSlideIndexFrom(s.items, from, 1);
      return i == null ? s : { ...s, live: { itemIndex: i, slideIndex: 0 }, selectedItemIndex: i, output: outputAfterChoosing(s.output) };
    }
    case "previousItem": {
      const from = (s.live?.itemIndex ?? s.selectedItemIndex ?? s.items.length) - 1;
      const i = firstSlideIndexFrom(s.items, from, -1);
      return i == null ? s : { ...s, live: { itemIndex: i, slideIndex: 0 }, selectedItemIndex: i, output: outputAfterChoosing(s.output) };
    }
    case "setOutput":
      return { ...s, output: a.output };
    case "toggleOutput":
      return { ...s, output: s.output === a.output ? "normal" : a.output };
    case "stop":
      return { ...s, live: null, output: "normal" };
  }
}

/**
 * Replaces the item list (after an edit or a reload) while keeping the live
 * slide on screen: the position is re-found by item id and slide id, then by
 * index within the same item, so editing a service never jumps the output.
 */
export function replaceItems(s: EngineState, items: PresentationItem[]): EngineState {
  const selectedId = s.selectedItemIndex != null ? s.items[s.selectedItemIndex]?.id : undefined;
  const selectedItemIndex = selectedId ? items.findIndex((i) => i.id === selectedId) : -1;
  let live: LivePosition | null = null;
  if (s.live) {
    const oldItem = s.items[s.live.itemIndex];
    const oldSlide = oldItem?.slides[s.live.slideIndex];
    const itemIndex = oldItem ? items.findIndex((i) => i.id === oldItem.id) : -1;
    if (itemIndex >= 0) {
      const newItem = items[itemIndex]!;
      const bySlideId = oldSlide ? newItem.slides.findIndex((sl) => sl.id === oldSlide.id) : -1;
      const slideIndex = bySlideId >= 0 ? bySlideId : Math.min(s.live.slideIndex, newItem.slides.length - 1);
      live = slideIndex >= 0 ? { itemIndex, slideIndex } : null;
    }
  }
  return { ...s, items, live, selectedItemIndex: selectedItemIndex >= 0 ? selectedItemIndex : null };
}

/** "Slide 3 of 7" style position for the operator. */
export function positionLabel(s: EngineState): string | null {
  if (!s.live) return null;
  const item = s.items[s.live.itemIndex];
  if (!item) return null;
  return `${s.live.slideIndex + 1} / ${item.slides.length}`;
}

/**
 * Puts items in the operator's chosen order. Items the order does not know
 * yet (for example one added in the service planner during the service) keep
 * their place after the item they follow in the plan.
 */
export function applyOrder<T extends { id: string }>(items: T[], order: string[] | null): T[] {
  if (!order?.length) return items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const result = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const placed = new Set(result.map((i) => i.id));
  items.forEach((item, natural) => {
    if (placed.has(item.id)) return;
    let at = 0;
    for (let j = natural - 1; j >= 0; j--) {
      const k = result.findIndex((r) => r.id === items[j]!.id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    result.splice(at, 0, item);
    placed.add(item.id);
  });
  return result;
}
