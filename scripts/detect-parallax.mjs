#!/usr/bin/env node
/**
 * Finds scroll-linked motion on the Framer pages. For every visible element we
 * record its document-relative Y while it is in the viewport at many scroll
 * positions. A normal element keeps a constant document Y; parallax, sticky
 * and fixed elements drift. slope = change in document Y per px scrolled
 * (parallax ≈ ±0.1..0.5, sticky/fixed ≈ 1).
 *
 * Usage: node scripts/detect-parallax.mjs [url-path ...]   (default: all)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "https://ponkimo.framer.website";
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ["", "sponsor-online", "cannyx-marketplace", "transformation-copilot", "frog-design-system"];
const executablePath =
  process.env.CHROMIUM ??
  join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");

const browser = await chromium.launch({ executablePath });
for (const p of paths) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${BASE}/${p}`, { waitUntil: "networkidle" });
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < H; y += 300) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(100); }
  await page.waitForLoadState("networkidle");
  // Tag candidates once so we can follow them across scroll positions.
  await page.evaluate(() => {
    scrollTo(0, 0);
    let i = 0;
    for (const el of document.querySelectorAll("img, video, svg, h1, h2, h3, p, div[data-framer-component-type]")) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 20 && !el.closest("nav, #__framer-badge-container")) el.dataset.px = String(i++);
    }
  });
  await page.waitForTimeout(800);
  const samples = [];
  for (let y = 0; y < H - 900; y += 150) {
    await page.evaluate((y) => scrollTo(0, y), y);
    await page.waitForTimeout(160); // let scroll-linked transforms settle
    samples.push(await page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll("[data-px]")) {
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < innerHeight) out[el.dataset.px] = Math.round((r.y + scrollY) * 10) / 10;
      }
      return { sy: scrollY, docY: out };
    }));
  }
  const info = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-px]")].map((el) => {
    const r = el.getBoundingClientRect();
    const label = el.tagName === "IMG" ? (el.currentSrc || el.src).split("/").pop().split("?")[0].slice(0, 16) : (el.textContent || "").trim().slice(0, 28);
    return [el.dataset.px, `${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} ${label}`];
  })));
  const ids = new Set(samples.flatMap((s) => Object.keys(s.docY)));
  const rows = [];
  for (const id of ids) {
    const pts = samples.filter((s) => id in s.docY).map((s) => [s.sy, s.docY[id]]);
    if (pts.length < 4) continue;
    const ys = pts.map((p) => p[1]);
    const range = Math.max(...ys) - Math.min(...ys);
    if (range < 6) continue;
    // least-squares slope of docY vs scrollY
    const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
    rows.push({ id, range: Math.round(range), slope: Math.round(slope * 100) / 100, span: [pts[0][0], pts.at(-1)[0]], what: info[id] });
  }
  rows.sort((a, b) => b.range - a.range);
  // Machine-readable speeds for the importer: images and videos only.
  const meta = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-px]")].filter((e) => ["IMG", "VIDEO"].includes(e.tagName)).map((el) => {
    const r = el.getBoundingClientRect();
    return [el.dataset.px, { file: (el.currentSrc || el.src).split("/").pop().split("?")[0], x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }];
  })));
  const speeds = rows.filter((r) => meta[r.id] && Math.abs(r.slope) >= 0.02 && Math.abs(r.slope) < 0.5 && r.range >= 10).map((r) => ({ ...meta[r.id], slope: r.slope }));
  if (p) await (await import("node:fs/promises")).writeFile(new URL(`./framer-extract/parallax-${p}.json`, import.meta.url), JSON.stringify(speeds, null, 1));
  console.log(`== /${p}  (${ids.size} tracked, ${rows.length} moving)`);
  for (const r of rows.slice(0, 12)) console.log(`  slope ${String(r.slope).padStart(5)}  drift ${String(r.range).padStart(4)}px  scroll ${r.span[0]}–${r.span[1]}  ${r.what}`);
  await page.close();
}
await browser.close();
