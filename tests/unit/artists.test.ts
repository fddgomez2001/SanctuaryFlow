import { describe, expect, it } from "vitest";
import type { SongSummary } from "@/types/generated/SongSummary";
import { artistKey, groupByArtist, NO_ARTIST } from "@/features/songs/artists";

const song = (title: string, artist: string | null): SongSummary => ({
  id: title,
  title,
  artist,
  category: null,
  language: null,
  tags: [],
  firstLine: null,
  isFavorite: false,
  archived: false,
  missingCopyright: false,
  lastUsedAt: null,
  updatedAt: "",
});

describe("artists", () => {
  it("groups songs by artist A–Z, merging spelling differences, with songs without an artist last", () => {
    const groups = groupByArtist([song("Still", "Hillsong Worship"), song("Untitled", null), song("Way Maker", "Leeland"), song("Cornerstone", " hillsong   worship "), song("Blank", "  ")]);
    expect(groups.map((g) => [g.name, g.songs.map((s) => s.title)])).toEqual([
      ["Hillsong Worship", ["Still", "Cornerstone"]],
      ["Leeland", ["Way Maker"]],
      [NO_ARTIST, ["Untitled", "Blank"]],
    ]);
    expect(artistKey("  Hillsong   WORSHIP ")).toBe("hillsong worship");
  });
});
