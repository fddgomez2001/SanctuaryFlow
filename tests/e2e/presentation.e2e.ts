import { expect, test } from "@playwright/test";
import { goTo, launchApp, openLiveService } from "./app";

test("the operator drives a separate projector window with the keyboard", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const song = await app.invoke<{ id: string }>("songs_save", {
      song: {
        id: null, title: "Projector Test Song", artist: null, originalKey: null, tempo: null, language: "en", category: null,
        copyrightHolder: "Test", copyrightYear: null, ccliNumber: null, source: null, license: null, notes: null, arrangement: null,
        themeId: null, tags: [],
        sections: [
          { id: null, kind: "verse", label: "", lyrics: "First projected line\nSecond projected line" },
          { id: null, kind: "chorus", label: "", lyrics: "Chorus projected line" },
        ],
      },
    });
    const plan = await app.invoke<{ id: string }>("services_save", {
      plan: {
        id: null, title: "Projector Test Service", serviceDate: "2026-11-01", serviceTime: null, description: null, notes: null,
        status: "ready", isTemplate: false, themeId: null,
        items: [
          { id: null, itemType: "heading", title: "Worship", refId: null, settings: {}, notes: null },
          { id: null, itemType: "song", title: "Projector Test Song", refId: song.id, settings: {}, notes: null },
          { id: null, itemType: "video", title: "Missing Video", refId: "00000000-0000-4000-8000-0000000000ff", settings: {}, notes: null },
          { id: null, itemType: "announcement", title: "Notices", refId: null, settings: { text: "Lunch after the service" }, notes: null },
        ],
      },
    });

    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);
    await expect(main.getByText("Projector Test Song").first()).toBeVisible();

    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await projector.waitForLoadState("domcontentloaded");

    // Nothing is live yet: the output is black.
    await expect(projector.getByText("First projected line")).toHaveCount(0);

    await main.getByText("Projector Test Song").first().click();
    await main.getByRole("button", { name: "Slide 1: Verse 1" }).click();
    await expect(projector.getByText("First projected line")).toBeVisible();

    await main.keyboard.press("ArrowRight");
    await expect(projector.getByText("Chorus projected line")).toBeVisible();

    await main.keyboard.press("b");
    await expect(projector.getByText("Chorus projected line")).toHaveCount(0);
    await main.keyboard.press("b");
    await expect(projector.getByText("Chorus projected line")).toBeVisible();

    await main.keyboard.press("ArrowLeft");
    await expect(projector.getByText("First projected line")).toBeVisible();

    // Keys pressed on the projector window are forwarded to the operator.
    await projector.keyboard.press("ArrowRight");
    await expect(projector.getByText("Chorus projected line")).toBeVisible();

    // On the last slide of an item, → and ↓ stay put: no accidental jump to the next song.
    await main.keyboard.press("ArrowRight");
    await main.keyboard.press("ArrowDown");
    await main.waitForTimeout(400);
    await expect(projector.getByText("Chorus projected line")).toBeVisible();
    await expect(main.getByText(/Click the next item in the lineup to continue/)).toBeVisible();

    // With "Next continues into the next service item" on, Next carries on,
    // and the missing video does not break the show.
    await goTo(app, "Settings");
    await main.getByRole("button", { name: "Presentation", exact: true }).click();
    await main.getByLabel("Next continues into the next service item").click();
    await goTo(app, "Live Presentation");
    await main.keyboard.press("ArrowRight");
    await main.keyboard.press("ArrowRight");
    await expect(projector.getByText("Lunch after the service")).toBeVisible();

    // Escape takes content off the screen without closing the output window.
    await main.keyboard.press("Escape");
    await expect(projector.getByText("Lunch after the service")).toHaveCount(0);

    // Typing in a text box never triggers shortcuts.
    await main.getByLabel("Present a song or Scripture now").fill("b");
    await main.keyboard.press("ArrowRight");
    await expect(projector.getByText("Lunch after the service")).toHaveCount(0);

    // A reloaded projector asks for and shows the current state.
    await main.getByText("Notices", { exact: true }).first().click();
    await main.getByRole("button", { name: "Slide 1: Notices" }).click();
    await expect(projector.getByText("Lunch after the service")).toBeVisible();
    await projector.reload();
    await expect(projector.getByText("Lunch after the service")).toBeVisible();

    await main.getByRole("button", { name: "Stop output" }).click();
    await expect.poll(() => app.browser.contexts().flatMap((c) => c.pages()).some((p) => p.url().includes("projector"))).toBe(false);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("an empty service and an empty presentation are handled", async () => {
  const app = await launchApp();
  try {
    const plan = await app.invoke<{ id: string }>("services_save", {
      plan: { id: null, title: "Empty", serviceDate: null, serviceTime: null, description: null, notes: null, status: "draft", isTemplate: false, themeId: null, items: [] },
    });
    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);
    await expect(app.main.getByText("Nothing to present")).toBeVisible();
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End", "b", "Escape"]) await app.main.keyboard.press(key);
    await expect(app.main.getByText("Nothing on screen")).toBeVisible();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("an item's theme can be changed live and the interface has a high-contrast mode", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    await app.invoke("services_save", {
      plan: {
        id: null, title: "Theme Test", serviceDate: null, serviceTime: null, description: null, notes: null, status: "draft", isTemplate: false, themeId: null,
        items: [{ id: null, itemType: "announcement", title: "Welcome", refId: null, settings: { text: "Welcome everyone" }, notes: null }],
      },
    });
    await goTo(app, "Live Presentation");
    const plans = await app.invoke<{ id: string }[]>("services_list", {
      query: { text: "Theme Test", status: null, templates: false, fromDate: null, toDate: null, sort: "updated", limit: 5 },
    });
    await openLiveService(app, plans[0]!.id);
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await main.getByText("Welcome", { exact: true }).first().click();
    await main.getByRole("button", { name: "Slide 1: Welcome" }).click();
    await expect(projector.getByText("Welcome everyone")).toBeVisible();

    // Midnight Blue is a built-in theme with a solid #0B1F3A background.
    const background = () =>
      projector.evaluate(() => [...document.querySelectorAll<HTMLElement>("div")].map((d) => getComputedStyle(d).backgroundColor).filter((c) => c === "rgb(11, 31, 58)").length);
    expect(await background()).toBe(0);
    await main.getByRole("button", { name: "Theme Midnight Blue" }).click();
    await expect.poll(background).toBeGreaterThan(0);
    await main.getByLabel("Theme for this item").selectOption({ label: "Item theme: as planned" });
    await expect.poll(background).toBe(0);
    await main.getByRole("button", { name: "Stop output" }).click();

    await goTo(app, "Settings");
    await main.getByLabel("Interface theme").selectOption("contrast");
    await expect.poll(() => main.evaluate(() => document.documentElement.dataset.ui)).toBe("contrast");
    await main.getByLabel("Interface theme").selectOption("light");
    const look = () => main.evaluate(() => [document.documentElement.dataset.ui, getComputedStyle(document.body).backgroundColor]);
    await expect.poll(look).toEqual(["light", "rgb(244, 245, 247)"]);
    // The choice is applied again straight away on the next start.
    await main.reload();
    await main.getByRole("navigation", { name: "Main" }).waitFor();
    expect(await look()).toEqual(["light", "rgb(244, 245, 247)"]);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
