// Snippets (spec 16): body syntax and insertion.
//
// Insertion works on Markdown source. The selection becomes source ranges, the body is
// applied to the text, and the cursor or selection is placed by source offsets computed
// before the change (16: "compute the target source offsets before insertion and map
// them through the transaction; do not search the DOM"). One transaction, one undo step;
// no input rule fires on inserted text.

import { EditorView as CMView } from "@codemirror/view";
import { TextSelection } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { posToSource, serializeWithMap, sourceToPos } from "../md/serialize";

export interface Snippet {
  name: string;
  key: string;
  body: string;
}

/**
 * Scan a body left to right (16, "Body syntax"): `$$` is a literal `$`; the first `$0`
 * is the cursor mark; everything else, later `$0`s included, is literal.
 */
export function parseBody(body: string): { text: string; cursor: number | null } {
  let text = "";
  let cursor: number | null = null;
  for (let i = 0; i < body.length; ) {
    if (body.startsWith("$$", i)) {
      text += "$";
      i += 2;
    } else if (body.startsWith("$0", i) && cursor === null) {
      cursor = text.length;
      i += 2;
    } else {
      text += body[i];
      i++;
    }
  }
  return { text, cursor };
}

export interface Applied {
  text: string;
  /** source offsets of the new selection */
  from: number;
  to: number;
}

/**
 * Apply a snippet to `src` at the given source ranges (one range, or one per touched
 * textblock for an inline body over several blocks). `indent` is prefixed to the body's
 * lines after the first (inside a list item, 16).
 */
export function applySnippet(src: string, ranges: [number, number][], body: string, indent = ""): Applied {
  const { text, cursor } = parseBody(body);
  const ind = (s: string) => (indent ? s.replace(/\n/g, `\n${indent}`) : s);
  const before = ind(cursor === null ? text : text.slice(0, cursor));
  const after = cursor === null ? "" : ind(text.slice(cursor));
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  let shift = 0;
  let selFrom = 0;
  let selTo = 0;
  sorted.forEach(([a, b], i) => {
    const selected = src.slice(a, b);
    out += src.slice(at, a);
    const start = a + shift;
    if (cursor === null) {
      // No cursor mark: the selection is replaced; the cursor ends after the text.
      out += before;
      shift += before.length - selected.length;
      if (i === 0) selFrom = start + before.length;
      selTo = start + before.length;
    } else {
      out += before + selected + after;
      if (i === 0) selFrom = start + before.length;
      selTo = start + before.length + selected.length;
      shift += before.length + after.length;
    }
    at = b;
  });
  out += src.slice(at);
  if (cursor === null) selFrom = selTo;
  return { text: out, from: selFrom, to: selTo };
}

/** Indentation for a multi-line body: the content column of the list item at `offset`. */
export function listIndent(src: string, offset: number): string {
  const lineStart = src.lastIndexOf("\n", offset - 1) + 1;
  const line = src.slice(lineStart, offset);
  const m = /^((?:[ \t]*>[ \t]?)*)([ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+)?/.exec(line);
  if (!m) return "";
  const marker = m[3] ? " ".repeat(m[3].length) : "";
  return m[1] + m[2] + marker;
}

/** Insert into the focused CodeMirror editor (code block, math, front matter, source
 * mode): literal text, same cursor rules. */
function insertIntoCodeMirror(cm: CMView, body: string) {
  const sel = cm.state.selection.main;
  const src = cm.state.doc.toString();
  const r = applySnippet(src, [[sel.from, sel.to]], body);
  const start = sel.from;
  const end = sel.to;
  const inserted = r.text.slice(start, r.text.length - (src.length - end));
  cm.dispatch({ changes: { from: start, to: end, insert: inserted }, selection: { anchor: r.from, head: r.to }, scrollIntoView: true, userEvent: "input.snippet" });
  cm.focus();
}

/** The CodeMirror editor that has focus, if any. */
export function focusedCodeMirror(): CMView | null {
  const el = document.activeElement?.closest?.(".cm-editor") as HTMLElement | null;
  return el ? CMView.findFromDOM(el) : null;
}

export interface SnippetTarget {
  view: EditorView;
  /** replace the whole document text (one undo step) */
  applyText(text: string): void;
  prettyTables: boolean;
}

/** Insert a snippet at the current selection (16, "Insertion behavior"). */
export function insertSnippet(target: SnippetTarget, body: string, cm: CMView | null = focusedCodeMirror()) {
  if (cm) {
    insertIntoCodeMirror(cm, body);
    return;
  }
  const view = target.view;
  const state = view.state;
  const { from, to, $from, $to } = state.selection;
  const multiLine = body.includes("\n");
  // Fast path: an inline body within one textblock of plain text.
  const sameBlock = $from.parent === $to.parent && $from.parent.isTextblock && !$from.parent.type.spec.code;
  let plain = true;
  state.doc.nodesBetween(from, to, (n) => {
    if (n.isInline && !n.isText) plain = false;
  });
  if (!multiLine && sameBlock && plain) {
    const selected = state.doc.textBetween(from, to);
    const r = applySnippet(selected, [[0, selected.length]], body);
    const tr = state.tr.insertText(r.text, from, to);
    tr.setSelection(TextSelection.create(tr.doc, from + r.from, from + r.to)).scrollIntoView();
    view.dispatch(tr);
    view.focus();
    return;
  }
  // Source path: the selection's Markdown, or each touched textblock's part of it.
  const { text, map } = serializeWithMap(state.doc, { prettyTables: target.prettyTables });
  const ranges: [number, number][] = [];
  if (multiLine) ranges.push([posToSource(map, from), posToSource(map, to)]);
  else {
    state.doc.nodesBetween(from, to, (n: Node, pos: number) => {
      if (!n.isTextblock) return true;
      const a = Math.max(from, pos + 1);
      const b = Math.min(to, pos + 1 + n.content.size);
      if (b >= a) ranges.push([posToSource(map, a), posToSource(map, b)]);
      return false;
    });
    if (!ranges.length) ranges.push([posToSource(map, from), posToSource(map, to)]);
  }
  let inList = false;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "list_item") inList = true;
  const indent = multiLine && inList ? listIndent(text, ranges[0][0]) : "";
  const r = applySnippet(text, ranges, body, indent);
  target.applyText(r.text);
  const after = serializeWithMap(view.state.doc, { prettyTables: target.prettyTables }).map;
  const a = sourceToPos(after, r.from);
  const b = sourceToPos(after, r.to);
  if (a !== null && b !== null) {
    const size = view.state.doc.content.size;
    try {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, Math.min(a, size), Math.min(b, size))).scrollIntoView().setMeta("addToHistory", false));
    } catch {
      /* the cursor stays where the change put it */
    }
  }
  view.focus();
}
