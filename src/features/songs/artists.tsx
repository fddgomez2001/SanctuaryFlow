import { useQuery } from "@tanstack/react-query";
import type { SongSummary } from "@/types/generated/SongSummary";
import { api } from "@/services/api";
import { setting, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { useMediaRefs } from "@/hooks/useThemes";
import { cn } from "@/lib/cn";
import { ARTIST_COVERS_KEY, artistKey, DEFAULT_COVER_KEY, defaultCoverId } from "@/lib/artists";
import { DEFAULT_ALBUM_URL } from "@/lib/default-art";
import { defaultSongQuery } from "./query";

/** Songs grouped under the artist (or worship leader) that sings them. */
export interface Artist {
  /** Lower-case name; "" for songs without an artist. */
  key: string;
  name: string;
  songs: SongSummary[];
}

export const NO_ARTIST = "No artist";
const COVERS_KEY = ARTIST_COVERS_KEY;
export { artistKey };

/** Groups songs by artist, A–Z, with songs that have no artist last. Spelling differences in case and spacing are merged. */
export function groupByArtist(songs: SongSummary[]): Artist[] {
  const groups = new Map<string, Artist>();
  for (const song of songs) {
    const key = artistKey(song.artist);
    let group = groups.get(key);
    if (!group) {
      group = { key, name: key ? song.artist!.trim().replace(/\s+/g, " ") : NO_ARTIST, songs: [] };
      groups.set(key, group);
    }
    group.songs.push(song);
  }
  return [...groups.values()].sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
}

/** Every song that is not archived, for the artist pages (a church library is small enough to load at once). */
export function useAllSongs() {
  return useQuery({ queryKey: ["songs", "all"], queryFn: () => api.songs.list({ ...defaultSongQuery(), limit: 10_000 }) });
}

/** Artist cover pictures, kept on this computer, and the default cover for those without one. */
export function useArtistCovers() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const raw = setting<unknown>(settings.data, COVERS_KEY, {});
  const covers: Record<string, string> = raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
  const chosenId = defaultCoverId(settings.data);
  const refs = useMediaRefs([...Object.values(covers), ...(chosenId ? [chosenId] : [])]);
  const urlOf = (id: string | null | undefined) => {
    const ref = id ? refs.data?.[id] : undefined;
    return ref ? (ref.posterUrl ?? ref.url) : null;
  };
  const chosenUrl = urlOf(chosenId);
  const defaultUrl = chosenUrl ?? DEFAULT_ALBUM_URL;
  return {
    /** The artist's cover, or the default cover. */
    coverUrl: (key: string) => urlOf(covers[key]) ?? defaultUrl,
    /** True for a chosen default cover, shown whole as it is often a logo. */
    isDefault: (url: string | null) => !!url && url === chosenUrl,
    defaultUrl,
    /** A picture was chosen to replace the gold album picture. */
    defaultChosen: !!chosenId,
    setDefaultCover: (mediaId: string | null) => update.mutate({ [DEFAULT_COVER_KEY]: mediaId }),
    hasCover: (key: string) => !!covers[key],
    setCover: (key: string, mediaId: string | null) => {
      const next = { ...covers };
      if (mediaId) next[key] = mediaId;
      else delete next[key];
      update.mutate({ [COVERS_KEY]: next });
    },
  };
}

/**
 * The artist's cover picture, or their initials in gold. A default cover
 * (`contain`) is shown whole on a dark ground, as it is usually a logo.
 */
export function ArtistCover({
  name,
  url,
  contain,
  size = "md",
  className,
}: {
  name: string;
  url: string | null;
  contain?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const box = { sm: "size-9 text-xs rounded-md", md: "size-11 text-sm rounded-md", lg: "aspect-square w-full text-3xl rounded-lg", xl: "size-40 text-5xl rounded-xl" }[size];
  if (url) {
    const inset = { sm: "p-0.5", md: "p-1", lg: "p-3", xl: "p-4" }[size];
    return <img src={url} alt="" className={cn("shrink-0 shadow-sm", contain ? `bg-[#0d0f13] object-contain ${inset}` : "object-cover", box, className)} draggable={false} />;
  }
  const initials = name === NO_ARTIST ? "?" : name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center font-bold text-white shadow-sm", box, className)}
      style={{ background: "linear-gradient(135deg, #d7b261, #b0842a 50%, #6b4f14)", textShadow: "0 1px 2px rgb(0 0 0 / 0.35)" }}
    >
      {initials}
    </span>
  );
}
