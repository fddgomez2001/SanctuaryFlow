import { expect, test, type Page } from "@playwright/test";
import { fixture, goTo, launchApp } from "./app";

type Plan = { id: string; title: string; serviceDate: string | null; serviceTime: string | null; status: string; items: { title: string; itemType: string; refId: string | null }[] };

const SHOTS = process.env.SANCTUARYFLOW_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test("light by default with a Light/Dark switch; services are planned from the list and sermons imported", async () => {
  const app = await launchApp();
  const { main } = app;
  try {
    // The console opens light; the switch at the top changes it at once and remembers it.
    await expect(main.locator("html")).toHaveAttribute("data-ui", "light");
    const switcher = main.getByRole("group", { name: "Light or dark mode" });
    await expect(switcher.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    await switcher.getByRole("button", { name: "Dark" }).click();
    await expect(main.locator("html")).toHaveAttribute("data-ui", "dark");
    await expect.poll(() => app.invoke<Record<string, unknown>>("settings_get_all").then((s) => s["general.uiTheme"])).toBe("dark");
    await switcher.getByRole("button", { name: "Light" }).click();
    await expect(main.locator("html")).toHaveAttribute("data-ui", "light");

    // Title, date and time are set from the Service Planner list.
    await goTo(app, "Service Planner");
    await main.getByRole("button", { name: "New service" }).first().click();
    const create = main.getByRole("dialog", { name: "New service" });
    await create.getByLabel("Title").fill("Harvest Sunday");
    await create.getByLabel("Date").fill("2026-11-01");
    await create.getByLabel("Time (optional)").fill("09:30");
    await create.getByRole("button", { name: "Create" }).click();

    // The editor shows only the title and the date.
    await expect(main.getByRole("heading", { name: "Harvest Sunday" })).toBeVisible();
    await expect(main.getByText(/November 1, 2026|1 November 2026/)).toBeVisible();
    await expect(main.getByLabel("Service title")).toHaveCount(0);
    await expect(main.locator('input[type="time"]')).toHaveCount(0);

    // Sermon slides: import the sermon's PDF (or a Canva link).
    await main.getByRole("group", { name: "Add to service" }).getByRole("button", { name: "Sermon slides" }).click();
    const sermon = main.getByRole("dialog", { name: "Add sermon slides" });
    await expect(sermon.getByRole("heading", { name: "From a Canva link" })).toBeVisible();
    await expect(sermon.getByRole("button", { name: "Choose slides from the library…" })).toBeVisible();
    await shot(main, "planner-sermon");
    await main.evaluate((p) => ((window as unknown as { __sanctuaryflowPickFile?: () => string }).__sanctuaryflowPickFile = () => p), fixture("presentations", "sample.pdf"));
    await sermon.getByRole("button", { name: "Choose file…" }).click();
    await expect(main.getByText("“sample” was added with 2 slides")).toBeVisible({ timeout: 60_000 });
    await main.getByRole("group", { name: "Add to service" }).getByRole("button", { name: "Heading" }).click();
    await shot(main, "planner-editor");
    let plan!: Plan;
    await expect
      .poll(async () => {
        plan = (await app.invoke<Plan[]>("services_list", { query: { text: "Harvest", status: null, templates: false, fromDate: null, toDate: null, sort: "dateAsc", limit: 5 } }))[0]!;
        plan = await app.invoke<Plan>("services_get", { id: plan.id });
        return plan.items.map((i) => i.itemType);
      })
      .toEqual(["sermon", "heading"]);
    expect(plan).toMatchObject({ serviceDate: "2026-11-01", serviceTime: "09:30" });
    const deck = await app.invoke<{ category: string }>("decks_get", { id: plan.items[0]!.refId });
    expect(deck.category).toBe("sermon");

    // Back on the list: a calendar date, the time, and Edit details for title, date, time, status and theme.
    await main.getByRole("button", { name: "Back to services" }).click();
    await main.getByRole("tab", { name: "all" }).click();
    const row = main.locator(".panel").filter({ hasText: "Harvest Sunday" });
    await expect(row.getByText(/9:30/)).toBeVisible();
    await shot(main, "planner-list");
    await row.getByRole("button", { name: "Edit details (title, date, time)" }).click();
    const details = main.getByRole("dialog", { name: "Service details" });
    await details.getByLabel("Title").fill("Harvest Thanksgiving");
    await details.getByLabel("Time (optional)").fill("10:00");
    await details.getByLabel("Status").selectOption("ready");
    await details.getByRole("button", { name: "Save" }).click();
    await expect(main.getByText("Service details saved")).toBeVisible();
    expect(await app.invoke<Plan>("services_get", { id: plan.id })).toMatchObject({ title: "Harvest Thanksgiving", serviceTime: "10:00", status: "ready" });
    // The editor opens with the new title.
    await main.getByRole("button", { name: /Harvest Thanksgiving/ }).click();
    await expect(main.getByRole("heading", { name: "Harvest Thanksgiving" })).toBeVisible();
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});
