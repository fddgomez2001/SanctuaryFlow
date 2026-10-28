/**
 * Presentation theme settings. Stored as JSON by the core; normalized here so
 * older or hand-edited themes always render with safe defaults.
 *
 * Sizes are in pixels on a canvas 1080 units tall; the renderer scales them
 * to the real output resolution.
 */
export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";
export type BackgroundType = "black" | "color" | "image" | "video";
export type BackgroundFit = "cover" | "contain" | "stretch";
export type LogoPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type TextCase = "none" | "capitalize" | "uppercase";
export type TransitionType = "none" | "fade" | "slide" | "rise" | "zoom" | "blur";
export type BackgroundStyle = "plain" | "gold-glow" | "royal-night" | "warm-dusk" | "metallic-gold";

/**
 * Built-in backdrops for a black or colour background: soft gold light, and
 * for some a fine double gold frame. Fixed designs (not free CSS) so a theme
 * can never inject anything into the output.
 */
export const BACKGROUND_STYLES: { value: BackgroundStyle; label: string; css: string | null; frame: boolean }[] = [
  { value: "plain", label: "Plain", css: null, frame: false },
  {
    value: "gold-glow",
    label: "Golden glow",
    css: "radial-gradient(ellipse 75% 55% at 50% -5%, rgb(224 185 92 / 0.42), transparent 70%), radial-gradient(ellipse 60% 45% at 50% 108%, rgb(176 132 42 / 0.28), transparent 72%), radial-gradient(ellipse 120% 90% at 50% 50%, transparent 55%, rgb(0 0 0 / 0.55) 100%), linear-gradient(180deg, #1a140b 0%, #0b0906 100%)",
    frame: false,
  },
  {
    value: "royal-night",
    label: "Royal night, gold frame",
    css: "radial-gradient(ellipse 55% 60% at 88% 105%, rgb(176 132 42 / 0.38), transparent 70%), radial-gradient(ellipse 55% 55% at 8% -5%, rgb(90 120 200 / 0.28), transparent 70%), linear-gradient(160deg, #1f2d4d 0%, #0e152b 58%, #070a14 100%)",
    frame: true,
  },
  {
    value: "warm-dusk",
    label: "Warm dusk, gold frame",
    css: "radial-gradient(ellipse 85% 70% at 50% 45%, rgb(176 132 42 / 0.2), transparent 72%), radial-gradient(ellipse 120% 95% at 50% 50%, transparent 60%, rgb(0 0 0 / 0.6) 100%), linear-gradient(180deg, #1d1813 0%, #0f0c09 100%)",
    frame: true,
  },
  {
    // Brushed gold with a soft sheen, a little deeper in the middle so white words stay readable.
    value: "metallic-gold",
    label: "Metallic gold",
    css: "repeating-linear-gradient(100deg, rgb(255 255 255 / 0.035) 0 2px, transparent 2px 5px), radial-gradient(ellipse 72% 58% at 50% 50%, rgb(58 36 4 / 0.34), transparent 78%), linear-gradient(118deg, transparent 30%, rgb(255 246 214 / 0.26) 43%, transparent 56%), radial-gradient(ellipse 130% 100% at 50% 50%, transparent 58%, rgb(40 24 2 / 0.45) 100%), linear-gradient(135deg, #5e400b 0%, #9a7224 18%, #d6b465 32%, #a67c28 46%, #6f4d10 60%, #b48a35 76%, #dcbc6c 89%, #8a6417 100%)",
    frame: false,
  },
];

/** How words change from one slide to the next. */
export const TRANSITIONS: { value: TransitionType; label: string }[] = [
  { value: "fade", label: "Fade" },
  { value: "slide", label: "Slide across" },
  { value: "rise", label: "Rise up" },
  { value: "zoom", label: "Zoom" },
  { value: "blur", label: "Blur" },
  { value: "none", label: "None (cut)" },
];

export const TEXT_CASES: { value: TextCase; label: string }[] = [
  { value: "none", label: "As typed" },
  { value: "capitalize", label: "Title Case" },
  { value: "uppercase", label: "CAPITALS" },
];

export interface ThemeBackground {
  type: BackgroundType;
  /** Backdrop design for black and colour backgrounds. */
  style: BackgroundStyle;
  color: string;
  mediaId: string | null;
  fit: BackgroundFit;
  overlayColor: string;
  overlayOpacity: number;
  videoLoop: boolean;
  videoMuted: boolean;
}

export interface ThemeSettings {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  lineHeight: number;
  textTransform: TextCase;
  italic: boolean;
  textShadow: boolean;
  textOutline: boolean;
  safeMargin: number;
  /** Width of the text area, in percent of the space inside the safe margin. */
  textWidth: number;
  background: ThemeBackground;
  reference: { show: boolean; position: "top" | "bottom"; fontSize: number; color: string; showTranslation: boolean };
  verseNumbers: { show: boolean };
  footer: { showSongInfo: boolean; fontSize: number; color: string };
  logo: { show: boolean; mediaId: string | null; position: LogoPosition; size: number };
  transition: { type: TransitionType; durationMs: number };
}

export const CANVAS_HEIGHT = 1080;

export const FONT_CHOICES = [
  "Inter Variable",
  "Poppins",
  "Montserrat Variable",
  "Outfit Variable",
  "Playfair Display Variable",
  "Segoe UI",
  "Arial",
  "Calibri",
  "Verdana",
  "Tahoma",
  "Georgia",
  "Cambria",
  "Times New Roman",
  "Palatino Linotype",
  "Trebuchet MS",
  "Impact",
] as const;

/** "Montserrat Variable" → "Montserrat" for menus. */
export function fontLabel(family: string): string {
  return family.replace(/ Variable$/, "");
}

export const DEFAULT_THEME: ThemeSettings = {
  fontFamily: "Inter Variable",
  fontSize: 72,
  fontWeight: 600,
  textColor: "#FFFFFF",
  textAlign: "center",
  verticalAlign: "middle",
  lineHeight: 1.25,
  textTransform: "none",
  italic: false,
  textShadow: true,
  textOutline: false,
  safeMargin: 6,
  textWidth: 100,
  background: {
    type: "black",
    style: "plain",
    color: "#000000",
    mediaId: null,
    fit: "cover",
    overlayColor: "#000000",
    overlayOpacity: 0,
    videoLoop: true,
    videoMuted: true,
  },
  reference: { show: true, position: "bottom", fontSize: 40, color: "#D6DEEA", showTranslation: true },
  verseNumbers: { show: true },
  footer: { showSongInfo: false, fontSize: 24, color: "#A8B2C1" },
  logo: { show: false, mediaId: null, position: "bottom-right", size: 10 },
  transition: { type: "fade", durationMs: 300 },
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown, fallback: string, max = 120): string {
  return typeof v === "string" && v.trim() ? v.slice(0, max) : fallback;
}
function color(v: unknown, fallback: string): string {
  return typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim()) ? v.trim() : fallback;
}
function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}
function idOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;
}

/** Fills missing values and clamps out-of-range ones. Never throws. */
export function normalizeTheme(raw: unknown, base: ThemeSettings = DEFAULT_THEME): ThemeSettings {
  const r = isObj(raw) ? raw : {};
  const bg = isObj(r.background) ? r.background : {};
  const ref = isObj(r.reference) ? r.reference : {};
  const vn = isObj(r.verseNumbers) ? r.verseNumbers : {};
  const ft = isObj(r.footer) ? r.footer : {};
  const lg = isObj(r.logo) ? r.logo : {};
  const tr = isObj(r.transition) ? r.transition : {};
  return {
    fontFamily: str(r.fontFamily, base.fontFamily, 80),
    fontSize: num(r.fontSize, base.fontSize, 16, 240),
    fontWeight: num(r.fontWeight, base.fontWeight, 100, 900),
    textColor: color(r.textColor, base.textColor),
    textAlign: oneOf(r.textAlign, ["left", "center", "right"], base.textAlign),
    verticalAlign: oneOf(r.verticalAlign, ["top", "middle", "bottom"], base.verticalAlign),
    lineHeight: num(r.lineHeight, base.lineHeight, 0.9, 2.5),
    textTransform: oneOf(r.textTransform, ["none", "capitalize", "uppercase"], base.textTransform),
    italic: bool(r.italic, base.italic),
    textShadow: bool(r.textShadow, base.textShadow),
    textOutline: bool(r.textOutline, base.textOutline),
    safeMargin: num(r.safeMargin, base.safeMargin, 0, 20),
    textWidth: num(r.textWidth, base.textWidth, 30, 100),
    background: {
      type: oneOf(bg.type, ["black", "color", "image", "video"], base.background.type),
      style: oneOf(bg.style, ["plain", "gold-glow", "royal-night", "warm-dusk", "metallic-gold"], base.background.style),
      color: color(bg.color, base.background.color),
      mediaId: bg.mediaId === undefined ? base.background.mediaId : idOrNull(bg.mediaId),
      fit: oneOf(bg.fit, ["cover", "contain", "stretch"], base.background.fit),
      overlayColor: color(bg.overlayColor, base.background.overlayColor),
      overlayOpacity: num(bg.overlayOpacity, base.background.overlayOpacity, 0, 1),
      videoLoop: bool(bg.videoLoop, base.background.videoLoop),
      videoMuted: bool(bg.videoMuted, base.background.videoMuted),
    },
    reference: {
      show: bool(ref.show, base.reference.show),
      position: oneOf(ref.position, ["top", "bottom"], base.reference.position),
      fontSize: num(ref.fontSize, base.reference.fontSize, 12, 160),
      color: color(ref.color, base.reference.color),
      showTranslation: bool(ref.showTranslation, base.reference.showTranslation),
    },
    verseNumbers: { show: bool(vn.show, base.verseNumbers.show) },
    footer: {
      showSongInfo: bool(ft.showSongInfo, base.footer.showSongInfo),
      fontSize: num(ft.fontSize, base.footer.fontSize, 10, 80),
      color: color(ft.color, base.footer.color),
    },
    logo: {
      show: bool(lg.show, base.logo.show),
      mediaId: lg.mediaId === undefined ? base.logo.mediaId : idOrNull(lg.mediaId),
      position: oneOf(lg.position, ["top-left", "top-right", "bottom-left", "bottom-right"], base.logo.position),
      size: num(lg.size, base.logo.size, 2, 40),
    },
    transition: {
      type: oneOf(tr.type, ["none", "fade", "slide", "rise", "zoom", "blur"], base.transition.type),
      durationMs: num(tr.durationMs, base.transition.durationMs, 0, 3000),
    },
  };
}

/** Media ids referenced by a theme (background and logo). */
export function themeMediaIds(t: ThemeSettings): string[] {
  const ids: string[] = [];
  if ((t.background.type === "image" || t.background.type === "video") && t.background.mediaId) ids.push(t.background.mediaId);
  if (t.logo.show && t.logo.mediaId) ids.push(t.logo.mediaId);
  return ids;
}
