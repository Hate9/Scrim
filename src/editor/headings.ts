// Heading ids (spec 02, "Heading IDs"): GitHub-style slugs from the heading's rendered
// text, with -1, -2 suffixes for duplicates. Stored in the heading's `id` attribute by
// an appended transaction that is not in the history and does not make the document
// dirty (like the presentation marks). Not decorations: ProseMirror scans every
// root-level decoration for each top-level block on every update, and a large document
// has thousands of headings (QA-LOG Q-027).

import { GithubSlugger, headingText } from "../md/headingtext";
import type { Node } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { changedRanges } from "./decorations";
import { isStructural } from "./normalize";

export { headingText, textOfPlain } from "../md/headingtext";

export interface HeadingInfo {
  pos: number;
  /** the heading node's size (so its end needs no lookup) */
  size: number;
  level: number;
  text: string;
  id: string;
  /** the heading node (its `id` attribute may still be out of date) */
  node: Node;
}

export function headings(doc: Node): HeadingInfo[] {
  const slugger = new GithubSlugger();
  const out: HeadingInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const text = headingText(node);
      out.push({ pos, size: node.nodeSize, level: node.attrs.level, text, id: slugger.slug(text), node });
      return false;
    }
    return !node.isTextblock;
  });
  return out;
}

export const headingKey = new PluginKey<{ list: HeadingInfo[]; rebuilt: boolean }>("scrim-headings");
export const HEADING_IDS_META = "scrim-heading-ids";

function build(doc: Node) {
  return { list: headings(doc), rebuilt: true };
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
        // `rebuilt` stays until the ids are written (by the appended transaction).
        // (Its nodes stay the old ones: only a rebuild, which reads the new ones, compares.)
        if (tr.getMeta(HEADING_IDS_META)) return { list: value.list, rebuilt: false };
        if (!tr.docChanged) return value;
        if (headingsUntouched(tr)) {
          return { rebuilt: value.rebuilt, list: value.list.map((h) => ({ ...h, pos: tr.mapping.map(h.pos) })) };
        }
        return build(tr.doc);
      },
    },
    appendTransaction(_trs, _old, state) {
      const st = headingKey.getState(state);
      if (!st?.rebuilt) return null;
      const tr = state.tr;
      for (const h of st.list) if (h.node.attrs.id !== h.id) tr.setNodeAttribute(h.pos, "id", h.id);
      // Even without changes: the meta clears `rebuilt`.
      return tr.setMeta(HEADING_IDS_META, true).setMeta("addToHistory", false);
    },
  });
}
