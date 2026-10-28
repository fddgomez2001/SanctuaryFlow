/**
 * End-to-end harness: launches the real desktop app (debug build) with its own
 * temporary library and a WebView2 debugging port, then drives its windows
 * with Playwright over CDP.
 *
 * Prerequisites: `cargo build -p sanctuaryflow` and the Vite dev server
 * (started automatically by the Playwright config).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

export const ROOT = path.resolve(import.meta.dirname, "../..");
// SANCTUARYFLOW_E2E_EXE runs the suite against another build (e.g. one with the
// bundled frontend, to exercise the production CSP and asset origins).
const EXE = process.env.SANCTUARYFLOW_E2E_EXE ?? path.join(ROOT, "target", "debug", process.platform === "win32" ? "sanctuaryflow.exe" : "sanctuaryflow");

let nextPort = 9400 + Math.floor(Math.random() * 400);

export interface AppHandle {
  proc: ChildProcess;
  browser: Browser;
  main: Page;
  dataDir: string;
  port: number;
  errors: string[];
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  projector(timeoutMs?: number): Promise<Page>;
  close(opts?: { keepData?: boolean }): Promise<void>;
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`);
}

export async function launchApp(opts: { dataDir?: string } = {}): Promise<AppHandle> {
  if (!existsSync(EXE)) throw new Error(`Build the app first: ${EXE} is missing (cargo build -p sanctuaryflow).`);
  const dataDir = opts.dataDir ?? mkdtempSync(path.join(process.env.SANCTUARYFLOW_E2E_TMP ?? tmpdir(), "sf-e2e-"));
  const port = nextPort++;
  const proc = spawn(EXE, [], {
    cwd: ROOT,
    env: { ...process.env, SANCTUARYFLOW_DATA_DIR: dataDir, SANCTUARYFLOW_E2E_DEBUG_PORT: String(port) },
    stdio: "ignore",
  });
  const browser = await waitFor(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 60_000, "the app's debugging port");
  const main = await waitFor(
    async () => browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().includes("projector") && p.url().startsWith("http")),
    30_000,
    "the operator window",
  );
  const errors: string[] = [];
  main.on("pageerror", (e) => errors.push(e.message));
  main.on("console", (m) => {
    if (m.type() === "error") errors.push(m.location().url ? `${m.text()} (${m.location().url})` : m.text());
  });
  await main.waitForLoadState("domcontentloaded");
  // By element, not role: an opening greeting hides the page from role queries.
  await main.locator('nav[aria-label="Main"]').waitFor({ timeout: 30_000 });

  const handle: AppHandle = {
    proc,
    browser,
    main,
    dataDir,
    port,
    errors,
    async invoke<T>(cmd: string, args: Record<string, unknown> = {}) {
      // Command errors are plain {code, message} objects; carry them across intact.
      const r = (await main.evaluate(
        ([c, a]) =>
          (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(c, a).then(
            (value) => ({ ok: true, value }),
            (error) => ({ ok: false, error }),
          ),
        [cmd, args] as const,
      )) as { ok: true; value: T } | { ok: false; error: { code?: string; message?: string } | string };
      if (r.ok) return r.value;
      const message = typeof r.error === "string" ? r.error : (r.error.message ?? JSON.stringify(r.error));
      throw Object.assign(new Error(message), { code: typeof r.error === "string" ? "other" : r.error.code });
    },
    projector: (timeoutMs = 20_000) =>
      waitFor(async () => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("projector")), timeoutMs, "the projector window"),
    async close({ keepData = false } = {}) {
      await browser.close().catch(() => undefined);
      proc.kill();
      await new Promise((r) => setTimeout(r, 1500));
      // WebView2 helper processes release the profile folder a little later;
      // cleanup is best effort and must never hide a test failure.
      if (!keepData) {
        try {
          rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
        } catch (e) {
          console.warn(`Could not remove ${dataDir}: ${String(e)}`);
        }
      }
    },
  };
  return handle;
}

export async function goTo(app: AppHandle, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await app.main.getByRole("navigation", { name: "Main" }).getByRole("button", { name: new RegExp(`^${escaped}`) }).click();
}

export function fixture(...parts: string[]) {
  return path.join(ROOT, "tests", "fixtures", ...parts);
}

/** Opens a service on the Live page through the service switcher at the top. */
export async function openLiveService(app: AppHandle, planId: string) {
  await app.main.getByRole("button", { name: /^(Service: |Choose a service)/ }).click();
  await app.main.locator(`[role="menuitem"][data-plan-id="${planId}"]`).click();
}
