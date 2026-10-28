export type UiTheme = "dark" | "light" | "contrast";

const STORAGE_KEY = "sanctuaryflow.uiTheme";

export function normalizeUiTheme(value: unknown): UiTheme {
  return value === "dark" || value === "contrast" ? value : "light";
}

/**
 * Applies the operator interface theme. The choice is also remembered in
 * local storage so the next launch paints in the right colours before the
 * settings have loaded from the library.
 */
export function applyUiTheme(value: unknown): void {
  const theme = normalizeUiTheme(value);
  document.documentElement.dataset.ui = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable; the setting itself lives in the library.
  }
}

export function rememberedUiTheme(): UiTheme {
  try {
    return normalizeUiTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "light";
  }
}
