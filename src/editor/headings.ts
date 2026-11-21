// Heading ids (spec 02, "Heading IDs"): GitHub-style slugs from the heading's rendered
// text, with -1, -2 suffixes for duplicates. Applied as node decorations so the
// document itself is not changed.

import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import type { Node } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { parseMdast } from "../md/mdast";
import { blockSource } from "./context";

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

export function createHeadingPlugin(): Plugin {
  return new Plugin({
    key: headingKey,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, value) => (tr.docChanged ? build(tr.doc) : value),
    },
    props: {
      decorations: (state) => headingKey.getState(state)?.set,
    },
  });
}
