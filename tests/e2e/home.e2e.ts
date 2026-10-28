import { expect, test, type Page } from "@playwright/test";
import { goTo, launchApp } from "./app";

const SHOTS = process.env.SANCTUARYFLOW_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const METALLIC_GOLD = "00000000-0000-4000-8000-000000000009";
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** True when a slide on the page is drawn on the metallic gold backdrop. */
const metallicGoldShown = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll("main div")].some((d) => getComputedStyle(d).backgroundImage.includes("rgb(214, 180, 101)")));

test("Home shows the library at a glance, from real numbers", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const song = (title: string) =>
      app.invoke<{ id: string }>("songs_save", {
        song: {
          id: null, title, artist: "Test Choir", originalKey: null, tempo: null, language: "en", category: null, copyrightHolder: null,
          copyrightYear: null, ccliNumber: null, source: null, license: null, notes: null, arrangement: null, themeId: null, tags: [],
          sections: [{ id: null, kind: "verse", label: "", lyrics: `${title} first line\n${title} second line` }],
        },
      });
    const often = await song("Placeholder Anthem");
    const once = await song("Second Placeholder");
    for (let i = 0; i < 3; i++) await app.invoke("songs_record_use", { id: often.id });
    await app.invoke("songs_record_use", { id: once.id });
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 7);
    for (const [title, date] of [["This Month Service", isoDate(today)], ["Next Month Service", isoDate(nextMonth)]] as const) {
      await app.invoke("services_save", {
        plan: {
          id: null, title, serviceDate: date, serviceTime: "09:30", description: null, notes: null, status: "ready", isTemplate: false, themeId: null,
          items: [
            { id: null, itemType: "song", title: "Placeholder Anthem", refId: often.id, settings: {}, notes: null },
            { id: null, itemType: "announcement", title: "Welcome", refId: null, settings: { text: "Welcome everyone" }, notes: null },
          ],
        },
      });
    }
    await goTo(app, "Service Planner");
    await goTo(app, "Home");

    await expect(main.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening)$/ })).toBeVisible();
    await expect(main.getByText("SanctuaryFlow · 2 songs · 2 services · 0 media files")).toBeVisible();
    // Headline numbers.
    const presented = main.locator("section", { has: main.getByRole("heading", { name: "Times presented" }) });
    await expect(presented.getByText("4", { exact: true })).toBeVisible();
    await expect(presented.getByText("4 songs · 0 Scripture")).toBeVisible();
    await expect(main.getByRole("img", { name: /^Songs added: .* 2$/ })).toBeVisible();
    // Services by month: one this month, one planned next month.
    const chart = main.locator("section", { has: main.getByRole("heading", { name: "Services by month" }) });
    await expect(chart.getByLabel(/: 1 service$/)).toHaveCount(2);
    // The most presented songs, in order.
    const top = main.locator("section", { has: main.getByRole("heading", { name: "Most presented songs" }) });
    await expect(top.getByRole("listitem")).toHaveCount(2);
    await expect(top.getByRole("listitem").first()).toContainText("Placeholder Anthem");
    await expect(top.getByRole("listitem").first()).toContainText("3 times");
    // What the services are made of.
    const mix = main.locator("section", { has: main.getByRole("heading", { name: "What your services include" }) });
    await expect(mix.getByText("2 · 50%")).toHaveCount(2);
    // Coming up, and a verse once a Bible is installed.
    await expect(main.getByRole("button", { name: "Present “This Month Service”" })).toBeVisible();
    await expect(main.getByText("Install a Bible translation and a verse for each part of the day will appear here.")).toBeVisible();
    // Disk and database details are no longer on Home.
    await expect(main.getByText("Free disk space")).toHaveCount(0);
    await expect(main.getByText("Database size")).toHaveCount(0);
    await shot(main, "home");
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("new songs show white Arial on metallic gold, and theme transitions play in the preview", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    expect((await app.invoke<Record<string, unknown>>("settings_get_all"))["presentation.defaultSongThemeId"]).toBe(METALLIC_GOLD);

    // A new song, typed in the Song Library.
    await goTo(app, "Song Library");
    await main.getByRole("button", { name: "New song" }).click();
    await main.getByLabel("Title").fill("Gold Placeholder");
    await main.getByPlaceholder("Type the lyrics…").fill("Golden placeholder line one\nGolden placeholder line two");
    await main.getByRole("button", { name: "Save", exact: true }).click();
    await expect(main.getByRole("heading", { name: "Gold Placeholder" })).toBeVisible();
    await expect.poll(() => metallicGoldShown(main)).toBe(true);
    const words = main.getByText("Golden placeholder line one").first();
    await expect(words).toBeVisible();
    const look = await words.evaluate((el) => {
      const s = getComputedStyle(el.closest("[style*='font-family']") ?? el);
      return { font: s.fontFamily, color: s.color, shadow: s.textShadow };
    });
    expect(look.font.startsWith('"Arial"') || look.font.startsWith("Arial")).toBe(true);
    expect(look.color).toBe("rgb(255, 255, 255)");
    expect(look.shadow).not.toBe("none");
    await shot(main, "song-metallic-gold");

    // Presentation Themes: pointing at an effect plays it in the preview; clicking chooses it.
    await goTo(app, "Presentation Themes");
    await main.getByRole("button", { name: /Metallic Gold/ }).click();
    await expect(main.getByLabel("Theme name")).toHaveValue("Metallic Gold");
    const effects = main.getByRole("radiogroup", { name: "Effect" });
    await expect(effects.getByRole("radio", { name: "Fade" })).toHaveAttribute("aria-checked", "true");
    // A slower transition, so the test sees it playing.
    await main.getByLabel("Duration (ms)").fill("1500");
    const playing = (effect: string) => main.getByRole("region", { name: "Preview" }).locator(`[style*="sf-${effect}-in"]`);
    await effects.getByRole("radio", { name: "Rise up" }).hover();
    await expect(playing("rise")).not.toHaveCount(0);
    await expect(effects.getByRole("radio", { name: "Fade" })).toHaveAttribute("aria-checked", "true");
    await effects.getByRole("radio", { name: "Zoom" }).click();
    await expect(effects.getByRole("radio", { name: "Zoom" })).toHaveAttribute("aria-checked", "true");
    await expect(playing("zoom")).not.toHaveCount(0);
    await main.mouse.move(0, 0);
    await main.waitForTimeout(800);
    await main.getByRole("button", { name: "Play transition" }).click();
    await expect(playing("zoom")).not.toHaveCount(0);
    await shot(main, "theme-transition");
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
