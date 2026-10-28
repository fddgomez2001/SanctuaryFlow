import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { DEFAULT_THEME, normalizeTheme, themeMediaIds, type ThemeSettings } from "@/lib/theme";
import { resolveMedia } from "@/services/presentation-engine/media";
import type { MediaRef } from "@/services/presentation-engine/render-model";
import { setting, useSettings } from "./useSettings";

export const THEMES_KEY = ["themes"] as const;

export function useThemes() {
  return useQuery({ queryKey: THEMES_KEY, queryFn: api.themes.list, staleTime: 30_000 });
}

/** Resolves media ids to local URLs (cached per id set). */
export function useMediaRefs(ids: string[]) {
  const key = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ["media-refs", key],
    queryFn: async () => (await resolveMedia(key)).refs,
    enabled: key.length > 0,
    staleTime: 60_000,
  });
}

/**
 * A theme ready to render: the given theme, or the default for the content
 * kind, plus URLs for its background and logo media.
 */
export function useRenderTheme(
  themeId: string | null | undefined,
  kind: "song" | "scripture" | "announcement" = "song",
): { theme: ThemeSettings; media: Record<string, MediaRef>; themeId: string | null } {
  const themes = useThemes();
  const settings = useSettings();
  const defaultKey = {
    song: "presentation.defaultSongThemeId",
    scripture: "presentation.defaultScriptureThemeId",
    announcement: "presentation.defaultAnnouncementThemeId",
  }[kind];
  const resolvedId = themeId || setting<string | null>(settings.data, defaultKey, null);
  const raw = themes.data?.find((t) => t.id === resolvedId)?.settings;
  const theme = useMemo(() => (raw ? normalizeTheme(raw) : DEFAULT_THEME), [raw]);
  const media = useMediaRefs(themeMediaIds(theme));
  return { theme, media: media.data ?? {}, themeId: resolvedId };
}
