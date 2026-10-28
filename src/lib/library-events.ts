/**
 * Tells other parts of the app that library content changed, so a song edited
 * in the Song Library updates the presentation that is using it.
 */

type Listener = (songId: string) => void;

const songListeners = new Set<Listener>();

/** Calls `listener` whenever a song is saved. Returns a function that stops it. */
export function onSongChanged(listener: Listener): () => void {
  songListeners.add(listener);
  return () => songListeners.delete(listener);
}

export function songChanged(songId: string): void {
  for (const listener of songListeners) listener(songId);
}
