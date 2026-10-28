import { describe, expect, it } from "vitest";
import { activeLineIndex, buildSyncLines, formatMs, lyricsChangedSinceSync, mergeTimings, nextTimedIndex, parseMs, type LyricLine } from "@/lib/music/sync";

const sections = [
  { id: "v1", kind: "verse" as const, label: "Verse 1", lyrics: "First line\nSecond line\n\nThird line", linesPerSlide: null },
  { id: "c", kind: "chorus" as const, label: "Chorus", lyrics: "Sing it\nAgain", linesPerSlide: null },
];

describe("timed lyrics", () => {
  it("lists lines in the order they are sung, repeats included", () => {
    const lines = buildSyncLines({ sections, arrangement: ["c", "v1", "c"] });
    expect(lines.map((l) => `${l.section}: ${l.text}`)).toEqual([
      "Chorus: Sing it",
      "Chorus: Again",
      "Verse 1: First line",
      "Verse 1: Second line",
      "Verse 1: Third line",
      "Chorus: Sing it",
      "Chorus: Again",
    ]);
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
    expect(lines.every((l) => l.startMs === null)).toBe(true);
  });

  it("keeps times when the lyrics change", () => {
    const timed = buildSyncLines({ sections, arrangement: null }).map((l, i) => ({ ...l, startMs: i * 1000, endMs: null }));
    // A line is reworded and a new line is added at the top of verse 1.
    const changed = [{ ...sections[0]!, lyrics: "New opening\nFirst line\nSecond line, changed\n\nThird line" }, sections[1]!];
    const merged = mergeTimings(timed, buildSyncLines({ sections: changed, arrangement: null }));
    expect(merged.map((l) => [l.text, l.startMs])).toEqual([
      ["New opening", null],
      ["First line", 0],
      ["Second line, changed", null],
      ["Third line", 2000],
      ["Sing it", 3000],
      ["Again", 4000],
    ]);
    expect(lyricsChangedSinceSync({ sections: changed, arrangement: null, lyricSync: timed })).toBe(true);
    expect(lyricsChangedSinceSync({ sections, arrangement: null, lyricSync: timed })).toBe(false);
  });

  it("finds the line being sung, including gaps", () => {
    const lines: Pick<LyricLine, "startMs" | "endMs">[] = [
      { startMs: 1000, endMs: null },
      { startMs: 3000, endMs: 5000 },
      { startMs: null, endMs: null },
      { startMs: 9000, endMs: null },
    ];
    expect([0, 1000, 2999, 3000, 4999, 5000, 8999, 9000, 60000].map((ms) => activeLineIndex(lines, ms))).toEqual([-1, 0, 0, 1, 1, -1, -1, 3, 3]);
    expect(nextTimedIndex(lines, 1)).toBe(3);
  });

  it("reads and writes times", () => {
    expect(formatMs(83456)).toBe("1:23.46");
    expect(formatMs(null)).toBe("–:––");
    expect(parseMs("1:23.46")).toBe(83460);
    expect(parseMs("83.5")).toBe(83500);
    expect(parseMs("0:05")).toBe(5000);
    expect(parseMs("1:75")).toBeNull();
    expect(parseMs("abc")).toBeNull();
  });
});
