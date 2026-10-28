import { describe, expect, it } from "vitest";
import { CANVA_BAR_SPACE, canvaDesignCrop, canvaFrame, canvaPictureViewer, isCanvaEmbedUrl, parseCanvaLink } from "@/lib/canva";
import { canvaPicturesOf, withCanvaLink } from "@/lib/service-items";

const EMBED = "https://www.canva.com/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/view?embed";

describe("Canva links", () => {
  it("turns public view and edit links, embed links and embed code into the embed address", () => {
    for (const input of [
      "https://www.canva.com/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/view?utm_content=DAGatIO09_0&utm_campaign=designshare&utm_medium=link",
      "https://www.canva.com/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/edit?utm_source=sharebutton",
      EMBED,
      "  canva.com/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/view  ",
      `<div style="position: relative"><iframe loading="lazy" src="${EMBED}" allowfullscreen="allowfullscreen"></iframe></div>`,
    ]) {
      const r = parseCanvaLink(input);
      expect(r).toEqual({ ok: true, designId: "DAGatIO09_0", embedUrl: EMBED });
    }
    expect(isCanvaEmbedUrl(EMBED)).toBe(true);
  });

  it("explains links that can't be shown", () => {
    const error = (s: string) => {
      const r = parseCanvaLink(s);
      return r.ok ? "" : r.error;
    };
    expect(error("https://www.canva.com/design/DAGatIO09_0/view")).toMatch(/Anyone with the link/);
    expect(error("https://canva.link/abc123")).toMatch(/full canva.com address/);
    expect(error("https://example.com/design/DAGatIO09_0/pLS_mXpjtCjA5Efg-l8M6g/view")).toMatch(/Only canva.com/);
    expect(error("https://www.canva.com/templates/")).toMatch(/not a link to a Canva design/);
    expect(error('<div class="canva-embed" data-design-id="DAGatIO09_0"></div>')).toMatch(/smart embed link/);
    expect(error("")).toMatch(/Paste/);
    expect(isCanvaEmbedUrl("https://evil.example/design/a/b/view?embed")).toBe(false);
    expect(isCanvaEmbedUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("Canva page bar and page pictures", () => {
  it("fits the design on the output; the viewer is taller so the page bar falls outside it", () => {
    expect(canvaFrame(1920, 1080, 16 / 9)).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
    // Unknown shape: a 16:9 presentation.
    expect(canvaFrame(1920, 1080, null)).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
    // A 16:9 design on a 4:3 output sits between black bars, as do square and portrait ones.
    expect(canvaFrame(1440, 1080, 16 / 9)).toEqual({ left: 0, top: 135, width: 1440, height: 810 });
    expect(canvaFrame(1920, 1080, 1)).toEqual({ left: 420, top: 0, width: 1080, height: 1080 });
    expect(canvaFrame(1920, 1080, 9 / 16).width).toBeCloseTo(607.5);
    expect(CANVA_BAR_SPACE).toBeGreaterThanOrEqual(100);
  });

  it("takes pictures in a viewer with room for the bar, and crops to the design", () => {
    expect(canvaPictureViewer(16 / 9)).toEqual({ width: 960, height: 540 + 2 * CANVA_BAR_SPACE, aspect: 16 / 9 });
    expect(canvaPictureViewer(9 / 16)).toEqual({ width: 405, height: 720 + 2 * CANVA_BAR_SPACE, aspect: 9 / 16 });
    // Measured on Canva's viewer: a 960 × 780 viewer shows a 16:9 design at y 120–660.
    expect(canvaDesignCrop(960, 780, 16 / 9)).toEqual({ x: 0, y: 120, width: 960, height: 540 });
    // At 125% display scaling the picture is larger; the crop scales with it.
    expect(canvaDesignCrop(1200, 975, 16 / 9)).toEqual({ x: 0, y: 150, width: 1200, height: 675 });
  });

  it("keeps a picture per page and forgets them when the link changes", () => {
    expect(canvaPicturesOf({ canvaPages: 3, canvaPictures: ["a", null, "c", "d"] })).toEqual(["a", null, "c"]);
    expect(canvaPicturesOf({ canvaPages: 2 })).toEqual([null, null]);
    expect(canvaPicturesOf({ canvaPages: 2, canvaPictures: "nonsense" })).toEqual([null, null]);
    expect(withCanvaLink({ canvaUrl: EMBED, canvaPages: 3, canvaPictures: ["a"], canvaAspect: 1, themeId: "t" }, "https://www.canva.com/design/DAGother123/AbCdEfGh1234/view?embed")).toEqual({
      canvaUrl: "https://www.canva.com/design/DAGother123/AbCdEfGh1234/view?embed",
      canvaPages: 3,
      themeId: "t",
    });
  });
});
