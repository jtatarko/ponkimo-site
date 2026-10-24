#!/usr/bin/env node
/**
 * Visual diff helper: screenshots the Framer original and the local build of
 * the same page, then writes side-by-side slices (Framer left, Astro right).
 *
 * Usage: node scripts/compare.mjs [page ...] [--width=1440] [--dark]
 *   page: "" (home) or a slug; defaults to all pages.
 *   Requires the site running at LOCAL (pnpm build && pnpm preview).
 * Output: reference/compare/<page>-<width>-<scheme>-<n>.png (gitignored)
 */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";

const FRAMER = "https://ponkimo.framer.website";
const LOCAL = process.env.LOCAL ?? "http://127.0.0.1:4321";
const ALL = ["", "sponsor-online", "cannyx-marketplace", "transformation-copilot", "frog-design-system"];
const OUT = new URL("../reference/compare/", import.meta.url).pathname;

const args = process.argv.slice(2);
const width = Number(args.find((a) => a.startsWith("--width="))?.split("=")[1] ?? 1440);
const scheme = args.includes("--dark") ? "dark" : "light";
const pages = args.filter((a) => !a.startsWith("--"));
const targets = pages.length ? pages.map((p) => (p === "home" ? "" : p)) : ALL;

// Use the locally installed headless shell; no browser download needed.
const executablePath =
  process.env.CHROMIUM ??
  join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");

async function capture(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  // Scroll in steps so lazy images load and scroll-triggered animations finish.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  // Hide Framer's badge so it doesn't show up as a difference.
  await page.addStyleTag({ content: "#__framer-badge-container{display:none!important}" });
  const full = await page.screenshot({ fullPage: true });
  // The footer is revealed from behind the page, which a full-page capture
  // can't show; grab the last viewport separately.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(800);
  const bottom = await page.screenshot();
  return { full, bottom };
}

const SLICE = 1800; // source px per slice
const SIDE = 720; // output px per side

async function sideBySide(a, b, name) {
  const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
  const slices = Math.ceil(Math.max(ma.height, mb.height) / SLICE);
  const scale = SIDE / ma.width;
  const sliceH = Math.round(SLICE * scale);
  const part = async (buf, meta, i) => {
    const top = i * SLICE;
    if (top >= meta.height) return sharp({ create: { width: SIDE, height: sliceH, channels: 3, background: "#f0f" } }).png().toBuffer();
    const h = Math.min(SLICE, meta.height - top);
    return sharp(buf)
      .extract({ left: 0, top, width: meta.width, height: h })
      .resize({ width: SIDE })
      .extend({ bottom: sliceH - Math.round(h * scale), background: "#f0f" })
      .png()
      .toBuffer();
  };
  for (let i = 0; i < slices; i++) {
    const [la, lb] = await Promise.all([part(a, ma, i), part(b, mb, i)]);
    await sharp({ create: { width: SIDE * 2 + 8, height: sliceH, channels: 3, background: "#f00" } })
      .composite([{ input: la, left: 0, top: 0 }, { input: lb, left: SIDE + 8, top: 0 }])
      .png()
      .toFile(join(OUT, `${name}-${i + 1}.png`));
  }
  return { framer: ma.height, local: mb.height, slices };
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
for (const slug of targets) {
  const page = await context.newPage();
  const [a, b] = [await capture(page, `${FRAMER}/${slug}`), await capture(page, `${LOCAL}/${slug}`)];
  const name = `${slug || "home"}-${width}-${scheme}`;
  const r = await sideBySide(a.full, b.full, name);
  await sideBySide(a.bottom, b.bottom, `${name}-bottom`);
  console.log(`${name}: framer ${r.framer}px, local ${r.local}px, ${r.slices} slices`);
  await page.close();
}
await browser.close();
