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
    const root = parseMdast(blockSource(node), { frontMatter: false });
    t = toString(root.children[0] ?? root);
    textCache.set(node, t);
  }
  return t;
}

export interface HeadingInfo {
  pos: number;
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
      out.push({ pos, level: node.attrs.level, text, id: slugger.slug(text) });
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
    list.map((h) => Decoration.node(h.pos, h.pos + doc.nodeAt(h.pos)!.nodeSize, { id: h.id })),
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
