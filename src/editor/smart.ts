// Smart punctuation (spec 03, Preferences → Markdown, default off). Display-only: in
// plain text runs, straight quotes show as curly quotes, `--` as an en dash, `---` as an
// em dash and `...` as an ellipsis. The source keeps the ASCII characters. Each
// replacement is a widget showing the typographic character with the source characters
// hidden next to it; a sequence with the cursor inside shows its source so it can be edited.

import type { Node } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { changedRanges } from "./decorations";
import { isProse } from "./context";

export interface Smart {
  from: number;
  to: number;
  char: string;
}

/** Markup characters that do not count as the character before a quote. */
const TRANSPARENT = /[*_~=^]/;
const OPENS_AFTER = /[\s([{<‘“–—/-]/;

/**
 * Typographic replacements in `text`; `inRange(i)` says whether position `i` is plain
 * text (replacements must lie entirely in plain text). Positions are offsets in `text`.
 */
export function smartReplacements(text: string, inRange: (from: number, to: number) => boolean = () => true, prev = ""): Smart[] {
  const out: Smart[] = [];
  const before = (i: number) => {
    let j = i - 1;
    while (j >= 0 && TRANSPARENT.test(text[j])) j--;
    return j < 0 ? prev : text[j];
  };
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === "-") {
      let j = i;
      while (text[j] === "-") j++;
      const n = j - i;
      if ((n === 2 || n === 3) && inRange(i, j)) out.push({ from: i, to: j, char: n === 2 ? "–" : "—" });
      i = j;
      continue;
    }
    if (c === ".") {
      let j = i;
      while (text[j] === ".") j++;
      if (j - i === 3 && inRange(i, j)) out.push({ from: i, to: j, char: "…" });
      i = j;
      continue;
    }
    if ((c === '"' || c === "'") && inRange(i, i + 1)) {
      const p = before(i);
      const open = p === "" || OPENS_AFTER.test(p);
      const char = c === '"' ? (open ? "“" : "”") : open ? "‘" : "’";
      out.push({ from: i, to: i + 1, char });
    }
    i++;
  }
  return out;
}

/** The displayed form of plain text (Copy as Plain Text with smart punctuation on). */
export function smartText(text: string, prev = ""): string {
  let out = "";
  let at = 0;
  for (const r of smartReplacements(text, undefined, prev)) {
    out += text.slice(at, r.from) + r.char;
    at = r.to;
  }
  return out + text.slice(at);
}

/** Plain text ranges of a prose textblock, from its presentation marks. */
function plainRanges(node: Node): [number, number][] {
  const ranges: [number, number][] = [];
  node.forEach((child, offset) => {
    if (!child.isText) return;
    const marks = child.marks.filter((m) => m.type.name === "pres");
    const last = marks[marks.length - 1];
    if (!last || !String(last.attrs.cls).split(" ").includes("md-plain")) return;
    const prev = ranges[ranges.length - 1];
    if (prev && prev[1] === offset) prev[1] = offset + child.nodeSize;
    else ranges.push([offset, offset + child.nodeSize]);
  });
  return ranges;
}

function blockDecorations(node: Node, pos: number, head: number): Decoration[] {
  const ranges = plainRanges(node);
  if (!ranges.length) return [];
  const text = node.textBetween(0, node.content.size, undefined, "\n");
  const inRange = (a: number, b: number) => ranges.some(([x, y]) => a >= x && b <= y);
  const out: Decoration[] = [];
  const base = pos + 1;
  for (const r of smartReplacements(text, inRange)) {
    const from = base + r.from;
    const to = base + r.to;
    if (head > from && head < to) continue; // the cursor is inside: show the source
    out.push(
      Decoration.widget(
        from,
        () => {
          const s = document.createElement("span");
          s.className = "md-smart";
          s.textContent = r.char;
          return s;
        },
        { side: -1, key: `smart:${r.char}`, ignoreSelection: true },
      ),
      Decoration.inline(from, to, { class: "md-smart-src" }),
    );
  }
  return out;
}

interface SmartState {
  set: DecorationSet;
  on: boolean;
}

export const smartKey = new PluginKey<SmartState>("scrim-smart");
const toggleMeta = "scrim-smart-toggle";

/** Turn the display on or off (the preference changed). */
export function setSmartPunctuation(view: { state: EditorState; dispatch(tr: Transaction): void }, on: boolean) {
  if (smartKey.getState(view.state)?.on === on) return;
  view.dispatch(view.state.tr.setMeta(toggleMeta, on).setMeta("addToHistory", false));
}

function all(doc: Node, head: number): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (isProse(node)) decos.push(...blockDecorations(node, pos, head));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

/** Redo the textblocks around the given document ranges. */
function redo(set: DecorationSet, doc: Node, ranges: [number, number][], head: number): DecorationSet {
  const done = new Set<number>();
  const size = doc.content.size;
  for (const [a, b] of ranges) {
    const lo = Math.max(0, Math.min(a, size));
    const hi = Math.max(lo, Math.min(b, size));
    doc.nodesBetween(lo, hi, (node, pos) => {
      if (!node.isTextblock) return true;
      if (done.has(pos)) return false;
      done.add(pos);
      set = set.remove(set.find(pos, pos + node.nodeSize));
      if (isProse(node)) set = set.add(doc, blockDecorations(node, pos, head));
      return false;
    });
  }
  return set;
}

export function createSmartPlugin(initial: () => boolean): Plugin<SmartState> {
  return new Plugin<SmartState>({
    key: smartKey,
    state: {
      init(_, state) {
        const on = initial();
        return { on, set: on ? all(state.doc, state.selection.head) : DecorationSet.empty };
      },
      apply(tr, value, old, state) {
        const toggle = tr.getMeta(toggleMeta) as boolean | undefined;
        if (toggle !== undefined) return { on: toggle, set: toggle ? all(state.doc, state.selection.head) : DecorationSet.empty };
        if (!value.on) return value;
        if (tr.getMeta("scrim-rebuild-inline")) return { on: true, set: all(state.doc, state.selection.head) };
        if (!tr.docChanged && old.selection.head === state.selection.head) return value;
        const set = value.set.map(tr.mapping, tr.doc);
        const head = state.selection.head;
        const oldHead = tr.mapping.map(old.selection.head);
        const ranges: [number, number][] = [...(tr.docChanged ? changedRanges(tr) : []), [oldHead, oldHead], [head, head]];
        return { on: true, set: redo(set, state.doc, ranges, head) };
      },
    },
    props: {
      decorations(state) {
        return smartKey.getState(state)?.set;
      },
    },
  });
}
