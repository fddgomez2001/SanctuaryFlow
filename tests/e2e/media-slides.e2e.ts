import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { goTo, launchApp, openLiveService } from "./app";
import { png, recordWebm } from "./files";

interface Asset {
  id: string;
  kind: string;
  title: string;
  width: number | null;
  height: number | null;
  thumbnailPath: string | null;
  missing: boolean;
  absolutePath: string;
}

test("media imports with validation and thumbnails, plays on the projector and is reported when missing", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const imagePath = path.join(app.dataDir, "..", `sf-test-${app.port}.png`);
    writeFileSync(imagePath, png(320, 180, [20, 80, 160]));
    const fakePath = path.join(app.dataDir, "..", `sf-fake-${app.port}.mp4`);
    writeFileSync(fakePath, "This is a text file pretending to be a video.");
    const webmBase64 = await recordWebm(main);
    const videoPath = path.join(app.dataDir, "..", `sf-test-${app.port}.webm`);
    writeFileSync(videoPath, Buffer.from(webmBase64, "base64"));

    const outcomes = await app.invoke<{ path: string; result: { asset: Asset; duplicate: boolean } | null; error: string | null }[]>("media_import", {
      paths: [imagePath, videoPath, fakePath, imagePath],
    });
    expect(outcomes[0]!.result?.asset.kind).toBe("image");
    expect(outcomes[1]!.error ?? "").toBe("");
    expect(outcomes[1]!.result?.asset.kind).toBe("video");
    expect(outcomes[2]!.error).toMatch(/do not look like/);
    expect(outcomes[3]!.result?.duplicate).toBe(true);
    for (const p of [imagePath, videoPath, fakePath]) unlinkSync(p);

    // The Media Library measures files and renders thumbnails in the background.
    await goTo(app, "Media Library");
    await expect
      .poll(async () => (await app.invoke<Asset[]>("media_list", { query: { kind: null, text: null } })).filter((a) => a.thumbnailPath && a.width).length, { timeout: 30_000 })
      .toBe(2);
    const image = (await app.invoke<Asset[]>("media_list", { query: { kind: "image", text: null } }))[0]!;
    expect([image.width, image.height]).toEqual([320, 180]);

    // Present the video and confirm it actually plays on the output.
    await goTo(app, "Live Presentation");
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await goTo(app, "Media Library");
    await main.getByRole("button", { name: new RegExp(`sf-test-${app.port}`) }).filter({ has: main.locator("svg.lucide-film") }).first().dblclick();
    await expect.poll(() => projector.evaluate(() => document.querySelector("video")?.currentTime ?? 0), { timeout: 20_000 }).toBeGreaterThan(0.3);

    // A file deleted outside the app is detected as missing.
    const video = (await app.invoke<Asset[]>("media_list", { query: { kind: "video", text: null } }))[0]!;
    await goTo(app, "Live Presentation");
    await main.getByRole("button", { name: "Stop output" }).click();
    await main.waitForTimeout(1000);
    unlinkSync(video.absolutePath);
    const after = await app.invoke<Asset>("media_get", { id: video.id });
    expect(after.missing).toBe(true);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("custom slides are built in the slide editor and presented", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    await goTo(app, "Slide Editor");
    await main.getByRole("button", { name: "New announcement slides" }).click();
    await main.getByLabel("Slides title").fill("Weekly Notices");
    await main.getByRole("button", { name: "Text", exact: true }).click();
    await main.getByLabel("Text", { exact: true }).fill("Prayer meeting on Wednesday at 7 PM");
    await main.getByRole("button", { name: "Add slide" }).click();
    await main.getByRole("button", { name: "Save", exact: true }).click();
    await expect(main.getByText("Slides saved")).toBeVisible();
    const decks = await app.invoke<{ title: string; slideCount: number }[]>("decks_list", { category: null });
    expect(decks).toEqual([expect.objectContaining({ title: "Weekly Notices", slideCount: 2 })]);

    await main.getByRole("button", { name: "Present now" }).click();
    await goTo(app, "Live Presentation");
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await expect(projector.getByText("Prayer meeting on Wednesday at 7 PM")).toBeVisible();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("a video theme given to an item during the service keeps playing when items are added live", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const videoPath = path.join(app.dataDir, "..", `sf-bg-${app.port}.webm`);
    writeFileSync(videoPath, Buffer.from(await recordWebm(main), "base64"));
    await app.invoke("media_import", { paths: [videoPath] });
    unlinkSync(videoPath);
    await app.invoke("songs_save", {
      song: {
        id: null, title: "Background Test Song", artist: null, originalKey: null, tempo: null, language: "en", category: null,
        copyrightHolder: "Test", copyrightYear: null, ccliNumber: null, source: null, license: null, notes: null, arrangement: null,
        themeId: null, tags: [], sections: [{ id: null, kind: "verse", label: "", lyrics: "Words over the video" }],
      },
    });
    const plan = await app.invoke<{ id: string }>("services_save", {
      plan: {
        id: null, title: "Video Theme Service", serviceDate: null, serviceTime: null, description: null, notes: null, status: "draft", isTemplate: false, themeId: null,
        items: [{ id: null, itemType: "announcement", title: "Welcome", refId: null, settings: { text: "Welcome everyone" }, notes: null }],
      },
    });

    // Open the Live page first, so its theme list is loaded before the theme changes.
    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);

    // Set the video as a theme background the way an operator would.
    await goTo(app, "Media Library");
    await main.getByRole("button", { name: new RegExp(`sf-bg-${app.port}`) }).first().click();
    await main.getByRole("button", { name: "Use as theme background" }).click();
    await main.getByRole("dialog").getByRole("button", { name: /Midnight Blue/ }).click();
    await expect(main.getByText(/now uses this background/)).toBeVisible();

    await goTo(app, "Live Presentation");
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await main.getByText("Welcome", { exact: true }).first().click();
    await main.getByRole("button", { name: "Slide 1: Welcome" }).click();
    // The video theme, from the palette, for the item on screen.
    await main.getByRole("button", { name: "Theme Midnight Blue" }).click();
    const videoSrc = () => projector.evaluate(() => document.querySelector("video")?.getAttribute("src") ?? "");
    await expect.poll(videoSrc).toContain("asset");

    // Presenting something new reloads the presentation; the item keeps its video background.
    await main.getByLabel("Present a song or Scripture now").fill("Background Test Song");
    await main.getByRole("button", { name: "Background Test Song" }).click();
    await expect(projector.getByText("Words over the video")).toBeVisible();
    await main.getByText("Welcome", { exact: true }).first().click();
    await main.getByRole("button", { name: "Slide 1: Welcome" }).click();
    await expect.poll(videoSrc).toContain("asset");
    await expect.poll(() => projector.evaluate(() => document.querySelector("video")?.currentTime ?? 0), { timeout: 20_000 }).toBeGreaterThan(0.2);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
