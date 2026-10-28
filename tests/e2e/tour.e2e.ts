import { test } from "@playwright/test";
import { goTo, launchApp, openLiveService } from "./app";

// Visual review helper, not a regression test: seeds a demo library and saves
// screenshots of every page. Run with SANCTUARYFLOW_TOUR_DIR=<folder>.
const dir = process.env.SANCTUARYFLOW_TOUR_DIR;
test.skip(!dir, "set SANCTUARYFLOW_TOUR_DIR to capture screenshots");

const lyrics = (text: string) => ({ id: null, kind: "verse", label: "", lyrics: text });

test("tour", async () => {
  const app = await launchApp();
  const { main } = app;
  const shot = async (name: string) => {
    await main.waitForTimeout(700);
    await main.screenshot({ path: `${dir}/${name}.png` });
  };
  try {
    // SANCTUARYFLOW_TOUR_UI=light|contrast captures another interface theme.
    if (process.env.SANCTUARYFLOW_TOUR_UI) {
      await app.invoke("settings_set", { key: "general.uiTheme", value: process.env.SANCTUARYFLOW_TOUR_UI });
      await main.reload();
      await main.getByRole("navigation", { name: "Main" }).waitFor();
    }
    await shot("01-home-empty");
    const songs = [];
    for (const [title, artist, sections] of [
      [
        "Morning Light (sample)",
        "Sample Writer",
        [
          lyrics("Morning light is breaking through\nEvery shadow fades from view\nWe lift our eyes to see Your face\nAnd stand in wonder at Your grace"),
          // Presented line by line.
          { id: null, kind: "chorus", label: "", lyrics: "Holy, holy, You are near\nIn this place Your voice is clear\n\nHoly, holy, we will sing\nPraise to You, our God and King", linesPerSlide: 1 },
          lyrics("All the earth will know Your name\nFrom age to age You stay the same"),
        ],
      ],
      ["Ikaw ang Liwanag (sample)", "Halimbawang Manunulat", [lyrics("Ikaw ang liwanag sa dilim\nIkaw ang pag-asa namin"), { id: null, kind: "chorus", label: "", lyrics: "Purihin Ka, O Diyos\nMagpakailanman" }]],
    ] as const) {
      songs.push(
        await app.invoke<{ id: string; title: string }>("songs_save", {
          song: {
            id: null, title, artist, originalKey: "G", tempo: null, language: title.includes("Ikaw") ? "tl" : "en", category: "Worship",
            copyrightHolder: "Sample Music", copyrightYear: "2026", ccliNumber: null, source: null, license: null, notes: null,
            arrangement: null, themeId: null, tags: ["Sample"], sections,
          },
        }),
      );
    }
    let translationId: string | null = null;
    if (process.env.SANCTUARYFLOW_E2E_NETWORK) {
      const pv = await app.invoke<{ token: string; suggestedMetadata: Record<string, unknown> }>("bible_provider_download", { providerId: "ebible", translationId: "engwebp" });
      translationId = (await app.invoke<{ translationId: string }>("bible_import_commit", { token: pv.token, options: { metadata: pv.suggestedMetadata, replaceExisting: false, acknowledgeExclusions: true } })).translationId;
      await app.invoke("settings_set", { key: "bible.defaultTranslationId", value: translationId });
    }
    await app.invoke("settings_set", { key: "general.churchName", value: "Grace Community Church" });
    const plan = await app.invoke<{ id: string }>("services_save", {
      plan: {
        id: null, title: "Sunday Worship", serviceDate: "2026-11-01", serviceTime: "09:30", description: null, notes: "Communion Sunday",
        status: "ready", isTemplate: false, themeId: null,
        items: [
          { id: null, itemType: "heading", title: "Gathering", refId: null, settings: {}, notes: null },
          { id: null, itemType: "song", title: songs[0]!.title, refId: songs[0]!.id, settings: {}, notes: "Two verses, chorus twice" },
          { id: null, itemType: "scripture", title: "Psalm 23", refId: null, settings: { translationId, references: [{ bookId: "PSA", chapter: 23, verseStart: null, chapterEnd: null, verseEnd: null }] }, notes: null },
          { id: null, itemType: "song", title: songs[1]!.title, refId: songs[1]!.id, settings: {}, notes: null },
          { id: null, itemType: "announcement", title: "Announcements", refId: null, settings: { text: "Fellowship lunch after the service\n---\nYouth night on Friday at 7 PM" }, notes: null },
          { id: null, itemType: "blank", title: "Holding slide", refId: null, settings: { mode: "theme" }, notes: null },
          { id: null, itemType: "custom", title: "Welcome loop (Canva)", refId: null, settings: { canvaUrl: "https://www.canva.com/design/DAFtest1234/AbCdEfGh12345/view?embed" }, notes: null },
        ],
      },
    });

    await goTo(app, "Home");
    await shot("02-home");
    await goTo(app, "Song Library");
    await main.getByRole("tab", { name: "Artists" }).click();
    await shot("03a-artists");
    await main.getByRole("tab", { name: "Songs" }).click();
    await main.getByRole("button", { name: /Morning Light/ }).first().click();
    await shot("03-songs");
    await main.getByRole("button", { name: "Edit", exact: true }).click();
    await shot("04-song-editor");
    await main.getByRole("button", { name: "Cancel", exact: true }).click();
    await goTo(app, "Service Planner");
    await shot("05-services");
    await main.getByRole("button", { name: /Sunday Worship/ }).first().click();
    await main.getByText("Psalm 23").first().click();
    await shot("06-service-editor");
    await main.getByRole("button", { name: "Import / Canva" }).click();
    await shot("06b-import-dialog");
    await main.keyboard.press("Escape");
    await goTo(app, "Bible Library");
    await main.getByLabel("Go to reference").fill("John 3:16-18");
    await main.getByRole("button", { name: "Go", exact: true }).click();
    await shot("07-bible");
    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await main.getByText(songs[0]!.title).first().click();
    await main.getByRole("button", { name: "Slide 2: Chorus (1/4)" }).click();
    await shot("08-live");
    await main.getByRole("button", { name: "List view" }).click();
    await shot("08b-live-list");
    await main.getByRole("button", { name: "Customize…" }).click();
    await shot("08c-customize");
    await main.getByRole("button", { name: "Cancel" }).click();
    await main.getByRole("button", { name: "Welcome loop (Canva)", exact: true }).click();
    await main.getByRole("button", { name: "Show every page…" }).click();
    await shot("08d-canva-pages");
    await main.keyboard.press("Escape");
    await main.getByRole("button", { name: songs[0]!.title, exact: true }).click();
    await main.getByRole("button", { name: "Grid view" }).click();
    await projector.waitForTimeout(600);
    await projector.screenshot({ path: `${dir}/09-projector-song.png` });
    await main.getByText("Psalm 23", { exact: true }).first().click();
    await main.getByRole("button", { name: /^Slide 1:/ }).click();
    await projector.waitForTimeout(600);
    await projector.screenshot({ path: `${dir}/10-projector-scripture.png` });
    await main.keyboard.press("l");
    await projector.waitForTimeout(600);
    await projector.screenshot({ path: `${dir}/11-projector-logo.png` });
    await main.getByRole("button", { name: "Stop output" }).click();
    for (const [label, name] of [
      ["Slide Editor", "12-slides"],
      ["Media Library", "13-media"],
      ["Presentation Themes", "14-themes"],
      ["Import & Export", "15-import-export"],
      ["Backup & Restore", "16-backup"],
      ["Synchronization", "17-sync"],
      ["Settings", "18-settings"],
    ] as const) {
      await goTo(app, label);
      await shot(name);
    }
    await main.getByRole("button", { name: "Presentation", exact: true }).click();
    await main.getByText("Logo screen", { exact: true }).scrollIntoViewIfNeeded();
    await shot("18b-settings-logo");
    await goTo(app, "Bible Library");
    await main.getByRole("button", { name: "Translations" }).click();
    await shot("19-translations");
  } finally {
    await app.close();
  }
});
