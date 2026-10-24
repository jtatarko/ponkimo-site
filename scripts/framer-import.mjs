#!/usr/bin/env node
/**
 * One-off migration helper: Framer -> Astro.
 *
 * Input:  scripts/framer-extract/extract-<slug>.json, produced by running the
 *         DOM walker in the Framer page at 1440px (see README "Migration").
 * Output: original-resolution assets in src/assets + public/media, and an MDX
 *         draft per case study in src/content/work (skipped if it already
 *         exists, unless --force).
 *
 * Usage:  node scripts/framer-import.mjs [--force] [--assets-only]
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import sharp from "sharp";

const ROOT = new URL("..", import.meta.url).pathname;
const FORCE = process.argv.includes("--force");
const ASSETS_ONLY = process.argv.includes("--assets-only");

const FOOTER_VIDEO = "Xvgx6Y6QjoA6XaoctxB5K1WZb0.mp4";
const IMG = "https://framerusercontent.com/images/";
const VID = "https://framerusercontent.com/assets/";

/** Homepage-only assets, mapped to readable names. */
const HOME_ASSETS = {
  "src/assets/home/process-scribble.svg": IMG + "DhWGxLhxQmVhKz97zfsxNLhnnZ0.svg",
  "src/assets/logos/365.svg": IMG + "WksHDn1VkYfpo4dmxdwba3gfHR0.svg",
  "src/assets/logos/adverity.svg": IMG + "gdP40qQRML3LiXuFYwPCdQknk.svg",
  "src/assets/logos/cannyx.png": IMG + "koMOUrSmhqX03vfGNbq0xjUiWs.png",
  "src/assets/logos/jaguar-land-rover.png": IMG + "2AwMd5VJe9tcUeXag0o0c4EkT8.png",
  "src/assets/logos/skoda.svg": IMG + "v4LBVkCn0QrWc35ZgHaIxtWEVI.svg",
  "src/assets/logos/uefa.svg": IMG + "BgbgjR8EhNG3xoejLc7QBfCPQw.svg",
  "public/media/footer-loop.mp4": VID + FOOTER_VIDEO,
};

/** Case studies in homepage order; `next` mirrors Framer's "Explore next" loop. */
const STUDIES = [
  {
    slug: "sponsor-online",
    client: "sponsor.online",
    cardTitle: "4:0 for Innovating Sponsorships",
    illustration: "WT5ibkgCd7s2J5VZejAQrdrLo.png",
    backdrop: "3IksbjtHy8KkWDVQeVK2LRhzY.jpg",
    next: "cannyx-marketplace",
  },
  {
    slug: "cannyx-marketplace",
    client: "Cannyx Markets",
    illustration: "yJ6K2WL2jI5pWbbSoSY4LctDE.png",
    backdrop: "V5gm3yKaPSehbEJThf9115xB16o.png",
    next: "transformation-copilot",
  },
  {
    slug: "transformation-copilot",
    client: "Adverity",
    illustration: "VfM36IiQheGefzqnepLQgLU8gIU.png",
    backdrop: "ZHXbAirzvgJgBvdUeS6Hvj78.png",
    next: "frog-design-system",
  },
  {
    slug: "frog-design-system",
    client: "Adverity’s Design System",
    illustration: "2OPFmJreHIvteXqyZFRYb21KINY.png",
    backdrop: "7noUHsFWTEcYBCsNDTLPQawAs.png",
    next: "sponsor-online",
  },
];

const exists = (p) => access(p).then(() => true, () => false);

async function download(url, dest) {
  const abs = join(ROOT, dest);
  if (await exists(abs)) return abs;
  await mkdir(dirname(abs), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(abs, Buffer.from(await res.arrayBuffer()));
  console.log("  ↓", dest);
  return abs;
}

/** Framer pads layouts with fully transparent PNGs; detect and skip them. */
async function isBlank(abs) {
  if (![".png", ".webp"].includes(extname(abs))) return false;
  const { channels, isOpaque } = await sharp(abs).stats();
  return !isOpaque && channels.length === 4 && channels[3].max === 0;
}

const fileOf = (src) => src.split("/").pop();
const mdxText = (t) =>
  t
    .replace(/[{}]/g, (c) => "\\" + c)
    .replace(/</g, "&lt;")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/(?<!\n)\n(?!\n)/g, "\\\n"); // single newline = hard break
// JSX string attributes can't contain escaped quotes; use an expression instead.
const attr = (s) => (/["\\]/.test(s) ? `{${JSON.stringify(s)}}` : JSON.stringify(s));
// YAML double-quoted scalars accept JSON escapes.
const yaml = (s) => JSON.stringify(s);
const plain = (t) => t.replace(/[*_\\]/g, "").replace(/\s+/g, " ").trim();
const varName = (file) => "img_" + file.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]/gi, "").slice(0, 10);

async function importStudy(study) {
  const raw = JSON.parse(await readFile(join(ROOT, `scripts/framer-extract/extract-${study.slug}.json`), "utf8"));
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  console.log(`\n${study.slug}`);

  // 1. Assets ---------------------------------------------------------------
  const imgDir = `src/assets/work/${study.slug}`;
  const blank = new Set();
  // Only Framer-hosted media; e.g. the YouTube poster comes from i.ytimg.com
  // and is rendered by <YouTube> itself.
  const isFramer = (b) => b.src?.startsWith("https://framerusercontent.com/");
  data.blocks = data.blocks.filter((b) => !(b.kind === "img" || b.kind === "video") || isFramer(b));
  const media = data.blocks.filter((b) => (b.kind === "img" || b.kind === "video") && !b.src.endsWith(FOOTER_VIDEO));
  for (const name of [study.illustration, study.backdrop]) await download(IMG + name, `${imgDir}/${name}`);
  for (const b of media) {
    const name = fileOf(b.src);
    if (b.kind === "video") await download(VID + name, `public/media/${study.slug}/${name}`);
    else if (await isBlank(await download(IMG + name, `${imgDir}/${name}`))) blank.add(name);
  }
  if (ASSETS_ONLY) return;

  const out = join(ROOT, `src/content/work/${study.slug}.mdx`);
  if ((await exists(out)) && !FORCE) {
    console.log("  = MDX exists, skipped (use --force to regenerate)");
    return;
  }

  // 2. Classify blocks ----------------------------------------------------
  const blocks = data.blocks.filter(
    (b) =>
      b.y > 80 &&
      b.kind !== "svg" &&
      b.kind !== "hr" &&
      !(b.kind === "video" && b.src.endsWith(FOOTER_VIDEO)) &&
      !(b.kind === "img" && blank.has(fileOf(b.src))) &&
      !(b.kind === "text" && (b.text === "→" || b.text.startsWith("Let’s design") || b.dark && b.fs > 40)),
  );
  const titleBlock = blocks.find((b) => b.kind === "text" && b.ff.startsWith("Montserrat") && b.fs >= 60);
  const heroBlock = blocks.find((b) => b.kind === "img" && b.y < titleBlock.y + 400 && b.x >= 500);
  const used = new Set([titleBlock, heroBlock]);

  const leadBlocks = blocks.filter(
    (b) => b.kind === "text" && b.fs === 28 && b.x >= 640 && b.y < titleBlock.y + 900,
  );
  leadBlocks.forEach((b) => used.add(b));

  // Captions: 14px text just above an image/video, or just below its bottom
  // edge, that overlaps it horizontally.
  const caption = new Map();
  for (const c of blocks.filter((b) => b.kind === "text" && b.fs <= 15)) {
    const gap = (m) => {
      const above = m.y - c.y;
      const below = c.y - (m.y + m.h);
      if (above > 0 && above < 90) return above;
      if (below >= 0 && below < 40) return below;
      return Infinity;
    };
    const target = blocks
      .filter((m) => (m.kind === "img" || m.kind === "video") && !caption.has(m) && m.x < c.x + c.w && c.x < m.x + m.w)
      .map((m) => ({ m, d: gap(m) }))
      .filter(({ d }) => d < Infinity)
      .sort((a, b) => a.d - b.d)[0];
    if (target) {
      caption.set(target.m, plain(c.text));
      used.add(c);
    }
  }

  // Section headings belong to the right-column paragraph just above them.
  const rightText = (b) => b.kind === "text" && b.x >= 640 && b.fs < 28 && b.fs > 15;
  const headingFor = new Map();
  for (const h of blocks.filter((b) => b.kind === "text" && b.ff.startsWith("Montserrat") && b.fs >= 40 && b.fs < 60)) {
    const anchor = blocks.filter((b) => rightText(b) && b.y <= h.y + 10 && h.y - b.y < 200 && !headingFor.has(b)).pop();
    if (anchor) headingFor.set(anchor, h.text.replace(/\n/g, " "));
    else headingFor.set(h, h.text.replace(/\n/g, " ")); // stand-alone heading
    used.add(h);
  }

  // 3. Emit ----------------------------------------------------------------
  const imports = new Map();
  const imgRef = (b) => {
    const name = fileOf(b.src);
    const v = varName(name);
    imports.set(v, `../../assets/work/${study.slug}/${name}`);
    return v;
  };
  const figure = (b, size) => {
    const cap = caption.get(b);
    const alt = cap ?? "TODO: describe image";
    if (b.kind === "video") {
      return `<Video src="/media/${study.slug}/${fileOf(b.src)}" label=${attr(cap ?? "TODO: describe clip")} ratio="${b.w} / ${b.h}"${size !== "column" ? ` size="${size}"` : ""}${cap ? ` caption=${attr(cap)}` : ""} />`;
    }
    const small = b.w < 420 && size === "column" ? ` width={${b.w}}` : "";
    return `<Figure src={${imgRef(b)}} alt=${attr(alt)}${size !== "column" ? ` size="${size}"` : ""}${cap ? ` caption=${attr(cap)}` : ""}${small} />`;
  };
  const sizeOf = (b) => {
    if (b.w >= 1300) return "bleed";
    if (b.x >= 600 && b.w <= 700) return "column";
    if (b.x <= 100 && b.w <= 960) return "left";
    if (b.x + b.w >= 1340 && b.x >= 400) return "right";
    return "wide";
  };

  const body = [];
  let section = null; // { title, lines[] }
  const closeSection = () => {
    if (!section) return;
    const t = section.title ? ` title=${attr(section.title)}` : "";
    const d = section.divider ? " divider" : "";
    body.push(`<Section${t}${d}>\n\n${section.lines.join("\n\n")}\n\n</Section>`);
    section = null;
  };
  let sectionCount = 0;

  const rest = blocks.filter((b) => !used.has(b));
  for (let i = 0; i < rest.length; i++) {
    const b = rest[i];

    if (b.kind === "iframe") {
      closeSection();
      const id = b.src.match(/embed\/([\w-]+)/)?.[1];
      body.push(`<YouTube id="${id}" title="TODO: video title" />`);
      continue;
    }

    if (b.kind === "text" && b.text === "“") {
      closeSection();
      // Quote, then the bold name, then an optional smaller role line; other
      // blocks (e.g. a portrait) may sit in between, so search forward.
      const after = rest.slice(i + 1);
      const quote = after.find((o) => o.kind === "text" && o.fs === 28);
      const name = quote && after.find((o) => o.kind === "text" && o.fw >= 600 && o.y > quote.y);
      const role = name && after.find((o) => o.kind === "text" && o.fs < 20 && o.y > name.y && o.y - name.y < 80);
      if (!quote || !name) continue;
      body.push(
        `<Testimonial name=${attr(plain(name.text))}${role ? ` role=${attr(plain(role.text))}` : ""}>\n\n${mdxText(quote.text)}\n\n</Testimonial>`,
      );
      [quote, name, role].forEach((o) => o && used.add(o));
      continue;
    }

    if (b.kind === "text" && b.fs === 28) {
      const row = rest.filter((o) => o.kind === "text" && o.fs === 28 && Math.abs(o.y - b.y) < 20);
      if (row.length > 1) {
        closeSection();
        const items = row.map((o) => {
          const sub = rest.find((s) => s.kind === "text" && s.fs < 28 && Math.abs(s.x - o.x) < 30 && s.y > o.y && s.y - o.y < 250);
          if (sub) used.add(sub);
          return `  { title: ${yaml(plain(o.text))}${sub ? `, text: ${yaml(plain(sub.text))}` : ""} }`;
        });
        row.forEach((o) => used.add(o));
        body.push(`<Highlights\n  items={[\n${items.join(",\n")}\n  ]}\n/>`);
        i += row.length - 1;
        continue;
      }
      closeSection();
      body.push(`<PullQuote>\n\n${mdxText(b.text)}\n\n</PullQuote>`);
      continue;
    }
    if (used.has(b)) continue;

    if (b.kind === "text") {
      if (headingFor.has(b) || !section) {
        closeSection();
        section = { title: headingFor.get(b), divider: sectionCount++ > 0 && headingFor.has(b), lines: [] };
      }
      if (b.ff.startsWith("Montserrat")) continue; // stand-alone heading only opens the section
      section.lines.push(mdxText(b.text));
      continue;
    }

    // Images / videos
    const row = rest.filter(
      (o) => (o.kind === "img" || o.kind === "video") && o !== b && Math.abs(o.y - b.y) < 90 && !used.has(o) && o.w < 1000,
    );
    if (row.length && b.w < 1000) {
      closeSection();
      const items = [b, ...row].sort((x, y) => x.x - y.x);
      items.forEach((o) => used.add(o));
      const grid = `<FigureGrid${items.length > 2 ? " cols={3}" : ""}>\n  ${items.map((o) => figure(o, "column")).join("\n  ")}\n</FigureGrid>`;
      body.push(b.dark ? `<Band>\n${grid}\n</Band>` : grid);
      continue;
    }
    const size = sizeOf(b);
    if (size === "column" && section && !b.dark) {
      section.lines.push(figure(b, "column"));
    } else {
      closeSection();
      const f = figure(b, size === "column" ? "right" : size);
      body.push(b.dark ? `<Band>\n${f}\n</Band>` : f);
    }
  }
  closeSection();

  const lead = leadBlocks.map((b) => mdxText(b.text)).join("\n\n");
  const description = plain(leadBlocks[0]?.text ?? data.desc).slice(0, 155).replace(/\s\S*$/, "…");
  const title = titleBlock.text.replace(/\n/g, " ");
  const front = [
    "---",
    `title: ${yaml(title)}`,
    `client: ${yaml(study.client)}`,
    study.cardTitle ? `cardTitle: ${yaml(study.cardTitle)}` : null,
    `description: ${yaml(description)}`,
    `order: ${STUDIES.indexOf(study) + 1}`,
    // Not every page has a hero illustration (sponsor-online opens on a video).
    `hero: ../../assets/work/${study.slug}/${heroBlock ? fileOf(heroBlock.src) : study.illustration}`,
    `heroAlt: "TODO: describe hero illustration"`,
    `cardIllustration: ../../assets/work/${study.slug}/${study.illustration}`,
    `cardBackdrop: ../../assets/work/${study.slug}/${study.backdrop}`,
    `next: ${study.next}`,
    "---",
  ].filter(Boolean);
  const importLines = [...imports].map(([v, p]) => `import ${v} from "${p}";`);
  const mdx = `${front.join("\n")}\n\n${importLines.join("\n")}\n\n<Lead>\n\n${lead}\n\n</Lead>\n\n${body.join("\n\n")}\n`;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, mdx);
  console.log(`  ✎ src/content/work/${study.slug}.mdx (${body.length} blocks, ${imports.size} images)`);
}

console.log("home");
for (const [dest, url] of Object.entries(HOME_ASSETS)) await download(url, dest);
for (const s of STUDIES) await importStudy(s);
