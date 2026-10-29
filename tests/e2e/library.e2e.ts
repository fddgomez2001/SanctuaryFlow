import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fixture, goTo, launchApp } from "./app";
import { png } from "./files";

test("a song and a service created in the UI survive an unexpected restart", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    await goTo(app, "Song Library");
    await main.getByRole("button", { name: "New song", exact: true }).click();
    await main.getByLabel("Title", { exact: true }).fill("Morning Test Song");
    await main.getByLabel("Verse 1 lyrics").fill("First test line\nSecond test line");
    await main.getByLabel("Artist").fill("Test Choir");
    await main.getByRole("button", { name: "Save", exact: true }).click();
    await expect(main.getByText("Song saved")).toBeVisible();

    await main.getByLabel("Search songs").fill("second test");
    await expect(main.getByRole("button", { name: /Morning Test Song/ })).toBeVisible();

    await goTo(app, "Service Planner");
    await main.getByRole("button", { name: "New service" }).first().click();
    await main.getByLabel("Title", { exact: true }).fill("E2E Service");
    await main.getByRole("button", { name: "Create", exact: true }).click();
    await expect(main.getByRole("heading", { name: "E2E Service" })).toBeVisible();
    await main.getByRole("button", { name: "Song", exact: true }).click();
    await main.getByRole("dialog").getByRole("button", { name: /Morning Test Song/ }).click();
    await expect(main.getByText("Saved", { exact: true })).toBeVisible();
  } finally {
    // Kill the app without a clean shutdown.
    await app.close({ keepData: true });
  }

  const again = await launchApp({ dataDir: app.dataDir });
  try {
    await goTo(again, "Service Planner");
    await again.main.getByRole("tab", { name: "all" }).click();
    await again.main.getByRole("button", { name: /E2E Service/ }).click();
    await expect(again.main.getByText("Morning Test Song").first()).toBeVisible();
    expect(again.errors).toEqual([]);
  } finally {
    await again.close();
  }
});

test("songs are organised by artist, with cover pictures and a simple editor", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const song = (title: string, artist: string | null) =>
      app.invoke("songs_save", {
        song: {
          id: null, title, artist, originalKey: null, tempo: null, language: "en", category: null, copyrightHolder: null, copyrightYear: null,
          ccliNumber: null, source: null, license: null, notes: null, arrangement: null, themeId: null, tags: [],
          sections: [{ id: null, kind: "verse", label: "", lyrics: `${title} first line` }],
        },
      });
    await song("Still", "Hillsong Worship");
    await song("Cornerstone", "Hillsong Worship");
    // Different spacing and capitals are still the same artist.
    await song("What a Beautiful Name", "hillsong  worship");
    await song("Untitled chorus", null);
    const cover = path.join(app.dataDir, "hillsong-cover.png");
    writeFileSync(cover, png(300, 300, [40, 90, 200]));

    await goTo(app, "Song Library");
    await expect(main.getByRole("tab", { name: "Artists" })).toHaveAttribute("aria-selected", "true");
    await expect(main.getByRole("button", { name: /^Hillsong Worship 3 songs$/ })).toBeVisible();
    await expect(main.getByRole("button", { name: /^No artist 1 song$/ })).toBeVisible();
    await main.getByRole("button", { name: "Artist Hillsong Worship" }).click();
    await expect(main.getByRole("heading", { name: "Hillsong Worship" })).toBeVisible();
    for (const t of ["Cornerstone", "Still", "What a Beautiful Name"]) await expect(main.getByRole("button", { name: new RegExp(`^${t}`) }).first()).toBeVisible();

    // A cover picture, imported straight from the computer.
    await main.getByRole("button", { name: "Add cover picture…" }).click();
    await main.evaluate((p) => ((window as unknown as { __sanctuaryflowPickFile?: () => string }).__sanctuaryflowPickFile = () => p), cover);
    await main.getByRole("dialog").getByRole("button", { name: "Import file…" }).click();
    await expect(main.getByRole("button", { name: "Change cover…" })).toBeVisible();
    await expect.poll(() => main.locator("img.size-40").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(300);

    // From the artist to a song and back.
    await main.getByRole("button", { name: /^Still/ }).first().click();
    await expect(main.getByRole("heading", { name: "Still" })).toBeVisible();
    await main.getByRole("button", { name: "Hillsong Worship", exact: true }).first().click();
    await expect(main.getByRole("heading", { name: "Hillsong Worship" })).toBeVisible();

    // A new song for this artist: title, artist and lyrics only.
    await main.getByRole("button", { name: "New song by Hillsong Worship" }).click();
    await expect(main.getByLabel("Artist")).toHaveValue("Hillsong Worship");
    for (const gone of ["Copyright holder", "Key", "Tempo", "Notes", "Theme", "Tags"]) await expect(main.getByLabel(gone, { exact: true })).toHaveCount(0);
    await main.getByLabel("Title", { exact: true }).fill("King of Kings");
    await main.getByLabel("Verse 1 lyrics").fill("In the darkness we were waiting");
    await main.getByRole("button", { name: "Save", exact: true }).click();
    await expect(main.getByText("Song saved")).toBeVisible();
    await main.getByRole("tab", { name: "Artists" }).click();
    await expect(main.getByRole("button", { name: /^Hillsong Worship 4 songs$/ })).toBeVisible();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("the built-in hymns come with the library", async () => {
  process.env.SANCTUARYFLOW_E2E_BUILTIN_SONGS = "1";
  const app = await launchApp();
  delete process.env.SANCTUARYFLOW_E2E_BUILTIN_SONGS;
  const { main } = app;
  try {
    await goTo(app, "Song Library");
    await expect(main.getByRole("button", { name: /^Charles Wesley 4 songs$/ })).toBeVisible();
    await main.getByLabel("Search songs").fill("amazing grace");
    await main.getByRole("button", { name: /^Amazing Grace/ }).first().click();
    await expect(main.getByRole("heading", { name: "Amazing Grace" })).toBeVisible();
    await expect(main.getByRole("button", { name: "John Newton", exact: true }).first()).toBeVisible();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("a chorus can be presented line by line", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    await goTo(app, "Song Library");
    await main.getByRole("button", { name: "New song", exact: true }).click();
    await main.getByLabel("Title", { exact: true }).fill("Line By Line Song");
    await main.getByLabel("Verse 1 lyrics").fill("Verse line one\nVerse line two\nVerse line three");
    await main.getByLabel("Add section").selectOption("chorus");
    await main.getByLabel("Chorus lyrics").fill("Chorus line one\nChorus line two\nChorus line three");
    await expect(main.getByLabel("Slide 2: Chorus", { exact: true })).toBeVisible();

    await main.getByLabel("Chorus lines per slide").selectOption("1");
    for (const [i, part] of ["1/3", "2/3", "3/3"].entries()) {
      await expect(main.getByLabel(`Slide ${i + 2}: Chorus (${part})`, { exact: true })).toBeVisible();
    }
    // The verse still uses the global size.
    await expect(main.getByLabel("Slide 1: Verse 1", { exact: true })).toBeVisible();
    await main.getByRole("button", { name: "Save", exact: true }).click();
    await expect(main.getByText("Song saved")).toBeVisible();

    await main.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(main.getByLabel("Chorus lines per slide")).toHaveValue("1");
    await expect(main.getByLabel("Verse 1 lines per slide")).toHaveValue("");
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("a Bible translation imports, validates and is readable and searchable offline", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const pv = await app.invoke<{ token: string; preview: { report: { status: string } }; suggestedMetadata: Record<string, unknown> }>(
      "bible_import_preview",
      { path: fixture("bible", "test-translation.json") },
    );
    // Three books are not a complete Bible, and the report says so.
    expect(pv.preview.report.status).toBe("incomplete");
    const notAllowed = await app
      .invoke("bible_import_commit", { token: pv.token, options: { metadata: { ...pv.suggestedMetadata, offlinePermitted: null }, replaceExisting: false, acknowledgeExclusions: false } })
      .then(() => "imported", (e: { message: string }) => e.message);
    expect(notAllowed).toMatch(/permits storing it offline/);
    const result = await app.invoke<{ versesImported: number }>("bible_import_commit", {
      token: pv.token,
      options: { metadata: { ...pv.suggestedMetadata, offlinePermitted: true }, replaceExisting: false, acknowledgeExclusions: false },
    });
    expect(result.versesImported).toBe(7);

    await goTo(app, "Bible Library");
    await main.getByLabel("Go to reference").fill("Ps 23");
    await main.getByRole("button", { name: "Go", exact: true }).click();
    await expect(main.getByText("Placeholder line alpha for testing the reader.")).toBeVisible();

    await main.getByRole("button", { name: "search", exact: true }).click();
    await main.getByPlaceholder(/Search TEST text/).fill("lighthouse");
    await expect(main.getByText("Psalms 23:2")).toBeVisible();

    await main.getByLabel("Go to reference").fill("John 3:16");
    await main.getByRole("button", { name: "Go", exact: true }).click();
    await expect(main.getByText("John 3:16", { exact: true }).first()).toBeVisible();
    await expect(main.getByRole("paragraph").filter({ hasText: "Synthetic sample text standing in for John three sixteen." })).toBeVisible();
    await main.getByLabel("Go to reference").fill("Jhn 22:1");
    await main.getByRole("button", { name: "Go", exact: true }).click();
    await expect(main.getByText(/has 21 chapters/)).toBeVisible();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("the built-in ASV Bible installs in the background on first start", async () => {
  process.env.SANCTUARYFLOW_E2E_BUILTIN_BIBLE = "1";
  const app = await launchApp();
  delete process.env.SANCTUARYFLOW_E2E_BUILTIN_BIBLE;
  const { main } = app;
  try {
    // The page opened before or during the install updates by itself.
    await goTo(app, "Bible Library");
    await expect(main.getByLabel("Go to reference")).toBeVisible({ timeout: 60_000 });
    await main.getByLabel("Go to reference").fill("John 3:16");
    await main.getByRole("button", { name: "Go", exact: true }).click();
    await expect(main.getByRole("paragraph").filter({ hasText: "For God so loved the world" })).toBeVisible();
    const translations = await app.invoke<{ code: string; licenseName: string | null }[]>("bible_translations");
    expect(translations.map((t) => [t.code, t.licenseName])).toEqual([["ASV", "Public Domain"]]);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("a backup restores the library while the app is running", async () => {
  const app = await launchApp();
  try {
    const song = (title: string) => ({
      song: {
        id: null, title, artist: null, originalKey: null, tempo: null, language: "en", category: null, copyrightHolder: "Test",
        copyrightYear: null, ccliNumber: null, source: null, license: null, notes: null, arrangement: null, themeId: null, tags: [],
        sections: [{ id: null, kind: "verse", label: "", lyrics: "Line" }],
      },
    });
    await app.invoke("songs_save", song("Before Backup"));
    const backup = await app.invoke<{ path: string }>("backup_create", { directory: null, includeMedia: true });
    const check = await app.invoke<{ valid: boolean; issues: string[] }>("backup_validate", { path: backup.path });
    expect(check.issues).toEqual([]);
    expect(check.valid).toBe(true);

    await app.invoke("songs_save", song("After Backup"));
    const restored = await app.invoke<{ safetyBackup: string }>("backup_restore", { path: backup.path, restoreMedia: true });
    expect(restored.safetyBackup).toMatch(/before-restore/);

    const list = await app.invoke<{ total: number; items: { title: string }[] }>("songs_list", {
      query: { text: null, field: null, tag: null, category: null, language: null, favoritesOnly: false, includeArchived: true, archivedOnly: false, sort: "title", limit: 50, offset: 0 },
    });
    expect(list.items.map((s) => s.title)).toEqual(["Before Backup"]);
    const history = await app.invoke<{ kind: string }[]>("backup_history", { limit: 10 });
    expect(history.map((h) => h.kind)).toEqual(expect.arrayContaining(["manual", "pre_restore"]));
  } finally {
    await app.close();
  }
});
