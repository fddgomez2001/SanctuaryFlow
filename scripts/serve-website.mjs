// Serves the website (website/) on this computer, the way Vercel does:
// the same security headers from vercel.json, clean URLs and the 404 page.
//
//   node scripts/serve-website.mjs        then open http://localhost:4321
//   node scripts/serve-website.mjs 8080   on another port
//
// Press Ctrl+C to stop it. Only this computer can open it.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "website");
const PORT = Number(process.argv[2]) || 4321;
const config = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function headersFor(urlPath) {
  const out = {};
  for (const rule of config.headers ?? []) {
    const pattern = new RegExp(`^${rule.source.replace("(.*)", ".*")}$`);
    if (pattern.test(urlPath)) for (const h of rule.headers) out[h.key] = h.value;
  }
  // There is no HTTPS on localhost: keep the page from asking for it.
  if (out["Content-Security-Policy"]) out["Content-Security-Policy"] = out["Content-Security-Policy"].replace("; upgrade-insecure-requests", "");
  delete out["Strict-Transport-Security"];
  // Vercel's default for files without their own rule: always check for a newer copy.
  out["Cache-Control"] ??= "public, max-age=0, must-revalidate";
  return out;
}

function resolve(urlPath) {
  const file = path.join(SITE, urlPath === "/" ? "index.html" : urlPath);
  if (!file.startsWith(SITE + path.sep) && file !== SITE) return null;
  if (existsSync(file) && statSync(file).isFile()) return file;
  if (existsSync(`${file}.html`)) return `${file}.html`;
  return null;
}

createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const redirect = (config.redirects ?? []).find((r) => r.source === urlPath);
  if (redirect) {
    res.writeHead(redirect.permanent ? 308 : 307, { Location: redirect.destination, ...headersFor(urlPath) });
    res.end();
    return;
  }
  const found = resolve(urlPath);
  const file = found ?? path.join(SITE, "404.html");
  res.writeHead(found ? 200 : 404, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", ...headersFor(urlPath) });
  res.end(readFileSync(file));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`SanctuaryFlow website: http://localhost:${PORT}  (Ctrl+C to stop)`);
});
