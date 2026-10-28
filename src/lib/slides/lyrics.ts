import type { Song } from "@/types/generated/Song";
import type { Slide } from "./types";

export interface LyricsOptions {
  /** Longest slide in lines; longer paragraphs are split evenly. */
  maxLinesPerSlide: number;
  /** CCLI license number for the footer, when the church has one. */
  ccliLicenseNumber?: string;
}

/**
 * Splits a section's lyrics into slides. A blank line is an explicit slide
 * break; paragraphs longer than `maxLines` are divided into near-equal parts
 * so a song never ends with a single orphaned line.
 */
export function splitSectionIntoSlides(lyrics: string, maxLines: number): string[][] {
  const max = Math.max(1, Math.floor(maxLines));
  const paragraphs = lyrics
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    )
    .filter((p) => p.length > 0);
  const slides: string[][] = [];
  for (const lines of paragraphs) {
    if (lines.length <= max) {
      slides.push(lines);
      continue;
    }
    const parts = Math.ceil(lines.length / max);
    const size = Math.ceil(lines.length / parts);
    for (let i = 0; i < lines.length; i += size) slides.push(lines.slice(i, i + size));
  }
  return slides;
}

/** "© 2001 Example Music · CCLI Song #1234 · CCLI License #5678" */
export function songFooter(song: Song, ccliLicenseNumber?: string): string | null {
  const parts: string[] = [];
  if (song.copyrightHolder || song.copyrightYear) {
    parts.push(`© ${[song.copyrightYear, song.copyrightHolder].filter(Boolean).join(" ")}`);
  } else if (song.license) {
    parts.push(song.license);
  }
  if (song.ccliNumber) parts.push(`CCLI Song #${song.ccliNumber}`);
  if (ccliLicenseNumber?.trim()) parts.push(`CCLI License #${ccliLicenseNumber.trim()}`);
  const credit = song.artist ? `${song.title} — ${song.artist}` : song.title;
  return parts.length ? `${credit} · ${parts.join(" · ")}` : credit;
}

/** The section ids in presentation order (the arrangement, or stored order). */
export function sectionOrder(song: Song): string[] {
  const ids = new Set(song.sections.map((s) => s.id));
  const arranged = (song.arrangement ?? []).filter((id) => ids.has(id));
  return arranged.length ? arranged : song.sections.map((s) => s.id);
}

/** Builds the slides for a song item. */
export function songToSlides(song: Song, itemId: string, opts: LyricsOptions): Slide[] {
  const footer = songFooter(song, opts.ccliLicenseNumber);
  const slides: Slide[] = [];
  for (const sectionId of sectionOrder(song)) {
    const section = song.sections.find((s) => s.id === sectionId);
    if (!section) continue;
    // A section can override the global size, e.g. a chorus shown line by line.
    const chunks = splitSectionIntoSlides(section.lyrics, section.linesPerSlide ?? opts.maxLinesPerSlide);
    chunks.forEach((lines, i) => {
      slides.push({
        id: `${itemId}:${slides.length}`,
        itemId,
        label: chunks.length > 1 ? `${section.label} (${i + 1}/${chunks.length})` : section.label,
        content: { kind: "lyrics", lines, sectionLabel: section.label, sectionKind: section.kind, songTitle: song.title, footer },
      });
    });
  }
  return slides;
}
