#!/usr/bin/env node
/**
 * Step 1 of the Framer migration: walks each live Framer page at 1440px in a
 * headless browser and records every visible text block, image, video,
 * embed and hairline with its position, in reading order.
 *
 * Output: scripts/framer-extract/extract-<slug>.json, consumed by
 * scripts/framer-import.mjs (step 2).
 *
 * Usage: node scripts/framer-extract.mjs [slug ...]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const FRAMER = "https://ponkimo.framer.website";
const ALL = ["sponsor-online", "cannyx-marketplace", "transformation-copilot", "frog-design-system"];
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const executablePath =
  process.env.CHROMIUM ??
  join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");

/** Runs in the page. Kept dependency-free so it can be pasted into DevTools too. */
function walk() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none";
  };
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const isDark = (c) => {
    const m = c.match(/\d+(\.\d+)?/g);
    if (!m) return false;
    const [r, g, b, a = 1] = m.map(Number);
    return a > 0.5 && (r + g + b) / 3 < 60;
  };
  const bandOf = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.getBoundingClientRect().width >= innerWidth - 2 && isDark(getComputedStyle(p).backgroundColor)) return true;
    }
    return false;
  };
  // Rich text -> Markdown, keeping italics, bold and links.
  const md = (node, base) => {
    // Escape literal Markdown markers so they survive next to added emphasis.
    if (node.nodeType === 3) return node.textContent.replace(/\u00a0/g, " ").replace(/[\\*_]/g, "\\$&");
    if (node.nodeType !== 1) return "";
    if (node.tagName === "BR") return "\n";
    const s = getComputedStyle(node);
    const inner = [...node.childNodes]
      .map((n) => md(n, { italic: base.italic || s.fontStyle === "italic", bold: base.bold || +s.fontWeight >= 600 }))
      .join("");
    if (node.tagName === "A") return inner.trim() ? `[${inner.trim()}](${node.getAttribute("href")})` : "";
    const t = inner.trim();
    if (!t) return inner;
    let w = t;
    if (+s.fontWeight >= 600 && !base.bold) w = `**${w}**`;
    if (s.fontStyle === "italic" && !base.italic) w = `*${w}*`;
    return inner.match(/^\s*/)[0] + w + inner.match(/\s*$/)[0];
  };

  const blocks = [];
  for (const c of document.querySelectorAll('[data-framer-component-type="RichTextContainer"]')) {
    if (!vis(c)) continue;
    for (const ch of c.children) {
      if (!vis(ch)) continue;
      const s = getComputedStyle(ch);
      const base = { italic: s.fontStyle === "italic", bold: +s.fontWeight >= 600 };
      const text =
        ch.tagName === "UL" || ch.tagName === "OL"
          ? [...ch.children].map((li, i) => (ch.tagName === "OL" ? `${i + 1}. ` : "- ") + md(li, base).trim()).join("\n")
          : md(ch, base).trim();
      if (!text) continue;
      blocks.push({
        kind: "text", tag: ch.tagName, ff: s.fontFamily.split(",")[0].replace(/"/g, ""),
        fs: parseFloat(s.fontSize), fw: +s.fontWeight, color: s.color, dark: bandOf(c), ...box(ch), text,
      });
    }
  }
  for (const im of document.querySelectorAll("img")) {
    if (!vis(im)) continue;
    const set = (im.getAttribute("srcset") || "").split(",").map((x) => x.trim().split(" ")[0]).filter(Boolean);
    const s = getComputedStyle(im);
    // Framer sets mix-blend-mode: multiply on the wrapper of line art and
    // diagrams (white drops out on any background); screenshots have none.
    let multiply = false;
    for (let p = im.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).mixBlendMode === "multiply") multiply = true;
    }
    blocks.push({
      kind: "img", src: (set.pop() || im.currentSrc || im.src).split("?")[0], alt: im.alt || "",
      fit: s.objectFit, position: s.objectPosition, natural: [im.naturalWidth, im.naturalHeight],
      multiply, dark: bandOf(im), ...box(im),
    });
  }
  for (const v of document.querySelectorAll("video")) {
    if (vis(v)) blocks.push({ kind: "video", src: v.src || v.querySelector("source")?.src, poster: v.poster || "", dark: bandOf(v), ...box(v) });
  }
  for (const f of document.querySelectorAll("iframe")) {
    if (vis(f.parentElement)) blocks.push({ kind: "iframe", src: f.src, ...box(f.parentElement) });
  }
  // Hairlines: 1-2px filled divs, or top/bottom borders on wide containers.
  const seen = new Set();
  const hr = (y, el) => {
    const r = el.getBoundingClientRect();
    const k = Math.round(y / 4);
    if (seen.has(k)) return;
    seen.add(k);
    blocks.push({ kind: "hr", x: Math.round(r.x), y: Math.round(y), w: Math.round(r.width), h: 1 });
  };
  for (const d of document.querySelectorAll("div")) {
    if (!vis(d)) continue;
    const r = d.getBoundingClientRect();
    if (r.width <= 400) continue;
    const s = getComputedStyle(d);
    if (r.height <= 2 && !d.children.length && s.backgroundColor !== "rgba(0, 0, 0, 0)") hr(r.y + scrollY, d);
    const line = (w, st, c) => parseFloat(w) >= 1 && st !== "none" && !/rgba\(\d+, \d+, \d+, 0\)/.test(c);
    if (line(s.borderTopWidth, s.borderTopStyle, s.borderTopColor)) hr(r.y + scrollY, d);
    if (line(s.borderBottomWidth, s.borderBottomStyle, s.borderBottomColor)) hr(r.y + scrollY + r.height, d);
    // Framer's separator component draws its line with a pseudo-element.
    if (/separator/i.test(d.className)) hr(r.y + scrollY, d);
    for (const pseudo of ["::before", "::after"]) {
      const p = getComputedStyle(d, pseudo);
      if (p.content === "none" || p.content === "normal") continue;
      const thin = parseFloat(p.height) <= 2 && p.backgroundColor !== "rgba(0, 0, 0, 0)";
      if (thin || line(p.borderTopWidth, p.borderTopStyle, p.borderTopColor)) hr(r.y + scrollY + (p.bottom === "0px" ? r.height : 0), d);
    }
  }
  // An empty section heading also starts a chapter in Framer's layout.
  for (const h of document.querySelectorAll("h2")) {
    const r = h.getBoundingClientRect();
    if (r.width > 400 && !h.textContent.trim() && getComputedStyle(h).display !== "none") hr(r.y + scrollY - 1, h);
  }
  const links = [...document.querySelectorAll("a[href]")].filter(vis).map((a) => ({ href: a.getAttribute("href"), text: (a.innerText || "").trim().slice(0, 80), ...box(a) }));
  blocks.sort((a, b) => a.y - b.y || a.x - b.x);
  return {
    url: location.pathname, title: document.title,
    desc: document.querySelector("meta[name=description]")?.content,
    og: document.querySelector('meta[property="og:image"]')?.content,
    docH: document.documentElement.scrollHeight, blocks, links,
  };
}

await mkdir(new URL("./framer-extract/", import.meta.url), { recursive: true });
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const slug of slugs) {
  await page.goto(`${FRAMER}/${slug}`, { waitUntil: "networkidle" });
  // Scroll slowly so every lazy image loads and every appear-animation runs.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 300) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(150);
  }
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r))))));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  const data = await page.evaluate(walk);
  await writeFile(new URL(`./framer-extract/extract-${slug}.json`, import.meta.url), JSON.stringify(data));
  const count = (k) => data.blocks.filter((b) => b.kind === k).length;
  console.log(`${slug}: ${data.blocks.length} blocks (text ${count("text")}, img ${count("img")}, video ${count("video")}, iframe ${count("iframe")})`);
}
await browser.close();
