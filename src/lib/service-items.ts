import type { PassageRef } from "@/types/generated/PassageRef";
import type { ServiceItemType } from "@/types/generated/ServiceItemType";
import type { BackgroundFit } from "@/lib/theme";
import type { ScriptureSplit } from "@/lib/slides/scripture";
import { isCanvaEmbedUrl } from "@/lib/canva";

/** Item settings, by item type. Stored as JSON in `service_items.settings`. */
export interface CommonItemSettings {
  themeId?: string | null;
}

export interface ScriptureItemSettings extends CommonItemSettings {
  translationId?: string | null;
  references?: PassageRef[];
  split?: ScriptureSplit;
  /** Most characters on one slide (otherwise the setting in Settings → Presentation). */
  maxChars?: number;
}

export interface MediaItemSettings extends CommonItemSettings {
  fit?: BackgroundFit;
  loop?: boolean;
  muted?: boolean;
}

export interface TextItemSettings extends CommonItemSettings {
  /** Inline text when no slide deck is linked. Slides are separated by a line containing only `---`. */
  text?: string;
  /** A Canva design shown live from its public embed link (see `@/lib/canva`). */
  canvaUrl?: string;
  /** How many pages it has (Canva shows "1 / 14"); each page is a slide. */
  canvaPages?: number;
  /** Pictures of its pages for thumbnails (slide-picture media ids, by page; null where missing). */
  canvaPictures?: (string | null)[];
  /** Width ÷ height of the design, so the output can keep Canva's page bar out of sight. */
  canvaAspect?: number;
}

export interface BlankItemSettings extends CommonItemSettings {
  mode?: "theme" | "black";
}

type Obj = Record<string, unknown>;

export function themeIdOf(settings: Obj): string | null {
  return typeof settings.themeId === "string" && settings.themeId ? settings.themeId : null;
}

export function scriptureSettings(settings: Obj): Required<Pick<ScriptureItemSettings, "references">> & ScriptureItemSettings {
  const refs = Array.isArray(settings.references)
    ? settings.references.filter(
        (r): r is PassageRef => !!r && typeof r === "object" && typeof (r as PassageRef).bookId === "string" && typeof (r as PassageRef).chapter === "number",
      )
    : [];
  return {
    translationId: typeof settings.translationId === "string" ? settings.translationId : null,
    references: refs,
    ...(settings.split === "verse" || settings.split === "fit" ? { split: settings.split } : {}),
    ...(typeof settings.maxChars === "number" && Number.isFinite(settings.maxChars) ? { maxChars: Math.min(2000, Math.max(80, Math.round(settings.maxChars))) } : {}),
    themeId: themeIdOf(settings),
  };
}

export function mediaSettings(settings: Obj): Required<Omit<MediaItemSettings, "themeId">> {
  return {
    fit: settings.fit === "contain" || settings.fit === "stretch" ? settings.fit : "cover",
    loop: typeof settings.loop === "boolean" ? settings.loop : false,
    muted: typeof settings.muted === "boolean" ? settings.muted : false,
  };
}

export function textBlocks(settings: Obj): string[] {
  const text = typeof settings.text === "string" ? settings.text : "";
  return text
    .split(/\n\s*---\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export const ITEM_TYPE_LABELS: Record<ServiceItemType, string> = {
  song: "Song",
  scripture: "Scripture",
  announcement: "Announcement",
  sermon: "Sermon slides",
  image: "Image",
  video: "Video",
  custom: "Custom slides",
  heading: "Section heading",
  blank: "Blank / holding slide",
};

/** What an item is, for icons and labels: slide decks and Canva links are told apart from text. */
export type ItemKind = ServiceItemType | "presentation" | "canva";

export function itemKind(item: { itemType: ServiceItemType; refId: string | null; settings?: Record<string, unknown> | null }): ItemKind {
  if (item.settings && "canvaUrl" in item.settings) return "canva";
  if (item.itemType === "custom" && item.refId) return "presentation";
  return item.itemType;
}

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  ...ITEM_TYPE_LABELS,
  presentation: "Slides",
  canva: "Canva design (live)",
};

/** The Canva embed address of an item, or null. */
export function canvaUrlOf(settings: Obj): string | null {
  return isCanvaEmbedUrl(settings.canvaUrl) ? settings.canvaUrl : null;
}

export const MAX_CANVA_PAGES = 300;

/** Pages of a live Canva item: 1 unless the operator gave the count. */
export function canvaPagesOf(settings: Obj): number {
  const n = settings.canvaPages;
  return typeof n === "number" && Number.isFinite(n) ? Math.min(MAX_CANVA_PAGES, Math.max(1, Math.round(n))) : 1;
}

/** Picture of each page of a live Canva item (null where none was taken). */
export function canvaPicturesOf(settings: Obj): (string | null)[] {
  const ids = Array.isArray(settings.canvaPictures) ? settings.canvaPictures : [];
  return Array.from({ length: canvaPagesOf(settings) }, (_, i) => (typeof ids[i] === "string" && ids[i] ? (ids[i] as string) : null));
}

/** Width ÷ height of a live Canva design, when known. */
export function canvaAspectOf(settings: Obj): number | null {
  const a = settings.canvaAspect;
  return typeof a === "number" && Number.isFinite(a) && a > 0.1 && a < 10 ? a : null;
}

/** Settings of a Canva item whose link changed: the old page pictures and shape no longer apply. */
export function withCanvaLink(settings: Obj, embedUrl: string): Obj {
  const { canvaPictures: _p, canvaAspect: _a, ...rest } = settings;
  return { ...rest, canvaUrl: embedUrl };
}
