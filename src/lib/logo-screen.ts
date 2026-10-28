/**
 * The logo / holding screen (the Logo button): a church logo picture or
 * video over its own background, and how quickly the output fades between
 * slides, black, clear and the logo.
 */
import type { SettingsMap } from "@/services/api";
import { setting } from "@/hooks/useSettings";
import type { ThemeBackground } from "@/lib/theme";

export type LogoBackgroundType = "theme" | "black" | "color" | "image" | "video";

export interface LogoBackgroundSetting {
  type: LogoBackgroundType;
  color: string;
  mediaId: string | null;
}

export interface LogoScreenSettings {
  /** A picture (shown centred) or a video (fills the screen, looping). */
  logoMediaId: string | null;
  background: LogoBackgroundSetting;
  /** Height of a logo picture, in percent of the screen. */
  size: number;
  /** Play a logo video with its sound. */
  sound: boolean;
}

export const LOGO_KEYS = {
  media: "presentation.logoMediaId",
  background: "presentation.logoBackground",
  size: "presentation.logoSize",
  sound: "presentation.logoVideoSound",
} as const;

export const OUTPUT_FADE_KEY = "presentation.outputFadeMs";
export const DEFAULT_OUTPUT_FADE_MS = 500;

const TYPES: LogoBackgroundType[] = ["theme", "black", "color", "image", "video"];
const isColor = (v: unknown): v is string => typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

export function logoScreenSettings(settings: SettingsMap | undefined): LogoScreenSettings {
  const raw = setting<unknown>(settings, LOGO_KEYS.background, null);
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const type = TYPES.includes(o.type as LogoBackgroundType) ? (o.type as LogoBackgroundType) : "theme";
  const size = setting<number>(settings, LOGO_KEYS.size, 45);
  return {
    logoMediaId: setting<string | null>(settings, LOGO_KEYS.media, null) || null,
    background: {
      type,
      color: isColor(o.color) ? o.color : "#000000",
      mediaId: typeof o.mediaId === "string" && o.mediaId ? o.mediaId : null,
    },
    size: typeof size === "number" && Number.isFinite(size) ? Math.min(90, Math.max(10, size)) : 45,
    sound: setting<boolean>(settings, LOGO_KEYS.sound, false) === true,
  };
}

/** Media the logo screen needs on the output. */
export function logoScreenMediaIds(s: LogoScreenSettings): string[] {
  const ids = s.logoMediaId ? [s.logoMediaId] : [];
  if ((s.background.type === "image" || s.background.type === "video") && s.background.mediaId) ids.push(s.background.mediaId);
  return ids;
}

/** The logo screen's own background, or null to keep the theme background. */
export function logoBackground(bg: LogoBackgroundSetting): ThemeBackground | null {
  if (bg.type === "theme") return null;
  const media = bg.type === "image" || bg.type === "video" ? bg.mediaId : null;
  return {
    // A picture or video that is not chosen yet falls back to the colour.
    type: bg.type === "black" ? "black" : media ? bg.type : "color",
    style: "plain",
    color: bg.type === "black" ? "#000000" : bg.color,
    mediaId: media,
    fit: "cover",
    overlayColor: "#000000",
    overlayOpacity: 0,
    videoLoop: true,
    videoMuted: true,
  };
}

/** Fade length for Black, Clear, Logo and Stop, in milliseconds. */
export function outputFadeMs(settings: SettingsMap | undefined): number {
  const v = setting<number>(settings, OUTPUT_FADE_KEY, DEFAULT_OUTPUT_FADE_MS);
  return typeof v === "number" && Number.isFinite(v) ? Math.min(3000, Math.max(0, Math.round(v))) : DEFAULT_OUTPUT_FADE_MS;
}
