// Keeps round-trip identities sound after structural edits.
//
// ProseMirror copies a node's attributes when it splits it (Enter in a paragraph, a new
// list item), which would give two blocks the same uid and the same stored source
// prefixes. After any structural change, every block node gets a unique uid: of two
// copies, the one that keeps the original identity is the first, unless the first is
// empty and the second is not (Enter at the start of a block). The other copy becomes a
// new node, written canonically by the serializer.

import type { Node } from "prosemirror-model";
import { Plugin, type Transaction } from "prosemirror-state";
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from "prosemirror-transform";
import { freshUid } from "../md/schema";

const NEW_LEAF = { sep: null, prev: null, lead: null, marks: null, sig: null };

/** True if the transaction may have changed block structure (not just inline text). */
export function isStructural(tr: Transaction): boolean {
  for (const step of tr.steps) {
    // Mark steps (presentation marks, automatic escapes' marks) never change structure.
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) continue;
    if (!(step instanceof ReplaceStep)) return true;
    const { from, to, slice } = step as unknown as { from: number; to: number; slice: { openStart: number; openEnd: number; content: { forEach(f: (n: Node) => void): void } } };
    if (slice.openStart || slice.openEnd) return true;
    let block = false;
    slice.content.forEach((n) => {
      if (!n.isInline) block = true;
    });
    if (block) return true;
    const doc = tr.docs[tr.steps.indexOf(step)];
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    if ($from.parent !== $to.parent) return true;
  }
  return false;
}

/**
 * Attributes for a node that becomes new. `split` marks the second copy of a node that
 * ProseMirror split in two: an ordered list split around a lifted item (Q-009) then
 * continues from the number its first item already has in the source.
 */
export function freshAttrs(node: Node, split = false): Record<string, unknown> {
  const attrs: Record<string, unknown> = { ...node.attrs, uid: freshUid() };
  if (node.isLeaf || node.isTextblock) Object.assign(attrs, NEW_LEAF);
  if (node.type.name === "list_item") attrs.marker = null;
  if (node.type.name === "heading") Object.assign(attrs, { open: null, openLevel: null, close: "", setext: null });
  if (node.type.name === "bullet_list" || node.type.name === "ordered_list") attrs.items = null;
  if (split && node.type.name === "ordered_list") {
    const n = parseInt(node.firstChild?.attrs.marker ?? "", 10);
    if (!Number.isNaN(n)) attrs.start = n;
  }
  return attrs;
}

export function createNormalizePlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged && isStructural(t))) return null;
      const byUid = new Map<number, { pos: number; node: Node }[]>();
      const missing: { pos: number; node: Node }[] = [];
      state.doc.descendants((node, pos) => {
        if (!node.isBlock) return false;
        const uid = node.attrs.uid as number | null | undefined;
        if (uid === undefined) return true;
        if (uid === null) missing.push({ pos, node });
        else {
          const list = byUid.get(uid) ?? [];
          list.push({ pos, node });
          byUid.set(uid, list);
        }
        return true;
      });
      const renew: { pos: number; node: Node; split?: boolean }[] = [...missing];
      for (const list of byUid.values()) {
        if (list.length < 2) continue;
        let keep = 0;
        if (list[0].node.content.size === 0 && list[0].node.isTextblock) {
          const other = list.findIndex((x) => x.node.content.size > 0);
          if (other > 0) keep = other;
        }
        list.forEach((x, i) => {
          if (i !== keep) renew.push({ ...x, split: true });
        });
      }
      if (!renew.length) return null;
      const tr = state.tr;
      for (const { pos, node, split } of renew) tr.setNodeMarkup(pos, undefined, freshAttrs(node, split));
      return tr;
    },
  });
}
