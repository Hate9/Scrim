// Viewport-only rendering of large documents (QA-LOG Q-027).
//
// Only the top-level blocks near the viewport are rendered: at least one screen above
// and below what is visible, plus the blocks that hold the selection's ends. Every other
// top-level block is a placeholder: the block's own outer element (same tag, classes and
// attributes, so theme counters still count it and sibling selectors still see a real
// neighbour), empty, non-editable, and as tall as the block was when it was last
// rendered, or an estimate until it has been. The document model stays complete; find,
// spell check, counts, outline, copy and export work from the model.
//
// Which blocks are rendered is a decoration (`scrimRendered`) on each rendered top-level
// block: a block whose decoration appears or disappears gets a new node view (real or
// placeholder). Only rendered blocks carry one, so there are about a hundred: ProseMirror
// scans the root-level decorations for every top-level child on each update.
//
// Documents under VIRTUAL_MIN_BLOCKS top-level blocks render whole, exactly as before.

import { DOMSerializer, type Node, type Schema } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView, type NodeView, type NodeViewConstructor } from "prosemirror-view";

/** Viewport-only rendering starts at this many top-level blocks (tuning: DESIGN.md, P8),
 * and stops again below VIRTUAL_OFF_BLOCKS (no switching back and forth while editing
 * around the threshold). */
export const VIRTUAL_MIN_BLOCKS = 1000;
const VIRTUAL_OFF_BLOCKS = 750;
/** Blocks rendered before the first measurement (the top of the document). */
const INITIAL_BLOCKS = 120;
/** Rendered margin above and below the visible area, in screens; the window moves when
 * the visible area comes within REFILL screens of its edge. */
const MARGIN = 1.5;
const REFILL = 0.5;

export interface ViewportState {
  on: boolean;
  /** Rendered window, as document positions (start of its first block, end of its last). */
  from: number;
  to: number;
  /** Start positions of the top-level blocks. */
  starts: number[];
  set: DecorationSet;
}

export const viewportKey = new PluginKey<ViewportState>("scrim-viewport");
const WINDOW_META = "scrim-viewport-window";
const MODE_META = "scrim-viewport-mode";
/** Test hook and tuning: the block count at which rendering becomes viewport-only. */
export const viewportConfig = { min: VIRTUAL_MIN_BLOCKS, off: VIRTUAL_OFF_BLOCKS, forceOff: false };

function topStarts(doc: Node): number[] {
  const out: number[] = new Array(doc.childCount);
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    out[i] = pos;
    pos += doc.child(i).nodeSize;
  }
  return out;
}

/** Index of the top-level block containing `pos` (or starting at it). */
function indexAt(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function isTopStart(starts: number[], pos: number): boolean {
  const i = indexAt(starts, pos);
  return starts[i] === pos;
}

const RENDERED = { scrimRendered: true };

function renderedSet(doc: Node, starts: number[], from: number, to: number, state: EditorState | null): DecorationSet {
  if (!doc.childCount) return DecorationSet.empty;
  const idx = new Set<number>();
  const a = indexAt(starts, from);
  const b = indexAt(starts, Math.max(from, to - 1));
  for (let i = a; i <= b; i++) idx.add(i);
  if (state) {
    const sel = state.selection;
    idx.add(indexAt(starts, Math.min(sel.anchor, doc.content.size - 1)));
    idx.add(indexAt(starts, Math.min(sel.head, doc.content.size - 1)));
  }
  const decos = [...idx]
    .sort((x, y) => x - y)
    .map((i) => Decoration.node(starts[i], starts[i] + doc.child(i).nodeSize, {}, RENDERED));
  return DecorationSet.create(doc, decos);
}

function wantOn(doc: Node, was: boolean): boolean {
  if (viewportConfig.forceOff) return false;
  return was ? doc.childCount >= viewportConfig.off : doc.childCount >= viewportConfig.min;
}

/** The end of the first `n` top-level blocks. */
function endOfFirst(starts: number[], doc: Node, n: number): number {
  const i = Math.min(n, doc.childCount) - 1;
  return i < 0 ? 0 : starts[i] + doc.child(i).nodeSize;
}

export function createViewportPlugin(): Plugin<ViewportState> {
  return new Plugin<ViewportState>({
    key: viewportKey,
    state: {
      init(_, state) {
        const doc = state.doc;
        const on = wantOn(doc, false);
        const starts = topStarts(doc);
        const to = endOfFirst(starts, doc, INITIAL_BLOCKS);
        return { on, from: 0, to, starts, set: on ? renderedSet(doc, starts, 0, to, state) : DecorationSet.empty };
      },
      apply(tr: Transaction, v: ViewportState, old: EditorState, state: EditorState) {
        const mode = tr.getMeta(MODE_META) as boolean | undefined;
        const win = tr.getMeta(WINDOW_META) as { from: number; to: number } | undefined;
        if (!tr.docChanged && mode === undefined && !win && old.selection.eq(state.selection)) return v;
        const doc = state.doc;
        const starts = tr.docChanged ? topStarts(doc) : v.starts;
        const on = mode !== undefined ? mode && wantOn(doc, true) : wantOn(doc, v.on);
        let from = win ? win.from : tr.mapping.map(v.from, -1);
        let to = win ? win.to : tr.mapping.map(v.to, 1);
        if (on && !v.on && !win) {
          from = 0;
          to = endOfFirst(starts, doc, INITIAL_BLOCKS);
        }
        from = Math.max(0, Math.min(from, doc.content.size));
        to = Math.max(from, Math.min(to, doc.content.size));
        return { on, from, to, starts, set: on ? renderedSet(doc, starts, from, to, state) : DecorationSet.empty };
      },
    },
    props: {
      decorations: (state) => viewportKey.getState(state)?.set,
    },
    view: (view) => new ViewportController(view),
  });
}

/** Turn viewport-only rendering off (export copies the whole rendered document) or back
 * on; the view redraws the blocks that change. */
export function setViewportMode(view: EditorView, on: boolean) {
  switching = true;
  try {
    view.dispatch(view.state.tr.setMeta(MODE_META, on).setMeta("addToHistory", false));
  } finally {
    switching = false;
  }
  redrawAll(view);
}

/** Set while `setViewportMode` redraws itself (the controller does not have to). */
let switching = false;

/** The node views most recently built by `viewportNodeViews` (for redraws). */
let lastViews: { base: Record<string, NodeViewConstructor>; schema: Schema } | null = null;

/**
 * Recreate every node view. Switching between viewport-only and whole rendering changes
 * what an undecorated top-level block is (placeholder or real), and ProseMirror only
 * redraws blocks whose decorations change; new node view functions make it redraw all.
 */
function redrawAll(view: EditorView) {
  if (lastViews) view.setProps({ nodeViews: viewportNodeViews(lastViews.base, lastViews.schema) });
}

/** Run `fn` with the whole document rendered (exports read the editor's DOM). */
export function withWholeDocument<T>(view: EditorView, fn: () => T): T {
  const st = viewportKey.getState(view.state);
  if (!st?.on) return fn();
  setViewportMode(view, false);
  try {
    return fn();
  } finally {
    setViewportMode(view, true);
  }
}

// ---- heights -------------------------------------------------------------------------

/** Measured border-box heights of top-level blocks (by node: nodes are immutable, so an
 * edited block is a new node, and it is on screen when it is created). */
const measured = new WeakMap<Node, number>();
/** Estimates, kept stable once made (the scrollbar should not wander). */
const estimated = new WeakMap<Node, number>();
/** Line height and characters per line, learned from measured paragraphs. */
const metrics = { line: 26, perLine: 80, ready: false };

function textLines(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) n += Math.max(1, Math.ceil(line.length / metrics.perLine));
  return n;
}

function estimate(node: Node): number {
  const known = measured.get(node) ?? estimated.get(node);
  if (known !== undefined) return known;
  let h: number;
  if (node.isTextblock) h = textLines(node.textContent) * metrics.line + (node.type.name === "heading" ? metrics.line * 0.6 : 0);
  else if (node.isLeaf) h = metrics.line;
  else if (node.type.name === "table") h = node.childCount * metrics.line * 1.4;
  else {
    h = 0;
    node.forEach((c) => (h += estimate(c) + metrics.line * 0.3));
  }
  h = Math.max(1, Math.round(h));
  estimated.set(node, h);
  return h;
}

function heightOf(node: Node): number {
  return measured.get(node) ?? estimate(node);
}

// ---- node views ----------------------------------------------------------------------

const isRendered = (outer: readonly Decoration[]) => outer.some((d) => (d.spec as { scrimRendered?: boolean }).scrimRendered);

const HEADING_MARK = "display:block;height:0;margin:0;padding:0;border:0";

function placeholder(node: Node, view: EditorView): NodeView {
  let current = node;
  const spec = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
  const dom = spec.dom as HTMLElement;
  dom.classList.add("md-virtual");
  // ProseMirror makes a view without content non-editable; 15,000 non-editable islands
  // inside the editor make WebKit's editing and layout slow. An unknown value means
  // "inherit" (HTML), and ProseMirror leaves an existing attribute alone.
  dom.setAttribute("contenteditable", "inherit");
  const target = (spec.contentDOM as HTMLElement | undefined) ?? dom;
  const fill = (n: Node) => {
    target.replaceChildren();
    // Headings inside containers keep counting (theme counters, 10.3).
    if (!n.isTextblock && !n.isLeaf) {
      n.descendants((c) => {
        if (c.type.name === "heading") {
          const h = document.createElement(`h${c.attrs.level}`);
          h.setAttribute("style", HEADING_MARK);
          h.className = "md-heading md-virtual-mark";
          target.appendChild(h);
        }
        return !c.isTextblock;
      });
    }
    dom.style.height = `${heightOf(n)}px`;
  };
  // Placeholders are empty but not hidden: in WebKit, `overflow: hidden` gives each box
  // its own layer and `visibility: hidden` made frames take about 200 ms while typing
  // (15,000 boxes). What can show of a placeholder is its own box (a quote's bar, a code
  // block's background, a heading's counter), until it is rendered.
  dom.style.boxSizing = "border-box";
  fill(node);
  return {
    dom,
    update(n, outer) {
      const st = viewportKey.getState(view.state);
      if (!st?.on || isRendered(outer) || n.type !== current.type || !n.sameMarkup(current)) return false;
      if (n !== current) fill(n);
      current = n;
      return true;
    },
    ignoreMutation: () => true,
    stopEvent: () => false,
  };
}

/** A rendered top-level block: the type's own node view, or the default rendering, that
 * turns into a placeholder when its block leaves the rendered window. */
function rendered(node: Node, make: () => NodeView | undefined): NodeView {
  const own = make();
  if (own) {
    const update = own.update?.bind(own);
    let current = node;
    own.update = (n, outer, inner) => {
      if (!isRendered(outer)) return false;
      if (update) return update(n, outer, inner);
      // Without an update method ProseMirror would redraw on any change of a view
      // without content, and keep a view with content whose markup is unchanged.
      if (!own.contentDOM) return n === current;
      if (!n.sameMarkup(current)) return false;
      current = n;
      return true;
    };
    return own;
  }
  const spec = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
  let current = node;
  return {
    dom: spec.dom,
    contentDOM: spec.contentDOM,
    update(n, outer) {
      if (!isRendered(outer) || !n.sameMarkup(current)) return false;
      current = n;
      return true;
    },
  };
}

/** Wrap the editor's node views: top-level blocks outside the rendered window become
 * placeholders while viewport-only rendering is on. */
export function viewportNodeViews(base: Record<string, NodeViewConstructor>, schema: Schema): Record<string, NodeViewConstructor> {
  lastViews = { base, schema };
  const out: Record<string, NodeViewConstructor> = {};
  for (const type of Object.values(schema.nodes)) {
    if (type.isInline || type.name === "doc" || !type.spec.toDOM) continue;
    const orig = base[type.name];
    out[type.name] = (node, view, getPos, outer, inner) => {
      const C = ((window as unknown as { __nvCalls?: Record<string, number> }).__nvCalls ??= {});
      C[type.name] = (C[type.name] ?? 0) + 1;
      const st = viewportKey.getState(view.state);
      const pos = getPos();
      const top = !!st?.on && pos !== undefined && isTopStart(st.starts, pos);
      if (!top) return orig ? orig(node, view, getPos, outer, inner) : (undefined as unknown as NodeView);
      if (!isRendered(outer)) return placeholder(node, view);
      return rendered(node, () => (orig ? orig(node, view, getPos, outer, inner) : undefined));
    };
  }
  return out;
}

// ---- following the viewport ----------------------------------------------------------

class ViewportController {
  private frame = 0;
  private scroller: HTMLElement | null;
  private onScroll = () => this.schedule();

  constructor(private view: EditorView) {
    this.scroller = view.dom.closest("content") as HTMLElement | null;
    this.scroller?.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onScroll);
    this.schedule();
  }

  update(view: EditorView, prev: EditorState) {
    this.view = view;
    if (!this.scroller) {
      this.scroller = view.dom.closest("content") as HTMLElement | null;
      this.scroller?.addEventListener("scroll", this.onScroll, { passive: true });
    }
    const st = viewportKey.getState(view.state);
    const was = viewportKey.getState(prev);
    // The document crossed the threshold (or a mode change): redraw after this update.
    if (st && was && st.on !== was.on && !this.redrawing && !switching) {
      this.redrawing = true;
      queueMicrotask(() => {
        this.redrawing = false;
        if (!view.isDestroyed) redrawAll(view);
      });
    }
    if (st?.on && (view.state.doc !== prev.doc || st !== was)) this.schedule();
  }

  private redrawing = false;

  destroy() {
    cancelAnimationFrame(this.frame);
    this.scroller?.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onScroll);
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.follow();
    });
  }

  /** The DOM element of each top-level block, in order. */
  private elements(): HTMLElement[] | null {
    const kids = this.view.dom.children;
    return kids.length === this.view.state.doc.childCount ? (Array.from(kids) as HTMLElement[]) : null;
  }

  /** Record the heights of rendered blocks, learn the text metrics, and move the window
   * when the visible area nears its edge. */
  follow() {
    const S = ((window as unknown as { __vpStats?: Record<string, number> }).__vpStats ??= { follows: 0, moves: 0, followMs: 0 });
    S.follows++;
    const t0 = performance.now();
    try {
      this.followInner();
    } finally {
      S.followMs += performance.now() - t0;
    }
  }

  private followInner() {
    const view = this.view;
    const st = viewportKey.getState(view.state);
    if (!st?.on || view.isDestroyed || view.composing || !this.scroller) return;
    const els = this.elements();
    if (!els) return;
    const doc = view.state.doc;
    const a = indexAt(st.starts, st.from);
    const b = indexAt(st.starts, Math.max(st.from, st.to - 1));
    for (let i = a; i <= b && i < els.length; i++) {
      const el = els[i];
      if (el.classList.contains("md-virtual")) continue;
      const node = doc.child(i);
      const h = el.getBoundingClientRect().height;
      measured.set(node, h);
      if (!metrics.ready && node.type.name === "paragraph" && node.textContent.length > 200) {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || metrics.line;
        const lines = Math.max(1, Math.round(h / lh));
        metrics.line = lh;
        metrics.perLine = Math.max(20, Math.round(node.textContent.length / lines));
        metrics.ready = true;
      }
    }
    const box = this.scroller.getBoundingClientRect();
    const screen = box.height || window.innerHeight;
    const topOf = (i: number) => els[i].getBoundingClientRect().top - box.top;
    const bottomOf = (i: number) => els[i].getBoundingClientRect().bottom - box.top;
    // Is the visible area (plus REFILL screens) inside the window?
    const need = [-REFILL * screen, (1 + REFILL) * screen];
    if (topOf(a) <= need[0] || a === 0) {
      if (bottomOf(b) >= need[1] || b === els.length - 1) return;
    }
    // The new window: MARGIN screens around the visible area.
    const want = [-MARGIN * screen, (1 + MARGIN) * screen];
    const first = this.search(els.length, (i) => bottomOf(i) > want[0]);
    const last = Math.max(first, this.search(els.length, (i) => topOf(i) >= want[1]) - 1);
    const from = st.starts[first];
    const to = st.starts[last] + doc.child(last).nodeSize;
    if (from === st.from && to === st.to) return;
    this.moveWindow(els, from, to);
  }

  /** First index for which `ok` holds (`ok` is monotonic), or `n`. */
  private search(n: number, ok: (i: number) => boolean): number {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ok(mid)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** Change the window, keeping the content at the top of the viewport where it is
   * (scroll anchoring: placeholders above it may change height). */
  private moveWindow(els: HTMLElement[], from: number, to: number) {
    const S = (window as unknown as { __vpStats?: Record<string, number> }).__vpStats;
    if (S) S.moves++;
    const view = this.view;
    const scroller = this.scroller!;
    const box = scroller.getBoundingClientRect();
    // The anchor: the first rendered block in view (a placeholder's own height changes
    // when it is rendered, which would move what is below it), else the first in view.
    const firstInView = this.search(els.length, (i) => els[i].getBoundingClientRect().bottom > box.top);
    let anchorIndex = firstInView;
    for (let i = firstInView; i < els.length && els[i].getBoundingClientRect().top < box.bottom; i++) {
      if (!els[i].classList.contains("md-virtual")) {
        anchorIndex = i;
        break;
      }
    }
    const st = viewportKey.getState(view.state)!;
    const anchorPos = st.starts[Math.min(anchorIndex, st.starts.length - 1)];
    const before = els[Math.min(anchorIndex, els.length - 1)].getBoundingClientRect().top;
    view.dispatch(view.state.tr.setMeta(WINDOW_META, { from, to }).setMeta("addToHistory", false));
    const dom = view.nodeDOM(anchorPos) as HTMLElement | null;
    if (dom) {
      const after = dom.getBoundingClientRect().top;
      if (after !== before) scroller.scrollTop += after - before;
    }
  }
}
