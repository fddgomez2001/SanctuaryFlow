import type { SongQuery } from "@/types/generated/SongQuery";

export function defaultSongQuery(): SongQuery {
  return {
    text: null,
    field: null,
    tag: null,
    category: null,
    language: null,
    favoritesOnly: false,
    includeArchived: false,
    archivedOnly: false,
    sort: "title",
    limit: 200,
    offset: 0,
  };
}
