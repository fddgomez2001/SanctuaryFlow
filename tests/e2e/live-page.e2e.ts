import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { fixture, goTo, launchApp } from "./app";
import { png } from "./files";

const SHOTS = process.env.SANCTUARYFLOW_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test("the Live page: services to choose from, Go Live, song-part jumps, and Bible passages that stay out of the lineup", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    // Synthetic test text (not Scripture): Psalms 23:1–3 and John 3:16–17.
    const pv = await app.invoke<{ token: string; suggestedMetadata: Record<string, unknown> }>("bible_import_preview", { path: fixture("bible", "test-translation.json") });
    await app.invoke("bible_import_commit", { token: pv.token, options: { metadata: { ...pv.suggestedMetadata, offlinePermitted: true }, replaceExisting: false, acknowledgeExclusions: false } });
    const song = await app.invoke<{ id: string }>("songs_save", {
      song: {
        id: null, title: "Placeholder Anthem", artist: "Test Choir", originalKey: null, tempo: null, language: "en", category: null, copyrightHolder: null,
        copyrightYear: null, ccliNumber: null, source: null, license: null, notes: null, arrangement: null, themeId: null, tags: [],
        sections: [
          { id: null, kind: "verse", label: "", lyrics: "First verse opening line\nFirst verse second line" },
          { id: null, kind: "chorus", label: "", lyrics: "Chorus opening line\nChorus second line" },
          { id: null, kind: "verse", label: "", lyrics: "Second verse opening line" },
        ],
      },
    });
    // A picture kept in a Media Library folder.
    const pictureFile = path.join(app.dataDir, "Sunrise Hills.png");
    writeFileSync(pictureFile, png(640, 360, [200, 140, 60]));
    const [picture] = await app.invoke<{ result: { asset: { id: string } } }[]>("media_import", { paths: [pictureFile] });
    await app.invoke("media_set_folder", { ids: [picture!.result.asset.id], folder: "Backgrounds" });
    const plan = await app.invoke<{ id: string }>("services_save", {
      plan: {
        id: null, title: "Harvest Sunday", serviceDate: null, serviceTime: null, description: null, notes: null, status: "ready", isTemplate: false, themeId: null,
        items: [
          { id: null, itemType: "announcement", title: "Welcome", refId: null, settings: { text: "Welcome everyone" }, notes: null },
          { id: null, itemType: "song", title: "Placeholder Anthem", refId: song.id, settings: {}, notes: null },
        ],
      },
    });

    // No service yet: the Live page lists them; Present now types examples.
    await goTo(app, "Live Presentation");
    await expect(main.getByRole("heading", { name: "Choose a service to present" })).toBeVisible();
    await expect.poll(() => main.locator("#present-now-hint").textContent(), { timeout: 10_000 }).toMatch(/Present now:\s*\S+/);
    await shot(main, "live-home");
    await main.locator(`[data-live-service="${plan.id}"]`).click();
    const lineup = main.getByRole("group", { name: "Service lineup" });
    await expect(lineup.getByText("Placeholder Anthem")).toBeVisible();
    await expect(main.getByRole("button", { name: "Service: Harvest Sunday" })).toBeVisible();
    // The output display and theme choices are no longer in the way.
    await expect(main.getByLabel("Output display")).toHaveCount(0);
    await expect(main.getByLabel("Output theme")).toHaveCount(0);

    // Before going live a chosen slide is only highlighted in gold: no LIVE, no NEXT.
    await lineup.getByText("Placeholder Anthem").click();
    await main.getByRole("button", { name: /^Slide 2:/ }).click();
    await expect(main.getByRole("button", { name: /^Slide 2: .*\(chosen\)$/ })).toBeVisible();
    await expect(main.getByText("LIVE", { exact: true })).toHaveCount(0);
    await expect(main.getByText("NEXT", { exact: true }).locator("xpath=ancestor::button")).toHaveCount(0);

    // Edit service opens the planner; Back returns to the Live page.
    await main.getByRole("button", { name: "Edit service" }).click();
    await expect(main.getByRole("heading", { name: "Harvest Sunday" })).toBeVisible();
    await main.getByRole("button", { name: "Back to Live Presentation" }).click();
    await expect(main.getByRole("button", { name: "Service: Harvest Sunday" })).toBeVisible();

    // A picture from the palette is only picked by a click; nothing changes on the output until it is used.
    await main.getByRole("tab", { name: "Pictures" }).click();
    await expect(main.getByRole("group", { name: "Folders" }).getByRole("button", { name: "Backgrounds" })).toBeVisible();
    await main.getByRole("group", { name: "Folders" }).getByRole("button", { name: "Backgrounds" }).click();
    await main.getByRole("button", { name: "Picture Sunrise Hills" }).click();
    await expect(main.getByRole("button", { name: "Picture Sunrise Hills" })).toHaveAttribute("aria-pressed", "true");
    await expect(main.getByRole("button", { name: "Use for item" })).toBeVisible();
    expect((await app.invoke<{ items: { settings: Record<string, unknown> }[] }>("services_get", { id: plan.id })).items[1]!.settings.themeId).toBeUndefined();
    await main.getByRole("button", { name: "Cancel" }).click();
    await main.getByRole("tab", { name: "Themes" }).click();

    // Present now finds a song by its words and shows the line it was found by.
    await main.getByLabel("Present a song or Scripture now").fill("second verse opening");
    const found = main.getByRole("button", { name: /Placeholder Anthem/ });
    await expect(found.locator("mark")).toHaveText(["Second verse opening"]);
    await main.getByLabel("Present a song or Scripture now").fill("");

    // Go Live opens the output; the button turns into the gold Live indicator and the dot blinks.
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    const liveButton = main.getByRole("button", { name: "Stop output" });
    await expect(liveButton).toHaveClass(/sf-live-gold/);
    await expect(main.getByText("LIVE OUTPUT")).toBeVisible();
    await expect(main.locator(".motion-safe\\:animate-ping").first()).toBeAttached();

    // Song parts: a jump puts the part's first line on screen.
    await lineup.getByText("Placeholder Anthem").click();
    await main.getByRole("button", { name: "List view" }).click();
    const jumps = main.getByRole("toolbar", { name: "Jump to a song part" });
    await expect(jumps.getByRole("button")).toHaveText(["V1", "C", "V2"]);
    await jumps.getByRole("button", { name: "Jump to Chorus" }).click();
    await expect(projector.getByText("Chorus opening line")).toBeVisible();
    await expect(jumps.getByRole("button", { name: "Jump to Chorus" })).toHaveAttribute("aria-current", "true");
    await jumps.getByRole("button", { name: "Jump to Verse 1" }).click();
    await expect(projector.getByText("First verse opening line")).toBeVisible();
    await expect(main.getByText("LIVE", { exact: true }).first()).toBeVisible();
    await shot(main, "live-song");

    // Lock the output on the song: a passage looked up meanwhile is only prepared.
    await main.getByRole("button", { name: "Lock output" }).click();
    await expect(main.getByRole("button", { name: /^Locked on “Placeholder Anthem”/ })).toHaveAttribute("aria-pressed", "true");
    await expect(lineup.getByLabel("The output is locked on this item")).toBeVisible();
    // A passage from Present now opens its chapter without joining the lineup.
    await main.getByLabel("Present a song or Scripture now").fill("Ps 23:1");
    await main.getByLabel("Present a song or Scripture now").press("Enter");
    await expect(main.getByRole("list", { name: "Psalms 23" })).toBeVisible();
    await expect(main.getByText(/^Prepared \(the output is locked\):/)).toBeVisible();
    await main.waitForTimeout(800);
    await expect(projector.getByText("First verse opening line").last()).toBeVisible();
    await expect(projector.getByText("Placeholder line alpha for testing the reader.")).toHaveCount(0);
    // Next still moves through the locked song.
    await main.keyboard.press("ArrowRight");
    await expect(projector.getByText("Chorus opening line").last()).toBeVisible();
    await shot(main, "live-locked");
    // "Show it now" unlocks and puts the prepared passage on screen, in the elegant verse theme.
    await main.getByRole("button", { name: "Show “Psalms 23:1” now" }).click();
    await expect(main.getByRole("button", { name: "Lock output" })).toHaveAttribute("aria-pressed", "false");
    await expect(projector.getByText("Placeholder line alpha for testing the reader.")).toBeVisible();
    const goldFrame = () => projector.evaluate(() => [...document.querySelectorAll("div")].some((d) => getComputedStyle(d).borderTopColor === "rgba(224, 185, 92, 0.6)"));
    await expect.poll(goldFrame).toBe(true);
    // The reference is always on screen with the verse.
    await expect(projector.getByText(/Psalms 23:1/).last()).toBeVisible();
    await expect(lineup.getByText(/Psalm/)).toHaveCount(0);
    await expect(main.getByText("2 items", { exact: true })).toBeVisible();
    // Next moves on to the next verse.
    await main.keyboard.press("ArrowRight");
    await expect(projector.getByText(/Placeholder line beta/)).toBeVisible();
    await expect(main.getByRole("button", { name: "Psalms 23:2" })).toHaveAttribute("aria-pressed", "true");
    // Ctrl+click shows several verses together.
    await main.getByRole("button", { name: "Psalms 23:3" }).click({ modifiers: ["Control"] });
    // (While one slide dissolves into the next, both are briefly on screen.)
    await expect(projector.getByText(/Placeholder line gamma/).last()).toBeVisible();
    await expect(projector.getByText(/Placeholder line beta/).last()).toBeVisible();
    await expect(main.getByText("Psalms 23:2–3", { exact: true })).toBeVisible();
    await shot(main, "live-bible");

    // Dragging the chosen verses onto the lineup adds them to the service, with a note.
    const verse = main.getByRole("button", { name: "Psalms 23:2" });
    const box = (await verse.boundingBox())!;
    const target = (await lineup.boundingBox())!;
    await main.mouse.move(box.x + 60, box.y + box.height / 2);
    await main.mouse.down();
    for (let i = 1; i <= 12; i++) await main.mouse.move(box.x + 60 + ((target.x + 60 - box.x - 60) * i) / 12, box.y + ((target.y + target.height - 60 - box.y) * i) / 12);
    await expect(lineup.getByText("Drop to add “Psalms 23:2–3”")).toBeVisible();
    await main.mouse.up();
    const add = main.getByRole("dialog", { name: "Add to “Harvest Sunday”" });
    await add.getByLabel("Note (optional)").fill("Tithes and offering");
    await add.getByRole("button", { name: "Add" }).click();
    await expect(main.getByText("“Psalms 23:2–3” was added to “Harvest Sunday”")).toBeVisible();
    await expect(lineup.getByText("Tithes and offering ·")).toBeVisible();
    const saved = await app.invoke<{ items: { itemType: string; title: string; notes: string | null; settings: Record<string, unknown> }[] }>("services_get", { id: plan.id });
    expect(saved.items.map((i) => [i.itemType, i.title, i.notes])).toEqual([
      ["announcement", "Welcome", null],
      ["song", "Placeholder Anthem", null],
      ["scripture", "Psalms 23:2–3", "Tithes and offering"],
    ]);
    await shot(main, "live-added");

    // Choosing a lineup item puts the chapter away; the button brings it back.
    await lineup.getByText("Welcome").click();
    await expect(lineup.getByText("Psalms 23:2–3")).toBeVisible();
    await expect(main.getByRole("list", { name: "Psalms 23" })).toHaveCount(0);
    await main.getByRole("button", { name: "Psalms 23", exact: true }).click();
    await expect(main.getByRole("list", { name: "Psalms 23" })).toBeVisible();

    await liveButton.click();
    await expect(main.getByRole("button", { name: "Go Live" })).toBeVisible();
    await expect(main.getByText("PREVIEW (output off)")).toBeVisible();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
