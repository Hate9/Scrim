// The rendered text of a heading and its id (spec 02, "Heading IDs"), shared by the
// parser (ids are set when a document is built) and the headings plugin (ids of edited
// headings).

import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import type { Node } from "prosemirror-model";
import { parseMdast } from "./mdast";

const textCache = new WeakMap<Node, string>();

/** Rendered (plain) text of a heading. */
export function headingText(node: Node): string {
  let t = textCache.get(node);
  if (t === undefined) {
    const src = node.textBetween(0, node.content.size, undefined, "\n");
    // Most headings are plain words: nothing for the inline parser to do (PF-1, a 1 MB
    // document has thousands of headings).
    if (/^[\p{L}\p{N} ,.;?'"()/%+-]*$/u.test(src) && !/ {2,}$/.test(src)) t = textOfPlain(src);
    else {
      const root = parseMdast(src, { frontMatter: false });
      t = toString(root.children[0] ?? root);
    }
    textCache.set(node, t);
  }
  return t;
}

/** The rendered text of a heading whose source has no inline syntax. */
export function textOfPlain(src: string): string {
  // The heading's own text (markers are not part of the block source); CommonMark
  // strips leading and trailing spaces and collapses nothing else.
  return src.replace(/^[ \t]+|[ \t]+$/g, "");
}

export { GithubSlugger };
