import { describe, expect, it } from "vitest";
import {
  applyOrder,
  currentSlide,
  type EngineState,
  initialState,
  nextSlide,
  positionLabel,
  type PresentationItem,
  reduce,
} from "@/services/presentation-engine/engine";
import type { Slide } from "@/lib/slides/types";

const slides = (itemId: string, n: number): Slide[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${itemId}:${i}`, itemId, label: `S${i + 1}`, content: { kind: "blank" } }));

const item = (id: string, n: number): PresentationItem => ({ id, title: id, type: "song", slides: slides(id, n), themeId: null });

const across = { advanceAcrossItems: true };
const within = { advanceAcrossItems: false };

function run(s: EngineState, ...types: Parameters<typeof reduce>[1][]): EngineState {
  return types.reduce((acc, a) => reduce(acc, a, across), s);
}

const base = reduce(initialState, { type: "setItems", items: [item("a", 2), item("empty", 0), item("b", 3)] }, across);

describe("presentation engine", () => {
  it("starts at the first slide and walks across items, skipping empty ones", () => {
    let s = run(base, { type: "next" });
    expect(currentSlide(s)?.id).toBe("a:0");
    s = run(s, { type: "next" }, { type: "next" });
    expect(currentSlide(s)?.id).toBe("b:0");
    expect(s.selectedItemIndex).toBe(2);
    s = run(s, { type: "next" }, { type: "next" }, { type: "next" });
    expect(currentSlide(s)?.id).toBe("b:2"); // stays on the last slide
    s = run(s, { type: "previous" }, { type: "previous" }, { type: "previous" });
    expect(currentSlide(s)?.id).toBe("a:1");
  });

  it("stays within the item when crossing is disabled", () => {
    let s = reduce(base, { type: "goLive", itemIndex: 0, slideIndex: 1 }, within);
    s = reduce(s, { type: "next" }, within);
    expect(currentSlide(s)?.id).toBe("a:1");
    expect(nextSlide(s, within)).toBeNull();
    expect(nextSlide(s, across)?.id).toBe("b:0");
  });

  it("supports first/last and item jumps", () => {
    let s = run(base, { type: "goLive", itemIndex: 2, slideIndex: 1 }, { type: "last" });
    expect(currentSlide(s)?.id).toBe("b:2");
    s = run(s, { type: "first" });
    expect(currentSlide(s)?.id).toBe("b:0");
    expect(positionLabel(s)).toBe("1 / 3");
    s = run(s, { type: "previousItem" });
    expect(currentSlide(s)?.id).toBe("a:0");
    s = run(s, { type: "nextItem" });
    expect(currentSlide(s)?.id).toBe("b:0");
  });

  it("blanks and restores the output without losing position", () => {
    let s = run(base, { type: "goLive", itemIndex: 0, slideIndex: 1 }, { type: "toggleOutput", output: "black" });
    expect(s.output).toBe("black");
    expect(currentSlide(s)?.id).toBe("a:1");
    s = run(s, { type: "toggleOutput", output: "black" });
    expect(s.output).toBe("normal");
    s = run(s, { type: "toggleOutput", output: "logo" }, { type: "goLive", itemIndex: 2, slideIndex: 0 });
    expect(s.output).toBe("normal"); // choosing a slide brings the output back
    // Clear stays on while slides are chosen, until it is turned off.
    s = run(s, { type: "toggleOutput", output: "clear" }, { type: "goLive", itemIndex: 0, slideIndex: 0 }, { type: "nextItem" }, { type: "next" });
    expect(s.output).toBe("clear");
    expect(currentSlide(s)?.id).toBe("b:1");
    s = run(s, { type: "toggleOutput", output: "clear" });
    expect(s.output).toBe("normal");
  });

  it("handles an empty presentation", () => {
    const empty = reduce(initialState, { type: "setItems", items: [] }, across);
    const s = run(empty, { type: "next" }, { type: "previous" }, { type: "last" }, { type: "nextItem" });
    expect(currentSlide(s)).toBeNull();
    expect(nextSlide(s, across)).toBeNull();
    expect(run(empty, { type: "goLive", itemIndex: 0, slideIndex: 0 }).live).toBeNull();
  });

  it("keeps the live slide when items are edited, reordered or removed", () => {
    let s = run(base, { type: "goLive", itemIndex: 2, slideIndex: 1 });
    // Reorder: b moves to the front, a new item is inserted.
    s = reduce(s, { type: "setItems", items: [item("b", 3), item("new", 1), item("a", 2)] }, across);
    expect(currentSlide(s)?.id).toBe("b:1");
    expect(s.live).toEqual({ itemIndex: 0, slideIndex: 1 });
    // The live item loses slides: clamp to its last slide.
    s = reduce(s, { type: "setItems", items: [item("b", 1), item("a", 2)] }, across);
    expect(currentSlide(s)?.id).toBe("b:0");
    // The live item is removed: nothing live, but no crash.
    s = reduce(s, { type: "setItems", items: [item("a", 2)] }, across);
    expect(s.live).toBeNull();
    expect(run(s, { type: "stop" }).live).toBeNull();
  });
});

describe("lineup order", () => {
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  const list = (...names: string[]) => names.map((id) => ({ id }));

  it("keeps the plan order until the operator arranges it", () => {
    expect(ids(applyOrder(list("a", "b", "c"), null))).toEqual(["a", "b", "c"]);
    expect(ids(applyOrder(list("a", "b", "c"), ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("forgets removed items and puts new ones after the item they follow", () => {
    // "x" was added to the plan after "a"; "b" was removed.
    expect(ids(applyOrder(list("a", "x", "c"), ["c", "b", "a"]))).toEqual(["c", "a", "x"]);
    // A new first item stays first.
    expect(ids(applyOrder(list("new", "a", "c"), ["c", "a"]))).toEqual(["new", "c", "a"]);
  });

  it("moving items keeps the slide on screen", () => {
    let s = run(base, { type: "next" }, { type: "next" });
    expect(currentSlide(s)?.id).toBe("a:1");
    s = reduce(s, { type: "setItems", items: applyOrder(s.items, ["b", "empty", "a"]) }, across);
    expect(currentSlide(s)?.id).toBe("a:1");
    expect(s.live).toEqual({ itemIndex: 2, slideIndex: 1 });
  });
});
