import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, launchApp, openLiveService } from "./app";
import { png, wav } from "./files";

type Song = { id: string; lyricSync: { text: string; startMs: number | null }[] | null; audioMediaId: string | null; coverMediaId: string | null };

async function answerNextFileDialog(main: Page, file: string) {
  await main.evaluate((p) => ((window as unknown as { __sanctuaryflowPickFile?: () => string }).__sanctuaryflowPickFile = () => p), file);
}

test("a song gets music and synced lyrics, plays in the library, and shows the turning vinyl on the output", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const song = await app.invoke<Song>("songs_save", {
      song: {
        id: null, title: "Great Is Our God", artist: "Test Choir", originalKey: null, tempo: null, language: "en", category: null, copyrightHolder: null,
        copyrightYear: null, ccliNumber: null, source: null, license: null, notes: null, arrangement: null, themeId: null, tags: [],
        sections: [{ id: null, kind: "verse", label: "", lyrics: "Line one of the song\nLine two of the song\nLine three of the song" }],
      },
    });
    const audioFile = path.join(app.dataDir, "great.wav");
    writeFileSync(audioFile, wav(12));
    const coverFile = path.join(app.dataDir, "cover.png");
    writeFileSync(coverFile, png(400, 400, [190, 30, 40]));

    await goTo(app, "Song Library");
    await main.getByRole("tab", { name: "Songs" }).click();
    await main.getByRole("button", { name: /^Great Is Our God/ }).first().click();

    // Music and an album cover, imported straight from the computer.
    await main.getByRole("button", { name: "Add music (MP3)…" }).click();
    await answerNextFileDialog(main, audioFile);
    await main.getByRole("dialog").getByRole("button", { name: "Import file…" }).click();
    await expect(main.getByText("Music added to the song")).toBeVisible();
    await main.getByRole("button", { name: "Album cover…" }).click();
    await answerNextFileDialog(main, coverFile);
    await main.getByRole("dialog").getByRole("button", { name: "Import file…" }).click();
    await expect(main.getByText("Album cover set")).toBeVisible();
    // The music file belongs to the song (not shown as a plain media item to delete by accident).
    const saved = await app.invoke<Song>("songs_get", { id: song.id });
    expect(saved.audioMediaId).toBeTruthy();
    expect(await app.invoke<string[]>("media_references", { id: saved.audioMediaId })).toEqual(["Song: Great Is Our God"]);

    // Sync by tapping as each line starts.
    await main.getByRole("button", { name: "Sync lyrics…" }).click();
    const editor = main.getByRole("dialog", { name: "Sync lyrics: Great Is Our God" });
    await editor.getByRole("button", { name: "Play", exact: true }).click();
    for (const wait of [500, 2500, 2500]) {
      await main.waitForTimeout(wait);
      await editor.getByRole("button", { name: /^Tap · line/ }).click();
    }
    await editor.getByRole("button", { name: "Pause", exact: true }).click();
    await editor.getByRole("button", { name: "Save timing" }).click();
    await expect(main.getByText("Lyric timing saved")).toBeVisible();
    const synced = (await app.invoke<Song>("songs_get", { id: song.id })).lyricSync!;
    expect(synced.map((l) => l.text)).toEqual(["Line one of the song", "Line two of the song", "Line three of the song"]);
    const starts = synced.map((l) => l.startMs!);
    expect(starts[0]).toBeGreaterThan(200);
    expect(starts[1]! - starts[0]!).toBeGreaterThan(1800);
    expect(starts[2]! - starts[1]!).toBeGreaterThan(1800);
    await main.keyboard.press("Escape");
    await expect(editor).toBeHidden();

    // The library player highlights the line being sung.
    await expect(main.getByText("3 of 3 lines synchronized", { exact: false })).toBeVisible();
    await main.getByRole("group", { name: "Music player" }).getByRole("button", { name: "Play" }).click();
    const activeLine = () => main.getByLabel("Synchronized lyrics").locator('[aria-current="true"]').textContent().catch(() => null);
    await expect.poll(activeLine, { timeout: 10_000 }).toBe("Line one of the song");
    await expect.poll(activeLine, { timeout: 10_000 }).toBe("Line two of the song");
    await main.getByRole("group", { name: "Music player" }).getByRole("button", { name: "Pause" }).click();

    // On the output: Play shows the vinyl turning, with the line being sung.
    const plan = await app.invoke<{ id: string }>("services_save", {
      plan: {
        id: null, title: "Music Service", serviceDate: null, serviceTime: null, description: null, notes: null, status: "draft", isTemplate: false, themeId: null,
        items: [{ id: null, itemType: "song", title: "Great Is Our God", refId: song.id, settings: {}, notes: null }],
      },
    });
    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await main.getByRole("button", { name: "Great Is Our God", exact: true }).click();
    await main.getByRole("button", { name: /^Slide 1:/ }).click();
    await expect(main.getByRole("group", { name: "Song music" })).toBeVisible();
    await main.getByRole("button", { name: "Play music" }).click();
    const stage = projector.locator('[data-music-view="vinyl"]');
    await expect(stage).toBeVisible();
    const disc = projector.locator("[data-vinyl-disc]");
    await expect(disc).toHaveCSS("animation-play-state", "running");
    await expect.poll(() => projector.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.3);
    await expect(stage.getByText("GREAT IS OUR GOD")).toBeVisible();
    await expect(stage.getByText("Line one of the song")).toBeVisible({ timeout: 10_000 });
    // The cover is the sleeve and the record's label.
    await expect.poll(() => stage.locator("img").evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).naturalWidth === 400).length)).toBeGreaterThanOrEqual(2);
    // The operator's preview follows the same music.
    await expect(main.locator('[data-music-view="vinyl"]')).toBeVisible();

    // Next line jumps the music; Pause stops the record turning.
    await main.getByRole("button", { name: "Next line" }).click();
    await expect(stage.getByText("Line two of the song").first()).toBeVisible();
    await main.getByRole("button", { name: "Pause music" }).click();
    await expect(disc).toHaveCSS("animation-play-state", "paused");

    // Other views: large lyrics and back to the slides.
    await main.getByRole("tab", { name: "Lyrics", exact: true }).click();
    await expect(projector.locator('[data-music-view="lyrics"]')).toBeVisible();
    await main.getByRole("tab", { name: "Slides", exact: true }).click();
    // The music layer fades away (it stays in place, invisible, while the music plays on).
    await expect(projector.locator("[data-music-view]")).toHaveCSS("opacity", "0");
    await expect(projector.getByText("Line one of the song")).toBeVisible();

    await main.getByRole("button", { name: "Stop output" }).click();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
