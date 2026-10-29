#!/usr/bin/env node
/**
 * Layout check for the case studies: scrolls each page at several desktop
 * widths, with parallax running, and reports text, captions, images and
 * chapter hairlines that overlap or sit too close. Each pair keeps the worst
 * clearance seen while both were on screen, so a clip that only collides
 * mid-scroll is caught too.
 *
 * Reports:
 *   overlap  two boxes intersect (images inside one canvas may overlap on purpose, so those are skipped)
 *   tight    a hairline, or boxes from different blocks, closer than MIN px vertically
 *
 * Usage: node scripts/check-overlaps.mjs [slug ...]   (default: all case studies)
 * Env:   LOCAL=http://127.0.0.1:4321  WIDTHS=1024,1280,1440,1920  MIN=24  CHROMIUM=/path/to/chrome
 * Exits 1 when anything is reported.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const LOCAL = process.env.LOCAL ?? "http://127.0.0.1:4321";
const WIDTHS = (process.env.WIDTHS ?? "1024,1280,1440,1920").split(",").map(Number);
const MIN = Number(process.env.MIN ?? 24);
const VH = 900;
const slugs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync("src/content/work").filter((f) => f.endsWith(".mdx")).map((f) => f.replace(/\.mdx$/, ""));

const executablePath = [
  process.env.CHROMIUM,
  join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));

// Runs in the page: boxes of everything on screen, in document coordinates.
function measure() {
  const items = [];
  const add = (el, kind, block, label) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) return;
    if (getComputedStyle(el).visibility === "hidden") return;
    // Items in one <figure> move together; they never count as a collision.
    const fig = el.closest("figure");
    items.push({ kind, block, label, fig: fig ? [...document.querySelectorAll("figure")].indexOf(fig) : -1, x0: r.left, x1: r.right, y0: r.top + scrollY, y1: r.bottom + scrollY });
  };
  const text = (el) => (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  const blocks = [...document.querySelectorAll("main article > *")].filter((el) => !["HEADER", "NAV", "SCRIPT", "STYLE"].includes(el.tagName));
  blocks.forEach((b, i) => {
    b.querySelectorAll("img, video").forEach((el) => add(el, "media", i, el.getAttribute("alt") || el.getAttribute("aria-label") || el.currentSrc.split("/").pop()));
    b.querySelectorAll("figcaption, .canvas-frame > p").forEach((el) => add(el, "caption", i, text(el)));
    b.querySelectorAll("h2, h3, blockquote, .prose-cs > *").forEach((el) => {
      if (!el.closest(".canvas, figcaption") && !el.parentElement.closest("blockquote, .prose-cs > *")) add(el, "text", i, text(el));
    });
    if (b.matches("[data-divider]")) {
      const r = b.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(b).paddingLeft);
      if (r.top >= 0 && r.top <= innerHeight)
        items.push({ kind: "hairline", block: i, fig: -1, label: `above “${text(b)}”`, x0: r.left + pad, x1: r.right - pad, y0: r.top + scrollY, y1: r.top + scrollY + 1 });
    }
  });
  return items;
}

const browser = await chromium.launch({ executablePath });
let total = 0;
for (const slug of slugs) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: VH } });
    await page.goto(`${LOCAL}/${slug}`, { waitUntil: "networkidle" });
    // Reveal-on-scroll only fades; settle it instantly so boxes are final.
    await page.addStyleTag({ content: ".reveal{transition:none!important;opacity:1!important;transform:none!important}" });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const worst = new Map();
    for (let y = 0; y < height; y += VH / 4) {
      await page.evaluate((y) => scrollTo(0, y), y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const items = await page.evaluate(measure);
      for (let a = 0; a < items.length; a++) {
        for (let c = a + 1; c < items.length; c++) {
          const A = items[a], B = items[c];
          if (A.fig !== -1 && A.fig === B.fig) continue;
          if (Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) <= 0) continue;
          if (A.block === B.block && A.kind === "media" && B.kind === "media") continue;
          if (A.block === B.block && A.kind === "text" && B.kind === "text") continue;
          const gap = Math.max(A.y0, B.y0) - Math.min(A.y1, B.y1);
          const closeMatters = A.kind === "hairline" || B.kind === "hairline" || A.block !== B.block;
          if (gap >= MIN || (gap >= 0 && !closeMatters)) continue;
          const key = [A, B].map((i) => `[${i.kind}] ${i.label}`).sort().join("  ↔  ");
          if (!worst.has(key) || worst.get(key).gap > gap) worst.set(key, { gap, y: Math.round(Math.max(A.y0, B.y0)) });
        }
      }
    }
    await page.close();
    if (worst.size) {
      console.log(`\n${slug} @ ${width}px`);
      for (const [key, { gap, y }] of [...worst].sort((p, q) => p[1].y - q[1].y))
        console.log(`  ${gap < 0 ? "overlap" : "tight  "} ${String(Math.round(Math.abs(gap))).padStart(4)}px  ${key}  @y≈${y}`);
      total += worst.size;
    }
  }
}
await browser.close();
console.log(total ? `\n${total} issue(s)` : "No overlaps or tight spots.");
process.exit(total ? 1 : 0);
