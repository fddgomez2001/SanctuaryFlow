/**
 * The greeting shown when SanctuaryFlow opens: once each morning, afternoon
 * and evening of a day. Only verse references live here; the words always
 * come from a Bible translation installed in the library.
 */

export type DayPart = "morning" | "afternoon" | "evening";

/** Settings keys: whether to greet, and the part of a day last greeted ("2026-10-28 morning"). */
export const GREETING_ENABLED = "general.greeting";
export const LAST_GREETING = "general.lastGreeting";

/** The operator's name, asked when SanctuaryFlow first starts. */
export const USER_NAME = "general.userName";

export const GREETINGS: Record<DayPart, string> = {
  morning: "Good Morning",
  afternoon: "Good Afternoon",
  evening: "Good Evening",
};

/** "Good Afternoon, Grace" — or just "Good Afternoon" without a name. */
export function greetingTitle(part: DayPart, name: unknown): string {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  return n ? `${GREETINGS[part]}, ${n}` : GREETINGS[part];
}

/** Morning until 11:59 am, afternoon until 5:59 pm, evening until 11:59 pm (local time). */
export function dayPart(d: Date): DayPart {
  const h = d.getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The part of a day a greeting belongs to, for example "2026-10-28 morning". */
export function greetingSlot(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${dayPart(d)}`;
}

/** Greet unless this part of today was already greeted. */
export function shouldGreet(now: Date, lastSlot: unknown): boolean {
  return lastSlot !== greetingSlot(now);
}

/** Verses for each part of the day (references only). */
export const GREETING_VERSES: Record<DayPart, readonly string[]> = {
  morning: [
    "Lamentations 3:22-23",
    "Psalm 5:3",
    "Psalm 143:8",
    "Psalm 90:14",
    "Psalm 118:24",
    "Psalm 59:16",
    "Psalm 92:1-2",
    "Isaiah 33:2",
  ],
  afternoon: [
    "Psalm 121:1-2",
    "Isaiah 40:31",
    "Psalm 55:17",
    "Colossians 3:23",
    "Galatians 6:9",
    "Proverbs 3:5-6",
    "Joshua 1:9",
    "Philippians 4:13",
  ],
  evening: [
    "Psalm 4:8",
    "Psalm 141:2",
    "Matthew 11:28",
    "Psalm 91:1",
    "Philippians 4:6-7",
    "1 Peter 5:7",
    "Psalm 121:7-8",
    "Psalm 63:6",
  ],
};

/**
 * The verses to try for a greeting, today's first: each day starts one
 * further along the list, and the rest follow in case a translation lacks it.
 */
export function greetingVerses(d: Date): string[] {
  const list = GREETING_VERSES[dayPart(d)];
  const day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  const start = day % list.length;
  return [...list.slice(start), ...list.slice(0, start)];
}
