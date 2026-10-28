import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fixture, goTo, launchApp, type AppHandle, openLiveService } from "./app";
import { recordWebm } from "./files";

type Plan = { id: string; items: { id: string; title: string; refId: string | null; itemType: string; settings: Record<string, unknown> }[] };

async function seedService(app: AppHandle) {
  const song = (title: string) =>
    app.invoke<{ id: string; title: string }>("songs_save", {
      song: {
        id: null, title, artist: null, originalKey: null, tempo: null, language: "en", category: null, copyrightHolder: "Test", copyrightYear: "2026",
        ccliNumber: null, source: null, license: null, notes: null, arrangement: null, themeId: null, tags: [],
        sections: [
          { id: null, kind: "verse", label: "", lyrics: `${title} verse line one\n${title} verse line two` },
          { id: null, kind: "chorus", label: "", lyrics: `${title} chorus line` },
        ],
      },
    });
  const first = await song("Alpha Song");
  const second = await song("Beta Song");
  const plan = await app.invoke<Plan>("services_save", {
    plan: {
      id: null, title: "Lineup Test", serviceDate: null, serviceTime: null, description: null, notes: null, status: "draft", isTemplate: false, themeId: null,
      items: [
        { id: null, itemType: "song", title: first.title, refId: first.id, settings: {}, notes: null },
        { id: null, itemType: "song", title: second.title, refId: second.id, settings: {}, notes: null },
        { id: null, itemType: "announcement", title: "Notices", refId: null, settings: { text: "Welcome everyone" }, notes: null },
      ],
    },
  });
  return plan;
}

const lineupOrder = (main: Page) =>
  main
    .getByRole("group", { name: "Service lineup" })
    .getByRole("button", { name: /^Move / })
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.replace(/^Move /, "")));

async function drag(main: Page, from: string, to: string) {
  await main.getByRole("button", { name: from, exact: true }).scrollIntoViewIfNeeded();
  const a = (await main.getByRole("button", { name: from, exact: true }).boundingBox())!;
  const b = (await main.getByRole("button", { name: to, exact: true }).boundingBox())!;
  // Paced like a hand: the drop zones are measured just after the drag starts.
  await main.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await main.mouse.down();
  await main.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 4 });
  await main.waitForTimeout(150);
  await main.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await main.waitForTimeout(150);
  await main.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2);
  await main.waitForTimeout(150);
  await main.mouse.up();
}

test("the live lineup can be rearranged, given per-song themes and shown as a list", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const plan = await seedService(app);
    const themes = await app.invoke<{ id: string; name: string }[]>("themes_list");
    const midnight = themes.find((t) => t.name === "Midnight Blue")!;
    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);
    await expect.poll(() => lineupOrder(main)).toEqual(["Alpha Song", "Beta Song", "Notices"]);

    // Rearrange with the keyboard: pick up Beta Song, move it up, drop it.
    await main.getByRole("button", { name: "Move Beta Song" }).focus();
    for (const key of ["Space", "ArrowUp", "Space"]) {
      await main.keyboard.press(key);
      await main.waitForTimeout(150);
    }
    await expect.poll(() => lineupOrder(main)).toEqual(["Beta Song", "Alpha Song", "Notices"]);
    await expect.poll(async () => (await app.invoke<Plan>("services_get", { id: plan.id })).items.map((i) => i.title)).toEqual(["Beta Song", "Alpha Song", "Notices"]);

    // Drag a theme from the palette onto one song.
    await drag(main, "Theme Midnight Blue", "Alpha Song");
    await expect(main.getByText("“Alpha Song” now uses the “Midnight Blue” theme")).toBeVisible();
    await expect.poll(async () => (await app.invoke<Plan>("services_get", { id: plan.id })).items.find((i) => i.title === "Alpha Song")!.settings.themeId).toBe(midnight.id);
    await expect(main.getByRole("button", { name: "Alpha Song", exact: true }).getByText("Midnight Blue")).toBeVisible();

    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    const midnightShown = () =>
      projector.evaluate(() => [...document.querySelectorAll<HTMLElement>("div")].some((d) => getComputedStyle(d).backgroundColor === "rgb(11, 31, 58)"));
    await main.getByRole("button", { name: "Alpha Song", exact: true }).click();
    await main.getByRole("button", { name: "Slide 1: Verse 1" }).click();
    await expect(projector.getByText("Alpha Song verse line one")).toBeVisible();
    await expect.poll(midnightShown).toBe(true);
    // The other song keeps the planned theme.
    await main.getByRole("button", { name: "Beta Song", exact: true }).click();
    await main.getByRole("button", { name: "Slide 1: Verse 1" }).click();
    await expect(projector.getByText("Beta Song verse line one")).toBeVisible();
    await expect.poll(midnightShown).toBe(false);

    // List view shows the words, coloured by song part, and presents on click.
    await main.getByRole("button", { name: "List view" }).click();
    const chorus = main.getByRole("button", { name: "Slide 2: Chorus", exact: true });
    await expect(chorus.locator("p", { hasText: "Beta Song chorus line" })).toBeVisible();
    const chorusGroup = main.getByRole("group", { name: "Chorus", exact: true });
    expect(await chorusGroup.getByText("Chorus", { exact: true }).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(122, 84, 16)");
    // A pure list: words only, no slide pictures.
    expect(await chorusGroup.locator("img, video").count()).toBe(0);
    await chorus.click();
    await expect(projector.getByText("Beta Song chorus line")).toBeVisible();
    await main.getByRole("button", { name: "Grid view" }).click();
    await expect(main.getByRole("button", { name: "Slide 2: Chorus (on screen)" })).toBeVisible();

    // The item theme can also be chosen from a list, and cleared again.
    await main.getByLabel("Theme for this item").selectOption({ label: "Item theme: Midnight Blue" });
    await expect.poll(midnightShown).toBe(true);
    await main.getByLabel("Theme for this item").selectOption({ label: "Item theme: as planned" });
    await expect.poll(midnightShown).toBe(false);

    // Themes can be searched; Customize always comes first.
    await main.getByLabel("Search themes").fill("midnight");
    await expect(main.getByRole("button", { name: /^Theme / })).toHaveCount(1);
    await expect(main.getByRole("button", { name: "Customize the look of an item" })).toBeVisible();

    // Customize, dropped on a song, restyles just that song.
    const fontSizeOn = (text: string) =>
      projector.getByText(text).last().evaluate((el) => parseFloat(getComputedStyle(el.parentElement!).fontSize));
    await drag(main, "Customize the look of an item", "Alpha Song");
    const editor = main.getByRole("dialog", { name: "Customize “Alpha Song”" });
    await expect(editor).toBeVisible();
    await editor.getByLabel("Text size").fill("130");
    await editor.getByLabel("Text width").fill("70");
    await editor.getByRole("button", { name: "Save for this item" }).click();
    await expect(main.getByText("“Alpha Song” has its new look")).toBeVisible();
    await main.getByRole("button", { name: "Alpha Song", exact: true }).click();
    await main.getByRole("button", { name: "Slide 1: Verse 1" }).click();
    await expect.poll(() => fontSizeOn("Alpha Song verse line one")).toBeGreaterThan(100);
    // The custom look keeps the song's background and is saved with the service.
    await expect.poll(midnightShown).toBe(true);
    const custom = (await app.invoke<{ id: string; name: string; settings: Record<string, unknown> }[]>("themes_list")).filter((t) => t.name === "Alpha Song (custom)");
    expect(custom).toHaveLength(1);
    expect(custom[0]!.settings).toMatchObject({ fontSize: 130, textWidth: 70 });
    await expect.poll(async () => (await app.invoke<Plan>("services_get", { id: plan.id })).items.find((i) => i.title === "Alpha Song")!.settings.themeId).toBe(custom[0]!.id);
    // Editing again updates the same look instead of adding another theme.
    await main.getByRole("button", { name: "Customize…" }).click();
    await editor.getByLabel("Text size").fill("90");
    await editor.getByRole("button", { name: "Save for this item" }).click();
    await expect(editor).toBeHidden();
    await expect.poll(async () => (await app.invoke<{ name: string }[]>("themes_list")).filter((t) => t.name === "Alpha Song (custom)").length).toBe(1);

    // New fonts, letter case, italic and transitions, saved as a theme of its own.
    await main.getByRole("button", { name: "Customize…" }).click();
    await editor.getByLabel("Font").selectOption("Poppins");
    await editor.getByRole("button", { name: "Title Case" }).click();
    await editor.getByLabel("Italic").click();
    await editor.getByLabel("Effect").selectOption("zoom");
    await editor.getByRole("button", { name: "Save as new theme…" }).click();
    await editor.getByLabel("New theme name").fill("Big Words");
    await editor.getByRole("button", { name: "Save theme" }).click();
    await expect(main.getByText("Theme “Big Words” was saved and used for “Alpha Song”")).toBeVisible();
    const bigWords = (await app.invoke<{ id: string; name: string; settings: Record<string, unknown> }[]>("themes_list")).find((t) => t.name === "Big Words")!;
    expect(bigWords.settings).toMatchObject({ fontFamily: "Poppins", textTransform: "capitalize", italic: true, transition: { type: "zoom" } });
    expect(bigWords.settings.customizedFor).toBeUndefined();
    const lineStyle = () =>
      // The newest copy: while words dissolve into a new look, both are on screen.
      projector.getByText("Alpha Song verse line one").last().evaluate((el) => {
        const cs = getComputedStyle(el.parentElement!);
        const family = cs.fontFamily.split(",")[0]!.replace(/"/g, "");
        // The bundled font is really in use (not a look-alike fallback).
        return [family, cs.textTransform, cs.fontStyle, document.fonts.check(`${cs.fontStyle} ${cs.fontWeight} 16px "${family}"`)];
      });
    await expect.poll(lineStyle).toEqual(["Poppins", "capitalize", "italic", true]);

    // A video from the palette's Videos tab becomes a song's background.
    const clip = Buffer.from(await recordWebm(main), "base64");
    const clipFile = path.join(app.dataDir, "Waves loop.webm");
    writeFileSync(clipFile, clip);
    await app.invoke("media_import", { paths: [clipFile] });
    await main.getByRole("tab", { name: "Videos" }).click();
    await drag(main, "Video Waves loop", "Beta Song");
    await expect(main.getByText("“Waves loop” is now the background of “Beta Song”")).toBeVisible();
    await main.getByRole("button", { name: "Beta Song", exact: true }).click();
    await main.getByRole("button", { name: "Slide 1: Verse 1" }).click();
    await expect(projector.locator("video")).toHaveCount(1);
    await expect.poll(() => projector.locator("video").evaluate((v: HTMLVideoElement) => v.loop && v.muted && v.currentTime > 0)).toBe(true);
    await main.getByRole("tab", { name: "Themes" }).click();
    await main.getByRole("button", { name: "Stop output" }).click();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("a public Canva design is shown live, then brought in page by page", async () => {
  // A downloads folder for this test only: the real one is never touched.
  const downloads = mkdtempSync(path.join(process.env.SANCTUARYFLOW_E2E_TMP ?? tmpdir(), "sf-downloads-"));
  process.env.SANCTUARYFLOW_DOWNLOADS_DIR = downloads;
  const app = await launchApp();
  delete process.env.SANCTUARYFLOW_DOWNLOADS_DIR;
  const { main } = app;
  const designLink = "https://www.canva.com/design/DAFtest1234/AbCdEfGh12345/view?utm_content=x&utm_medium=link";
  const embed = "https://www.canva.com/design/DAFtest1234/AbCdEfGh12345/view?embed";
  try {
    const plan = await app.invoke<Plan>("services_save", {
      plan: { id: null, title: "Canva Test", serviceDate: null, serviceTime: null, description: null, notes: null, status: "draft", isTemplate: false, themeId: null, items: [] },
    });
    await goTo(app, "Service Planner");
    await main.getByRole("tab", { name: "all" }).click();
    await main.getByRole("button", { name: /Canva Test/ }).first().click();
    await main.getByRole("button", { name: "Import / Canva" }).click();
    const dialog = main.getByRole("dialog");
    // A link that needs sign-in is explained, not accepted.
    await dialog.getByLabel("Canva link").fill("https://www.canva.com/design/DAFtest1234/view");
    await dialog.getByLabel("Name in the service").click();
    await expect(dialog.getByText(/only works for people signed in/)).toBeVisible();
    await dialog.getByLabel("Canva link").fill(designLink);
    await dialog.getByLabel("Name in the service").fill("Welcome loop");
    // Every page as slides is offered first; this time show it live.
    await expect(dialog.getByRole("tab", { name: "Every page as a slide" })).toHaveAttribute("aria-selected", "true");
    await dialog.getByRole("tab", { name: "Live from Canva" }).click();
    await dialog.getByLabel("Number of Canva pages").fill("3");
    await dialog.getByRole("button", { name: /^Add Canva design/ }).click();
    await expect(main.getByText("“Welcome loop” was added. It is shown live from Canva.")).toBeVisible();
    await expect(main.getByText("Canva design (live)").first()).toBeVisible();
    await expect
      .poll(async () => (await app.invoke<Plan>("services_get", { id: plan.id })).items.map((i) => [i.title, i.settings.canvaUrl]))
      .toEqual([["Welcome loop", embed]]);

    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await main.getByRole("button", { name: "Welcome loop", exact: true }).click();
    await main.getByRole("button", { name: /^Slide 1:/ }).click();
    const frame = projector.locator("iframe");
    await expect(frame).toHaveAttribute("src", `${embed}#1`);
    // Next turns Canva's pages on the output and its preview together, in the
    // same viewer (no reload), with no mouse on the output; it stops on the last page.
    await frame.evaluate((f) => (f.dataset.mark = "first"));
    const preview = main.locator("iframe");
    for (const page of [2, 3, 3]) {
      await main.keyboard.press("ArrowRight");
      await expect(frame).toHaveAttribute("src", `${embed}#${page}`);
      await expect(preview).toHaveAttribute("src", `${embed}#${page}`);
    }
    expect(await frame.evaluate((f) => f.dataset.mark)).toBe("first");
    await expect(main.getByRole("button", { name: "Slide 3: Page 3 (on screen)" })).toBeVisible();
    await main.keyboard.press("ArrowLeft");
    await expect(frame).toHaveAttribute("src", `${embed}#2`);
    await expect(frame).toHaveCSS("pointer-events", "none");
    // The design can run, but can't reach or navigate the app.
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");

    // "Show every page": the design opens in the browser, the PDF downloaded
    // from Canva is found in Downloads, and each page becomes a slide.
    await main.evaluate(() => {
      const w = window as unknown as { __sanctuaryflowOpenUrl?: (u: string) => void; __opened?: string };
      w.__sanctuaryflowOpenUrl = (u) => (w.__opened = u);
    });
    await main.getByRole("button", { name: "Show every page…" }).click();
    await main.getByRole("dialog").getByRole("button", { name: /^Open .* in Canva$/ }).click();
    expect(await main.evaluate(() => (window as unknown as { __opened?: string }).__opened)).toBe("https://www.canva.com/design/DAFtest1234/AbCdEfGh12345/view");
    await expect(main.getByText(/Waiting for .* in your Downloads folder/)).toBeVisible();
    // Written fresh, as a browser download is (a copy would keep the fixture's old date).
    writeFileSync(path.join(downloads, "Welcome loop.pdf"), readFileSync(fixture("presentations", "sample.pdf")));
    await expect(main.getByText("“Welcome loop” now has 2 pages from Canva")).toBeVisible({ timeout: 60_000 });
    const saved = (await app.invoke<Plan>("services_get", { id: plan.id })).items[0]!;
    expect(saved.settings).toMatchObject({ canvaSource: embed });
    expect(saved.settings.canvaUrl).toBeUndefined();
    const deck = await app.invoke<Deck>("decks_get", { id: saved.refId });
    expect(deck.slides).toHaveLength(2);

    // Every page is a slide, and the output follows Next page by page.
    const shownImage = () => projector.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 1920).map((i) => i.src).pop() ?? "");
    await main.getByRole("button", { name: "Slide 1: Slide 1" }).click();
    await expect.poll(shownImage).not.toBe("");
    const first = await shownImage();
    await expect(frame).toHaveCount(0);
    await main.keyboard.press("ArrowRight");
    await expect.poll(shownImage).not.toBe(first);
    await expect(main.getByRole("button", { name: "Slide 2: Slide 2 (on screen)" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Update from Canva…" })).toBeVisible();

    await main.getByRole("button", { name: "Stop output" }).click();
    // Messages logged inside Canva's own page are not the app's.
    expect(app.errors.filter((e) => !e.includes("canva.com"))).toEqual([]);
  } finally {
    await app.close();
    rmSync(downloads, { recursive: true, force: true });
  }
});

/** Makes the next "choose a file" request return `path` instead of opening Windows' picker. */
async function answerNextFileDialog(main: Page, path: string) {
  await main.evaluate((p) => {
    (window as unknown as { __sanctuaryflowPickFile?: () => string | null }).__sanctuaryflowPickFile = () => p;
  }, path);
}

type Deck = { id: string; title: string; slides: { background: { mediaId: string; type: string }; notes?: string }[] };

test("PowerPoint and PDF files are imported into a service as picture slides", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const plan = await app.invoke<Plan>("services_save", {
      plan: { id: null, title: "Import Test", serviceDate: null, serviceTime: null, description: null, notes: null, status: "draft", isTemplate: false, themeId: null, items: [] },
    });
    const hasPowerPoint = await app.invoke<boolean>("powerpoint_available");
    await goTo(app, "Service Planner");
    await main.getByRole("tab", { name: "all" }).click();
    await main.getByRole("button", { name: /Import Test/ }).first().click();
    const deckOf = async (title: string) => {
      const saved = await app.invoke<Plan>("services_get", { id: plan.id });
      const item = saved.items.find((i) => i.title === title);
      return item?.refId ? app.invoke<Deck>("decks_get", { id: item.refId }) : null;
    };

    // PDF (what Canva and Google Slides download): drawn page by page.
    await main.getByRole("button", { name: "Import / Canva" }).click();
    await expect(main.getByRole("dialog").getByText("From a Canva link")).toBeVisible();
    await answerNextFileDialog(main, fixture("presentations", "sample.pdf"));
    await main.getByRole("button", { name: "Choose file…" }).click();
    await expect(main.getByText("“sample” was added with 2 slides")).toBeVisible({ timeout: 60_000 });
    // The planner saves a moment after each change.
    await expect.poll(async () => (await deckOf("sample"))?.slides.length).toBe(2);
    const pdfDeck = (await deckOf("sample"))!;
    const page = await app.invoke<{ mimeType: string; missing: boolean }>("media_get", { id: pdfDeck.slides[0]!.background.mediaId });
    expect(page).toMatchObject({ mimeType: "image/jpeg", missing: false, purpose: "slide" });
    // Pages stay with their slides instead of filling the Media Library.
    expect(await app.invoke<unknown[]>("media_list", { query: { kind: null, text: null } })).toEqual([]);
    expect(await app.invoke<unknown[]>("media_list", { query: { kind: null, text: null, includeSlidePictures: true } })).toHaveLength(2);

    if (hasPowerPoint) {
      await main.getByRole("button", { name: "Import / Canva" }).click();
      await expect(main.getByRole("dialog").getByText(/PowerPoint is installed/)).toBeVisible();
      await answerNextFileDialog(main, fixture("presentations", "sample.pptx"));
      await main.getByRole("button", { name: "Choose file…" }).click();
      // Three slides, one hidden.
      await expect(main.getByText("“sample” was added with 2 slides").last()).toBeVisible({ timeout: 120_000 });
      await expect(main.getByText(/1 hidden slide was left out/)).toBeVisible();
      await expect.poll(async () => (await app.invoke<Plan>("services_get", { id: plan.id })).items.length).toBe(2);
      const saved = await app.invoke<Plan>("services_get", { id: plan.id });
      const pptItem = saved.items.filter((i) => i.title === "sample")[1]!;
      const pptDeck = await app.invoke<Deck>("decks_get", { id: pptItem.refId });
      expect(pptDeck.slides).toHaveLength(2);
      expect(pptDeck.slides[0]!.notes).toBe("Greet everyone and introduce the team");
      const slide = await app.invoke<{ mimeType: string; title: string }>("media_get", { id: pptDeck.slides[1]!.background.mediaId });
      expect(slide).toMatchObject({ mimeType: "image/png", title: "sample - slide 2" });
    } else {
      console.warn("PowerPoint is not installed; the .pptx import was not exercised.");
    }

    // The imported pages are presented as pictures.
    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await main.getByRole("button", { name: "sample", exact: true }).first().click();
    await main.getByRole("button", { name: /^Slide 1:/ }).click();
    await expect
      .poll(() => projector.evaluate(() => [...document.images].some((i) => i.complete && i.naturalWidth === 1920 && i.naturalHeight === 1080)))
      .toBe(true);
    await main.getByRole("button", { name: "Stop output" }).click();
    expect(app.errors).toEqual([]);

    // Deleting an imported deck also removes its pictures.
    await app.invoke("decks_delete", { id: pdfDeck.id });
    const gone = await app.invoke("media_get", { id: pdfDeck.slides[0]!.background.mediaId }).then(() => "kept", () => "removed");
    expect(gone).toBe("removed");
  } finally {
    await app.close();
  }
});
