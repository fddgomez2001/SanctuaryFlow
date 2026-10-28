import type { SettingsMap } from "@/services/api";
import { setting } from "@/hooks/useSettings";

/** Where artist cover pictures are kept (a setting: artist key → media id). */
export const ARTIST_COVERS_KEY = "songs.artistCovers";

/** A picture chosen to replace the gold album picture for songs and artists without a cover (a setting: media id). */
export const DEFAULT_COVER_KEY = "songs.defaultCover";

/** The chosen default cover, if any; without one the gold album picture (`@/lib/default-art`) is used. */
export function defaultCoverId(settings: SettingsMap | undefined): string | null {
  return setting<string | null>(settings, DEFAULT_COVER_KEY, null) || null;
}

/** "  Hillsong   WORSHIP " → "hillsong worship": one artist however it is typed. */
export const artistKey = (name: string | null | undefined) => (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** The cover picture chosen for an artist, if any. */
export function artistCoverId(covers: unknown, artist: string | null | undefined): string | null {
  if (!covers || typeof covers !== "object") return null;
  const id = (covers as Record<string, unknown>)[artistKey(artist)];
  return typeof id === "string" && id ? id : null;
}
