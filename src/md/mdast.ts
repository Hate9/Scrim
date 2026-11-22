// Markdown parser configuration (spec 02): CommonMark + GFM (tables, strikethrough,
// autolink literals, footnotes, task list items) + front matter + math.

import type { Root, Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { mathFromMarkdown } from "mdast-util-math";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { math } from "micromark-extension-math";
import { lenient } from "./lenient";

/** Strict mode (Preferences → Markdown, default on). Off: the lenient forms of spec 02
 * (`lenient.ts`). One setting for every parse in the window; the app reloads the
 * document when it changes. */
export const dialect = { strict: true };

export interface ParseOptions {
  /** Inline `$…$` math (Preferences → Markdown, default off). */
  inlineMath?: boolean;
  /** Parse YAML front matter at the start (only for whole documents). */
  frontMatter?: boolean;
  /**
   * Block structure only (whole documents): inline constructs are not tokenized, so
   * paragraphs, headings, and cells hold one text node with their raw content. CommonMark
   * determines block structure before and independently of inline content, so the blocks
   * are the same; parsing is several times faster. Task list checks stay (they decide a
   * list item's kind).
   */
  blockOnly?: boolean;
  /** The document's block tree, already parsed by Rust (Q-026; whole documents only). */
  blockTree?: Root;
}

const INLINE_CONSTRUCTS = [
  "attention",
  "autolink",
  "characterEscape",
  "characterReference",
  "codeText",
  "hardBreakEscape",
  "htmlText",
  "labelEnd",
  "labelStartImage",
  "labelStartLink",
  "emailAutolink",
  "protocolAutolink",
  "wwwAutolink",
  "gfmFootnoteCall",
  "gfmPotentialFootnoteCall",
  "mathText",
  "strikethrough",
];

export function parseMdast(src: string, opts: ParseOptions = {}): Root {
  const extensions = [
    gfmAutolinkLiteral(),
    gfmFootnote(),
    gfmStrikethrough({ singleTilde: false }),
    gfmTable(),
    gfmTaskListItem(),
    // Block math `$$` is always on; inline math only when enabled.
    math({ singleDollarTextMath: !!opts.inlineMath }),
  ];
  const literalLinks = gfmAutolinkLiteralFromMarkdown();
  const mdastExtensions = [
    literalLinks,
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
    mathFromMarkdown(),
  ];
  if (opts.frontMatter !== false) {
    extensions.unshift(frontmatter(["yaml"]));
    mdastExtensions.unshift(frontmatterFromMarkdown(["yaml"]));
  }
  if (!dialect.strict) extensions.unshift(lenient);
  if (opts.blockOnly) {
    extensions.push({ disable: { null: INLINE_CONSTRUCTS } });
    // Literal URLs are found by an mdast transform that rebuilds the inline children
    // without positions (headings and table cells need them); block structure never
    // depends on them, and the inline analyzer finds them itself.
    mdastExtensions.splice(mdastExtensions.indexOf(literalLinks), 1);
  }
  return fromMarkdown(src, { extensions, mdastExtensions });
}

/** Structural fingerprint of a node: types, values, urls; no positions, line endings
 * normalized to LF. */
export function fingerprint(node: Nodes): string {
  return JSON.stringify(node, (key, value) =>
    key === "position" ? undefined : typeof value === "string" ? value.replace(/\r\n?/g, "\n") : value,
  );
}
