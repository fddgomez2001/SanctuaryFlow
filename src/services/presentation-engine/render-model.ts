import type { Slide } from "@/lib/slides/types";
import type { TextAlign, ThemeBackground, ThemeSettings } from "@/lib/theme";
import type { OutputMode } from "./engine";

export interface MediaRef {
  url: string;
  kind: "image" | "video" | "audio";
  mimeType: string;
  /** Thumbnail for previews (videos are not played in previews). */
  posterUrl: string | null;
}

export interface MediaCommand {
  seq: number;
  action: "play" | "pause" | "restart";
}

/** How a playing song looks on the output. */
export type MusicView = "slides" | "vinyl" | "lyrics" | "full";

export interface MusicCommand {
  seq: number;
  action: "play" | "pause" | "seek" | "rate" | "volume";
  /** Seconds for seek, a factor for rate and volume. */
  value?: number;
}

export interface MusicLine {
  text: string;
  section: string;
  startMs: number | null;
  endMs: number | null;
}

/** The live song's recording, played by the output window. */
export interface MusicRender {
  songId: string;
  audio: MediaRef;
  cover: MediaRef | null;
  title: string;
  artist: string | null;
  lines: MusicLine[];
  view: MusicView;
  fontSize: number;
  align: TextAlign;
  command: MusicCommand | null;
}

/** What the Logo button shows. */
export interface LogoScreen {
  /** A picture (centred) or a video (fills the screen and loops); none shows the church name. */
  logo: MediaRef | null;
  /** Its own background, or null for the current theme background. */
  background: ThemeBackground | null;
  /** Height of a logo picture, in percent of the screen. */
  size: number;
  /** Play a logo video with sound. */
  sound: boolean;
}

/**
 * Everything the projector needs to draw the output. It is self-contained:
 * the projector never queries the library, so it keeps working even while
 * the operator window is busy.
 */
export interface ProjectorRenderState {
  version: 1;
  seq: number;
  output: OutputMode;
  slide: Slide | null;
  theme: ThemeSettings;
  media: Record<string, MediaRef>;
  /** Church logo for the logo / holding screen. */
  logo: MediaRef | null;
  /** The full logo screen (absent in states saved by older versions). */
  logoScreen?: LogoScreen;
  /** Fade between slides, black, clear and logo, in milliseconds. */
  fadeMs?: number;
  /** The live song's music, when it has a recording. */
  music?: MusicRender | null;
  churchName: string;
  /** Output aspect ratio (width / height) of the projector display. */
  aspect: number;
  mediaCommand: MediaCommand | null;
}

export interface ProjectorMediaStatus {
  type: "media";
  mediaId: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
}

export interface ProjectorReadyStatus {
  type: "ready";
  width: number;
  height: number;
}

export interface ProjectorMusicStatus {
  type: "music";
  songId: string;
  playing: boolean;
  /** Seconds. */
  currentTime: number;
  duration: number;
  error: string | null;
}

export type ProjectorReport = ProjectorMediaStatus | ProjectorReadyStatus | ProjectorMusicStatus;

export function isRenderState(v: unknown): v is ProjectorRenderState {
  return !!v && typeof v === "object" && (v as { version?: unknown }).version === 1 && "theme" in (v as object);
}
