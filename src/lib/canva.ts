/**
 * Canva designs shown live from their public link. Canva lets a design be
 * framed only through its embed address (`/design/<id>/<token>/view?embed`),
 * which works once the design is shared publicly; the regular `/view` page
 * refuses to be framed. Nothing is downloaded or copied from Canva.
 */

export type CanvaLinkResult = { ok: true; embedUrl: string; designId: string } | { ok: false; error: string };

const PART = /^[A-Za-z0-9_-]{4,64}$/;
const CANVA_HOSTS = new Set(["canva.com", "www.canva.com"]);

/** Accepts a share link ("Anyone with the link"), an embed link or pasted embed code. */
export function parseCanvaLink(input: string): CanvaLinkResult {
  let text = input.trim();
  if (!text) return { ok: false, error: "Paste the Canva link." };
  // Embed code from Share → Embed → HTML: take the address of its frame.
  const src = /src\s*=\s*["']([^"']+)["']/i.exec(text);
  if (src?.[1]) text = src[1];
  else if (/data-design-id/i.test(text)) {
    return { ok: false, error: "That embed code has no link in it. In Canva use Share → Embed and copy the smart embed link instead." };
  }
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "That doesn't look like a link." };
  }
  const host = url.hostname.toLowerCase();
  if (host === "canva.link" || host.endsWith(".canva.link")) {
    return { ok: false, error: "Short canva.link links can't be used. Open it in your browser and copy the full canva.com address instead." };
  }
  if (!CANVA_HOSTS.has(host)) return { ok: false, error: "Only canva.com design links can be shown." };
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "design" || !parts[1] || !PART.test(parts[1])) {
    return { ok: false, error: "This is not a link to a Canva design." };
  }
  const designId = parts[1];
  const token = parts[2] && PART.test(parts[2]) && !["view", "edit", "watch", "present"].includes(parts[2]) ? parts[2] : null;
  if (!token) {
    return {
      ok: false,
      error: "This link only works for people signed in to Canva. In Canva choose Share, set access to “Anyone with the link”, and copy that link (or use Share → Embed).",
    };
  }
  return { ok: true, designId, embedUrl: `https://www.canva.com/design/${designId}/${token}/view?embed` };
}

/** True for an address made by {@link parseCanvaLink}. */
export function isCanvaEmbedUrl(url: unknown): url is string {
  return typeof url === "string" && /^https:\/\/www\.canva\.com\/design\/[A-Za-z0-9_-]{4,64}\/[A-Za-z0-9_-]{4,64}\/view\?embed$/.test(url);
}

/**
 * Canva centres the design in its viewer and draws its page bar (progress,
 * "1 / 34", zoom, full screen) along the bottom ~90 px. A viewer this much
 * taller above and below the design keeps the bar off the design, where it is
 * cropped away.
 */
export const CANVA_BAR_SPACE = 120;

const ratio = (aspect: number | null | undefined) => (aspect && aspect > 0.1 && aspect < 10 ? aspect : 16 / 9);

/**
 * Where a design (width ÷ height `aspect`; 16:9 if unknown) sits on a W × H
 * output, fitted inside it. The viewer is the box plus {@link CANVA_BAR_SPACE}
 * above and below, clipped to the box.
 */
export function canvaFrame(W: number, H: number, aspect: number | null | undefined) {
  const a = ratio(aspect);
  const width = a >= W / H ? W : H * a;
  const height = width / a;
  return { left: (W - width) / 2, top: (H - height) / 2, width, height };
}

/** The viewer used to take pictures of the pages (CSS pixels). */
export function canvaPictureViewer(aspect: number | null | undefined) {
  const a = ratio(aspect);
  const width = Math.round(a >= 1 ? 960 : 720 * a);
  return { width, height: Math.round(width / a) + 2 * CANVA_BAR_SPACE, aspect: a };
}

/** The part of a viewer picture (`w` × `h` pixels) that shows the design. */
export function canvaDesignCrop(w: number, h: number, aspect: number) {
  const height = Math.min(h, w / aspect);
  return { x: 0, y: (h - height) / 2, width: w, height };
}

/** The public view page of a design, opened in the browser to download it. */
export function canvaViewUrl(link: string): string | null {
  const parsed = parseCanvaLink(link);
  return parsed.ok ? parsed.embedUrl.replace(/\?embed$/, "") : null;
}
