import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, normalizeTheme, themeMediaIds } from "@/lib/theme";
import {
  comboLabel,
  DEFAULT_SHORTCUTS,
  eventToCombo,
  findConflicts,
  isEditableTarget,
  matchShortcut,
  normalizeShortcuts,
} from "@/lib/keyboard";

describe("theme normalization", () => {
  it("fills defaults and clamps unsafe values", () => {
    const t = normalizeTheme({ fontSize: 9999, textColor: "red; background:url(x)", textAlign: "justify", background: { type: "image", mediaId: "m1" } });
    expect(t.fontSize).toBe(240);
    expect(t.textColor).toBe(DEFAULT_THEME.textColor);
    expect(t.textAlign).toBe("center");
    expect(t.background.type).toBe("image");
    expect(t.background.color).toBe(DEFAULT_THEME.background.color);
    expect(themeMediaIds(t)).toEqual(["m1"]);
  });

  it("accepts garbage without throwing", () => {
    expect(normalizeTheme(null)).toEqual(DEFAULT_THEME);
    expect(normalizeTheme("x")).toEqual(DEFAULT_THEME);
    expect(normalizeTheme({ reference: 5, logo: [] })).toEqual(DEFAULT_THEME);
  });
});

describe("theme text styles and transitions", () => {
  it("keeps title case, italic, text width and the newer transitions, and defaults older themes", () => {
    const t = normalizeTheme({ textTransform: "capitalize", italic: true, textWidth: 70, fontFamily: "Poppins", transition: { type: "zoom", durationMs: 800 } });
    expect(t).toMatchObject({ textTransform: "capitalize", italic: true, textWidth: 70, fontFamily: "Poppins", transition: { type: "zoom", durationMs: 800 } });
    const old = normalizeTheme({ textTransform: "shout", transition: { type: "spin" } });
    expect(old).toMatchObject({ textTransform: "none", italic: false, textWidth: 100, transition: { type: DEFAULT_THEME.transition.type } });
    expect(normalizeTheme({ textWidth: 5 }).textWidth).toBe(30);
  });
});

describe("keyboard shortcuts", () => {
  it("matches the default bindings", () => {
    const e = { code: "ArrowRight", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(matchShortcut(DEFAULT_SHORTCUTS, eventToCombo(e))).toBe("next");
    expect(matchShortcut(DEFAULT_SHORTCUTS, eventToCombo({ ...e, code: "KeyB" }))).toBe("blank");
    expect(matchShortcut(DEFAULT_SHORTCUTS, eventToCombo({ ...e, code: "KeyB", ctrlKey: true }))).toBeNull();
    expect(matchShortcut(DEFAULT_SHORTCUTS, "Escape")).toBe("exit");
    expect(matchShortcut(DEFAULT_SHORTCUTS, "Home")).toBe("first");
  });

  it("detects conflicts", () => {
    expect(findConflicts(DEFAULT_SHORTCUTS)).toEqual([]);
    const map = normalizeShortcuts({ ...DEFAULT_SHORTCUTS, logo: ["KeyB"] });
    expect(findConflicts(map)).toEqual([{ combo: "KeyB", actions: ["blank", "logo"] }]);
  });

  it("labels combos for people", () => {
    expect(comboLabel("Ctrl+KeyB")).toBe("Ctrl + B");
    expect(comboLabel("ArrowRight")).toBe("→");
  });

  it("ignores keys typed into text fields", () => {
    const input = document.createElement("input");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const area = document.createElement("textarea");
    const div = document.createElement("div");
    const wrapper = document.createElement("div");
    wrapper.dataset.shortcuts = "off";
    const inner = document.createElement("span");
    wrapper.appendChild(inner);
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(area)).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(inner)).toBe(true);
  });
});
