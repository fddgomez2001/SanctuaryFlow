/**
 * Saving the look of one lineup item. A look made for one item is a theme
 * marked with that item's id, so changing it again (in the Customize editor
 * or by dropping a background on it) updates the same theme instead of
 * adding another one.
 */
import type { Theme } from "@/types/generated/Theme";
import type { ThemeDocument } from "@/types/generated/ThemeDocument";
import { api } from "@/services/api";
import { queryClient } from "@/app/queryClient";
import { THEMES_KEY } from "@/hooks/useThemes";
import { setting } from "@/hooks/useSettings";
import { themeIdOf } from "@/lib/service-items";
import type { ThemeBackground, ThemeSettings } from "@/lib/theme";
import type { PresentationItem } from "@/services/presentation-engine/engine";
import { itemTheme, useLive } from "@/services/presentation-engine/store";

export const FOR_ITEM = "customizedFor";

export type LookScope = { scope: "item" } | { scope: "theme" } | { scope: "new"; name: string };

/** The theme an item is shown with now, and whether it is that item's own look. */
export function lookBase(item: PresentationItem, themes: Theme[]) {
  const live = useLive.getState();
  const source = [...live.serviceItems, ...live.adhocItems].find((s) => s.id === item.id);
  const baseId = item.themeId ?? setting<string | null>(live.settings, "presentation.defaultSongThemeId", null);
  const record = themes.find((t) => t.id === baseId);
  const ownForItem = !!record && !record.isBuiltin && record.settings[FOR_ITEM] === item.id && themeIdOf(source?.settings ?? {}) === record.id;
  return { record, ownForItem, sourceThemeId: themeIdOf(source?.settings ?? {}) };
}

/** Saves `settings` as the item's own look, into its theme, or as a new named theme used by the item. */
export async function saveItemLook(item: PresentationItem, settings: ThemeSettings, target: LookScope): Promise<Theme> {
  const themes = await queryClient.fetchQuery({ queryKey: THEMES_KEY, queryFn: api.themes.list, staleTime: 0 });
  const { record, ownForItem, sourceThemeId } = lookBase(item, themes);
  let doc: ThemeDocument;
  if (target.scope === "theme") {
    if (!record || record.isBuiltin) throw new Error("Built-in themes can't be changed. Save a new theme instead.");
    doc = { id: record.id, name: record.name, category: record.category, settings: { ...record.settings, ...settings } };
  } else if (target.scope === "new") {
    doc = { id: null, name: target.name.trim() || `${item.title} theme`, category: record?.category ?? "general", settings: { ...settings } };
  } else if (ownForItem && record) {
    doc = { id: record.id, name: record.name, category: record.category, settings: { ...settings, [FOR_ITEM]: item.id } };
  } else {
    doc = { id: null, name: `${item.title} (custom)`, category: record?.category ?? "general", settings: { ...settings, [FOR_ITEM]: item.id } };
  }
  const saved = await api.themes.save(doc);
  await queryClient.invalidateQueries({ queryKey: THEMES_KEY });
  await useLive.getState().refreshThemes();
  if (target.scope !== "theme" && sourceThemeId !== saved.id) await useLive.getState().setItemTheme(item.id, saved.id);
  return saved;
}

/** Puts a picture or video behind one item's words, keeping the rest of its look. */
export async function setItemBackground(item: PresentationItem, media: { id: string; kind: string }): Promise<Theme> {
  const current = itemTheme(useLive.getState(), item.themeId);
  const background: ThemeBackground = {
    ...current.background,
    type: media.kind === "video" ? "video" : "image",
    mediaId: media.id,
    fit: "cover",
    videoLoop: true,
    videoMuted: true,
  };
  return saveItemLook(item, { ...current, background }, { scope: "item" });
}
