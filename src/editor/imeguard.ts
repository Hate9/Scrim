// A composition never changes the blocks it is typed in (E-9, owner's log on cc0dbcb).
// When an input method commits, WebKitGTK first deletes the composition text; that
// leaves an empty heading (or list item, quote, table cell), and WebKit's own editing
// replaces the empty element with <p><br></p> before inserting the committed text there.
// ProseMirror reads that DOM and the heading has become a paragraph.
//
// So: at compositionstart the document and selection are recorded; after compositionend
// the result should be that document with the committed text in place of the selection.
// When the document has exactly that text but other blocks, the changed range is replaced
// by the expected content (structure as before, the committed text in it). When the text
// differs (the input method did something else), nothing is touched.

import { Plugin, TextSelection } from "prosemirror-state";
import { Transform } from "prosemirror-transform";
import type { Node } from "prosemirror-model";

interface Start {
  doc: Node;
  from: number;
  to: number;
}
interface Pending extends Start {
  data: string;
  until: number;
}

/** Block structure: the type (and heading level) of every non-text node, in order. */
function shape(doc: Node): string {
  const out: string[] = [];
  doc.descendants((n) => {
    if (!n.isText) out.push(n.type.name + (n.attrs.level != null ? `:${n.attrs.level}` : ""));
    return true;
  });
  return out.join(",");
}

const text = (doc: Node) => doc.textBetween(0, doc.content.size, "\n", "\n");

/** The recorded document with `data` typed over the recorded selection. */
function expected(p: Pending): Node | null {
  try {
    const t = new Transform(p.doc);
    if (p.data) t.replaceWith(p.from, p.to, p.doc.type.schema.text(p.data, p.doc.resolve(p.from).marks()));
    else if (p.to > p.from) t.delete(p.from, p.to);
    return t.doc;
  } catch {
    return null;
  }
}

export function createImeGuardPlugin(): Plugin {
  let start: Start | null = null;
  let pending: Pending | null = null;
  let composing = false;
  return new Plugin({
    props: {
      handleDOMEvents: {
        compositionstart(view) {
          composing = true;
          if (!start) {
            const { from, to } = view.state.selection;
            start = { doc: view.state.doc, from, to };
          }
          return false;
        },
        compositionend(view, event) {
          composing = false;
          if (start) pending = { ...start, data: (event as CompositionEvent).data ?? "", until: Date.now() + 1000 };
          start = null;
          // ProseMirror reads the committed text shortly after; check once more after that
          // in case no transaction follows.
          window.setTimeout(() => {
            if (pending && !view.isDestroyed) view.dispatch(view.state.tr.setMeta("addToHistory", false));
          }, 80);
          return false;
        },
        blur() {
          // A composition cut short: no compositionend will come.
          if (!composing) start = null;
          return false;
        },
      },
    },
    appendTransaction(_trs, _old, state) {
      const p = pending;
      if (!p || composing) return null;
      if (Date.now() > p.until) {
        pending = null;
        return null;
      }
      const want = expected(p);
      if (!want || text(state.doc) !== text(want)) return null; // not there yet, or something else
      pending = null;
      if (shape(state.doc) === shape(want)) return null;
      const a = state.doc.content.findDiffStart(want.content);
      const b = state.doc.content.findDiffEnd(want.content);
      if (a == null || !b) return null;
      let { a: endA, b: endB } = b;
      const overlap = a - Math.min(endA, endB);
      if (overlap > 0) {
        endA += overlap;
        endB += overlap;
      }
      const tr = state.tr.replace(a, endA, want.slice(a, endB));
      const at = Math.min(p.from + p.data.length, tr.doc.content.size);
      try {
        tr.setSelection(TextSelection.create(tr.doc, at));
      } catch {
        /* keep the mapped selection */
      }
      return tr;
    },
  });
}
