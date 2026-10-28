import type { MediaAsset } from "@/types/generated/MediaAsset";
import { api } from "@/services/api";
import { mediaRef } from "@/services/presentation-engine/media";

const MAX = 480;

function canvasToBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error("Could not encode the thumbnail."))),
      "image/jpeg",
      0.82,
    ),
  );
}

function draw(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // CORS mode keeps the canvas readable (the asset protocol allows this origin).
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The image could not be decoded."));
    img.src = url;
  });
}

function loadVideoFrame(url: string): Promise<{ video: HTMLVideoElement; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    const timeout = setTimeout(() => reject(new Error("The video took too long to open.")), 20000);
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 10);
    };
    video.onseeked = () => {
      clearTimeout(timeout);
      resolve({ video, duration: video.duration });
    };
    video.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("This video format or codec is not supported. Convert it to MP4 (H.264/AAC) or WebM."));
    };
    video.src = url;
  });
}

function loadAudio(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = () => reject(new Error("This audio format is not supported."));
    audio.src = url;
  });
}

/**
 * Measures a media file and stores a small thumbnail. Errors are returned
 * (not thrown) so one bad file never interrupts a batch.
 */
export async function processMedia(asset: MediaAsset): Promise<string | null> {
  const ref = mediaRef(asset);
  if (!ref) return "The file is missing.";
  try {
    if (asset.kind === "image") {
      const img = await loadImage(ref.url);
      await api.media.setProbe(asset.id, { width: img.naturalWidth, height: img.naturalHeight, durationMs: null });
      if (!asset.thumbnailPath) await api.media.setThumbnail(asset.id, await canvasToBytes(draw(img, img.naturalWidth, img.naturalHeight)));
    } else if (asset.kind === "video") {
      const { video, duration } = await loadVideoFrame(ref.url);
      await api.media.setProbe(asset.id, {
        width: video.videoWidth || null,
        height: video.videoHeight || null,
        durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
      });
      if (!asset.thumbnailPath && video.videoWidth) await api.media.setThumbnail(asset.id, await canvasToBytes(draw(video, video.videoWidth, video.videoHeight)));
      video.removeAttribute("src");
      video.load();
    } else {
      const duration = await loadAudio(ref.url);
      await api.media.setProbe(asset.id, { width: null, height: null, durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null });
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
