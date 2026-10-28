import { convertFileSrc } from "@tauri-apps/api/core";
import type { MediaAsset } from "@/types/generated/MediaAsset";
import { api } from "@/services/api";
import type { MediaRef } from "./render-model";

/** Builds a playable reference to a managed media file (local asset URL). */
export function mediaRef(asset: MediaAsset): MediaRef | null {
  if (asset.missing || !asset.absolutePath) return null;
  const url = convertFileSrc(asset.absolutePath);
  const poster = asset.thumbnailAbsolutePath ? convertFileSrc(asset.thumbnailAbsolutePath) : asset.kind === "image" ? url : null;
  return { url, kind: asset.kind, mimeType: asset.mimeType, posterUrl: poster };
}

export interface ResolvedMedia {
  refs: Record<string, MediaRef>;
  /** Ids that are referenced but missing from disk or from the library. */
  missing: string[];
}

/** Resolves media ids to local URLs; unknown or missing files are reported, not thrown. */
export async function resolveMedia(ids: Iterable<string>): Promise<ResolvedMedia> {
  const unique = [...new Set(ids)].filter(Boolean);
  const refs: Record<string, MediaRef> = {};
  const missing: string[] = [];
  await Promise.all(
    unique.map(async (id) => {
      try {
        const ref = mediaRef(await api.media.get(id));
        if (ref) refs[id] = ref;
        else missing.push(id);
      } catch {
        missing.push(id);
      }
    }),
  );
  return { refs, missing };
}
