// Syntax reveal and cursor movement over marker runs (spec 03, 3.2).
//
// - Expanded elements (cursor or a selection endpoint strictly inside) get `md-expand`;
//   the textblock holding the cursor gets `md-focus`. Classes are toggled directly on
//   the DOM with ProseMirror's DOM observer paused, so no decoration changes.
// - ArrowLeft/ArrowRight (with or without Shift) cross each marker run in one step.
// - Any other selection change that lands strictly inside a marker run of a collapsed
//   element snaps to the run's content side (rule 7a).

import type { Node } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { flatten, type InlineElement } from "../md/inline";
import { elementsOf, isProse, type EditorOptions } from "./context";
import { inlineKey } from "./decorations";

export const STEP_META = "scrim-step";

interface BlockAt {
  node: Node;
  /** position of the block's content start */
  start: number;
  /** position before the block */
  pos: number;
  els: InlineElement[];
}

function blockAt(state: EditorState, pos: number, opts: EditorOptions): BlockAt | null {
  const $p = state.doc.resolve(pos);
  const node = $p.parent;
  if (!isProse(node)) return null;
  const defs = inlineKey.getState(state)?.defs;
  if (!defs) return null;
  return { node, start: $p.start(), pos: $p.before(), els: flatten(elementsOf(node, defs, opts)) };
}

/** Indices (into the flattened list) of elements expanded by offset `off`. */
function expandedAt(els: InlineElement[], off: number): number[] {
  const out: number[] = [];
  els.forEach((e, i) => {
    if (e.from < off && off < e.to) out.push(i);
  });
  return out;
}

export function expandedElements(state: EditorState, opts: EditorOptions): Map<number, Set<number>> {
  const result = new Map<number, Set<number>>();
  const { anchor, head } = state.selection;
  for (const p of anchor === head ? [head] : [anchor, head]) {
    const b = blockAt(state, p, opts);
    if (!b) continue;
    const set = result.get(b.pos) ?? new Set<number>();
    for (const i of expandedAt(b.els, p - b.start)) set.add(i);
    result.set(b.pos, set);
  }
  return result;
}

interface DomObserverLike {
  stop(): void;
  start(): void;
}

class RevealView {
  private marked: Element[] = [];

  constructor(view: EditorView, private opts: EditorOptions) {
    this.update(view);
  }

  update(view: EditorView) {
    const observer = (view as unknown as { domObserver: DomObserverLike }).domObserver;
    observer.stop();
    try {
      for (const el of this.marked) el.classList.remove("md-expand", "md-focus", "md-focus-container");
      this.marked = [];
      const state = view.state;
      for (const [pos, set] of expandedElements(state, this.opts)) {
        const dom = view.nodeDOM(pos);
        if (!(dom instanceof HTMLElement)) continue;
        for (const i of set) {
          dom.querySelectorAll(`[data-el="${i}"]`).forEach((el) => {
            el.classList.add("md-expand");
            this.marked.push(el);
          });
        }
      }
      const $head = state.selection.$head;
      if ($head.parent.isTextblock) {
        const dom = view.nodeDOM($head.before());
        if (dom instanceof HTMLElement) {
          dom.classList.add("md-focus");
          this.marked.push(dom);
        }
        // The nearest enclosing list item is the focus container (10.3); quotes are not.
        for (let d = $head.depth - 1; d > 0; d--) {
          if ($head.node(d).type.name !== "list_item") continue;
          const li = view.nodeDOM($head.before(d));
          if (li instanceof HTMLElement) {
            li.classList.add("md-focus-container");
            this.marked.push(li);
          }
          break;
        }
      }
    } finally {
      observer.start();
    }
  }
}

function isHighSurrogate(c: number) {
  return c >= 0xd800 && c <= 0xdbff;
}
function isLowSurrogate(c: number) {
  return c >= 0xdc00 && c <= 0xdfff;
}

/** Next cursor offset moving one step in `dir` inside a block (null = leave block). */
export function stepOffset(node: Node, els: InlineElement[], off: number, dir: 1 | -1): number | null {
  const size = node.content.size;
  if (dir > 0 && off >= size) return null;
  if (dir < 0 && off <= 0) return null;
  for (const e of els) {
    for (const [a, b] of e.runs) {
      if (dir > 0 && a === off && b > a) return b;
      if (dir < 0 && b === off && a < b) return a;
    }
  }
  const text = node.textBetween(0, size, undefined, "\n");
  if (dir > 0) return isHighSurrogate(text.charCodeAt(off)) && isLowSurrogate(text.charCodeAt(off + 1)) ? off + 2 : off + 1;
  return isLowSurrogate(text.charCodeAt(off - 1)) && isHighSurrogate(text.charCodeAt(off - 2)) ? off - 2 : off - 1;
}

export function arrowCommand(opts: EditorOptions, dir: 1 | -1, extend: boolean) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const sel = state.selection;
    if (!(sel instanceof TextSelection)) return false;
    if (!extend && !sel.empty) return false;
    const b = blockAt(state, sel.head, opts);
    if (!b) return false;
    const next = stepOffset(b.node, b.els, sel.head - b.start, dir);
    if (next === null) return false;
    if (dispatch) {
      const head = b.start + next;
      const tr = state.tr.setSelection(TextSelection.create(state.doc, extend ? sel.anchor : head, head));
      dispatch(tr.setMeta(STEP_META, true).scrollIntoView());
    }
    return true;
  };
}

/** Position `p` snapped out of collapsed marker runs, or null if no snap is needed. */
function snap(state: EditorState, p: number, collapsedCheck: (b: BlockAt, i: number) => boolean, opts: EditorOptions): number | null {
  const b = blockAt(state, p, opts);
  if (!b) return null;
  const off = p - b.start;
  for (let i = 0; i < b.els.length; i++) {
    const e = b.els[i];
    for (const [a, c] of e.runs) {
      if (a < off && off < c && collapsedCheck(b, i)) {
        return b.start + (c <= e.contentFrom ? c : a);
      }
    }
  }
  return null;
}

/**
 * Rule 7: a click that lands on a boundary next to hidden (collapsed) markers resolves
 * to the content side. Where two elements meet, the side under the pointer wins (7b).
 */
export function clickTarget(view: EditorView, pos: number, clientX: number, opts: EditorOptions): number | null {
  const b = blockAt(view.state, pos, opts);
  if (!b) return null;
  const expanded = expandedElements(view.state, opts).get(b.pos) ?? new Set<number>();
  let off = pos - b.start;
  let changed = false;
  for (let guard = 0; guard < 8; guard++) {
    const left = b.els.findIndex((e, i) => e.to === off && !expanded.has(i) && !e.replace && e.contentTo < e.to);
    const right = b.els.findIndex((e, i) => e.from === off && !expanded.has(i) && !e.replace && e.contentFrom > e.from);
    let next: number | null = null;
    if (left >= 0 && right >= 0) {
      const x = view.coordsAtPos(b.start + b.els[right].contentFrom, 1).left;
      next = clientX < x ? b.els[left].contentTo : b.els[right].contentFrom;
    } else if (right >= 0) next = b.els[right].contentFrom;
    else if (left >= 0) next = b.els[left].contentTo;
    if (next === null || next === off) break;
    off = next;
    changed = true;
  }
  return changed ? b.start + off : null;
}

export const revealKey = new PluginKey("scrim-reveal");

export function createRevealPlugin(opts: EditorOptions): Plugin {
  return new Plugin({
    key: revealKey,
    view: (view) => new RevealView(view, opts),
    props: {
      handleClick(view, pos, event) {
        if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
        const target = clickTarget(view, pos, event.clientX, opts);
        if (target === null) return false;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)).setMeta(STEP_META, true));
        return true;
      },
    },
    appendTransaction(trs, oldState, newState) {
      if (trs.some((t) => t.docChanged || t.getMeta(STEP_META))) return null;
      if (!trs.some((t) => t.selectionSet)) return null;
      const sel = newState.selection;
      if (!(sel instanceof TextSelection)) return null;
      const before = expandedElements(oldState, opts);
      const wasCollapsed = (b: BlockAt, i: number) => !(before.get(b.pos)?.has(i) ?? false);
      const anchor = snap(newState, sel.anchor, wasCollapsed, opts);
      const head = snap(newState, sel.head, wasCollapsed, opts);
      if (anchor === null && head === null) return null;
      return newState.tr
        .setSelection(TextSelection.create(newState.doc, anchor ?? sel.anchor, head ?? sel.head))
        .setMeta(STEP_META, true);
    },
  });
}

