import { describe, expect, it } from "vitest";
import { dayPart, GREETING_VERSES, greetingSlot, greetingTitle, greetingVerses, shouldGreet } from "@/lib/greeting";
import { parseReferences } from "@/lib/bible/reference";
import { referenceBooks } from "@/lib/bible/canon";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);

describe("opening greeting", () => {
  it("splits the day into morning, afternoon and evening", () => {
    expect(dayPart(at(28, 0, 0))).toBe("morning");
    expect(dayPart(at(28, 7))).toBe("morning");
    expect(dayPart(at(28, 11, 59))).toBe("morning");
    expect(dayPart(at(28, 12, 0))).toBe("afternoon");
    expect(dayPart(at(28, 17, 59))).toBe("afternoon");
    expect(dayPart(at(28, 18, 0))).toBe("evening");
    expect(dayPart(at(28, 23, 59))).toBe("evening");
  });

  it("greets by name when one was given", () => {
    expect(greetingTitle("morning", "Grace")).toBe("Good Morning, Grace");
    expect(greetingTitle("evening", "  Grace   Ann ")).toBe("Good Evening, Grace Ann");
    expect(greetingTitle("afternoon", "")).toBe("Good Afternoon");
    expect(greetingTitle("afternoon", null)).toBe("Good Afternoon");
  });

  it("greets once in each part of the day", () => {
    let last: string | null = null;
    const open = (d: Date) => {
      const greet = shouldGreet(d, last);
      if (greet) last = greetingSlot(d);
      return greet;
    };
    expect(open(at(28, 7))).toBe(true);
    expect(open(at(28, 11))).toBe(false);
    expect(open(at(28, 12, 30))).toBe(true);
    expect(open(at(28, 17))).toBe(false);
    expect(open(at(28, 18))).toBe(true);
    expect(open(at(28, 23, 59))).toBe(false);
    expect(open(at(29, 7))).toBe(true);
    expect(last).toBe("2026-10-29 morning");
  });

  it("uses verse references that all read correctly", () => {
    const books = referenceBooks();
    for (const ref of Object.values(GREETING_VERSES).flat()) {
      const [parsed] = parseReferences(ref, books);
      expect(parsed?.ok, ref).toBe(true);
    }
  });

  it("starts each day with another verse, keeping the others as fallbacks", () => {
    const today = greetingVerses(at(28, 8));
    expect(greetingVerses(at(28, 10))).toEqual(today);
    expect(greetingVerses(at(29, 8))[0]).not.toBe(today[0]);
    expect([...today].sort()).toEqual([...GREETING_VERSES.morning].sort());
    expect(GREETING_VERSES.evening).toContain(greetingVerses(at(28, 19))[0]);
  });
});
