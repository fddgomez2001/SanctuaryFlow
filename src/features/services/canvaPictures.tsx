/**
 * Real thumbnails for Canva designs shown live: a picture of every page,
 * taken from the design's public viewer in a hidden window
 * (`src-tauri/src/canva_capture.rs`), cropped to the design and kept with the
 * item as slide pictures (not listed in the Media Library). One design at a
 * time. The output itself always shows Canva live.
 */
import { create } from "zustand";
import { CircleAlert, Images, Loader2 } from "lucide-react";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { canvaDesignCrop, canvaPictureViewer } from "@/lib/canva";
import { errorMessage } from "@/lib/ipc";

interface Problem {
  reason: string;
  /** The operator pressed Stop (rather than something going wrong). */
  stopped: boolean;
}

interface CanvaPicturesState {
  job: { itemId: string; done: number; total: number } | null;
  /** Items whose pictures stopped this session; they are not taken again by themselves. */
  problems: Record<string, Problem>;
  stopping: boolean;
}

export const useCanvaPictures = create<CanvaPicturesState>(() => ({ job: null, problems: {}, stopping: false }));

export interface CanvaPicturesRequest {
  itemId: string;
  title: string;
  /** The design's embed address. */
  url: string;
  /** Current pictures by page (null where missing). */
  pictures: (string | null)[];
  /** Take every page again, after the design changed in Canva. */
  retake: boolean;
  /** Stores the item's pictures and the design's shape (width ÷ height). */
  save: (pictures: (string | null)[], aspect: number) => Promise<void>;
}

export type CanvaPicturesResult = "done" | "stopped" | "failed" | "busy";

/** Pages are saved in small groups, so thumbnails appear while the rest are taken. */
const SAVE_EVERY = 4;

export async function takeCanvaPictures(req: CanvaPicturesRequest): Promise<CanvaPicturesResult> {
  const store = useCanvaPictures;
  if (store.getState().job) return "busy";
  const ids = req.retake ? req.pictures.map(() => null) : [...req.pictures];
  const total = ids.length;
  const count = () => ids.filter(Boolean).length;
  const { [req.itemId]: _previous, ...problems } = store.getState().problems;
  store.setState({ job: { itemId: req.itemId, done: count(), total }, problems, stopping: false });
  let aspect: number | null = null;
  let unsaved = 0;
  let opened = false;
  try {
    const info = await api.files.canvaInfo(req.url);
    const viewer = canvaPictureViewer(info.width && info.height ? info.width / info.height : null);
    aspect = viewer.aspect;
    await api.files.canvaCaptureOpen(req.url, viewer.width, viewer.height);
    opened = true;
    for (let page = 1; page <= total; page++) {
      if (store.getState().stopping) break;
      if (ids[page - 1]) continue;
      const picture = await takePage(page, viewer.aspect);
      ids[page - 1] = (await api.media.importBytes(`${req.title} - Canva page ${page}.jpg`, picture, "slide")).id;
      store.setState({ job: { itemId: req.itemId, done: count(), total } });
      if (++unsaved >= SAVE_EVERY) {
        await req.save(ids, viewer.aspect);
        unsaved = 0;
      }
    }
    await req.save(ids, viewer.aspect);
    unsaved = 0;
    await removeUnused(req.pictures.filter((id): id is string => !!id && !ids.includes(id)));
    if (count() < total) {
      store.setState((s) => ({ problems: { ...s.problems, [req.itemId]: { reason: `Stopped at ${count()} of ${total} pages.`, stopped: true } } }));
      return "stopped";
    }
    return "done";
  } catch (e) {
    if (unsaved && aspect) await req.save(ids, aspect).catch(() => undefined);
    store.setState((s) => ({ problems: { ...s.problems, [req.itemId]: { reason: errorMessage(e), stopped: false } } }));
    return "failed";
  } finally {
    if (opened) await api.files.canvaCaptureClose().catch(() => undefined);
    store.setState({ job: null, stopping: false });
  }
}

/** A picture of one page. A page caught before Canva drew it is taken once more. */
async function takePage(page: number, aspect: number): Promise<Uint8Array> {
  const shot = await cropToDesign(await api.files.canvaCapturePage(page), aspect);
  return shot.plain ? (await cropToDesign(await api.files.canvaCapturePage(page), aspect)).bytes : shot.bytes;
}

async function cropToDesign(jpeg: ArrayBuffer, aspect: number): Promise<{ bytes: Uint8Array; plain: boolean }> {
  const image = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
  try {
    const crop = canvaDesignCrop(image.width, image.height, aspect);
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(960, Math.round(crop.width));
    canvas.height = Math.round(canvas.width / aspect);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("A page picture could not be made.");
    ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    const plain = isPlain(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) throw new Error("A page picture could not be made.");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), plain };
  } finally {
    image.close();
  }
}

/** True for a picture of one flat colour. */
function isPlain(rgba: Uint8ClampedArray): boolean {
  const step = 4 * Math.max(1, Math.floor(rgba.length / 4 / 5000));
  let min = 255;
  let max = 0;
  for (let i = 0; i < rgba.length; i += step) {
    const v = (3 * rgba[i]! + 6 * rgba[i + 1]! + rgba[i + 2]!) / 10;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return max - min < 12;
}

/** Old page pictures nothing uses any more. */
async function removeUnused(ids: string[]) {
  for (const id of ids) {
    const usedBy = await api.media.references(id).catch(() => null);
    if (usedBy && !usedBy.length) await api.media.remove(id).catch(() => undefined);
  }
}

/** Progress of an item's page pictures, with Stop, Try again and Update. */
export function CanvaPicturesControl({ itemId, onTake }: { itemId: string; onTake: (retake: boolean) => void }) {
  const job = useCanvaPictures((s) => s.job);
  const problem = useCanvaPictures((s) => s.problems[itemId]);
  if (job?.itemId === itemId) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
        <Loader2 className="size-3.5 animate-spin" />
        Page pictures {job.done} / {job.total}
        <Button size="sm" variant="ghost" onClick={() => useCanvaPictures.setState({ stopping: true })}>
          Stop
        </Button>
      </span>
    );
  }
  if (problem) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-warning" role="status">
        <CircleAlert className="size-3.5 shrink-0" />
        <span className="max-w-72 truncate" title={problem.reason}>
          {problem.stopped ? problem.reason : `No page pictures: ${problem.reason}`}
        </span>
        <Button size="sm" variant="ghost" disabled={!!job} onClick={() => onTake(false)}>
          {problem.stopped ? "Continue" : "Try again"}
        </Button>
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Images className="size-3.5" />}
      disabled={!!job}
      title="Take new pictures of every page, after changing the design in Canva"
      onClick={() => onTake(true)}
    >
      Update pictures
    </Button>
  );
}
