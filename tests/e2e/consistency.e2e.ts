import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, launchApp, openLiveService } from "./app";
import { png } from "./files";

const SHOTS = process.env.SANCTUARYFLOW_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const newSong = (title: string, artist: string, lyrics: string) => ({
  id: null, title, artist, originalKey: null, tempo: null, language: "en", category: null, copyrightHolder: null, copyrightYear: null, ccliNumber: null,
  source: null, license: null, notes: null, arrangement: null, themeId: null, tags: [], sections: [{ id: null, kind: "verse", label: "", lyrics }],
});

test("lyrics edited in the Song Library change the song in the live presentation and on the output", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const song = await app.invoke<{ id: string }>("songs_save", { song: newSong("Placeholder Hymn", "Test Choir", "Placeholder first line\nPlaceholder second line") });
    const plan = await app.invoke<{ id: string }>("services_save", {
      plan: {
        id: null, title: "Edit Test", serviceDate: null, serviceTime: null, description: null, notes: null, status: "draft", isTemplate: false, themeId: null,
        items: [{ id: null, itemType: "song", title: "Placeholder Hymn", refId: song.id, settings: {}, notes: null }],
      },
    });
    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await main.getByRole("button", { name: "Placeholder Hymn", exact: true }).click();
    await main.getByRole("button", { name: /^Slide 1:/ }).click();
    await expect(projector.getByText("Placeholder first line")).toBeVisible();

    // Edit and save the lyrics in the Song Library while the song is on screen.
    await goTo(app, "Song Library");
    await main.getByRole("tab", { name: "Songs" }).click();
    await main.getByRole("button", { name: /^Placeholder Hymn/ }).first().click();
    await main.getByRole("button", { name: "Edit", exact: true }).click();
    await main.getByLabel("Verse 1 lyrics").fill("Edited first line\nPlaceholder second line");
    await main.getByRole("button", { name: "Save", exact: true }).click();
    await expect(main.getByText("Song saved")).toBeVisible();

    // The output changes by itself, and the Live page shows the new words.
    await expect(projector.getByText("Edited first line")).toBeVisible();
    await expect(projector.getByText("Placeholder first line")).toHaveCount(0);
    await goTo(app, "Live Presentation");
    await expect(main.getByRole("button", { name: /^Slide 1: .*\(on screen\)/ })).toBeVisible();
    await expect(main.getByText("Edited first line").first()).toBeVisible();
    await main.getByRole("button", { name: "Stop output" }).click();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("dark mode uses the same gold, and songs without a cover show the gold album picture", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    await app.invoke("songs_save", { song: newSong("Placeholder Song", "Placeholder Band", "Line one\nLine two") });
    const otherFile = path.join(app.dataDir, "Default Cover.png");
    writeFileSync(otherFile, png(320, 320, [20, 20, 20]));
    await app.invoke("media_import", { paths: [otherFile] });

    await main.getByRole("group", { name: "Light or dark mode" }).getByRole("button", { name: "Dark" }).click();
    await expect(main.locator("html")).toHaveAttribute("data-ui", "dark");
    const primary = () => main.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim().toLowerCase());
    expect(await primary()).toBe("#b0842a");
    // The current page in the menu is gold, as in light mode.
    await expect(main.getByRole("navigation", { name: "Main" }).locator('[aria-current="page"]')).toHaveCSS("background-color", "rgb(176, 132, 42)");

    await goTo(app, "Song Library");
    const artist = main.getByRole("button", { name: "Artist Placeholder Band" });
    await expect(artist.locator("img")).toHaveAttribute("src", /\/Album_Default\.png$/);
    await expect.poll(() => artist.locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1254);
    await expect(main.getByText("Default cover: gold album")).toBeVisible();
    await shot(main, "library-dark");

    // Another picture can replace it, and the gold album comes back.
    await main.getByRole("button", { name: "Default cover…" }).click();
    await main.getByRole("dialog").getByRole("button", { name: /Default Cover/ }).click();
    await expect(main.getByText("Default cover: your picture")).toBeVisible();
    await expect.poll(() => artist.locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(320);
    expect(await app.invoke<Record<string, unknown>>("settings_get_all").then((s) => typeof s["songs.defaultCover"])).toBe("string");
    await main.getByRole("button", { name: "Use the gold album" }).click();
    await expect(artist.locator("img")).toHaveAttribute("src", /\/Album_Default\.png$/);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
