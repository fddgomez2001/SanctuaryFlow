import type { MediaRef } from "@/services/presentation-engine/render-model";

/** The gold album picture for songs and audio without a picture of their own (public/Album_Default.png). */
export const DEFAULT_ALBUM_URL = "/Album_Default.png";

/** {@link DEFAULT_ALBUM_URL} as a media reference, for the output's music views. */
export const DEFAULT_ALBUM_REF: MediaRef = { url: DEFAULT_ALBUM_URL, kind: "image", mimeType: "image/png", posterUrl: DEFAULT_ALBUM_URL };

/** The church logo shipped with the app (public/LOGO.png). */
export const APP_LOGO_URL = "/LOGO.png";
