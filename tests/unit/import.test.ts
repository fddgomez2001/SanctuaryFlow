import { describe, expect, it } from "vitest";
import { pictureSlide, titleFromPath } from "@/lib/import/presentation";
import { normalizeDeckSlide } from "@/lib/slides/deck";

describe("presentation import", () => {
  it("names the deck after the file", () => {
    expect(titleFromPath(String.raw`C:\Users\Team\Desktop\Sunday Announcements.pdf`)).toBe("Sunday Announcements");
    expect(titleFromPath("/home/team/slides.v2.pptx")).toBe("slides.v2");
    expect(titleFromPath(".pdf")).toBe("Imported slides");
  });

  it("makes picture slides that survive the deck validation", () => {
    const slide = pictureSlide("media-1", "  Pray for the team  ");
    expect(normalizeDeckSlide(JSON.parse(JSON.stringify(slide)))).toEqual(slide);
    expect(slide).toMatchObject({ background: { type: "image", mediaId: "media-1", fit: "contain" }, elements: [], notes: "Pray for the team" });
    expect(pictureSlide("media-2", "   ")).not.toHaveProperty("notes");
  });
});
