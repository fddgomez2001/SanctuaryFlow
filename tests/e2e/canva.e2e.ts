import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, launchApp, type AppHandle, openLiveService } from "./app";
import { png } from "./files";

type Plan = { id: string; items: { id: string; title: string; settings: Record<string, unknown> }[] };
type Asset = { id: string };

async function canvaPlan(app: AppHandle, items: [title: string, settings: Record<string, unknown>][]) {
  return app.invoke<Plan>("services_save", {
    plan: {
      id: null, title: "Canva Pictures", serviceDate: null, serviceTime: null, description: null, notes: null, status: "draft", isTemplate: false, themeId: null,
      items: items.map(([title, settings]) => ({ id: null, itemType: "custom", title, refId: null, settings, notes: null })),
    },
  });
}

/** Where Canva's viewer sits on the output, relative to the box that shows the design. */
const outputFrame = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("[data-canva-box]")!;
    const b = box.getBoundingClientRect();
    const f = box.querySelector("iframe")!.getBoundingClientRect();
    return { boxTop: b.top, boxHeight: b.height, frameTop: f.top, frameBottom: f.bottom, boxBottom: b.bottom, overflow: getComputedStyle(box).overflow };
  });

test("Canva pages have real thumbnails, and the output keeps Canva's page bar out of sight", async () => {
  const app = await launchApp();
  const { main } = app;
  const embed = "https://www.canva.com/design/DAFtest1234/AbCdEfGh12345/view?embed";
  try {
    // Pictures of the two pages, as the app stores them after taking them.
    const ids: string[] = [];
    for (const [n, rgb] of [[1, [200, 40, 40]], [2, [40, 40, 200]]] as const) {
      const file = path.join(app.dataDir, `page${n}.png`);
      writeFileSync(file, png(960, 540, [...rgb]));
      const [outcome] = await app.invoke<{ result: { asset: Asset } | null }[]>("media_import", { paths: [file] });
      ids.push(outcome!.result!.asset.id);
    }
    const plan = await canvaPlan(app, [
      ["Palm Test", { canvaUrl: embed, canvaPages: 2, canvaPictures: ids, canvaAspect: 16 / 9 }],
      // Synchronized from another computer: its picture is not on this one.
      ["From Elsewhere", { canvaUrl: "https://www.canva.com/design/DAFtest5678/AbCdEfGh12345/view?embed", canvaPages: 1, canvaPictures: ["not-on-this-computer"] }],
    ]);

    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);
    await main.getByRole("button", { name: "Go Live" }).click();
    const projector = await app.projector();
    await main.getByRole("button", { name: "Palm Test", exact: true }).click();

    // Each page's thumbnail is its picture, not a placeholder.
    for (const page of [1, 2]) {
      const thumb = main.getByRole("button", { name: new RegExp(`^Slide ${page}:`) }).getByRole("img", { name: `Palm Test, page ${page}` });
      await expect(thumb).toBeVisible();
      await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(960);
    }
    await expect(main.getByText("Canva design · shown live on the output")).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Update pictures" })).toBeVisible();

    // On the output the design is live; Canva's viewer reaches past the design
    // above and below, so its page bar (along the viewer's bottom) is clipped away.
    await main.getByRole("button", { name: /^Slide 1:/ }).click();
    await expect(projector.locator("iframe")).toHaveAttribute("src", `${embed}#1`);
    const f = await outputFrame(projector);
    expect(f.overflow).toBe("hidden");
    expect(f.boxTop).toBeGreaterThan(f.frameTop + 1);
    expect(f.frameBottom - f.boxBottom).toBeGreaterThan(f.boxHeight * (100 / 1080));
    expect(f.frameBottom - f.boxBottom).toBeCloseTo(f.boxTop - f.frameTop, 0);
    // The operator's preview of the output is cropped the same way.
    const p = await outputFrame(main);
    expect(p.frameBottom - p.boxBottom).toBeGreaterThan(p.boxHeight * (100 / 1080));
    // The Next preview shows the next page's picture.
    await expect(main.getByRole("img", { name: "Palm Test, page 2" })).toHaveCount(2);

    // Update pictures asks Canva again; when it can't be reached or found, the
    // reason is shown and the old pictures stay.
    await main.getByRole("button", { name: "Update pictures" }).click();
    await expect(main.getByText(/^No page pictures: /)).toBeVisible({ timeout: 30_000 });
    await expect(main.getByRole("button", { name: "Try again" })).toBeVisible();
    expect((await app.invoke<Plan>("services_get", { id: plan.id })).items[0]!.settings.canvaPictures).toEqual(ids);

    // A picture that is not on this computer counts as missing: the page shows
    // its placeholder and pictures are taken here (this design can't be found).
    await main.getByRole("button", { name: "From Elsewhere", exact: true }).click();
    await expect(main.getByText("Canva design · shown live on the output (needs the internet)")).toBeVisible();
    await expect(main.getByText(/^No page pictures: /)).toBeVisible({ timeout: 30_000 });

    await main.getByRole("button", { name: "Stop output" }).click();
    expect(app.errors.filter((e) => !e.includes("canva.com"))).toEqual([]);
  } finally {
    await app.close();
  }
});

// A real public Canva design (Canva's sample "Sample Video", 14 pages); needs the internet.
test("pictures of a real Canva design's pages are taken by themselves", async () => {
  test.skip(!process.env.SANCTUARYFLOW_E2E_NETWORK, "network test; set SANCTUARYFLOW_E2E_NETWORK=1");
  const app = await launchApp();
  const { main } = app;
  const embed = "https://www.canva.com/design/DAF-T8RAh04/SxzRWRTacEs23N8js6Powg/view?embed";
  try {
    const plan = await canvaPlan(app, [["Sample Design", { canvaUrl: embed, canvaPages: 3 }]]);
    await goTo(app, "Live Presentation");
    await openLiveService(app, plan.id);
    await main.getByRole("button", { name: "Sample Design", exact: true }).click();
    await expect(main.getByText(/^Page pictures \d \/ 3/)).toBeVisible();
    await expect
      .poll(async () => ((await app.invoke<Plan>("services_get", { id: plan.id })).items[0]!.settings.canvaPictures as unknown[] | undefined)?.filter(Boolean).length ?? 0, {
        timeout: 120_000,
      })
      .toBe(3);
    const settings = (await app.invoke<Plan>("services_get", { id: plan.id })).items[0]!.settings;
    expect(settings.canvaAspect).toBeCloseTo(16 / 9, 2);
    const pictures = settings.canvaPictures as string[];
    // Three different pages (the library keeps identical pictures once).
    expect(new Set(pictures).size).toBe(3);
    for (const page of [1, 2, 3]) {
      const thumb = main.getByRole("img", { name: `Sample Design, page ${page}` }).first();
      await expect(thumb).toBeVisible();
      await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([960, 540]);
    }
    await expect(main.getByRole("button", { name: "Update pictures" })).toBeVisible();
    // They belong to the item: the Media Library does not list them.
    const library = await app.invoke<Asset[]>("media_list", { query: { text: null, kind: null } });
    expect(library.filter((a) => pictures.includes(a.id))).toEqual([]);
    expect(app.errors.filter((e) => !e.includes("canva.com"))).toEqual([]);
  } finally {
    await app.close();
  }
});
