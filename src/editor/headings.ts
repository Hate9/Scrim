// Heading ids (spec 02, "Heading IDs"): GitHub-style slugs from the heading's rendered
// text, with -1, -2 suffixes for duplicates. Applied as node decorations so the
// document itself is not changed.

import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import type { Node } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { parseMdast } from "../md/mdast";
import { blockSource } from "./context";
import { changedRanges } from "./decorations";
import { isStructural } from "./normalize";

const textCache = new WeakMap<Node, string>();

/** Rendered (plain) text of a heading. */
export function headingText(node: Node): string {
  let t = textCache.get(node);
  if (t === undefined) {
    const src = blockSource(node);
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
function textOfPlain(src: string): string {
  // The heading's own text (markers are not part of the block source); CommonMark
  // strips leading and trailing spaces and collapses nothing else.
  return src.replace(/^[ \t]+|[ \t]+$/g, "");
}

export interface HeadingInfo {
  pos: number;
  /** the heading node's size (so its end needs no lookup) */
  size: number;
  level: number;
  text: string;
  id: string;
}

export function headings(doc: Node): HeadingInfo[] {
  const slugger = new GithubSlugger();
  const out: HeadingInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const text = headingText(node);
      out.push({ pos, size: node.nodeSize, level: node.attrs.level, text, id: slugger.slug(text) });
      return false;
    }
    return !node.isTextblock;
  });
  return out;
}

export const headingKey = new PluginKey<{ set: DecorationSet; list: HeadingInfo[] }>("scrim-headings");

function build(doc: Node) {
  const list = headings(doc);
  const set = DecorationSet.create(
    doc,
    list.map((h) => Decoration.node(h.pos, h.pos + h.size, { id: h.id })),
  );
  return { set, list };
}

/** Typing inside non-heading blocks cannot change heading ids: just map positions. */
function headingsUntouched(tr: Transaction): boolean {
  if (isStructural(tr)) return false;
  for (const [from, to] of changedRanges(tr)) {
    let heading = false;
    tr.doc.nodesBetween(Math.min(from, tr.doc.content.size), Math.min(to, tr.doc.content.size), (n) => {
      if (n.type.name === "heading") heading = true;
      return !heading && !n.isTextblock;
    });
    if (heading) return false;
  }
  return true;
}

export function createHeadingPlugin(): Plugin {
  return new Plugin({
    key: headingKey,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, value) => {
        if (!tr.docChanged) return value;
        if (headingsUntouched(tr)) {
          return {
            set: value.set.map(tr.mapping, tr.doc),
            list: value.list.map((h) => ({ ...h, pos: tr.mapping.map(h.pos) })),
          };
        }
        return build(tr.doc);
      },
    },
    props: {
      decorations: (state) => headingKey.getState(state)?.set,
    },
  });
}
