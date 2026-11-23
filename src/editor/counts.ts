// Word count and friends (spec 14).

import type { Node } from "prosemirror-model";
import { flatten } from "../md/inline";
import type { Definitions } from "../md/inline";
import { elementsOf, isProse, type EditorOptions } from "./context";
import { project } from "./find";

export interface Counts {
  words: number;
  chars: number;
  charsNoSpaces: number;
  lines: number;
  paragraphs: number;
  /** minutes at 250 words per minute */
  minutes: number;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD = /[\p{L}\p{N}'’-]+/gu;

/** Words in rendered text (14): runs of letters, digits, apostrophes, hyphens; each CJK
 * character is one word; emoji are not words. */
export function countWords(text: string): number {
  let n = 0;
  for (const m of text.matchAll(WORD)) {
    const w = m[0];
    if (!/[\p{L}\p{N}]/u.test(w)) continue;
    let cjk = 0;
    let rest = "";
    for (const ch of w) {
      if (CJK.test(ch)) cjk++;
      else rest += ch;
    }
    n += cjk;
    if (/[\p{L}\p{N}]/u.test(rest)) {
      // CJK characters split the word into parts.
      n += w.split(CJK).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
    }
  }
  return n;
}

function chars(s: string): number {
  return [...s.replace(/\n/g, "")].length;
}

/** Rendered text of the document blocks for counting, and whether each is code. */
export function countableText(doc: Node, defs: Definitions, opts: EditorOptions, from = 0, to = doc.content.size): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return node.type.name !== "front_matter";
    if (node.type.name === "front_matter") return false;
    out.push(blockText(node, Math.max(0, from - pos - 1), Math.min(node.content.size, to - pos - 1), defs, opts));
    return false;
  });
  return out;
}

/** The rendered text of offsets `a`..`b` of a textblock, and whether it is code. */
function blockText(node: Node, a: number, b: number, defs: Definitions, opts: EditorOptions): { text: string; code: boolean } {
  if (isProse(node)) {
    const proj = project(node, flatten(elementsOf(node, defs, opts)));
    let t = "";
    for (let i = 0; i < proj.text.length; i++) if (proj.from[i] >= a && proj.to[i] <= b) t += proj.text[i];
    return { text: t, code: false };
  }
  return { text: node.textBetween(a, b, undefined, "\n"), code: node.type.name !== "html_block" && node.type.name !== "raw" };
}

export function count(blocks: { text: string; code: boolean }[], sourceLines: number, codeInWords = false): Counts {
  let words = 0;
  let c = 0;
  let cn = 0;
  let paragraphs = 0;
  for (const b of blocks) {
    if (b.text.trim()) paragraphs++;
    if (!b.code || codeInWords) words += countWords(b.text);
    c += chars(b.text);
    cn += chars(b.text.replace(/\s/g, ""));
  }
  return { words, chars: c, charsNoSpaces: cn, lines: sourceLines, paragraphs, minutes: Math.max(words ? 1 : 0, Math.round(words / 250)) };
}

interface BlockCounts {
  words: number;
  chars: number;
  charsNoSpaces: number;
  paragraph: boolean;
  code: boolean;
}

/** Per-textblock counts of the whole document, by node (nodes are immutable, so an
 * unchanged block keeps its entry). Recounting a 10,000-line document after each typing
 * pause took about 1 s; with the cache only changed blocks are analyzed (Q-027 follow-up). */
let cache = new WeakMap<Node, BlockCounts>();
let cacheKey: [Definitions | null, string] = [null, ""];

/** Counts of the whole document, as `count(countableText(doc, ...))`. */
export function countDocument(doc: Node, defs: Definitions, opts: EditorOptions, sourceLines: number, codeInWords = false): Counts {
  const key = JSON.stringify(opts);
  if (cacheKey[0] !== defs || cacheKey[1] !== key) {
    cache = new WeakMap();
    cacheKey = [defs, key];
  }
  let words = 0;
  let c = 0;
  let cn = 0;
  let paragraphs = 0;
  doc.descendants((node) => {
    if (!node.isTextblock) return node.type.name !== "front_matter";
    if (node.type.name === "front_matter") return false;
    let k = cache.get(node);
    if (!k) {
      const b = blockText(node, 0, node.content.size, defs, opts);
      k = { words: countWords(b.text), chars: chars(b.text), charsNoSpaces: chars(b.text.replace(/\s/g, "")), paragraph: !!b.text.trim(), code: b.code };
      cache.set(node, k);
    }
    if (k.paragraph) paragraphs++;
    if (!k.code || codeInWords) words += k.words;
    c += k.chars;
    cn += k.charsNoSpaces;
    return false;
  });
  return { words, chars: c, charsNoSpaces: cn, lines: sourceLines, paragraphs, minutes: Math.max(words ? 1 : 0, Math.round(words / 250)) };
}

/** Fill the count cache for at most `budgetMs`; true when every block is counted. The
 * first count of a large document runs in slices so typing is not held up (Q-027 follow-up). */
export function warmCounts(doc: Node, defs: Definitions, opts: EditorOptions, budgetMs: number): boolean {
  const key = JSON.stringify(opts);
  if (cacheKey[0] !== defs || cacheKey[1] !== key) {
    cache = new WeakMap();
    cacheKey = [defs, key];
  }
  const end = performance.now() + budgetMs;
  let done = true;
  doc.descendants((node) => {
    if (!done) return false;
    if (!node.isTextblock) return node.type.name !== "front_matter";
    if (node.type.name === "front_matter" || cache.has(node)) return false;
    const b = blockText(node, 0, node.content.size, defs, opts);
    cache.set(node, { words: countWords(b.text), chars: chars(b.text), charsNoSpaces: chars(b.text.replace(/\s/g, "")), paragraph: !!b.text.trim(), code: b.code });
    if (performance.now() > end) done = false;
    return false;
  });
  return done;
}
