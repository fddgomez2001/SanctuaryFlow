import { DEFAULT_THEME, normalizeTheme, type ThemeBackground } from "@/lib/theme";
import type { DeckSlide, ElementBox, ImageElement, ShapeElement, SlideElement, TextElement } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const n = (v: unknown, d: number, min = -1e6, max = 1e6) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const s = (v: unknown, d: string, max = 5000) => (typeof v === "string" ? v.slice(0, max) : d);
const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const color = (v: unknown, d: string) => (typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : d);

export function newId(): string {
  return crypto.randomUUID();
}

function box(v: unknown, d: ElementBox): ElementBox {
  const o = isObj(v) ? v : {};
  return { x: n(o.x, d.x, -50, 150), y: n(o.y, d.y, -50, 150), w: n(o.w, d.w, 1, 200), h: n(o.h, d.h, 1, 200) };
}

export function textElement(partial: Partial<TextElement> = {}): TextElement {
  return {
    id: newId(),
    type: "text",
    box: { x: 8, y: 30, w: 84, h: 40 },
    text: "Your text",
    fontFamily: DEFAULT_THEME.fontFamily,
    fontSize: 72,
    fontWeight: 600,
    color: "#FFFFFF",
    align: "center",
    verticalAlign: "middle",
    lineHeight: 1.2,
    italic: false,
    uppercase: false,
    shadow: true,
    autoFit: true,
    ...partial,
  };
}

export function imageElement(mediaId: string | null, partial: Partial<ImageElement> = {}): ImageElement {
  return { id: newId(), type: "image", box: { x: 25, y: 20, w: 50, h: 60 }, mediaId, fit: "contain", opacity: 1, radius: 0, cropX: 50, cropY: 50, ...partial };
}

export function shapeElement(partial: Partial<ShapeElement> = {}): ShapeElement {
  return { id: newId(), type: "shape", box: { x: 0, y: 70, w: 100, h: 30 }, color: "#000000", opacity: 0.5, radius: 0, ...partial };
}

export function blankDeckSlide(): DeckSlide {
  return { id: newId(), background: null, elements: [textElement()] };
}

function element(raw: unknown): SlideElement | null {
  if (!isObj(raw)) return null;
  const id = s(raw.id, "", 64) || newId();
  if (raw.type === "text") {
    const d = textElement({ id });
    return {
      ...d,
      box: box(raw.box, d.box),
      text: s(raw.text, ""),
      fontFamily: s(raw.fontFamily, d.fontFamily, 80) || d.fontFamily,
      fontSize: n(raw.fontSize, d.fontSize, 8, 300),
      fontWeight: n(raw.fontWeight, d.fontWeight, 100, 900),
      color: color(raw.color, d.color),
      align: raw.align === "left" || raw.align === "right" ? raw.align : "center",
      verticalAlign: raw.verticalAlign === "top" || raw.verticalAlign === "bottom" ? raw.verticalAlign : "middle",
      lineHeight: n(raw.lineHeight, d.lineHeight, 0.8, 3),
      italic: b(raw.italic, false),
      uppercase: b(raw.uppercase, false),
      shadow: b(raw.shadow, true),
      autoFit: b(raw.autoFit, true),
    };
  }
  if (raw.type === "image") {
    const d = imageElement(null, { id });
    return {
      ...d,
      box: box(raw.box, d.box),
      mediaId: typeof raw.mediaId === "string" && raw.mediaId ? raw.mediaId : null,
      fit: raw.fit === "cover" ? "cover" : "contain",
      opacity: n(raw.opacity, 1, 0, 1),
      radius: n(raw.radius, 0, 0, 500),
      cropX: n(raw.cropX, 50, 0, 100),
      cropY: n(raw.cropY, 50, 0, 100),
    };
  }
  if (raw.type === "shape") {
    const d = shapeElement({ id });
    return { ...d, box: box(raw.box, d.box), color: color(raw.color, d.color), opacity: n(raw.opacity, d.opacity, 0, 1), radius: n(raw.radius, 0, 0, 500) };
  }
  return null;
}

/** Validates a stored slide document; unknown elements are dropped. */
export function normalizeDeckSlide(raw: unknown): DeckSlide {
  const o = isObj(raw) ? raw : {};
  const background: ThemeBackground | null = isObj(o.background) ? normalizeTheme({ background: o.background }).background : null;
  const notes = typeof o.notes === "string" ? o.notes : undefined;
  return {
    id: s(o.id, "", 64) || newId(),
    background,
    elements: Array.isArray(o.elements) ? o.elements.map(element).filter((e): e is SlideElement => e !== null) : [],
    ...(notes ? { notes } : {}),
  };
}

export function normalizeDeckSlides(raw: unknown): DeckSlide[] {
  return Array.isArray(raw) ? raw.map(normalizeDeckSlide) : [];
}

/** Media ids used by a slide (background and image elements). */
export function deckSlideMediaIds(slide: DeckSlide): string[] {
  const ids = slide.elements.flatMap((e) => (e.type === "image" && e.mediaId ? [e.mediaId] : []));
  if (slide.background?.mediaId && (slide.background.type === "image" || slide.background.type === "video")) ids.push(slide.background.mediaId);
  return ids;
}
