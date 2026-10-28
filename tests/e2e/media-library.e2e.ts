import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, launchApp } from "./app";
import { png, wav } from "./files";

type Asset = { id: string; title: string; folder: string | null };

const SHOTS = process.env.SANCTUARYFLOW_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test("the Media Library opens with a carousel of pictures, and keeps files in folders", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    const files = [
      ["Sunrise.png", png(640, 360, [200, 150, 60])],
      ["Harvest.png", png(640, 360, [120, 80, 40])],
      ["Night.png", png(640, 360, [30, 40, 80])],
      ["Hymn.wav", wav(2)],
    ] as const;
    const paths = files.map(([name, bytes]) => {
      const p = path.join(app.dataDir, name);
      writeFileSync(p, bytes);
      return p;
    });
    await app.invoke("media_import", { paths });
    // A folder of photos on the computer, with a subfolder and a file that is not media.
    const camp = path.join(app.dataDir, "Youth Camp 2026");
    mkdirSync(path.join(camp, "Day 2"), { recursive: true });
    writeFileSync(path.join(camp, "Campfire.png"), png(400, 300, [220, 120, 30]));
    writeFileSync(path.join(camp, "Lake.png"), png(400, 300, [40, 120, 200]));
    writeFileSync(path.join(camp, "Day 2", "Worship.png"), png(400, 300, [90, 60, 140]));
    writeFileSync(path.join(camp, "notes.txt"), "not media");

    await goTo(app, "Media Library");
    // The entrance: the library's pictures, one after another.
    const hero = main.getByRole("region", { name: "Media Library: pictures" });
    await expect(hero.getByRole("heading", { name: "Media Library" })).toBeVisible();
    await expect(hero.getByText("3 pictures · 1 audio file")).toBeVisible();
    await expect(hero.getByRole("button", { name: /^Show picture \d of 3$/ })).toHaveCount(3);
    await expect(hero.getByRole("button", { name: "Show picture 1 of 3" })).toHaveAttribute("aria-current", "true");
    await hero.hover();
    await hero.getByRole("button", { name: "Next picture" }).click();
    await expect(hero.getByRole("button", { name: "Show picture 2 of 3" })).toHaveAttribute("aria-current", "true");
    // Audio has no picture of its own: it shows the gold album picture.
    const audioCard = main.getByRole("button", { name: /Hymn/ });
    await expect(audioCard.locator("img")).toHaveAttribute("src", /\/Album_Default\.png$/);
    await shot(main, "media-library");

    // A new folder, and a picture moved into it.
    await hero.getByRole("button", { name: "New folder" }).click();
    await main.getByRole("dialog", { name: "New folder" }).getByLabel("Folder name").fill("Sunday Backgrounds");
    await main.getByRole("button", { name: "Create folder" }).click();
    await expect(main.getByRole("heading", { name: "Sunday Backgrounds" })).toBeVisible();
    await expect(main.getByText("This folder is empty")).toBeVisible();
    await main.getByRole("button", { name: "All media" }).click();
    await main.getByRole("button", { name: /^Sunrise/ }).click();
    await main.getByLabel("Folder", { exact: true }).selectOption("Sunday Backgrounds");
    await expect(main.getByText("Moved to “Sunday Backgrounds”")).toBeVisible();
    await expect(main.getByRole("button", { name: "Folder Sunday Backgrounds, 1 item" })).toBeVisible();

    // A whole folder from the computer, subfolders included, becomes a library folder.
    await main.evaluate((p) => ((window as unknown as { __sanctuaryflowPickFolder?: () => string }).__sanctuaryflowPickFolder = () => p), camp);
    await hero.getByRole("button", { name: "Import a folder" }).click();
    await expect(main.getByText("Imported 3 files into “Youth Camp 2026”")).toBeVisible();
    const inside = main.getByRole("region", { name: "Youth Camp 2026: pictures" });
    await expect(inside.getByRole("heading", { name: "Youth Camp 2026" })).toBeVisible();
    await expect(inside.getByText("3 pictures")).toBeVisible();
    for (const name of ["Campfire", "Lake", "Worship"]) await expect(main.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
    await shot(main, "media-folder");
    const all = await app.invoke<Asset[]>("media_list", { query: { kind: null, text: null } });
    expect(all.filter((a) => a.folder === "Youth Camp 2026").map((a) => a.title).sort()).toEqual(["Campfire", "Lake", "Worship"]);

    // Rename it; then remove it (the files stay in the library).
    await inside.getByRole("button", { name: "Rename" }).click();
    await main.getByRole("dialog").getByLabel("Folder name").fill("Camp 2026");
    await main.getByRole("button", { name: "Rename", exact: true }).last().click();
    await expect(main.getByText("Folder renamed to “Camp 2026”")).toBeVisible();
    const renamed = main.getByRole("region", { name: "Camp 2026: pictures" });
    await renamed.getByRole("button", { name: "Remove folder" }).click();
    await main.getByRole("dialog").getByRole("button", { name: "Remove folder" }).click();
    await expect(main.getByRole("heading", { name: "Media Library" })).toBeVisible();
    await expect(main.getByRole("button", { name: /^Folder Camp 2026/ })).toHaveCount(0);
    const after = await app.invoke<Asset[]>("media_list", { query: { kind: null, text: null } });
    expect(after).toHaveLength(7);
    expect(after.filter((a) => a.folder).map((a) => a.folder)).toEqual(["Sunday Backgrounds"]);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
