/**
 * Turns service items into slides, loading songs, Scripture and slide decks
 * from the local library. A problem with one item (deleted song, missing
 * translation) is attached to that item and never blocks the others.
 */
import type { ServiceItem } from "@/types/generated/ServiceItem";
import type { SettingsMap } from "@/services/api";
import { api } from "@/services/api";
import { errorMessage } from "@/lib/ipc";
import { setting } from "@/hooks/useSettings";
import { songToSlides } from "@/lib/slides/lyrics";
import { passageToSlides, type ScriptureSplit } from "@/lib/slides/scripture";
import { deckSlideMediaIds, normalizeDeckSlides } from "@/lib/slides/deck";
import type { Slide } from "@/lib/slides/types";
import { canvaAspectOf, canvaPagesOf, canvaPicturesOf, canvaUrlOf, itemKind, mediaSettings, scriptureSettings, textBlocks, themeIdOf } from "@/lib/service-items";
import { normalizeTheme, themeMediaIds, type ThemeSettings } from "@/lib/theme";
import { formatReference } from "@/lib/bible/reference";
import { logoScreenMediaIds, logoScreenSettings } from "@/lib/logo-screen";
import { ARTIST_COVERS_KEY, artistCoverId, defaultCoverId } from "@/lib/artists";
import { canonBook } from "@/lib/bible/canon";
import type { PresentationItem } from "./engine";
import { resolveMedia } from "./media";
import type { MediaRef } from "./render-model";

export interface ResolveContext {
  settings: SettingsMap | undefined;
  planThemeId: string | null;
  themes: Map<string, ThemeSettings>;
}

function defaultTheme(ctx: ResolveContext, kind: "song" | "scripture" | "announcement"): string | null {
  const key = {
    song: "presentation.defaultSongThemeId",
    scripture: "presentation.defaultScriptureThemeId",
    announcement: "presentation.defaultAnnouncementThemeId",
  }[kind];
  return setting<string | null>(ctx.settings, key, null);
}

function renumber(itemId: string, slides: Slide[]): Slide[] {
  return slides.map((s, i) => ({ ...s, id: `${itemId}:${i}` }));
}

async function resolveOne(item: ServiceItem, ctx: ResolveContext): Promise<PresentationItem> {
  const base = { id: item.id, title: item.title, type: item.itemType, kind: itemKind(item) };
  const s = item.settings ?? {};
  const override = themeIdOf(s);
  try {
    switch (item.itemType) {
      case "song": {
        if (!item.refId) throw new Error("No song is linked to this item.");
        const song = await api.songs.get(item.refId).catch(() => {
          throw new Error("This song is no longer in the library.");
        });
        const slides = songToSlides(song, item.id, {
          maxLinesPerSlide: setting(ctx.settings, "presentation.maxLinesPerSlide", 4),
          ccliLicenseNumber: setting(ctx.settings, "presentation.ccliLicenseNumber", ""),
        });
        const music = song.audioMediaId
          ? {
              songId: song.id,
              audioMediaId: song.audioMediaId,
              coverMediaId: song.coverMediaId ?? artistCoverId(setting<unknown>(ctx.settings, ARTIST_COVERS_KEY, {}), song.artist) ?? defaultCoverId(ctx.settings),
              title: song.title,
              artist: song.artist,
              lines: (song.lyricSync ?? []).map(({ text, section, startMs, endMs }) => ({ text, section, startMs, endMs })),
            }
          : undefined;
        const result: PresentationItem = { ...base, slides, music, themeId: override ?? song.themeId ?? ctx.planThemeId ?? defaultTheme(ctx, "song") };
        return slides.length ? result : { ...result, error: "This song has no lyrics yet." };
      }
      case "scripture": {
        const sc = scriptureSettings(s);
        const translationId = sc.translationId ?? setting<string | null>(ctx.settings, "bible.defaultTranslationId", null);
        const themeId = override ?? ctx.planThemeId ?? defaultTheme(ctx, "scripture");
        if (!translationId) return { ...base, slides: [], themeId, error: "Choose a Bible translation for this passage." };
        if (!sc.references.length) return { ...base, slides: [], themeId, error: "No passage is selected." };
        const slides: Slide[] = [];
        const problems: string[] = [];
        for (const ref of sc.references) {
          try {
            const passage = await api.bible.passage(translationId, ref);
            slides.push(
              ...passageToSlides({ bookName: passage.bookName, translationCode: passage.translationCode, verses: passage.verses }, item.id, {
                split: sc.split ?? setting<ScriptureSplit>(ctx.settings, "presentation.scriptureSplit", "fit"),
                maxChars: sc.maxChars ?? setting(ctx.settings, "presentation.maxScriptureCharsPerSlide", 320),
                hideParagraphMarks: setting(ctx.settings, "bible.hideParagraphMarks", true),
              }),
            );
          } catch (e) {
            problems.push(`${formatReference(canonBook(ref.bookId)?.name ?? ref.bookId, ref)}: ${errorMessage(e)}`);
          }
        }
        return { ...base, slides: renumber(item.id, slides), themeId, ...(problems.length ? { error: problems.join(" ") } : {}) };
      }
      case "announcement":
      case "sermon":
      case "custom": {
        const fallbackTheme = override ?? ctx.planThemeId ?? defaultTheme(ctx, "announcement");
        if ("canvaUrl" in s) {
          const url = canvaUrlOf(s);
          if (!url) return { ...base, slides: [], themeId: fallbackTheme, error: "The Canva link is not valid. Paste it again in the Service Planner." };
          const pages = canvaPagesOf(s);
          const pictures = canvaPicturesOf(s);
          const aspect = canvaAspectOf(s);
          return {
            ...base,
            themeId: fallbackTheme,
            slides: Array.from({ length: pages }, (_, i) => ({
              id: `${item.id}:${i}`,
              itemId: item.id,
              label: pages > 1 ? `Page ${i + 1}` : item.title,
              content: {
                kind: "web" as const,
                url,
                title: item.title,
                provider: "canva" as const,
                page: i + 1,
                ...(pictures[i] ? { pictureId: pictures[i] } : {}),
                ...(aspect ? { aspect } : {}),
              },
            })),
          };
        }
        if (item.refId) {
          const deck = await api.decks.get(item.refId).catch(() => {
            throw new Error("The linked slide deck is no longer in the library.");
          });
          const slides = normalizeDeckSlides(deck.slides).map<Slide>((slide, i) => ({
            id: `${item.id}:${i}`,
            itemId: item.id,
            label: `Slide ${i + 1}`,
            content: { kind: "custom", slide },
            ...(slide.notes ? { notes: slide.notes } : {}),
          }));
          return { ...base, slides, themeId: override ?? deck.themeId ?? fallbackTheme, ...(slides.length ? {} : { error: "The slide deck is empty." }) };
        }
        const blocks = textBlocks(s);
        const slides = blocks.map<Slide>((body, i) => ({
          id: `${item.id}:${i}`,
          itemId: item.id,
          label: blocks.length > 1 ? `${item.title} (${i + 1}/${blocks.length})` : item.title,
          content: { kind: "text", title: i === 0 && item.itemType !== "custom" ? item.title : null, body },
        }));
        return { ...base, slides, themeId: fallbackTheme, ...(slides.length ? {} : { error: "Add text or link a slide deck." }) };
      }
      case "image":
      case "video": {
        if (!item.refId) throw new Error("No media file is linked to this item.");
        const m = mediaSettings(s);
        return {
          ...base,
          themeId: override ?? ctx.planThemeId,
          slides: [
            {
              id: `${item.id}:0`,
              itemId: item.id,
              label: item.title,
              content: { kind: "media", mediaId: item.refId, mediaType: item.itemType, fit: m.fit, loop: m.loop, muted: m.muted },
            },
          ],
        };
      }
      case "heading":
        return { ...base, slides: [], themeId: null };
      case "blank":
        return {
          ...base,
          themeId: override ?? ctx.planThemeId,
          slides: [{ id: `${item.id}:0`, itemId: item.id, label: item.title, content: { kind: "blank", black: s.mode === "black" } }],
        };
    }
  } catch (e) {
    return { ...base, slides: [], themeId: null, error: errorMessage(e) };
  }
}

export interface ResolvedPresentation {
  items: PresentationItem[];
  media: Record<string, MediaRef>;
}

/** Page pictures of a Canva item: thumbnails only, so a missing one is not a problem. */
function pictureIds(item: PresentationItem): string[] {
  return item.slides.flatMap((s) => (s.content.kind === "web" && s.content.pictureId ? [s.content.pictureId] : []));
}

/** Media used by an item's slides and theme. */
export function itemMediaIds(item: PresentationItem, themes: Map<string, ThemeSettings>): string[] {
  const ids: string[] = [];
  const theme = item.themeId ? themes.get(item.themeId) : undefined;
  if (theme) ids.push(...themeMediaIds(theme));
  if (item.music) ids.push(item.music.audioMediaId, ...(item.music.coverMediaId ? [item.music.coverMediaId] : []));
  for (const slide of item.slides) {
    if (slide.content.kind === "media") ids.push(slide.content.mediaId);
    if (slide.content.kind === "custom") ids.push(...deckSlideMediaIds(slide.content.slide));
  }
  return ids;
}

export async function resolveItems(items: ServiceItem[], ctx: ResolveContext): Promise<ResolvedPresentation> {
  const resolved = await Promise.all(items.map((i) => resolveOne(i, ctx)));
  const ids = [...resolved.flatMap((i) => [...itemMediaIds(i, ctx.themes), ...pictureIds(i)]), ...logoScreenMediaIds(logoScreenSettings(ctx.settings))];
  const { refs, missing } = await resolveMedia(ids);
  const withWarnings = resolved.map((item) => {
    const lost = itemMediaIds(item, ctx.themes).filter((id) => missing.includes(id));
    return lost.length && !item.error ? { ...item, error: "A media file used by this item is missing. The background colour will be shown instead." } : item;
  });
  return { items: withWarnings, media: refs };
}

/** Loads every theme, normalized, keyed by id. */
export async function loadThemes(): Promise<Map<string, ThemeSettings>> {
  const list = await api.themes.list();
  return new Map(list.map((t) => [t.id, normalizeTheme(t.settings)]));
}
