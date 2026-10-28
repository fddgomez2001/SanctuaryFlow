/**
 * Turns a presentation file into a slide deck of full-slide pictures, so a
 * design from PowerPoint, Google Slides or Canva looks exactly as it was
 * made. PDF pages are drawn here with pdf.js; PowerPoint files are converted
 * by PowerPoint itself (through the app backend) when it is installed.
 */
import type { DeckCategory } from "@/types/generated/DeckCategory";
import type { SlideDeck } from "@/types/generated/SlideDeck";
import { api } from "@/services/api";
import { newId } from "@/lib/slides/deck";
import type { DeckSlide } from "@/lib/slides/types";

export const PRESENTATION_EXTENSIONS = ["pptx", "ppt", "pptm", "ppsx", "pps", "potx", "odp", "pdf", "zip", "png", "jpg", "jpeg", "webp", "bmp", "gif"];
export const POWERPOINT_EXTENSIONS = ["pptx", "ppt", "pptm", "ppsx", "pps", "potx", "odp"];

export interface ImportProgress {
  message: string;
  done?: number;
  total?: number;
}

export interface ImportedPresentation {
  deck: SlideDeck;
  warnings: string[];
}

const extension = (path: string) => path.split(".").pop()?.toLowerCase() ?? "";

/** "C:\Slides\Sunday Announcements.pdf" → "Sunday Announcements" */
export function titleFromPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.[^.]+$/, "").trim() || "Imported slides";
}

/** A slide that shows one picture over black, letterboxed if the shapes differ. */
export function pictureSlide(mediaId: string, notes?: string | null): DeckSlide {
  return {
    id: newId(),
    background: { type: "image", style: "plain", color: "#000000", mediaId, fit: "contain", overlayColor: "#000000", overlayOpacity: 0, videoLoop: false, videoMuted: true },
    elements: [],
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
  };
}

// Largest picture drawn per page: the output is at most full HD.
const MAX_W = 1920;
const MAX_H = 1080;

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("A page could not be turned into a picture.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function importPdf(path: string, onProgress: (p: ImportProgress) => void): Promise<{ slides: DeckSlide[]; warnings: string[] }> {
  onProgress({ message: "Opening the PDF…" });
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = await api.files.readForImport(path);
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useWasm: false });
  const doc = await task.promise;
  const slides: DeckSlide[] = [];
  const warnings: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress({ message: `Drawing page ${n} of ${doc.numPages}…`, done: n - 1, total: doc.numPages });
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(MAX_W / base.width, MAX_H / base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("The page could not be drawn.");
      // PDF pages are printed on white paper.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      try {
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      } catch (e) {
        warnings.push(`Page ${n} could not be drawn completely: ${e instanceof Error ? e.message : String(e)}`);
      }
      const bytes = await canvasToJpeg(canvas);
      page.cleanup();
      const asset = await api.media.importBytes(`${titleFromPath(path)} - page ${n}.jpg`, bytes, "slide");
      slides.push(pictureSlide(asset.id));
    }
  } finally {
    void task.destroy();
  }
  return { slides, warnings };
}

/** Imports one presentation file as a new slide deck in the library. */
export async function importPresentation(path: string, onProgress: (p: ImportProgress) => void, category: DeckCategory = "custom"): Promise<ImportedPresentation> {
  const ext = extension(path);
  let slides: DeckSlide[];
  let warnings: string[];
  if (ext === "pdf") {
    ({ slides, warnings } = await importPdf(path, onProgress));
  } else {
    onProgress({
      message: POWERPOINT_EXTENSIONS.includes(ext) ? "PowerPoint is converting the slides. Large presentations can take a minute…" : "Adding the pictures…",
    });
    const converted = await api.files.convertPresentation(path);
    slides = converted.slides.map((s) => pictureSlide(s.mediaId, s.notes));
    warnings = converted.warnings;
  }
  if (!slides.length) throw new Error("The file has no slides or pages to import.");
  onProgress({ message: "Saving the slides…", done: slides.length, total: slides.length });
  const deck = await api.decks.save({ id: null, title: titleFromPath(path), category, themeId: null, slides });
  return { deck, warnings };
}
