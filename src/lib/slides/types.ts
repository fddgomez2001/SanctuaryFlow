import type { SectionKind } from "@/types/generated/SectionKind";
import type { BackgroundFit, TextAlign, ThemeBackground, VerticalAlign } from "@/lib/theme";

/** Position and size as percentages of the slide canvas. */
export interface ElementBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextElement {
  id: string;
  type: "text";
  box: ElementBox;
  text: string;
  fontFamily: string;
  /** Pixels on a 1080-unit-tall canvas. */
  fontSize: number;
  fontWeight: number;
  color: string;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  lineHeight: number;
  italic: boolean;
  uppercase: boolean;
  shadow: boolean;
  /** Shrink the text to fit its box. */
  autoFit: boolean;
}

export interface ImageElement {
  id: string;
  type: "image";
  box: ElementBox;
  mediaId: string | null;
  fit: "cover" | "contain";
  opacity: number;
  radius: number;
  /** Focal crop position for `cover` (percent). */
  cropX: number;
  cropY: number;
}

export interface ShapeElement {
  id: string;
  type: "shape";
  box: ElementBox;
  color: string;
  opacity: number;
  radius: number;
}

export type SlideElement = TextElement | ImageElement | ShapeElement;

/** One slide in a custom slide deck (slide editor document). */
export interface DeckSlide {
  id: string;
  /** `null` uses the theme background. */
  background: ThemeBackground | null;
  elements: SlideElement[];
  notes?: string;
}

export interface ScriptureVerseText {
  /** "16" or "2–3" for combined verses. */
  number: string;
  text: string;
}

export type SlideContent =
  | { kind: "lyrics"; lines: string[]; sectionLabel: string; sectionKind?: SectionKind; songTitle: string; footer: string | null }
  | { kind: "scripture"; verses: ScriptureVerseText[]; reference: string; translation: string | null }
  | { kind: "text"; title: string | null; body: string }
  | { kind: "custom"; slide: DeckSlide }
  | { kind: "media"; mediaId: string; mediaType: "image" | "video"; fit: BackgroundFit; loop: boolean; muted: boolean }
  | { kind: "blank"; black?: boolean }
  /** A design shown live from the web (a public Canva embed link); needs the internet. */
  | { kind: "web"; url: string; title: string; provider: "canva"; page: number; pictureId?: string; aspect?: number };

export interface Slide {
  /** Stable within a presentation: `${itemId}:${index}`. */
  id: string;
  itemId: string;
  /** Operator-facing label, e.g. "Verse 1" or "John 3:16–17". */
  label: string;
  content: SlideContent;
  /** Operator-only notes; never sent to the projector. */
  notes?: string;
}

export type { VerticalAlign };
