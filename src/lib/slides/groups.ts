import type { Slide } from "./types";
import { slideColor } from "./colors";

export interface SlideGroup {
  label: string;
  color: string | null;
  slides: { slide: Slide; index: number }[];
}

/** "Chorus (2/3)" → "Chorus" */
const baseLabel = (label: string) => label.replace(/\s*\(\d+\/\d+\)$/, "");

/** The heading a slide is listed under: its song part, chapter or item. */
function groupOf(slide: Slide): string {
  const c = slide.content;
  if (c.kind === "lyrics") return c.sectionLabel || baseLabel(slide.label);
  if (c.kind === "scripture") return c.reference.split(":")[0] ?? c.reference;
  if (c.kind === "custom") return "Slides";
  return baseLabel(slide.label);
}

/** Consecutive slides of one song part (or chapter, or item) form one group. */
export function groupSlides(slides: Slide[]): SlideGroup[] {
  const groups: SlideGroup[] = [];
  slides.forEach((slide, index) => {
    const label = groupOf(slide);
    const last = groups[groups.length - 1];
    // Each time a song part is sung (a chorus repeated) it starts its own group.
    const startsPart = slide.content.kind === "lyrics" && !/\((?!1\/)\d+\/\d+\)$/.test(slide.label);
    if (last && last.label === label && !startsPart) last.slides.push({ slide, index });
    else groups.push({ label, color: slideColor(slide), slides: [{ slide, index }] });
  });
  return groups;
}
