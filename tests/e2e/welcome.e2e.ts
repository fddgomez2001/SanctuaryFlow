import { expect, test, type Page } from "@playwright/test";
import { goTo, launchApp } from "./app";

const SHOTS = process.env.SANCTUARYFLOW_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

// The greeting matches the computer's clock, as the app does.
const part = (h: number) => (h < 12 ? "morning" : h < 18 ? "afternoon" : "evening");
const GREETING = { morning: "Good Morning", afternoon: "Good Afternoon", evening: "Good Evening" } as const;
const HOME = { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" } as const;

test("the first start welcomes the operator, asks their name, and can be skipped or shown again", async () => {
  process.env.SANCTUARYFLOW_E2E_WELCOME = "1";
  process.env.SANCTUARYFLOW_E2E_GREETING = "1";
  const now = part(new Date().getHours());
  let app = await launchApp();
  try {
    let welcome = app.main.getByRole("dialog", { name: "Welcome to SanctuaryFlow" });
    await expect(welcome.getByRole("heading", { name: "Welcome to SanctuaryFlow" })).toBeVisible();
    // The greeting waits until the welcome is done.
    await expect(app.main.getByRole("dialog")).toHaveCount(1);
    await shot(app.main, "welcome-1");
    await welcome.getByRole("button", { name: "Get started" }).click();

    await expect(welcome.getByRole("heading", { name: "What should we call you?" })).toBeVisible();
    await welcome.getByLabel("Church name (optional)").fill("Example Fellowship");
    await welcome.getByLabel("Your name").fill("Grace");
    await shot(app.main, "welcome-2-name");
    await welcome.getByLabel("Your name").press("Enter");
    await expect(welcome.getByRole("heading", { name: "Plan every service" })).toBeVisible();
    for (const title of ["Your songs, beautifully", "The Bible, even offline", "Go Live with confidence"]) {
      await welcome.getByRole("button", { name: "Next" }).click();
      await expect(welcome.getByRole("heading", { name: title })).toBeVisible();
    }
    await shot(app.main, "welcome-3-tour");
    // Back goes back a page.
    await welcome.getByRole("button", { name: "Back" }).click();
    await expect(welcome.getByRole("heading", { name: "The Bible, even offline" })).toBeVisible();
    await welcome.getByRole("button", { name: "Next" }).click();
    await welcome.getByRole("button", { name: "Next" }).click();
    await expect(welcome.getByRole("heading", { name: "You’re all set, Grace!" })).toBeVisible();
    await welcome.getByRole("button", { name: "Start using SanctuaryFlow" }).click();
    await expect(welcome).toBeHidden();

    // Then the greeting, by name.
    const greeting = app.main.getByRole("dialog", { name: `${GREETING[now]}, Grace` });
    await expect(greeting).toBeVisible();
    await greeting.getByRole("button", { name: "Continue" }).click();
    await expect(greeting).toBeHidden();
    expect(await app.invoke<Record<string, unknown>>("settings_get_all")).toMatchObject({
      "general.userName": "Grace",
      "general.churchName": "Example Fellowship",
      "general.onboardingDone": true,
    });
    // Home welcomes them by name too, with the church name below.
    await expect(app.main.getByRole("heading", { level: 1, name: `${HOME[now]}, Grace` })).toBeVisible();
    await expect(app.main.getByText(/^Example Fellowship · 0 songs/)).toBeVisible();

    // Not shown again on the next start.
    await app.close({ keepData: true });
    app = await launchApp({ dataDir: app.dataDir });
    await goTo(app, "Settings");
    await expect(app.main.getByRole("dialog")).toHaveCount(0);
    await expect(app.main.getByLabel("Your name")).toHaveValue("Grace");

    // Settings shows it again; Skip closes it at once and keeps the name.
    await app.main.getByRole("button", { name: "Show the welcome tour again" }).click();
    welcome = app.main.getByRole("dialog", { name: "Welcome to SanctuaryFlow" });
    await expect(welcome).toBeVisible();
    await welcome.getByRole("button", { name: "Skip" }).click();
    await expect(welcome).toBeHidden();
    await expect.poll(() => app.invoke<Record<string, unknown>>("settings_get_all").then((s) => [s["general.onboardingDone"], s["general.userName"]])).toEqual([true, "Grace"]);
    expect(app.errors).toEqual([]);
  } finally {
    delete process.env.SANCTUARYFLOW_E2E_WELCOME;
    delete process.env.SANCTUARYFLOW_E2E_GREETING;
    await app.close();
  }
});
