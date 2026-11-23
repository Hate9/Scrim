// Inline rendering (spec 03, 3.2; spec 05; theme contract spec 10.3, QA-LOG Q-018).
//
// The structure themes select on (wrappers, markers, plain runs) is expressed as
// presentation marks (pres.ts), which this plugin keeps in sync with the text: every
// transaction's touched textblocks are re-marked in an appended transaction that is not
// in the history and does not make the document dirty. Rendered replacements (images,
// emoji, entities, inline math) are widget decorations placed inside their wrapper.
// Expansion only toggles the `md-expand` class on wrappers (reveal.ts), so cursor
// movement never changes the DOM structure (spec 01). Work is limited to touched
// textblocks, done progressively for large documents, and frozen during IME composition.

import { Fragment, type Node } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import { SetMarksStep } from "./presstep";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { flatten, type InlineElement, type Widget, type Definitions } from "../md/inline";
import { documentDefinitions, elementsOf, isProse, type EditorOptions } from "./context";
import { isStructural } from "./normalize";
import { sanitizeAttrs } from "./sanitize";
import { schema } from "../md/schema";
import { PRES_META, presSegments, type PresSegment, type PresSpec } from "./pres";

export { PRES_META };

export interface InlineDecoState {
  set: DecorationSet;
  defs: Definitions;
  /** Ranges of textblocks whose presentation marks are due (consumed by the next
   * appended presentation transaction). */
  touched: [number, number][];
  /** Position from which blocks still need decorations (progressive load), or null. */
  pending: number | null;
}

/** Textblocks decorated synchronously at load; the rest follow in idle chunks. */
const INITIAL_BLOCKS = 150;
const CHUNK_BLOCKS = 300;

export const inlineKey = new PluginKey<InlineDecoState>("scrim-inline");

/** Hooks the decorations need from the environment (image URLs, math rendering). */
export interface RenderHooks {
  /** Point `img` at the image `src` refers to (may be asynchronous for local files). */
  setImageSource(img: HTMLImageElement, src: string): void;
  renderMath(tex: string, el: HTMLElement, display?: boolean): void;
}

function widgetDom(w: Widget, index: number, hooks: RenderHooks, kind: string, view?: EditorView): HTMLElement {
  const span = document.createElement("span");
  span.className = `md-widget md-widget-${w.type}`;
  span.dataset.el = String(index);
  span.dataset.kind = kind;
  span.contentEditable = "false";
  switch (w.type) {
    case "image": {
      const wrap = document.createElement("span");
      wrap.className = "md-image-render";
      const img = document.createElement("img");
      hooks.setImageSource(img, w.src);
      img.alt = w.alt;
      img.title = w.title ? `${w.title}\n${w.src}` : w.src; // path tooltip (4.8)
      img.draggable = false;
      img.dataset.src = w.src;
      // Missing images: a placeholder with the alt text and the path (4.8).
      // The element's wrapper (span.md-image) gets `md-img-error` (10.3).
      // The wrapper is ProseMirror's mark element: change it only when needed, with the
      // DOM observer paused, or ProseMirror re-reads the paragraph from the DOM and drops
      // the wrapper's presentation mark.
      const setError = (on: boolean) => {
        const wrapper = span.closest(".md-image");
        if (!wrapper || wrapper.classList.contains("md-img-error") === on) return;
        const observer = (view as unknown as { domObserver?: { stop(): void; start(): void } } | undefined)?.domObserver;
        observer?.stop();
        wrapper.classList.toggle("md-img-error", on);
        observer?.start();
      };
      img.addEventListener("error", () => {
        wrap.classList.add("md-image-broken");
        wrap.dataset.label = `${w.alt ? w.alt + " — " : ""}${w.src}`;
        setError(true);
      });
      img.addEventListener("load", () => {
        wrap.classList.remove("md-image-broken");
        setError(false);
      });
      wrap.appendChild(img);
      span.appendChild(wrap);
      break;
    }
    case "emoji": {
      const e = document.createElement("span");
      e.className = "md-emoji";
      e.textContent = w.char;
      e.title = `:${w.name}:`;
      span.appendChild(e);
      break;
    }
    case "char":
      span.textContent = w.char;
      break;
    case "math": {
      const m = document.createElement("span");
      m.className = "md-inline-math";
      hooks.renderMath(w.tex, m);
      span.appendChild(m);
      break;
    }
    case "hidden":
      break;
  }
  return span;
}

function widgetKey(w: Widget): string {
  switch (w.type) {
    case "image":
      return `img:${w.src}:${w.alt}:${w.title ?? ""}`;
    case "emoji":
      return `emoji:${w.name}`;
    case "char":
      return `char:${w.char}`;
    case "math":
      return `math:${w.tex}`;
    default:
      return "hidden";
  }
}

const presType = schema.marks.pres;
const presMark = (p: PresSpec) => presType.create({ tag: p.tag, cls: p.cls, attrs: p.attrs, key: p.key });

/** The presentation segments of a prose textblock. */
export function blockSegments(node: Node, defs: Definitions, opts: EditorOptions): PresSegment[] {
  return presSegments(elementsOf(node, defs, opts), node.textBetween(0, node.content.size, undefined, "\n"), sanitizeAttrs);
}

/** Widget decorations of a textblock: rendered images, emoji, entities, inline math,
 * each inside its element's wrapper. */
export function decorationsForBlock(node: Node, pos: number, defs: Definitions, opts: EditorOptions, hooks: RenderHooks): Decoration[] {
  const els = flatten(elementsOf(node, defs, opts));
  const base = pos + 1;
  const out: Decoration[] = [];
  let segments: PresSegment[] | null = null;
  els.forEach((e: InlineElement, i) => {
    let widget = e.replace && e.replace.type !== "hidden" ? e.replace : null;
    if (e.kind === "html" && (e.nodeName === "br" || e.nodeName === "wbr")) widget = { type: "char", char: "" };
    if (!widget) return;
    const w = widget;
    const brTag = e.kind === "html" && e.nodeName === "br";
    // Inside the wrapper: the marks of the element's first piece, up to its wrapper.
    segments ??= blockSegments(node, defs, opts);
    const seg = segments.find((sg) => sg.from === e.from);
    const upTo = seg ? seg.marks.findIndex((m) => m.key === `w${i}`) : -1;
    const marks = seg && upTo >= 0 ? seg.marks.slice(0, upTo + 1).map(presMark) : [];
    out.push(
      Decoration.widget(
        base + e.from,
        (view) => {
          const dom = widgetDom(w, i, hooks, e.kind, view);
          if (brTag) dom.appendChild(document.createElement("br"));
          return dom;
        },
        { side: -1, key: `${i}:${e.kind}:${widgetKey(w)}:${marks.length}`, ignoreSelection: true, marks },
      ),
    );
  });
  return out;
}

type Run = [number, number, string];
const runSig = (marks: readonly { attrs: Record<string, unknown> }[]) => JSON.stringify(marks.map((m) => m.attrs));

/** Merge adjacent equal runs and fill gaps with "no marks", over [0, size). */
function normalizeRuns(list: Run[], size: number): Run[] {
  const out: Run[] = [];
  const add = (r: Run) => {
    const last = out[out.length - 1];
    if (last && last[1] === r[0] && last[2] === r[2]) last[1] = r[1];
    else out.push([...r]);
  };
  let at = 0;
  for (const r of list) {
    if (r[0] > at) add([at, r[0], "[]"]);
    add(r);
    at = r[1];
  }
  if (at < size) add([at, size, "[]"]);
  return out;
}

/** Bring a textblock's presentation marks in line with its text; false if they were. */
function syncMarks(tr: Transaction, node: Node, pos: number, defs: Definitions, opts: EditorOptions): boolean {
  const want = blockSegments(node, defs, opts);
  const wanted: Run[] = want.map((sg) => [sg.from, sg.to, runSig(sg.marks.map((p) => presMark(p)))]);
  const present: Run[] = [];
  node.forEach((child, offset) => present.push([offset, offset + child.nodeSize, runSig(child.marks.filter((m) => m.type === presType))]));
  const size = node.content.size;
  if (JSON.stringify(normalizeRuns(wanted, size)) === JSON.stringify(normalizeRuns(present, size))) return false;
  // The marks are changed on a document holding only this block, then the block's
  // content is swapped in one step (presstep.ts).
  const t = new Transform(tr.doc.copy(Fragment.from(node)));
  t.removeMark(1, 1 + size, presType);
  for (const sg of want) for (const p of sg.marks) t.addMark(1 + sg.from, 1 + sg.to, presMark(p));
  tr.step(new SetMarksStep(pos, t.doc.firstChild!.content));
  return true;
}

/** Decorations for up to `limit` textblocks starting at `from`; returns where it stopped. */
function blocksFrom(doc: Node, from: number, limit: number, defs: Definitions, opts: EditorOptions, hooks: RenderHooks) {
  const decos: Decoration[] = [];
  const ranges: [number, number][] = [];
  let count = 0;
  let next: number | null = null;
  doc.nodesBetween(from, doc.content.size, (node, pos) => {
    if (next !== null) return false;
    if (!node.isTextblock) return pos + node.nodeSize > from;
    if (pos < from) return false;
    if (count >= limit) {
      next = pos;
      return false;
    }
    count++;
    ranges.push([pos, pos + node.nodeSize]);
    if (isProse(node)) {
      decos.push(...decorationsForBlock(node, pos, defs, opts, hooks));
    }
    return false;
  });
  return { decos, ranges, next };
}

function initialState(doc: Node, defs: Definitions, opts: EditorOptions, hooks: RenderHooks): InlineDecoState {
  const { decos, ranges, next } = blocksFrom(doc, 0, INITIAL_BLOCKS, defs, opts, hooks);
  return { defs, set: DecorationSet.create(doc, decos), pending: next, touched: ranges };
}

function touchesRawDefinitions(tr: Transaction, doc: Node): boolean {
  let hit = false;
  for (const [from, to] of changedRanges(tr)) {
    doc.nodesBetween(Math.min(from, doc.content.size), Math.min(to, doc.content.size), (n) => {
      if ((n.type.name === "raw" && n.attrs.kind === "definition") || n.type.name === "footnote_def") hit = true;
      return !hit && !n.isTextblock;
    });
  }
  return hit;
}

/** Ranges of the new document touched by a transaction. */
export function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  const maps = tr.mapping.maps;
  maps.forEach((map, i) => {
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      let from = newStart;
      let to = newEnd;
      for (let j = i + 1; j < maps.length; j++) {
        from = maps[j].map(from, -1);
        to = maps[j].map(to, 1);
      }
      ranges.push([from, Math.max(from, to)]);
    });
  });
  return ranges;
}

const rebuildMeta = "scrim-rebuild-inline";

/** Analyze and render every block again (registered custom tags changed, 17). Not an edit,
 * not an undo step. */
export function rebuildInline(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(rebuildMeta, true).setMeta("addToHistory", false));
}

export function createInlinePlugin(opts: EditorOptions, hooks: RenderHooks): Plugin<InlineDecoState> {
  let composing = false;
  const chunkMeta = "scrim-inline-chunk";
  return new Plugin<InlineDecoState>({
    key: inlineKey,
    state: {
      init(_, state) {
        return initialState(state.doc, documentDefinitions(state.doc), opts, hooks);
      },
      apply(tr, value, _old, state: EditorState) {
        if (tr.getMeta(rebuildMeta)) return initialState(state.doc, documentDefinitions(state.doc), opts, hooks);
        if (tr.getMeta(chunkMeta) && value.pending !== null && !tr.docChanged) {
          const { decos, ranges, next } = blocksFrom(state.doc, value.pending, CHUNK_BLOCKS, value.defs, opts, hooks);
          let set = value.set;
          for (const [a, b] of ranges) set = set.remove(set.find(a, b));
          return { defs: value.defs, set: set.add(state.doc, decos), pending: next, touched: [...value.touched, ...ranges] };
        }
        // A presentation transaction: the marks are now current.
        if (tr.getMeta(PRES_META)) return { ...value, set: value.set.map(tr.mapping, tr.doc), touched: [] };
        if (!tr.docChanged) return value;
        let set = value.set.map(tr.mapping, tr.doc);
        const pending = value.pending === null ? null : tr.mapping.map(value.pending, -1);
        const touched: [number, number][] = value.touched.map(([a, b]) => [tr.mapping.map(a, -1), tr.mapping.map(b, 1)]);
        if (composing) return { defs: value.defs, set, pending, touched };
        // Definitions can only change if a definition block (or the structure) changed.
        let defs = value.defs;
        if (isStructural(tr) || touchesRawDefinitions(tr, state.doc)) {
          defs = documentDefinitions(state.doc);
          if (defs !== value.defs) return initialState(state.doc, defs, opts, hooks);
        }
        const done = new Set<number>();
        for (const [from, to] of changedRanges(tr)) {
          touched.push([from, to]);
          const lo = Math.max(0, Math.min(from, state.doc.content.size));
          const hi = Math.max(lo, Math.min(to, state.doc.content.size));
          state.doc.nodesBetween(lo, hi, (node, pos) => {
            if (!node.isTextblock) return true;
            if (done.has(pos)) return false;
            done.add(pos);
            set = set.remove(set.find(pos, pos + node.nodeSize));
            if (isProse(node)) set = set.add(state.doc, decorationsForBlock(node, pos, defs, opts, hooks));
            return false;
          });
        }
        return { defs, set, pending, touched };
      },
    },
    appendTransaction(_trs, _old, state) {
      const st = inlineKey.getState(state);
      if (!st || composing || !st.touched.length) return null;
      const tr = state.tr;
      const size = state.doc.content.size;
      const done = new Set<number>();
      for (const [from, to] of st.touched) {
        const lo = Math.max(0, Math.min(from, size));
        const hi = Math.max(lo, Math.min(to, size));
        state.doc.nodesBetween(lo, hi, (node, pos) => {
          if (!node.isTextblock) return true;
          if (done.has(pos)) return false;
          done.add(pos);
          if (isProse(node) && node.type.allowsMarkType(presType)) syncMarks(tr, node, pos, st.defs, opts);
          return false;
        });
      }
      // Even without changes: the meta clears `touched`.
      return tr.setMeta(PRES_META, true).setMeta("addToHistory", false);
    },
    view: (initialView) => {
      let scheduled = 0;
      const pv = {
        update(view: EditorView) {
          if (scheduled || inlineKey.getState(view.state)?.pending == null) return;
          scheduled = window.setTimeout(() => {
            scheduled = 0;
            if (!view.isDestroyed && inlineKey.getState(view.state)?.pending != null) view.dispatch(view.state.tr.setMeta(chunkMeta, true));
          }, 0);
        },
      };
      pv.update(initialView);
      return pv;
    },
    props: {
      decorations(state) {
        return inlineKey.getState(state)?.set;
      },
      handleDOMEvents: {
        compositionstart() {
          composing = true;
          return false;
        },
        compositionend(view: EditorView) {
          composing = false;
          // Apply what was deferred during composition (spec 03, 3.3).
          setTimeout(() => view.dispatch(view.state.tr.setMeta(rebuildMeta, true)), 0);
          return false;
        },
      },
    },
  });
}
