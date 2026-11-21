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

export interface ParseOptions {
  /** Inline `$…$` math (Preferences → Markdown, default off). */
  inlineMath?: boolean;
  /** Parse YAML front matter at the start (only for whole documents). */
  frontMatter?: boolean;
}

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
  const mdastExtensions = [
    gfmAutolinkLiteralFromMarkdown(),
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
  return fromMarkdown(src, { extensions, mdastExtensions });
}

/** Structural fingerprint of a node: types, values, urls; no positions, line endings
 * normalized to LF. */
export function fingerprint(node: Nodes): string {
  return JSON.stringify(node, (key, value) =>
    key === "position" ? undefined : typeof value === "string" ? value.replace(/\r\n?/g, "\n") : value,
  );
}
