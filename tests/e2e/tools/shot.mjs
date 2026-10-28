// Captures screenshots of the running app over the WebView2 debug port.
// Usage: node tests/e2e/tools/shot.mjs <port> <outDir> [js-to-eval-before]
import { chromium } from "@playwright/test";

const [port = "9333", outDir = ".", script = ""] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const pages = browser.contexts().flatMap((c) => c.pages());
for (const page of pages) {
  const name = new URL(page.url()).pathname.includes("projector") ? "projector" : "main";
  if (script && name === "main") {
    await page.evaluate(script);
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`${name}: ${page.url()}`);
}
await browser.close();
