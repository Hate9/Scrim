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
