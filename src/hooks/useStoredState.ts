import { useCallback, useState } from "react";

const PREFIX = "sanctuaryflow.";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * A small view preference for this computer (a chosen layout, a collapsed
 * panel). Library data belongs in settings, not here: browser storage can be
 * cleared and is never backed up or synced.
 */
export function useStoredState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(next));
      } catch {
        // Not remembered; the view still changes.
      }
    },
    [key],
  );
  return [value, update];
}
