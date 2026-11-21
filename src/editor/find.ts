// Find and replace in the document (spec 08).

import type { Node } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { flatten, type InlineElement } from "../md/inline";
import { blockSource, elementsOf, isProse, type EditorOptions } from "./context";
import { inlineKey } from "./decorations";
import { literalLine } from "./clipboard";

export interface FindQuery {
  text: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Match the Markdown source instead of the rendered text. */
  source: boolean;
}

export interface Match {
  /** document positions of the source range covered by the match */
  from: number;
  to: number;
  /** block start (position of the textblock's content) */
  start: number;
  /** displayed-text range inside the block's projection */
  dFrom: number;
  dTo: number;
  groups: string[];
}

/** A textblock projected to the text the user sees (8, "What is matched"). */
export interface Projection {
  text: string;
  /** per displayed character: source range [from, to) inside the block */
  from: number[];
  to: number[];
  elements: InlineElement[];
}

export function project(node: Node, els: InlineElement[]): Projection {
  const src = blockSource(node);
  const hiddenOrSkip = new Array<number>(src.length).fill(0); // 1 = excluded
  const atoms: { from: number; to: number; text: string }[] = [];
  for (const e of els) {
    for (const [a, b] of e.runs) for (let i = a; i < b; i++) hiddenOrSkip[i] = 1;
    for (const [a, b] of e.hidden ?? []) for (let i = a; i < b; i++) hiddenOrSkip[i] = 1;
    if (e.kind === "image") {
      // Alt text is searchable; the source and the rest are not.
      for (let i = e.from; i < e.to; i++) hiddenOrSkip[i] = i >= e.contentFrom && i < e.contentTo ? hiddenOrSkip[i] : 1;
    } else if (e.kind === "escape" || e.kind === "entity" || e.kind === "emoji") {
      for (let i = e.from; i < e.to; i++) hiddenOrSkip[i] = 2;
      const r = e.replace;
      const text = e.kind === "escape" ? src.slice(e.contentFrom, e.contentTo) : r?.type === "emoji" ? r.char : r?.type === "char" ? r.char : "";
      atoms.push({ from: e.from, to: e.to, text });
    } else if (e.kind === "comment") {
      for (let i = e.from; i < e.to; i++) hiddenOrSkip[i] = 1;
    }
  }
  const text: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  let ai = 0;
  atoms.sort((a, b) => a.from - b.from);
  for (let i = 0; i < src.length; i++) {
    if (hiddenOrSkip[i] === 2) {
      const atom = atoms[ai];
      if (atom && atom.from === i) {
        for (const ch of atom.text) {
          text.push(ch);
          from.push(atom.from);
          to.push(atom.to);
        }
        ai++;
        i = atom.to - 1;
      }
      continue;
    }
    if (hiddenOrSkip[i] === 1) continue;
    text.push(src[i]);
    from.push(i);
    to.push(i + 1);
  }
  return { text: text.join(""), from, to, elements: els };
}

function sourceProjection(node: Node): Projection {
  const src = blockSource(node);
  const from = Array.from({ length: src.length }, (_, i) => i);
  return { text: src, from, to: from.map((i) => i + 1), elements: [] };
}

/** Build the regex for a query (8, matching rules). */
export function buildRegex(q: FindQuery): RegExp | null {
  if (!q.text) return null;
  let pattern: string;
  if (q.regex) pattern = q.text;
  else {
    pattern = [...q.text]
      .map((c) => {
        if (c === '"' || c === "\u201c" || c === "\u201d") return '["\u201c\u201d]';
        if (c === "'" || c === "\u2018" || c === "\u2019") return "['\u2018\u2019]";
        if (c === "-" || c === "\u2013" || c === "\u2014") return "[-\u2013\u2014]";
        return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
  }
  if (q.wholeWord) pattern = `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(pattern, `gu${q.caseSensitive ? "" : "i"}`);
  } catch {
    return null;
  }
}

export function findMatches(state: EditorState, q: FindQuery, opts: EditorOptions): Match[] {
  const re = buildRegex(q);
  if (!re) return [];
  const defs = inlineKey.getState(state)?.defs;
  const out: Match[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const proj = q.source || !isProse(node) || !defs ? sourceProjection(node) : project(node, flatten(elementsOf(node, defs, opts)));
    const start = pos + 1;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(proj.text))) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const dFrom = m.index;
      const dTo = m.index + m[0].length;
      out.push({ from: start + proj.from[dFrom], to: start + proj.to[dTo - 1], start, dFrom, dTo, groups: [...m] });
    }
    return false;
  });
  return out;
}

/** Expand `$1`…`$9` and `$&` (regex replacements). */
export function expandReplacement(rep: string, m: Match, regex: boolean): string {
  if (!regex) return rep;
  return rep.replace(/\$(\d|&)/g, (_, g) => (g === "&" ? m.groups[0] : m.groups[Number(g)] ?? ""));
}

/** Apply one replacement to `tr` (positions in tr.doc mapped by the caller). */
export function replaceMatch(tr: Transaction, state: EditorState, m: Match, replacement: string, q: FindQuery, opts: EditorOptions) {
  const map = (p: number, assoc = 1) => tr.mapping.map(p, assoc);
  const $p = state.doc.resolve(m.from);
  const node = $p.parent;
  const rendered = !q.source && isProse(node);
  const text = rendered ? literalLine(replacement, opts) : replacement;
  if (!rendered) {
    tr.insertText(text, map(m.from, -1), map(m.to));
    return;
  }
  const defs = inlineKey.getState(state)?.defs;
  const els = defs ? flatten(elementsOf(node, defs, opts)) : [];
  const proj = project(node, els);
  // Segments: runs of displayed characters with contiguous source (8, Replace).
  const segs: [number, number][] = [];
  for (let i = m.dFrom; i < m.dTo; i++) {
    const a = proj.from[i];
    const b = proj.to[i];
    const last = segs[segs.length - 1];
    if (last && last[1] === a) last[1] = b;
    else if (!last || last[1] < b) segs.push([a, b]);
  }
  if (segs.length === 1) {
    tr.insertText(text, map(m.start + segs[0][0], -1), map(m.start + segs[0][1]));
    return;
  }
  // Spanning: delete every segment, insert at the match start, remove elements whose
  // content became empty (decided on the elements before the edit).
  const deleted = new Set<number>();
  for (const [a, b] of segs) for (let i = a; i < b; i++) deleted.add(i);
  const ranges: [number, number][] = [...segs];
  const insertAt = segs[0][0];
  for (const e of els) {
    if (e.contentTo <= e.contentFrom || e.runs.length === 0) continue;
    let empty = true;
    for (let i = e.contentFrom; i < e.contentTo; i++) if (!deleted.has(i)) empty = false;
    if (!empty) continue;
    // The insertion point lies inside this element: it keeps content, so it stays.
    if (insertAt > e.contentFrom && insertAt < e.contentTo) continue;
    if (insertAt === e.contentFrom && e.from < insertAt) continue;
    for (const [a, b] of e.runs) ranges.push([a, b]);
  }
  ranges.sort((x, y) => y[0] - x[0]);
  for (const [a, b] of ranges) tr.delete(map(m.start + a), map(m.start + b));
  tr.insertText(text, map(m.start + insertAt, -1));
}

// ---- highlighting ----------------------------------------------------------------------

interface FindState {
  matches: Match[];
  current: number;
  set: DecorationSet;
}

export const findKey = new PluginKey<FindState>("scrim-find");

export function setFindResults(view: EditorView, matches: Match[], current: number) {
  view.dispatch(view.state.tr.setMeta(findKey, { matches, current }));
}

export function createFindPlugin(): Plugin {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: (): FindState => ({ matches: [], current: -1, set: DecorationSet.empty }),
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(findKey) as { matches: Match[]; current: number } | undefined;
        if (meta) {
          const decos = meta.matches.map((m, i) =>
            Decoration.inline(m.from, m.to, { class: i === meta.current ? "md-search-hit md-search-select" : "md-search-hit" }),
          );
          return { ...meta, set: DecorationSet.create(state.doc, decos) };
        }
        if (tr.docChanged) return { ...value, set: value.set.map(tr.mapping, tr.doc) };
        return value;
      },
    },
    props: {
      decorations: (state) => findKey.getState(state)?.set,
    },
  });
}

/** Select match `m` and scroll it into the middle third of the viewport. */
export function revealMatch(view: EditorView, m: Match) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)));
  const coords = view.coordsAtPos(m.from);
  const scroller = view.dom.closest("content") as HTMLElement | null;
  if (scroller) {
    const r = scroller.getBoundingClientRect();
    const y = coords.top - r.top;
    if (y < r.height / 3 || y > (2 * r.height) / 3) scroller.scrollTop += y - r.height / 2;
  }
}
