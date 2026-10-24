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
import { mkdir, readFile, writeFile, access, stat } from "node:fs/promises";
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

/** Framer pads layouts with (nearly) transparent PNGs; detect and skip them. */
async function isBlank(abs) {
  if (![".png", ".webp"].includes(extname(abs))) return false;
  if ((await stat(abs)).size < 400) return true; // a few hundred bytes: a spacer
  const { channels, isOpaque } = await sharp(abs).stats();
  return !isOpaque && channels.length === 4 && channels[3].max <= 8;
}

const fileOf = (src) => src.split("/").pop();
const isListLine = (l) => /^\s*(-|\d+\.)\s/.test(l);
const mdxText = (t) => {
  const lines = t
    .replace(/[{}]/g, (c) => "\\" + c)
    .replace(/</g, "&lt;")
    .replace(/[ \t]+\n/g, "\n")
    .split("\n");
  // A single newline inside a paragraph is a deliberate line break in Framer;
  // keep it as a hard break, except around list items.
  return lines
    .map((l, i) => {
      const next = lines[i + 1];
      const hard = next !== undefined && l !== "" && next !== "" && !isListLine(l) && !isListLine(next);
      return hard ? l + "\\" : l;
    })
    .join("\n");
};
// JSX string attributes can't contain escaped quotes; use an expression instead.
const attr = (s) => (/["\\]/.test(s) ? `{${JSON.stringify(s)}}` : JSON.stringify(s));
// YAML double-quoted scalars accept JSON escapes.
const yaml = (s) => JSON.stringify(s);
// Framer's quote styles render ***x*** as plain italic; match what's visible.
const quoteText = (t) => mdxText(t.replace(/\*\*\*(.+?)\*\*\*/g, "*$1*"));
const plain = (t) => t.replace(/[*_\\]/g, "").replace(/\s+/g, " ").trim();
const varName = (file) => "img_" + file.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]/gi, "").slice(0, 10);

async function importStudy(study) {
  const raw = JSON.parse(await readFile(join(ROOT, `scripts/framer-extract/extract-${study.slug}.json`), "utf8"));
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  console.log(`\n${study.slug}`);

  // Framer "Fit" images (object-fit: contain) only fill part of their box.
  // Swap the box for the visible rectangle so layout and aspect match.
  for (const b of data.blocks) {
    if (b.kind !== "img" || b.fit !== "contain" || !b.natural?.[0]) continue;
    const scale = Math.min(b.w / b.natural[0], b.h / b.natural[1]);
    const [w, h] = [Math.round(b.natural[0] * scale), Math.round(b.natural[1] * scale)];
    const [px, py] = (b.position ?? "50% 50%").split(" ").map((p) => parseFloat(p) / 100);
    b.x += Math.round((b.w - w) * px);
    b.y += Math.round((b.h - h) * py);
    [b.w, b.h] = [w, h];
  }

  // 1. Assets ---------------------------------------------------------------
  const imgDir = `src/assets/work/${study.slug}`;
  const blank = new Set();
  // Only Framer-hosted media; e.g. the YouTube poster comes from i.ytimg.com
  // and is rendered by <YouTube> itself.
  const isFramer = (b) => b.src?.startsWith("https://framerusercontent.com/");
  data.blocks = data.blocks.filter((b) => !(b.kind === "img" || b.kind === "video") || isFramer(b));
  // Framer injects its editor as a full-page iframe; only YouTube embeds are content.
  data.blocks = data.blocks.filter((b) => b.kind !== "iframe" || /youtube(-nocookie)?\.com\/embed\//.test(b.src));
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
      b.y > 60 && // below the nav bar (its text sits at y≈21)
      b.kind !== "svg" &&
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
      if (above <= 0 && -above < 40 && m.h > 120) return -above; // label just inside the top edge
      if (below >= 0 && below < 40) return below;
      return Infinity;
    };
    const target = blocks
      .filter((m) => (m.kind === "img" || m.kind === "video") && !caption.has(m) && m.x < c.x + c.w && c.x < m.x + m.w)
      .map((m) => ({ m, d: gap(m) }))
      .filter(({ d }) => d < Infinity)
      .sort((a, b) => a.d - b.d)[0];
    if (target) {
      caption.set(target.m, { text: plain(c.text), block: c, above: c.y <= target.m.y + 40 });
      used.add(c);
    }
  }

  // Section headings belong to the right-column paragraph just above them.
  const rightText = (b) => b.kind === "text" && b.x >= 640 && b.fs < 28 && b.fs > 15;
  const headingFor = new Map();
  for (const h of blocks.filter((b) => b.kind === "text" && b.ff.startsWith("Montserrat") && b.fs >= 40 && b.fs < 60)) {
    const anchor = blocks.filter((b) => rightText(b) && b.y <= h.y + 10 && h.y - b.y < 200 && !headingFor.has(b)).pop();
    const heading = { text: h.text.replace(/\n/g, " "), block: h };
    if (anchor) headingFor.set(anchor, heading);
    else headingFor.set(h, heading); // stand-alone heading
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
  /**
   * `at` = [x, y, w, h] inside a Canvas; omit for a figure in a text column.
   * The Framer box ratio is always kept, so crops match the original.
   */
  const figure = (b, at, slot, offset) => {
    const cap = caption.get(b)?.text;
    const atAttr = at ? ` at={[${at.join(", ")}]}` : ` ratio="${b.w} / ${b.h}"`;
    const capAttr = cap ? ` caption=${attr(cap)}` : "";
    const slotAttr = (slot ? ` slot="${slot}"` : "") + (offset > 8 ? ` offset={${offset}}` : "");
    if (b.kind === "video") {
      return `<Video src="/media/${study.slug}/${fileOf(b.src)}" label=${attr(cap ?? "TODO: describe clip")} ratio="${b.w} / ${b.h}"${at ? ` at={[${at.join(", ")}]}` : ""}${capAttr}${slotAttr} />`;
    }
    const small = !at && !slot && b.w < 420 ? ` width={${b.w}}` : "";
    // Framer's crop anchor, when it isn't the centre.
    const pos = b.fit === "cover" && b.position && b.position !== "50% 50%" ? ` pos="${b.position}"` : "";
    return `<Figure src={${imgRef(b)}} alt=${attr(cap ?? "TODO: describe image")}${atAttr}${capAttr}${small}${pos}${slotAttr} />`;
  };
  const isMedia = (b) => b.kind === "img" || b.kind === "video";
  const overlapsY = (a, b) => a.y < b.y + b.h && b.y < a.y + a.h;
  const hasMediaBeside = (b) => blocks.some((o) => o !== b && isMedia(o) && overlapsY(o, b) && !used.has(o));
  // Images aligned with the right-hand text column flow inside the prose,
  // unless another image sits beside them (then they're a pair -> Canvas).
  const inColumn = (b) => b.x >= 690 && b.x <= 760 && b.w <= 600 && !hasMediaBeside(b);
  // Left-half images next to right-column text become the section's aside.
  const besideText = (b) =>
    b.x < 640 && b.x + b.w <= 760 && !hasMediaBeside(b) &&
    blocks.some((t) => t.kind === "text" && t.x >= 640 && t.fs > 15 && t.fs < 28 && t.y >= b.y - 150 && t.y <= b.y + b.h);
  /** Top edge of a figure including a caption above it. */
  const topOf = (m) => (caption.get(m)?.above ? Math.min(caption.get(m).block.y, m.y) : m.y);
  const isLabel = (b) => b.kind === "text" && b.fs <= 15;
  const bottomOf = (m) => {
    const c = caption.get(m);
    return Math.max(m.y + m.h, c && !c.above ? c.block.y + c.block.h : 0);
  };
  /** Emit a Canvas reproducing the group's Framer arrangement. */
  const canvas = (items) => {
    const top = Math.min(...items.map(topOf));
    const h = Math.max(...items.map(bottomOf)) - top;
    // Framer wrapped labels in the space left of a neighbouring image.
    const labelWidth = (m) => {
      const right = items.filter((o) => isMedia(o) && o.x > m.x && o.y < m.y + 40 && o.y + o.h > m.y);
      return Math.min(m.w, ...right.map((o) => o.x - m.x - 12));
    };
    const kids = items.map((m) =>
      isLabel(m)
        ? `  <Caption at={[${m.x}, ${m.y - top}, ${labelWidth(m)}]}>${mdxText(plain(m.text))}</Caption>`
        : "  " + figure(m, [m.x, topOf(m) - top, m.w, m.h]),
    );
    return `<Canvas h={${h}}>\n${kids.join("\n")}\n</Canvas>`;
  };

  // Each entry keeps its Framer top/bottom so the gap above it can be
  // reproduced (see `gap` on the MDX components).
  const body = [];
  const extent = (bs) => ({
    top: Math.min(...bs.map((o) => (isMedia(o) ? topOf(o) : o.y))),
    bottom: Math.max(...bs.map((o) => (isMedia(o) ? bottomOf(o) : o.y + o.h))),
  });
  const emit = (code, bs) => body.push({ code, ...extent(bs.filter(Boolean)) });
  let section = null; // { title, divider, lines[], asides[], blocks[] }
  const closeSection = () => {
    if (!section) return;
    const t = section.title ? ` title=${attr(section.title)}` : "";
    const d = section.divider ? " divider" : "";
    const lines = [...section.asides, ...section.lines];
    emit(`<Section${t}${d}>\n\n${lines.join("\n\n")}\n\n</Section>`, section.blocks);
    section = null;
  };
  let sectionCount = 0;
  let pendingDivider = false;

  const rest = blocks.filter((b) => !used.has(b));
  for (let i = 0; i < rest.length; i++) {
    const b = rest[i];
    if (used.has(b)) continue;

    // Framer's hairlines mark chapter breaks.
    if (b.kind === "hr") {
      closeSection();
      pendingDivider = true;
      continue;
    }

    if (b.kind === "iframe") {
      closeSection();
      const id = b.src.match(/embed\/([\w-]+)/)?.[1];
      emit(`<YouTube id="${id}" title="TODO: video title" />`, [b]);
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
      // Small portrait to the left of the name.
      const avatar = after.find((o) => o.kind === "img" && o.w <= 120 && Math.abs(o.y - name.y) < 40 && o.x < name.x);
      emit(
        `<Testimonial name=${attr(plain(name.text))}${role ? ` role=${attr(plain(role.text))}` : ""}${avatar ? ` avatar={${imgRef(avatar)}}` : ""}>\n\n${quoteText(quote.text)}\n\n</Testimonial>`,
        [b, quote, name, role],
      );
      [quote, name, role, avatar].forEach((o) => o && used.add(o));
      continue;
    }

    if (b.kind === "text" && b.fs === 28) {
      const row = rest.filter((o) => o.kind === "text" && o.fs === 28 && Math.abs(o.y - b.y) < 20);
      if (row.length > 1) {
        closeSection();
        const subs = [];
        const items = row.map((o) => {
          const sub = rest.find((s) => s.kind === "text" && s.fs < 28 && Math.abs(s.x - o.x) < 30 && s.y > o.y && s.y - o.y < 250);
          if (sub) used.add(sub), subs.push(sub);
          return `  { title: ${yaml(plain(o.text))}${sub ? `, text: ${yaml(plain(sub.text))}` : ""} }`;
        });
        row.forEach((o) => used.add(o));
        emit(`<Highlights\n  items={[\n${items.join(",\n")}\n  ]}\n/>`, [...row, ...subs]);
        i += row.length - 1;
        continue;
      }
      closeSection();
      emit(`<PullQuote>\n\n${quoteText(b.text)}\n\n</PullQuote>`, [b]);
      continue;
    }
    if (used.has(b)) continue;

    // A small label right above an image belongs to that image's canvas.
    if (isLabel(b) && rest.some((o) => isMedia(o) && !used.has(o) && o.y > b.y && o.y - b.y < 150)) continue;

    if (b.kind === "text") {
      // A jump of >100px between right-column paragraphs is a chapter break.
      const lastText = section?.blocks.filter((o) => o && o.kind === "text" && o.x >= 640).at(-1);
      if (section && lastText && !headingFor.has(b) && b.x >= 640 && b.y - (lastText.y + lastText.h) > 100) closeSection();
      if (headingFor.has(b) || !section) {
        closeSection();
        const h = headingFor.get(b)?.block;
        // leftBottom: where the left column currently ends, to offset asides.
        const divider = pendingDivider || (sectionCount++ > 0 && headingFor.has(b));
        pendingDivider = false;
        section = { title: headingFor.get(b)?.text, divider, lines: [], asides: [], blocks: [h], leftBottom: h ? h.y + h.h : b.y, leftGap: h ? 40 : 0 };
      }
      if (b.ff.startsWith("Montserrat")) continue; // stand-alone heading only opens the section
      section.lines.push(
        isLabel(b) ? `<p class="text-caption text-muted">${mdxText(plain(b.text))}</p>` : mdxText(b.text),
      );
      section.blocks.push(b);
      continue;
    }

    // Images / videos
    if (inColumn(b) && section && !b.dark) {
      section.lines.push(figure(b));
      section.blocks.push(b);
      continue;
    }
    if (besideText(b) && !b.dark) {
      // The paragraph it sits beside may come just after it (sorted by y).
      if (!section) section = { title: undefined, divider: false, lines: [], asides: [], blocks: [], leftBottom: b.y, leftGap: 0 };
      // Framer pushed asides down with transparent spacers; keep that offset.
      const offset = Math.round(topOf(b) - section.leftBottom - section.leftGap);
      section.asides.push(figure(b, undefined, "aside", offset));
      section.blocks.push(b);
      section.leftBottom = bottomOf(b);
      section.leftGap = 40;
      used.add(b);
      continue;
    }
    // Group every following media block that overlaps (or nearly touches)
    // this one vertically; text in between ends the group.
    closeSection();
    const items = rest.filter((o) => isLabel(o) && !used.has(o) && o.y < b.y && b.y - o.y < 150);
    items.push(b);
    let bottom = bottomOf(b);
    for (let j = i + 1; j < rest.length; j++) {
      const o = rest[j];
      if (used.has(o)) continue;
      // Stray small labels inside the group's span belong to the arrangement.
      if (isLabel(o) && o.y <= bottom) {
        items.push(o);
        i = j;
        continue;
      }
      if (!isMedia(o) || topOf(o) > bottom + 40 || o.dark !== b.dark) break;
      items.push(o);
      bottom = Math.max(bottom, bottomOf(o));
      i = j;
    }
    items.forEach((o) => used.add(o));
    const c = canvas(items);
    emit(b.dark ? `<Band>\n${c}\n</Band>` : c, items);
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
    heroBlock ? `hero: ../../assets/work/${study.slug}/${fileOf(heroBlock.src)}` : null,
    heroBlock ? `heroAlt: "TODO: describe hero illustration"` : null,
    `cardIllustration: ../../assets/work/${study.slug}/${study.illustration}`,
    `cardBackdrop: ../../assets/work/${study.slug}/${study.backdrop}`,
    `next: ${study.next}`,
    "---",
  ].filter(Boolean);
  const importLines = [...imports].map(([v, p]) => `import ${v} from "${p}";`);
  // Space above each block = Framer's distance from the previous block.
  let prevBottom = leadBlocks.length ? Math.max(...leadBlocks.map((o) => o.y + o.h)) : titleBlock.y + titleBlock.h;
  const blocksMdx = body.map(({ code, top, bottom }) => {
    const gap = Math.max(0, Math.round(top - prevBottom));
    prevBottom = Math.max(prevBottom, bottom);
    return code.replace(/^<(\w+)/, `<$1 gap={${gap}}`);
  });
  const mdx = `${front.join("\n")}\n\n${importLines.join("\n")}\n\n<Lead>\n\n${lead}\n\n</Lead>\n\n${blocksMdx.join("\n\n")}\n`;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, mdx);
  console.log(`  ✎ src/content/work/${study.slug}.mdx (${body.length} blocks, ${imports.size} images)`);
}

console.log("home");
for (const [dest, url] of Object.entries(HOME_ASSETS)) await download(url, dest);
for (const s of STUDIES) await importStudy(s);
