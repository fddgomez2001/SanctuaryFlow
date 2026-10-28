import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { goTo, launchApp, type AppHandle } from "./app";

// The greeting matches the computer's clock, as the app does.
const part = (h: number) => (h < 12 ? "morning" : h < 18 ? "afternoon" : "evening");
const GREETING = { morning: "Good Morning", afternoon: "Good Afternoon", evening: "Good Evening" } as const;

/** A tiny translation with one greeting verse for each part of the day (placeholder words, not Scripture). */
const PLACEHOLDER = {
  morning: ["Psalms 5:3", "Placeholder morning words for the greeting test."],
  afternoon: ["Psalms 121:1–2", "Placeholder afternoon words, first line. Placeholder afternoon words, second line."],
  evening: ["Psalms 4:8", "Placeholder evening words for the greeting test."],
} as const;

async function installTestBible(app: AppHandle) {
  const file = path.join(app.dataDir, "greeting-test.json");
  const chapter = (chapter: number, verses: [number, string][]) => ({ chapter, verses: verses.map(([verse, text]) => ({ verse, text })) });
  writeFileSync(
    file,
    JSON.stringify({
      format: "sanctuaryflow-bible",
      version: 1,
      translation: { code: "GRT", name: "Greeting Test Text", language: "en", license: "Test data — not Scripture" },
      books: [
        {
          id: "PSA",
          name: "Psalms",
          chapters: [
            chapter(4, [[8, PLACEHOLDER.evening[1]]]),
            chapter(5, [[3, PLACEHOLDER.morning[1]]]),
            chapter(121, [
              [1, "Placeholder afternoon words, first line."],
              [2, "Placeholder afternoon words, second line."],
            ]),
          ],
        },
      ],
    }),
  );
  const pv = await app.invoke<{ token: string; suggestedMetadata: Record<string, unknown> }>("bible_import_preview", { path: file });
  await app.invoke("bible_import_commit", {
    token: pv.token,
    options: { metadata: { ...pv.suggestedMetadata, offlinePermitted: true }, replaceExisting: false, acknowledgeExclusions: false },
  });
}

test("the app greets once in each part of the day, with a verse from the installed Bible", async () => {
  process.env.SANCTUARYFLOW_E2E_GREETING = "1";
  const now = part(new Date().getHours());
  let app = await launchApp();
  try {
    // First opening today: greeted. No Bible yet, so it says where to add one.
    let greeting = app.main.getByRole("dialog", { name: GREETING[now] });
    await expect(greeting).toBeVisible();
    await expect(greeting.getByText("Add a Bible translation in the Bible Library and a verse will greet you here.")).toBeVisible();
    await greeting.getByRole("button", { name: "Continue" }).click();
    await expect(greeting).toBeHidden();
    await installTestBible(app);

    // Opening again in the same part of the day: no greeting.
    await app.close({ keepData: true });
    app = await launchApp({ dataDir: app.dataDir });
    await goTo(app, "Settings");
    await expect(app.main.getByText("Greet me with a Bible verse when SanctuaryFlow opens")).toBeVisible();
    await expect(app.main.getByRole("dialog")).toHaveCount(0);

    // The last greeting was in an earlier part of the day: greeted again, with
    // the verse for this part of the day read from the installed translation.
    await app.invoke("settings_set", { key: "general.lastGreeting", value: "2026-01-01 morning" });
    await app.close({ keepData: true });
    app = await launchApp({ dataDir: app.dataDir });
    greeting = app.main.getByRole("dialog", { name: GREETING[now] });
    await expect(greeting).toBeVisible();
    await expect(greeting.getByText(PLACEHOLDER[now][1], { exact: true })).toBeVisible();
    await expect(greeting.getByText(`${PLACEHOLDER[now][0]} (GRT)`)).toBeVisible();
    // Escape closes it too.
    await app.main.keyboard.press("Escape");
    await expect(greeting).toBeHidden();

    // Turned off in Settings: not greeted, even in a new part of the day.
    await goTo(app, "Settings");
    await app.main.getByRole("switch", { name: "Greet me with a Bible verse when SanctuaryFlow opens" }).click();
    await expect.poll(() => app.invoke<Record<string, unknown>>("settings_get_all").then((s) => s["general.greeting"])).toBe(false);
    await app.invoke("settings_set", { key: "general.lastGreeting", value: "2026-01-01 morning" });
    await app.close({ keepData: true });
    app = await launchApp({ dataDir: app.dataDir });
    await goTo(app, "Settings");
    await expect(app.main.getByRole("dialog")).toHaveCount(0);
    expect(app.errors).toEqual([]);
  } finally {
    delete process.env.SANCTUARYFLOW_E2E_GREETING;
    await app.close();
  }
});
