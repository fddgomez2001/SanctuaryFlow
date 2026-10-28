/**
 * Lyrics timed to a song's recording. Lines follow the song's presentation
 * order, so a chorus sung three times appears three times, each with its own
 * times. Times are milliseconds from the start of the audio.
 */
import type { LyricLine } from "@/types/generated/LyricLine";
import type { Song } from "@/types/generated/Song";
import { sectionOrder } from "@/lib/slides/lyrics";

export type { LyricLine };

/** The lines of a song in the order they are sung, not yet timed. */
export function buildSyncLines(song: Pick<Song, "sections" | "arrangement">): LyricLine[] {
  const seen = new Map<string, number>();
  const lines: LyricLine[] = [];
  for (const sectionId of sectionOrder(song as Song)) {
    const section = song.sections.find((s) => s.id === sectionId);
    if (!section) continue;
    const occurrence = seen.get(sectionId) ?? 0;
    seen.set(sectionId, occurrence + 1);
    section.lyrics
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((text, i) => lines.push({ id: `${sectionId}:${occurrence}:${i}`, section: section.label, text, startMs: null, endMs: null }));
  }
  return lines;
}

/**
 * Lines rebuilt from changed lyrics, keeping the times of lines that are
 * still there: first the same line in the same place, then the next unused
 * line with the same words (a line moved or a section added before it).
 */
export function mergeTimings(previous: LyricLine[] | null | undefined, next: LyricLine[]): LyricLine[] {
  if (!previous?.length) return next;
  const byId = new Map(previous.map((l) => [l.id, l]));
  const used = new Set<string>();
  const firstPass = next.map((line) => {
    const old = byId.get(line.id);
    if (old && old.text === line.text) {
      used.add(old.id);
      return { ...line, startMs: old.startMs, endMs: old.endMs };
    }
    return null;
  });
  return next.map((line, i) => {
    if (firstPass[i]) return firstPass[i]!;
    const old = previous.find((p) => !used.has(p.id) && p.text === line.text);
    if (!old) return line;
    used.add(old.id);
    return { ...line, startMs: old.startMs, endMs: old.endMs };
  });
}

/** True when the timed lines no longer match the song's lyrics. */
export function lyricsChangedSinceSync(song: Pick<Song, "sections" | "arrangement" | "lyricSync">): boolean {
  if (!song.lyricSync?.length) return false;
  const now = buildSyncLines(song).map((l) => l.text);
  const timed = song.lyricSync.map((l) => l.text);
  return now.length !== timed.length || now.some((t, i) => t !== timed[i]);
}

/**
 * The line being sung at `ms`, or -1 before the first line and in a gap a
 * line ended early for (an instrumental). A line lasts until its end time,
 * or until the next timed line starts.
 */
export function activeLineIndex(lines: Pick<LyricLine, "startMs" | "endMs">[], ms: number): number {
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i]!.startMs;
    if (start == null) continue;
    if (start <= ms) active = i;
    else break;
  }
  if (active < 0) return -1;
  const end = lines[active]!.endMs;
  return end != null && ms >= end ? -1 : active;
}

/** The next line after `index` that has a start time. */
export function nextTimedIndex(lines: Pick<LyricLine, "startMs">[], index: number): number {
  for (let i = index + 1; i < lines.length; i++) if (lines[i]!.startMs != null) return i;
  return -1;
}

export function timedCount(lines: Pick<LyricLine, "startMs">[] | null | undefined): number {
  return lines?.filter((l) => l.startMs != null).length ?? 0;
}

/** 83456 → "1:23.45" */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "–:––";
  const total = Math.max(0, Math.round(ms / 10));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** "1:23.45", "83.45" or "1:23" → milliseconds; null when it can't be read. */
export function parseMs(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const minutes = m[1] ? Number(m[1]) : 0;
  const seconds = Number(m[2]);
  if (!m[1] && seconds >= 3600) return null;
  if (m[1] && seconds >= 60) return null;
  return Math.round((minutes * 60 + seconds) * 1000);
}

/** "3:05" for a duration in seconds. */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "0:00";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
