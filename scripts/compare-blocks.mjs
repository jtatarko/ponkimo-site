#!/usr/bin/env node
/**
 * Per-block comparison for one case study: Framer's extent for each MDX block
 * (from the importer's DEBUG_BLOCKS output) next to the block's rendered
 * height in the local build. Shows which block grows or shrinks the page.
 *
 * Usage: DEBUG_BLOCKS=<slug> node scripts/framer-import.mjs --force | grep '^{' > blocks.jsonl
 *        node scripts/compare-blocks.mjs <slug> blocks.jsonl
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const [slug, file] = process.argv.slice(2);
const LOCAL = process.env.LOCAL ?? "http://127.0.0.1:4321";
const executablePath =
  process.env.CHROMIUM ??
  join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");

const framer = (await readFile(file, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await page.goto(`${LOCAL}/${slug}`, { waitUntil: "networkidle" });
const local = await page.evaluate(() => {
  const kids = [...document.querySelectorAll("main article > *")].filter((el) => !["HEADER", "NAV", "SCRIPT", "STYLE"].includes(el.tagName));
  return kids.map((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase(), y: Math.round(r.y + scrollY), h: Math.round(r.height), mt: parseFloat(s.marginTop), mb: parseFloat(s.marginBottom), pt: parseFloat(s.paddingTop), pb: parseFloat(s.paddingBottom) };
  });
});
await browser.close();

// local[0] is the <Lead>; framer entries follow in order.
const blocks = local.slice(1);
console.log(`framer blocks ${framer.length}, local blocks ${blocks.length}`);
console.log("#  framerTop localY  Δtop | framerH localH Δh | gap localGap Δgap  code");
let prevBottom = local[0].y + local[0].h;
framer.forEach((f, i) => {
  const l = blocks[i];
  if (!l) return;
  const localGap = Math.round(l.y - prevBottom);
  console.log(
    `${String(i).padStart(2)} ${String(f.top).padStart(8)} ${String(l.y).padStart(7)} ${String(l.y - f.top).padStart(5)} | ${String(f.h).padStart(6)} ${String(l.h).padStart(6)} ${String(l.h - f.h).padStart(4)} | ${String(f.gap).padStart(4)} ${String(localGap).padStart(8)} ${String(localGap - f.gap).padStart(5)}  ${f.code}`,
  );
  prevBottom = l.y + l.h;
});
