import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, launchApp, openLiveService } from "./app";
import { png, recordWebm } from "./files";

/** Makes the next "choose a file" request return `file` instead of opening Windows' picker. */
async function answerNextFileDialog(main: Page, file: string) {
  await main.evaluate((p) => {
    (window as unknown as { __sanctuaryflowPickFile?: () => string | null }).__sanctuaryflowPickFile = () => p;
  }, file);
}

test("Black, Clear, Logo and Stop fade, and the logo screen has its own logo and background", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const plan = await app.invoke<{ id: string }>("services_save", {
      plan: {
        id: null, title: "Output Test", serviceDate: null, serviceTime: null, description: null, notes: null, status: "draft", isTemplate: false, themeId: null,
        items: [{ id: null, itemType: "announcement", title: "Notices", refId: null, settings: { text: "Welcome everyone" }, notes: null }],
      },
    });
    const logoFile = path.join(app.dataDir, "church-logo.png");
    writeFileSync(logoFile, png(400, 200, [220, 30, 30]));

    // Logo screen: import a logo straight from the picker, on a colour background.
    await goTo(app, "Settings");
    await main.getByRole("button", { name: "Presentation", exact: true }).click();
    await expect(main.getByLabel("Fade for Black, Clear, Logo and Stop")).toHaveValue("500");
    await main.getByRole("button", { name: "Choose picture or video…" }).click();
    await answerNextFileDialog(main, logoFile);
    await main.getByRole("dialog").getByRole("button", { name: "Import file…" }).click();
    await expect(main.getByText("church-logo", { exact: true })).toBeVisible();
    await main.getByLabel("Background", { exact: true }).selectOption("color");
    await main.getByLabel("Background colour").fill("#123456");
    // The imported logo is in the Media Library like any other picture.
    expect((await app.invoke<{ title: string }[]>("media_list", { query: { kind: null, text: null } })).map((m) => m.title)).toEqual(["church-logo"]);

    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await main.getByRole("button", { name: "Notices", exact: true }).click();
    await main.getByRole("button", { name: /^Slide 1:/ }).click();
    await expect(projector.getByText("Welcome everyone")).toBeVisible();

    // Present now dissolves from the slide on screen into the new one.
    await app.invoke("songs_save", {
      song: {
        id: null, title: "Quick Song", artist: null, originalKey: null, tempo: null, language: "en", category: null, copyrightHolder: "Test", copyrightYear: "2026",
        ccliNumber: null, source: null, license: null, notes: null, arrangement: null, themeId: null, tags: [],
        sections: [{ id: null, kind: "verse", label: "", lyrics: "Quick line one" }],
      },
    });
    const dissolve = projector.waitForFunction(() => [...document.querySelectorAll<HTMLElement>("div")].some((d) => d.style.animation.includes("sf-fade-out")), undefined, {
      polling: "raf",
      timeout: 15_000,
    });
    const presentNow = main.getByLabel("Present a song or Scripture now");
    await presentNow.fill("Quick Song");
    await expect(main.getByRole("button", { name: /Quick Song/ })).toBeVisible();
    await presentNow.press("Enter");
    await dissolve;
    await expect(projector.getByText("Quick line one")).toBeVisible();
    await main.getByRole("button", { name: "Notices", exact: true }).click();
    await main.getByRole("button", { name: /^Slide 1:/ }).click();
    await expect(projector.getByText("Welcome everyone")).toBeVisible();

    // Clear stays on while another slide is chosen, until it is turned off.
    await main.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(projector.getByText("Welcome everyone")).toHaveCount(0);
    await main.getByRole("button", { name: "Notices", exact: true }).dblclick();
    await main.getByRole("button", { name: /^Slide 1:/ }).click();
    await expect(main.getByText("Clear is on:")).toBeVisible();
    await main.waitForTimeout(800);
    await expect(projector.getByText("Welcome everyone")).toHaveCount(0);
    await main.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(projector.getByText("Welcome everyone")).toBeVisible();

    // Black fades the slide out instead of cutting it.
    await main.getByRole("button", { name: "Black", exact: true }).click();
    await expect(projector.locator('[data-fade="out"]', { hasText: "Welcome everyone" })).toBeAttached({ timeout: 400 });
    await expect(projector.getByText("Welcome everyone")).toHaveCount(0);
    await main.getByRole("button", { name: "Black", exact: true }).click();
    await expect(projector.getByText("Welcome everyone")).toBeVisible();

    // Logo: the imported logo over the chosen colour, faded in.
    await main.getByRole("button", { name: "Logo", exact: true }).click();
    const logoLayer = projector.locator('[data-fade="in"]').filter({ has: projector.locator("img") });
    await expect(logoLayer).toBeAttached();
    await expect
      .poll(() => logoLayer.evaluate((el) => [getComputedStyle(el).opacity, [...el.querySelectorAll("div")].some((d) => getComputedStyle(d).backgroundColor === "rgb(18, 52, 86)")]))
      .toEqual(["1", true]);
    expect(await logoLayer.locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(400);

    // Stop takes everything off with a fade too.
    await main.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(projector.locator('[data-fade="out"]').filter({ has: projector.locator("img") })).toBeAttached({ timeout: 400 });
    await expect(projector.locator("img")).toHaveCount(0);

    // A video can be the logo: it fills the screen and loops silently.
    const videoFile = path.join(app.dataDir, "logo-loop.webm");
    writeFileSync(videoFile, Buffer.from(await recordWebm(main), "base64"));
    await goTo(app, "Settings");
    await main.getByRole("button", { name: "Presentation", exact: true }).click();
    await main.getByRole("button", { name: "Choose picture or video…" }).click();
    await answerNextFileDialog(main, videoFile);
    await main.getByRole("dialog").getByRole("button", { name: "Import file…" }).click();
    await expect(main.getByText("Play the video's sound")).toBeVisible();
    await goTo(app, "Live Presentation");
    await main.getByRole("button", { name: "Logo", exact: true }).click();
    const video = projector.locator('[data-fade="in"] video');
    await expect(video).toBeAttached();
    expect(await video.evaluate((v: HTMLVideoElement) => [v.loop, v.muted])).toEqual([true, true]);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime > 0)).toBe(true);
    await main.getByRole("button", { name: "Stop output" }).click();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
