/**
 * Typographic ties: keeps one- and two-letter words ("a", "to", "in", ...) and
 * numbers ("10+ years") off the end of a line by replacing the space after them
 * with a non-breaking space (U+00A0), so they wrap together with the next word.
 *
 * Runs on rendered HTML (see src/middleware.ts), so it covers MDX, components
 * and data alike. Only text in <body> is touched: never attributes, and never
 * inside code, pre, script, style, textarea or svg.
 */
import type { Element, ElementContent, Root, RootContent, Text } from "hast";
import rehypeParse from "rehype-parse";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";

const WORDS = [
  "a", "i", "an", "to", "in", "at", "of", "on", "by", "or", "as", "is", "it",
  "we", "my", "no", "so", "if", "up", "be", "&", "for",
];
const SKIP = new Set(["code", "pre", "script", "style", "textarea", "svg", "head"]);

// A short word or a number, starting a "word" (after a space, an opening
// bracket or quote, or at the start of the text node), followed by spaces.
const LEAD = String.raw`(?<=^|[\s (\[“‘"'/])`;
const TOKEN = String.raw`(?:${WORDS.join("|")}|\d[\d.,+%]*)`;
const INNER = new RegExp(`${LEAD}(${TOKEN}) +(?=\\S)`, "gi");
const TRAILING = new RegExp(`${LEAD}(${TOKEN}) +$`, "i");

function tieText(node: Text, hasNextSibling: boolean) {
  let value = node.value.replace(INNER, "$1 ");
  // "into <span>desirable</span>": the next word is in a sibling element.
  if (hasNextSibling) value = value.replace(TRAILING, "$1 ");
  node.value = value;
}

function walk(parent: Root | Element) {
  const children = parent.children as (RootContent | ElementContent)[];
  children.forEach((child, i) => {
    if (child.type === "text") tieText(child, i < children.length - 1);
    else if (child.type === "element" && !SKIP.has(child.tagName)) walk(child);
  });
}

export function rehypeTieShortWords() {
  return (tree: Root) => walk(tree);
}

const processor = unified().use(rehypeParse).use(rehypeTieShortWords).use(rehypeStringify);

export function tieShortWords(html: string): string {
  return String(processor.processSync(html));
}
