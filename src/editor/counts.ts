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
    const a = Math.max(0, from - pos - 1);
    const b = Math.min(node.content.size, to - pos - 1);
    if (isProse(node)) {
      const proj = project(node, flatten(elementsOf(node, defs, opts)));
      let t = "";
      for (let i = 0; i < proj.text.length; i++) if (proj.from[i] >= a && proj.to[i] <= b) t += proj.text[i];
      out.push({ text: t, code: false });
    } else {
      out.push({ text: node.textBetween(a, b, undefined, "\n"), code: node.type.name !== "html_block" && node.type.name !== "raw" });
    }
    return false;
  });
  return out;
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
