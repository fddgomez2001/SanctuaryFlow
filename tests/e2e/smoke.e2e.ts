import { expect, test } from "@playwright/test";
import { goTo, launchApp } from "./app";

test("every page opens on an empty library without errors", async () => {
  const app = await launchApp();
  try {
    await expect(app.main.getByText("Set up SanctuaryFlow")).toBeVisible();
    await expect(app.main.getByText("Library ready")).toBeVisible();
    for (const label of [
      "Live Presentation",
      "Service Planner",
      "Song Library",
      "Bible Library",
      "Slide Editor",
      "Media Library",
      "Presentation Themes",
      "Import & Export",
      "Backup & Restore",
      "Synchronization",
      "Settings",
      "Home",
    ]) {
      await goTo(app, label);
      await app.main.waitForTimeout(500);
    }
    // The catalog is seeded: 66 books are listed for an empty translation set.
    const canon = await app.invoke<{ length: number }>("bible_books", { translationId: null });
    expect(canon.length).toBe(66);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
