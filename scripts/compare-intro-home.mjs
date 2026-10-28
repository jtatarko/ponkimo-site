#!/usr/bin/env node
/** Homepage hero intro: samples each hero part's effective opacity/y on Framer vs local. */
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const FRAMER = "https://ponkimo.framer.website/";
const LOCAL = process.env.LOCAL ?? "http://127.0.0.1:4321/";
const executablePath =
  process.env.CHROMIUM ??
  join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");

const sample = () => {
  const eff = (el) => {
    let op = 1;
    for (let e = el; e && e !== document.body; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const r = el.getBoundingClientRect();
    return { op: Math.round(op * 100) / 100, y: Math.round(r.y) };
  };
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const fs = (e) => parseFloat(getComputedStyle(e).fontSize);
  // Find each hero part once, then keep tracking the same element.
  const finders = {
    mark: () => [...document.querySelectorAll("svg")].filter(vis).find((s) => { const r = s.getBoundingClientRect(); return r.width >= 60 && r.width <= 80 && r.y > 150 && r.y < 400; }),
    title: () => [...document.querySelectorAll("p,h1,h2")].filter(vis).find((e) => fs(e) >= 100),
    name: () => [...document.querySelectorAll("p")].filter(vis).find((e) => /Jakub Tatarko/.test(e.textContent) && fs(e) < 30),
    scribble: () => [...document.querySelectorAll("img")].filter(vis).find((i) => i.getBoundingClientRect().width > 900),
    skills: () => [...document.querySelectorAll("p")].filter(vis).find((e) => /^Design & Business Thinking/.test(e.textContent.trim())),
    intro: () => [...document.querySelectorAll("h3")].filter(vis).find((e) => /Future-tech/.test(e.textContent)),
    venn: () => [...document.querySelectorAll("svg")].filter(vis).find((s) => s.getBoundingClientRect().width > 400),
  };
  window.__els ??= {};
  const out = {};
  for (const [k, find] of Object.entries(finders)) {
    window.__els[k] ??= find();
    out[k] = window.__els[k] && document.contains(window.__els[k]) ? eff(window.__els[k]) : null;
  }
  return out;
};

const browser = await chromium.launch({ executablePath });
for (const [label, url] of [["framer", FRAMER], ["local", LOCAL]]) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(url, { waitUntil: "commit" });
  const t0 = Date.now();
  const tl = [];
  while (Date.now() - t0 < 3200) {
    try { tl.push({ t: Date.now() - t0, ...(await page.evaluate(sample)) }); } catch {}
    await page.waitForTimeout(40);
  }
  console.log(`== ${label}`);
  for (const k of ["mark", "title", "name", "scribble", "skills", "intro", "venn"]) {
    const pts = tl.filter((s) => s[k]).map((s) => [s.t, s[k]]);
    if (!pts.length) { console.log(`  ${k.padEnd(9)} not found`); continue; }
    const first = pts[0][1], final = pts.at(-1)[1];
    const moving = first.op < 0.98 || first.y !== final.y;
    if (!moving) { console.log(`  ${k.padEnd(9)} static (first seen ${pts[0][0]}ms)`); continue; }
    const start = pts.find(([, v]) => v.op > first.op + 0.02 || v.y !== first.y)?.[0];
    const half = pts.find(([, v]) => v.op >= 0.5)?.[0];
    const done = pts.find(([, v]) => Math.abs(v.op - final.op) < 0.02 && Math.abs(v.y - final.y) <= 1)?.[0];
    console.log(`  ${k.padEnd(9)} op ${first.op}→${final.op}  dy ${first.y - final.y}px  start ${start}  50% ${half}  done ${done}ms`);
  }
}
await browser.close();
