#!/usr/bin/env node
/**
 * Intro-animation comparison for the case-study heroes.
 *
 * 1. Hooks Element.prototype.animate before any page script runs, so every
 *    Web Animations call (Framer's "appear" effects use it) is logged with
 *    its target, keyframes and timing.
 * 2. Samples opacity/transform of the hero's mark, title, illustration and
 *    lead every ~60ms for both the Framer page and the local build.
 * 3. Writes a filmstrip per case study: Framer top row, local bottom row.
 *
 * Usage: node scripts/compare-intro.mjs [slug ...]
 * Output: reference/intro/<slug>.png and <slug>.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";

const FRAMER = "https://ponkimo.framer.website";
const LOCAL = process.env.LOCAL ?? "http://127.0.0.1:4321";
const ALL = ["sponsor-online", "cannyx-marketplace", "transformation-copilot", "frog-design-system"];
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const OUT = new URL("../reference/intro/", import.meta.url).pathname;
const FRAMES = [0, 150, 300, 450, 600, 800, 1000, 1400, 2000];
const executablePath =
  process.env.CHROMIUM ??
  join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");

// Runs before page scripts: log every element.animate() call.
const hook = () => {
  window.__anims = [];
  const t0 = performance.now();
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const r = this.getBoundingClientRect();
    window.__anims.push({
      at: Math.round(performance.now() - t0),
      el: `${this.tagName.toLowerCase()} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} "${(this.textContent || "").trim().slice(0, 30)}"`,
      keyframes: JSON.stringify(keyframes).slice(0, 300),
      options: typeof options === "number" ? { duration: options } : JSON.parse(JSON.stringify(options ?? {})),
    });
    return orig.call(this, keyframes, options);
  };
};

// Runs in the page: locate hero parts and read their current visual state.
const sample = () => {
  const pick = (el) => {
    if (!el) return null;
    // Effective opacity/transform include animated ancestors (Framer animates wrappers).
    let op = 1;
    const tr = [];
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      op *= parseFloat(s.opacity);
      if (s.transform !== "none") tr.push(s.transform);
    }
    const r = el.getBoundingClientRect();
    return { op: Math.round(op * 100) / 100, y: Math.round(r.y), x: Math.round(r.x), tr: tr.join(" ") };
  };
  const vis = (e) => e.getBoundingClientRect().width > 0;
  const title = [...document.querySelectorAll("h1, h2, p")].filter(vis).find((e) => parseFloat(getComputedStyle(e).fontSize) >= 60);
  const mark = [...document.querySelectorAll("svg")].filter(vis).find((s) => {
    const r = s.getBoundingClientRect();
    return r.width >= 60 && r.width <= 80 && r.y < 400;
  });
  const hero = [...document.querySelectorAll("img")].filter(vis).find((i) => {
    const r = i.getBoundingClientRect();
    return r.x > 600 && r.y < 500 && r.width > 300;
  });
  const lead = [...document.querySelectorAll("p")].filter(vis).find((e) => {
    const s = parseFloat(getComputedStyle(e).fontSize);
    return s >= 24 && s < 40 && e.getBoundingClientRect().x > 600;
  });
  return { mark: pick(mark), title: pick(title), hero: pick(hero), lead: pick(lead) };
};

async function record(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(hook);
  const page = await ctx.newPage();
  // Start the clock at navigation commit, then sample as fast as we can.
  await page.goto(url, { waitUntil: "commit" });
  const t0 = Date.now();
  const timeline = [];
  const shots = new Map();
  let next = 0;
  while (Date.now() - t0 < 2600) {
    const t = Date.now() - t0;
    try {
      timeline.push({ t, ...(await page.evaluate(sample)) });
    } catch {
      /* page still loading */
    }
    if (next < FRAMES.length && t >= FRAMES[next]) {
      shots.set(FRAMES[next], { t, buf: await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 900 } }) });
      next++;
    }
    await page.waitForTimeout(40);
  }
  const anims = await page.evaluate(() => window.__anims ?? []).catch(() => []);
  await ctx.close();
  return { timeline, anims, shots };
}

async function filmstrip(rows, file) {
  const W = 288, H = 180; // each frame scaled to 1/5
  const tiles = [];
  for (const [r, shots] of rows.entries()) {
    for (const [c, f] of FRAMES.entries()) {
      const s = shots.get(f);
      const img = s ? await sharp(s.buf).resize(W, H).toBuffer() : await sharp({ create: { width: W, height: H, channels: 3, background: "#f0f" } }).png().toBuffer();
      const label = Buffer.from(`<svg width="${W}" height="18"><rect width="${W}" height="18" fill="#000"/><text x="4" y="13" font-size="12" fill="#fff" font-family="sans-serif">${r ? "local" : "framer"} ${f}ms${s ? ` (actual ${s.t})` : ""}</text></svg>`);
      tiles.push({ input: img, left: c * (W + 4), top: r * (H + 22) + 18 }, { input: label, left: c * (W + 4), top: r * (H + 22) });
    }
  }
  await sharp({ create: { width: FRAMES.length * (W + 4), height: 2 * (H + 22), channels: 3, background: "#888" } })
    .composite(tiles)
    .png()
    .toFile(file);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath });
for (const slug of slugs) {
  const framer = await record(browser, `${FRAMER}/${slug}`);
  const local = await record(browser, `${LOCAL}/${slug}`);
  await filmstrip([framer.shots, local.shots], join(OUT, `${slug}.png`));
  await writeFile(
    join(OUT, `${slug}.json`),
    JSON.stringify({ framer: { anims: framer.anims, timeline: framer.timeline }, local: { anims: local.anims, timeline: local.timeline } }, null, 1),
  );
  console.log(`${slug}: framer ${framer.anims.length} animate() calls, local ${local.anims.length}`);
}
await browser.close();
