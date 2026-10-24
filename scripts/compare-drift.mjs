#!/usr/bin/env node
/**
 * Spacing diagnostics: matches images (by file) and headings (by text) between
 * the Framer extraction and the local build, and prints how far each anchor
 * has drifted. Jumps in drift show which block adds or loses height.
 *
 * Usage: node scripts/compare-drift.mjs <slug>
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const slug = process.argv[2];
const LOCAL = process.env.LOCAL ?? "http://127.0.0.1:4321";
const executablePath =
  process.env.CHROMIUM ??
  join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");

let data = JSON.parse(await readFile(new URL(`./framer-extract/extract-${slug}.json`, import.meta.url), "utf8"));
if (typeof data === "string") data = JSON.parse(data);
const key = (s) => s.replace(/\s+/g, " ").trim().slice(0, 40);
const framer = data.blocks
  .filter((b) => (b.kind === "img" && b.src.includes("framerusercontent")) || (b.kind === "text" && b.ff.startsWith("Montserrat") && b.fs >= 40 && !b.dark))
  .map((b) => ({ id: b.kind === "img" ? b.src.split("/").pop().split(".")[0] : "H:" + key(b.text), y: b.y }));

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await page.goto(`${LOCAL}/${slug}`, { waitUntil: "networkidle" });
const local = await page.evaluate(() => {
  const out = [];
  for (const img of document.querySelectorAll("main img")) {
    const r = img.getBoundingClientRect();
    // Astro renames files to <original>.<hash>_<variant>.<ext>
    out.push({ id: (img.currentSrc || img.src).split("/").pop().split(".")[0], y: Math.round(r.y + scrollY) });
  }
  for (const h of document.querySelectorAll("main h1, main h2")) {
    const r = h.getBoundingClientRect();
    out.push({ id: "H:" + h.textContent.replace(/\s+/g, " ").trim().slice(0, 40), y: Math.round(r.y + scrollY) });
  }
  return out;
});
await browser.close();

let prev = 0;
console.log("drift  Δ      framerY  localY  anchor");
for (const f of framer) {
  const l = local.find((l) => l.id === f.id);
  if (!l) continue;
  local.splice(local.indexOf(l), 1);
  const drift = l.y - f.y;
  console.log(`${String(drift).padStart(5)}  ${String(drift - prev).padStart(5)}  ${String(f.y).padStart(7)}  ${String(l.y).padStart(6)}  ${f.id}`);
  prev = drift;
}
