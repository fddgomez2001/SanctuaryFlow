export const SHORTCUT_ACTIONS = [
  "next",
  "previous",
  "blank",
  "clear",
  "logo",
  "exit",
  "first",
  "last",
  "nextItem",
  "previousItem",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

/** Each action maps to key combos such as "ArrowRight", "KeyB" or "Ctrl+KeyL". */
export type ShortcutMap = Record<ShortcutAction, string[]>;

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  next: "Next slide",
  previous: "Previous slide",
  blank: "Black screen",
  clear: "Clear text (keep background)",
  logo: "Logo / holding screen",
  exit: "Exit presentation",
  first: "First slide of item",
  last: "Last slide of item",
  nextItem: "Next item",
  previousItem: "Previous item",
};

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  next: ["ArrowRight", "Space", "PageDown"],
  previous: ["ArrowLeft", "PageUp"],
  blank: ["KeyB"],
  clear: ["KeyC"],
  logo: ["KeyL"],
  exit: ["Escape"],
  first: ["Home"],
  last: ["End"],
  nextItem: ["ArrowDown"],
  previousItem: ["ArrowUp"],
};

export function normalizeShortcuts(raw: unknown): ShortcutMap {
  const out = { ...DEFAULT_SHORTCUTS };
  if (raw && typeof raw === "object") {
    for (const action of SHORTCUT_ACTIONS) {
      const v = (raw as Record<string, unknown>)[action];
      if (Array.isArray(v)) out[action] = v.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length < 40);
    }
  }
  return out;
}

interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** "Ctrl+Shift+KeyB" from a keyboard event. */
export function eventToCombo(e: KeyLike): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.code);
  return parts.join("+");
}

export function matchShortcut(map: ShortcutMap, combo: string): ShortcutAction | null {
  for (const action of SHORTCUT_ACTIONS) {
    if (map[action].includes(combo)) return action;
  }
  return null;
}

/** Combos assigned to more than one action. */
export function findConflicts(map: ShortcutMap): { combo: string; actions: ShortcutAction[] }[] {
  const byCombo = new Map<string, ShortcutAction[]>();
  for (const action of SHORTCUT_ACTIONS) {
    for (const combo of map[action]) byCombo.set(combo, [...(byCombo.get(combo) ?? []), action]);
  }
  return [...byCombo.entries()].filter(([, a]) => a.length > 1).map(([combo, actions]) => ({ combo, actions }));
}

/** Readable label: "Ctrl+KeyB" → "Ctrl + B", "ArrowRight" → "→". */
export function comboLabel(combo: string): string {
  const names: Record<string, string> = {
    ArrowRight: "→",
    ArrowLeft: "←",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Space: "Space",
    Escape: "Esc",
    PageDown: "Page Down",
    PageUp: "Page Up",
  };
  return combo
    .split("+")
    .map((p) => names[p] ?? p.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num "))
    .join(" + ");
}

/** True when keys typed into this element should never trigger shortcuts. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "range", "color", "submit", "reset"].includes(type);
  }
  return !!target.closest("[data-shortcuts='off']");
}
