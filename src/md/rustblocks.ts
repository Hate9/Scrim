// When the block tree Rust parses for a whole document (Q-026, `crates/scrim-core/src/
// blocks.rs`) gives the same document as the frontend's own parse. Rust parses CommonMark
// with Scrim's extensions; it does not know two settings that change block structure:
// strict mode off (`lenient.ts`) and registered custom block tags (17). A document with a
// line either could affect is parsed by the frontend instead. The checks are conservative
// (a line that merely looks affected sends the document to the frontend), never the other
// way round; `rustparity.test.ts` checks the result for the corpus.

import type { Root } from "mdast";
import { dialect } from "./mdast";
import { customTags } from "./customtags";

/** Optional container prefixes before a line's content: quote markers, list markers. */
const PREFIX = String.raw`(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*`;
const LAX_HEADING = new RegExp(`^${PREFIX}#{1,6}\\p{L}`, "u");
const ORDERED = new RegExp(`^${PREFIX}?(\\d{1,9})[.)](?:[ \\t]|$)`);

export interface DialectInfo {
  strict: boolean;
  /** Registered custom block tag names (lowercase). */
  customBlockTags: readonly string[];
}

export function rustTreeApplies(text: string, d: DialectInfo): boolean {
  let tagRe: RegExp | null = null;
  if (d.customBlockTags.length) {
    const names = d.customBlockTags.map((t) => t.replace(/[^a-z0-9-]/gi, "")).filter(Boolean);
    if (names.length) tagRe = new RegExp(`^${PREFIX}</?(?:${names.join("|")})(?=[\\s/>]|$)`, "i");
  }
  if (d.strict && !tagRe) return true;
  let prevBlank = true;
  for (const line of text.split(/\r\n?|\n/)) {
    if (tagRe && tagRe.test(line)) return false;
    if (!d.strict) {
      if (LAX_HEADING.test(line)) return false;
      const m = ORDERED.exec(line);
      if (m && !prevBlank && m[1] !== "1") return false;
    }
    prevBlank = !line.trim();
  }
  return true;
}


/** The Rust block tree for `text`, when it gives the frontend's own document (else the
 * frontend parses). */
export function usableTree(text: string, tree: unknown): Root | undefined {
  const t = tree as (Root & { unsure?: boolean }) | null | undefined;
  if (!t || t.type !== "root" || t.unsure) return undefined;
  return rustTreeApplies(text, { strict: dialect.strict, customBlockTags: [...customTags.block] }) ? t : undefined;
}

// ---- compact encoding (Q-027; the format is described in crates/scrim-core/src/blocks.rs)

const TYPES = [
  "root", "paragraph", "heading", "thematicBreak", "blockquote", "list", "listItem", "code", "math", "yaml", "toml", "html", "table", "tableRow",
  "tableCell", "footnoteDefinition", "definition", "text", "break", "link", "unknown",
];
/** Types that have children (an empty array when they have none). */
const PARENTS = new Set(["root", "paragraph", "heading", "blockquote", "list", "listItem", "table", "tableRow", "tableCell", "footnoteDefinition", "link"]);
const NONE = 0xffffffff;
const ALIGN = [null, "left", "right", "center"];

type Mutable = Record<string, unknown>;

/** Decode an encoded block tree (`bytes` from offset `at`); null when empty or invalid. */
export function decodeTree(bytes: ArrayBuffer, at = 0): (Root & { unsure?: boolean }) | null {
  if (bytes.byteLength - at < 16) return null;
  const head = new Uint8Array(bytes, at, 4);
  if (String.fromCharCode(...head) !== "SBT1") return null;
  const dv = new DataView(bytes, at);
  const flags = dv.getUint32(4, true);
  const strLen = dv.getUint32(12, true);
  const wordsBytes = bytes.byteLength - at - 16 - strLen * 2;
  // Words may not be 4-aligned in the buffer: copy them into an aligned array.
  const words = new Uint32Array(new Uint8Array(bytes, at + 16, wordsBytes).slice().buffer);
  const table = new TextDecoder("utf-16le").decode(new Uint8Array(bytes, at + 16 + wordsBytes, strLen * 2));
  let i = 0;
  const str = (): string | null => {
    const s = words[i++];
    const n = words[i++];
    return s === NONE ? null : table.slice(s, s + n);
  };
  const node = (): Mutable => {
    const type = TYPES[words[i++]] ?? "unknown";
    const start = words[i++];
    const end = words[i++];
    const line = words[i++];
    const count = words[i++];
    const n: Mutable = { type, position: { start: { line, offset: start }, end: { offset: end } } };
    switch (type) {
      case "heading":
        n.depth = words[i++];
        break;
      case "list": {
        n.ordered = words[i++] === 1;
        const s = words[i++];
        n.start = s === NONE ? null : s;
        n.spread = words[i++] === 1;
        break;
      }
      case "listItem": {
        const c = words[i++];
        n.checked = c === 2 ? null : c === 1;
        break;
      }
      case "code":
        n.value = str();
        n.lang = str();
        n.meta = str();
        break;
      case "math":
        n.value = str();
        n.meta = str();
        break;
      case "yaml":
      case "toml":
      case "html":
      case "text":
        n.value = str();
        break;
      case "table": {
        const k = words[i++];
        const align: (string | null)[] = [];
        for (let a = 0; a < k; a++) align.push(ALIGN[words[i++]] ?? null);
        n.align = align;
        break;
      }
      case "footnoteDefinition":
        n.identifier = str();
        n.label = str();
        break;
      case "definition":
        n.identifier = str();
        n.label = str();
        n.url = str();
        n.title = str();
        break;
      case "link":
        n.url = str();
        break;
    }
    if (count || PARENTS.has(type)) {
      const children: Mutable[] = [];
      for (let c = 0; c < count; c++) children.push(node());
      n.children = children;
    }
    return n;
  };
  const root = node() as unknown as Root & { unsure?: boolean };
  if (flags & 1) root.unsure = true;
  return root;
}

/** A reply of a JSON header followed by an encoded tree (`reply_with_tree` in Rust). */
export function decodeReply<T>(bytes: ArrayBuffer): { header: T; tree: (Root & { unsure?: boolean }) | null } {
  const len = new DataView(bytes).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 4, len))) as T;
  return { header, tree: decodeTree(bytes, 4 + len) };
}
