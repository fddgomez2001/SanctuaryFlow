import { describe, expect, it } from "vitest";
import { highlightParts, matchingLine, simplify } from "@/lib/lyrics-search";
import { partShortName } from "@/features/live/LiveSlides";

// Placeholder lyrics (not from any real song).
const LINES = ["Morning light upon the hill", "We walk the narrow road together", "Señor, your kindness never ends", "We walk the road"];

describe("finding songs by their words", () => {
  it("picks the line with most of the typed words", () => {
    expect(matchingLine(LINES, "narrow road")).toBe("We walk the narrow road together");
    expect(matchingLine(LINES, "walk the narrow")).toBe("We walk the narrow road together");
    // Accents, case and punctuation do not matter; words may be cut short.
    expect(matchingLine(LINES, "senor your kind")).toBe("Señor, your kindness never ends");
    expect(matchingLine(LINES, "MORNING, LIGHT!")).toBe("Morning light upon the hill");
    expect(matchingLine(LINES, "ocean waves")).toBeNull();
    expect(matchingLine(LINES, "   ")).toBeNull();
  });

  it("marks the typed words for highlighting", () => {
    expect(highlightParts("We walk the narrow road", "narrow road")).toEqual([
      { text: "We walk the ", match: false },
      { text: "narrow road", match: true },
    ]);
    expect(simplify("  Señor,  ¡Gracias! ")).toBe("senor gracias");
  });

  it("gives song parts the short names singers use", () => {
    expect(["Verse 1", "Chorus", "Chorus 2", "Pre-Chorus", "Bridge 1", "Interlude", "Outro"].map(partShortName)).toEqual(["V1", "C", "C2", "PC", "B1", "IN", "O"]);
  });
});
