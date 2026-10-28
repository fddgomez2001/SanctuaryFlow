import type { SectionKind } from "@/types/generated/SectionKind";
import type { Slide } from "./types";

/**
 * One shade of the interface's gold (and its navy) per song part, so the
 * operator can find the chorus or bridge at a glance. Dark enough for white
 * label text in both interface themes.
 */
export const SECTION_COLORS: Record<SectionKind, string> = {
  intro: "#8c7341",
  verse: "#b0842a",
  prechorus: "#a8692a",
  chorus: "#7a5410",
  bridge: "#1f2d4d",
  interlude: "#6e5a2e",
  tag: "#94612b",
  outro: "#4f3d17",
  ending: "#3d4660",
  custom: "#6b6152",
};

const SCRIPTURE_COLOR = "#8a6417";

/** The label colour for a slide, or null when it has no section. */
export function slideColor(slide: Slide): string | null {
  const c = slide.content;
  if (c.kind === "lyrics") return c.sectionKind ? SECTION_COLORS[c.sectionKind] : null;
  if (c.kind === "scripture") return SCRIPTURE_COLOR;
  return null;
}

/** The words on a slide as plain lines, for list views and search. */
export function slideTextLines(slide: Slide): string[] {
  const c = slide.content;
  switch (c.kind) {
    case "lyrics":
      return c.lines;
    case "scripture":
      return c.verses.map((v) => `${v.number} ${v.text}`);
    case "text":
      return [c.title, ...c.body.split("\n")].filter((l): l is string => !!l && l.trim().length > 0);
    case "custom":
      return c.slide.elements.flatMap((e) => (e.type === "text" ? e.text.split("\n") : [])).filter((l) => l.trim().length > 0);
    case "media":
      return [c.mediaType === "video" ? "Video" : "Image"];
    case "blank":
      return [c.black ? "Black screen" : "Theme background only"];
    case "web":
      return [`Canva: ${c.title} — page ${c.page}`];
  }
}
