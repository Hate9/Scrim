// Editing commands (spec 03, 3.3–3.7; spec 04, lists and quotes; spec 12, editing keys).

import { chainCommands, deleteSelection, joinBackward, joinForward, selectNodeBackward, selectNodeForward, splitBlock } from "prosemirror-commands";
import { closeHistory } from "prosemirror-history";
import { Fragment, type Node, type NodeType, type ResolvedPos } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { AllSelection, NodeSelection, Selection, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { canSplit, liftTarget } from "prosemirror-transform";
import { flatten, type InlineElement, type InlineKind } from "../md/inline";
import { freshUid, schema } from "../md/schema";
import { blockSource, elementsOf, isProse, type EditorOptions } from "./context";
import { inlineKey } from "./decorations";
import { SKIP_ESCAPES } from "./escapes";

const S = schema.nodes;

/** Leaf attributes that carry the block's source identity across a type change. */
function keepLeaf(attrs: Record<string, unknown>) {
  const { uid, sep, prev, lead, marks, sig } = attrs;
  return { uid, sep, prev, lead, marks, sig };
}

function elementsAt(state: EditorState, $pos: ResolvedPos, opts: EditorOptions): InlineElement[] {
  const defs = inlineKey.getState(state)?.defs;
  if (!defs || !isProse($pos.parent)) return [];
  return flatten(elementsOf($pos.parent, defs, opts));
}

// ---- block input rules -----------------------------------------------------------------

/** Space-triggered rules (3.3): `text` is the paragraph text before the cursor plus " ". */
function spaceRule(state: EditorState, $from: ResolvedPos, prefix: string): Transaction | null {
  const para = $from.parent;
  if (para.type !== S.paragraph) return null;
  const start = $from.start();
  const end = $from.pos;
  const trigger = prefix + " ";
  let m: RegExpExecArray | null;
  const tr = state.tr;
  if ((m = /^(#{1,6}) $/.exec(trigger))) {
    tr.delete(start, end);
    tr.setNodeMarkup($from.before(), S.heading, { ...keepLeaf(para.attrs), level: m[1].length });
    return tr;
  }
  if (trigger === "> ") {
    tr.delete(start, end);
    const range = tr.doc.resolve(start).blockRange();
    if (!range) return null;
    tr.wrap(range, [{ type: S.blockquote, attrs: { uid: freshUid() } }]);
    return tr;
  }
  if ((m = /^([-*+]) $/.exec(trigger)) || (m = /^(\d{1,9})([.)]) $/.exec(trigger))) {
    tr.delete(start, end);
    const ordered = m.length === 3 && /\d/.test(m[1]);
    const listType = ordered ? S.ordered_list : S.bullet_list;
    const attrs = ordered
      ? { uid: freshUid(), start: parseInt(m[1], 10), delim: m[2], numbering: "seq", tight: true, items: null }
      : { uid: freshUid(), bullet: m[1], tight: true, items: null };
    const range = tr.doc.resolve(start).blockRange();
    if (!range) return null;
    const marker = ordered ? `${m[1]}${m[2]}` : m[1];
    // Join an adjacent list of the same kind instead of starting a second list.
    tr.wrap(range, [
      { type: listType, attrs },
      { type: S.list_item, attrs: { uid: freshUid(), marker } },
    ]);
    return tr;
  }
  return null;
}

const FENCE = /^(`{3,}|~{3,})([^`]*)$/;
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const TABLE = /^\|(.*\|)+$/;
const HTML_OPEN = /^<\/?([A-Za-z][A-Za-z0-9-]*)(\s[^>]*)?\/?>/;

function rawBlock(kind: string, lines: string[]): Node {
  const content: Node[] = [];
  lines.forEach((l, i) => {
    if (i) content.push(S.line_break.create());
    if (l) content.push(schema.text(l));
  });
  return S.raw.create({ uid: freshUid(), kind }, content);
}

/** Enter-triggered rules (3.3): fire when the paragraph's entire text is the trigger. */
function enterRule(state: EditorState): Transaction | null {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== S.paragraph || $from.parentOffset !== $from.parent.content.size) return null;
  const text = blockSource($from.parent);
  const pos = $from.before();
  const size = $from.parent.nodeSize;
  const tr = state.tr;
  let m: RegExpExecArray | null;
  const isFirstBlockOfEmptyDoc = state.doc.childCount === 1 && $from.depth === 1;
  if (text === "---" && isFirstBlockOfEmptyDoc) {
    tr.replaceWith(pos, pos + size, rawBlock("frontmatter", ["---", "", "---"]));
    return tr.setSelection(TextSelection.create(tr.doc, pos + 1 + 4));
  }
  if (HR.test(text)) {
    const hr = S.hr.create({ ...keepLeaf($from.parent.attrs), text });
    const para = S.paragraph.create({ uid: freshUid() });
    tr.replaceWith(pos, pos + size, [hr, para]);
    return tr.setSelection(TextSelection.create(tr.doc, pos + hr.nodeSize + 1));
  }
  if ((m = FENCE.exec(text))) {
    tr.replaceWith(pos, pos + size, rawBlock("code", [text, "", m[1]]));
    return tr.setSelection(TextSelection.create(tr.doc, pos + 1 + text.length + 1));
  }
  if (text === "$$") {
    tr.replaceWith(pos, pos + size, rawBlock("math", ["$$", "", "$$"]));
    return tr.setSelection(TextSelection.create(tr.doc, pos + 1 + 3));
  }
  if (TABLE.test(text)) {
    const cells = text.slice(1, -1).split("|");
    if (cells.some((c) => c.trim())) {
      const header = "| " + cells.map((c) => c.trim()).join(" | ") + " |";
      const delim = "| " + cells.map((c) => "-".repeat(Math.max(3, c.trim().length))).join(" | ") + " |";
      const body = "| " + cells.map((c) => " ".repeat(Math.max(3, c.trim().length))).join(" | ") + " |";
      tr.replaceWith(pos, pos + size, rawBlock("table", [header, delim, body]));
      return tr.setSelection(TextSelection.create(tr.doc, pos + 1 + header.length + 1 + delim.length + 1 + 2));
    }
  }
  if ((m = HTML_OPEN.exec(text)) && !/^(span|b|i|u|s|a|em|strong|code|kbd|img|br)$/i.test(m[1])) {
    tr.replaceWith(pos, pos + size, rawBlock("html", [text, ""]));
    return tr.setSelection(TextSelection.create(tr.doc, pos + 1 + text.length + 1));
  }
  return null;
}

// ---- Enter / Shift+Enter ------------------------------------------------------------------

function inList($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type === S.list_item) return d;
  return -1;
}

function inQuote($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type === S.blockquote) return d;
  return -1;
}

export const shiftEnter = (opts: EditorOptions): Command => (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return false;
  if ($from.parent.type === S.heading) return enter(opts)(state, dispatch);
  if (dispatch) {
    const tr = state.tr;
    if (!opts.preserveLineBreaks && $from.parent.type === S.paragraph) tr.insertText("\\");
    tr.replaceSelectionWith(S.line_break.create(), false);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Newline in a raw (code-like) block, indented like the previous line. */
const rawNewline: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type !== S.raw) return false;
  if (dispatch) {
    const text = blockSource($from.parent).slice(0, $from.parentOffset);
    const line = text.slice(text.lastIndexOf("\n") + 1);
    const indent = /^[ \t]*/.exec(line)![0];
    const tr = state.tr.replaceSelectionWith(S.line_break.create(), false);
    if (indent) tr.insertText(indent);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

const splitHeading: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type !== S.heading) return false;
  if (dispatch) {
    const tr = state.tr;
    if (!state.selection.empty) tr.deleteSelection();
    const $p = tr.selection.$from;
    if ($p.parentOffset === 0 && $p.parent.content.size > 0) {
      // At the start: an empty paragraph before, the heading moves down.
      tr.insert($p.before(), S.paragraph.create({ uid: freshUid() }));
    } else if (canSplit(tr.doc, $p.pos, 1, [{ type: S.paragraph }])) {
      tr.split($p.pos, 1, [{ type: S.paragraph, attrs: { uid: freshUid() } }]);
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Enter on an empty paragraph that is the last child of a quote leaves the quote. */
const leaveQuote: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== S.paragraph || $from.parent.content.size) return false;
  const qd = inQuote($from);
  if (qd < 0 || qd !== $from.depth - 1) return false;
  if ($from.index(qd) !== $from.node(qd).childCount - 1) return false;
  const range = $from.blockRange();
  const target = range && liftTarget(range);
  if (target == null || !range) return false;
  if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView());
  return true;
};

/** Empty list item: outdent one level; at top level the item leaves the list. */
const emptyItem: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.content.size || inList($from) !== $from.depth - 1) return false;
  return liftListItem(S.list_item)(state, dispatch);
};

export function enter(opts: EditorOptions): Command {
  return (state, dispatch) => {
    const rule = enterRule(state);
    if (rule) {
      // Fold the typed trigger into its own undo step first (3.3, undo).
      if (dispatch) dispatch(closeHistory(rule).scrollIntoView());
      return true;
    }
    return chainCommands(
      rawNewline,
      splitHeading,
      emptyItem,
      splitListItem(S.list_item),
      leaveQuote,
      splitBlockAsParagraph,
    )(state, dispatch);
    void opts;
  };
}

/** splitBlock, with the part after the cursor always a plain paragraph. */
const splitBlockAsParagraph: Command = (state, dispatch) => splitBlock(state, dispatch);

// ---- Backspace / Delete --------------------------------------------------------------------

function atBlockStart(state: EditorState): ResolvedPos | null {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0 || !$from.parent.isTextblock) return null;
  return $from;
}

const headingToParagraph: Command = (state, dispatch) => {
  const $p = atBlockStart(state);
  if (!$p || $p.parent.type !== S.heading) return false;
  if (dispatch) dispatch(state.tr.setNodeMarkup($p.before(), S.paragraph, keepLeaf($p.parent.attrs)));
  return true;
};

const liftFirstItemParagraph: Command = (state, dispatch) => {
  const $p = atBlockStart(state);
  if (!$p) return false;
  const d = inList($p);
  if (d < 0 || d !== $p.depth - 1 || $p.index(d) !== 0) return false;
  return liftListItem(S.list_item)(state, dispatch);
};

const liftFirstQuoteParagraph: Command = (state, dispatch) => {
  const $p = atBlockStart(state);
  if (!$p) return false;
  const d = inQuote($p);
  if (d < 0 || d !== $p.depth - 1 || $p.index(d) !== 0) return false;
  const range = $p.blockRange();
  const target = range && liftTarget(range);
  if (!range || target == null) return false;
  if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView());
  return true;
};

/** A paragraph after a rich block selects that block first (3.4). */
const selectRichBefore: Command = (state, dispatch) => {
  const $p = atBlockStart(state);
  if (!$p) return false;
  const index = $p.index($p.depth - 1);
  if (index === 0) return false;
  const before = $p.node($p.depth - 1).child(index - 1);
  if (before.type !== S.raw && before.type !== S.hr) return false;
  if (dispatch) {
    const pos = $p.before() - before.nodeSize;
    dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView());
  }
  return true;
};

const emptyRawToParagraph: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type !== S.raw || $from.parent.content.size) return false;
  if (dispatch) {
    const pos = $from.before();
    const tr = state.tr.setNodeMarkup(pos, S.paragraph, { uid: freshUid() });
    dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)));
  }
  return true;
};

/** Inside a raw block, Backspace at its start does nothing but select it. */
const rawStart: Command = (state, dispatch) => {
  const $p = atBlockStart(state);
  if (!$p || $p.parent.type !== S.raw) return false;
  if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, $p.before())));
  return true;
};

const deleteAutoPair = (opts: EditorOptions): Command => (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !isProse($from.parent)) return false;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, "\n");
  const after = $from.parent.textBetween($from.parentOffset, Math.min($from.parent.content.size, $from.parentOffset + 1), undefined, "\n");
  const pair = pairFor(before, opts);
  if (!pair || pair !== after) return false;
  if (dispatch) dispatch(state.tr.delete($from.pos - 1, $from.pos + 1));
  return true;
};

export function backspace(opts: EditorOptions): Command {
  return chainCommands(
    deleteSelection,
    deleteAutoPair(opts),
    emptyRawToParagraph,
    rawStart,
    headingToParagraph,
    liftFirstItemParagraph,
    liftFirstQuoteParagraph,
    selectRichBefore,
    joinBackward,
    selectNodeBackward,
  );
}

const joinProseForward: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== $from.parent.content.size || !$from.parent.isTextblock) return false;
  const after = Selection.findFrom(state.doc.resolve($from.after()), 1, true);
  const next = after?.$from.parent;
  if (next && after && (next.type === S.raw || next.type === S.hr || after instanceof NodeSelection)) {
    if (dispatch) {
      const nextPos = after instanceof NodeSelection ? after.from : after.$from.before();
      dispatch(state.tr.setSelection(NodeSelection.create(state.doc, nextPos)));
    }
    return true;
  }
  return false;
};

export const del: Command = chainCommands(deleteSelection, joinProseForward, joinForward, selectNodeForward);

/** Mod+Shift+Backspace: delete to the start of the line. */
export const deleteToLineStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return false;
  const text = blockSource($from.parent).slice(0, $from.parentOffset);
  const lineStart = text.lastIndexOf("\n") + 1;
  if (lineStart === $from.parentOffset) return false;
  if (dispatch) dispatch(state.tr.delete($from.start() + lineStart, $from.pos));
  return true;
};

// ---- Tab -------------------------------------------------------------------------------

export const tab: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type === S.raw) {
    if (dispatch) dispatch(state.tr.insertText("    "));
    return true;
  }
  if (inList($from) >= 0) {
    sinkListItem(S.list_item)(state, dispatch);
    return true;
  }
  return true; // ignored elsewhere (3.5)
};

export const shiftTab: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type === S.raw) {
    if (dispatch) {
      const text = blockSource($from.parent).slice(0, $from.parentOffset);
      const lineStart = $from.start() + text.lastIndexOf("\n") + 1;
      const line = blockSource($from.parent).slice(lineStart - $from.start());
      const n = /^ {1,4}|^\t/.exec(line)?.[0].length ?? 0;
      if (n) dispatch(state.tr.delete(lineStart, lineStart + n));
    }
    return true;
  }
  if (inList($from) >= 0) {
    liftListItem(S.list_item)(state, dispatch);
    return true;
  }
  return true;
};

// ---- auto-pairing ----------------------------------------------------------------------

const BRACKETS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
const MD_SYMBOLS: Record<string, string> = { "*": "*", _: "_", "`": "`", "~": "~", "=": "=", $: "$" };

function pairFor(open: string, opts: EditorOptions): string | null {
  if (opts.autoPairBrackets && BRACKETS[open]) return BRACKETS[open];
  if (opts.autoPairMarkdown && MD_SYMBOLS[open]) return MD_SYMBOLS[open];
  return null;
}

const CLOSERS = new Set([")", "]", "}", '"', "'", "*", "_", "`", "~", "=", "$"]);

/** handleTextInput for auto-pairing (3.3). Returns true when handled. */
export function autoPair(state: EditorState, from: number, to: number, text: string, opts: EditorOptions, dispatch: (tr: Transaction) => void): boolean {
  if (text.length !== 1) return false;
  const $from = state.doc.resolve(from);
  if (!isProse($from.parent)) return false;
  const sel = state.selection;
  const close = pairFor(text, opts);
  // With a selection: wrap it and keep it selected inside the pair.
  if (!sel.empty && close && sel.from === from && sel.to === to && $from.sameParent(state.doc.resolve(to))) {
    const tr = state.tr.insertText(close, to).insertText(text, from);
    tr.setSelection(TextSelection.create(tr.doc, from + 1, to + 1));
    dispatch(tr);
    return true;
  }
  if (!sel.empty) return false;
  const next = $from.parent.textBetween($from.parentOffset, Math.min($from.parent.content.size, $from.parentOffset + 1), undefined, "\n");
  // Typing the closing char right before an identical one steps over it.
  if (CLOSERS.has(text) && next === text && (BRACKETS[Object.keys(BRACKETS).find((k) => BRACKETS[k] === text) ?? ""] || MD_SYMBOLS[text])) {
    const prev = $from.parent.textBetween(0, $from.parentOffset, undefined, "\n");
    const opener = Object.keys(BRACKETS).find((k) => BRACKETS[k] === text) ?? text;
    if (prev.includes(opener) || opener === text) {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)));
      return true;
    }
  }
  if (!close) return false;
  if (text === '"' || text === "'") {
    const prev = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, "\n");
    if (/[\p{L}\p{N}]/u.test(prev)) return false; // apostrophes
  }
  const tr = state.tr.insertText(text + close, from, to);
  tr.setSelection(TextSelection.create(tr.doc, from + 1));
  dispatch(tr);
  return true;
}

// ---- space-triggered input rules (from handleTextInput) ---------------------------------------

/**
 * Space-triggered block rules from handleTextInput (3.3). The typed space is dispatched
 * first (it joins the typing undo step), then the transformation as its own step, so
 * one undo restores the trigger text as typed.
 */
export function spaceInputRule(
  getState: () => EditorState,
  from: number,
  to: number,
  text: string,
  dispatch: (tr: Transaction) => void,
): boolean {
  const state = getState();
  if (text !== " " || from !== to) return false;
  const $from = state.doc.resolve(from);
  if ($from.parent.type !== S.paragraph) return false;
  const prefix = $from.parent.textBetween(0, $from.parentOffset, undefined, "\n");
  if (prefix.includes("\n") || prefix.length > 12 || !spaceRule(state, $from, prefix)) return false;
  dispatch(state.tr.insertText(" ", from, to).setMeta(SKIP_ESCAPES, true));
  const after = getState();
  const tr = spaceRule(after, after.selection.$from, prefix);
  if (tr) dispatch(closeHistory(tr).scrollIntoView());
  return true;
}

// ---- formatting (3.6) ----------------------------------------------------------------------

export type InlineFormat = "strong" | "em" | "underline" | "code" | "strike" | "highlight" | "math";

const FORMAT_KIND: Record<InlineFormat, InlineKind | "underline" | "highlight"> = {
  strong: "strong",
  em: "em",
  underline: "underline",
  code: "code",
  strike: "strike",
  highlight: "highlight",
  math: "math",
};

function markersFor(format: InlineFormat, content: string): [string, string] {
  switch (format) {
    case "strong":
      return ["**", "**"];
    case "em":
      return ["*", "*"];
    case "underline":
      return ["<u>", "</u>"];
    case "strike":
      return ["~~", "~~"];
    case "highlight":
      return ["==", "=="];
    case "math":
      return ["$", "$"];
    case "code": {
      const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((r) => r.length));
      const ticks = "`".repeat(longest + 1);
      const pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
      return [ticks + pad, pad + ticks];
    }
  }
}

function matchesFormat(e: InlineElement, format: InlineFormat): boolean {
  if (format === "underline") return e.kind === "html" && e.nodeName === "u";
  return e.kind === FORMAT_KIND[format];
}

/** Remove an element's markers (all runs). */
function unwrap(tr: Transaction, start: number, e: InlineElement) {
  for (const [a, b] of [...e.runs].sort((x, y) => y[0] - x[0])) tr.delete(tr.mapping.map(start + a), tr.mapping.map(start + b));
}

export function toggleFormat(format: InlineFormat, opts: EditorOptions): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    const { $from, $to } = sel;
    if (!$from.parent.isTextblock || !isProse($from.parent)) {
      if (sel.empty) return false;
    }
    if (sel.empty || $from.sameParent($to)) {
      if (!isProse($from.parent)) return false;
      const els = elementsAt(state, $from, opts);
      const start = $from.start();
      const from = $from.parentOffset;
      const to = $to.parentOffset;
      if (!sel.empty) {
        const exact = els.find((e) => matchesFormat(e, format) && e.contentFrom === from && e.contentTo === to);
        if (exact) {
          if (dispatch) {
            const tr = state.tr;
            unwrap(tr, start, exact);
            dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(start + from, 1), tr.mapping.map(start + to, -1))));
          }
          return true;
        }
        if (dispatch) {
          const text = state.doc.textBetween(sel.from, sel.to, undefined, "\n");
          const [open, close] = markersFor(format, text);
          const tr = state.tr.insertText(close, sel.to).insertText(open, sel.from);
          dispatch(tr.setSelection(TextSelection.create(tr.doc, sel.from + open.length, sel.to + open.length)));
        }
        return true;
      }
      const inside = els.filter((e) => matchesFormat(e, format) && e.from < from && from < e.to).pop();
      if (inside) {
        if (dispatch) {
          const tr = state.tr;
          unwrap(tr, start, inside);
          dispatch(tr);
        }
        return true;
      }
      if (dispatch) {
        const [open, close] = markersFor(format, "");
        const tr = state.tr.insertText(open + close, sel.from);
        dispatch(tr.setSelection(TextSelection.create(tr.doc, sel.from + open.length)));
      }
      return true;
    }
    // Selection across blocks: format each textblock's selected part separately.
    if (dispatch) {
      const tr = state.tr;
      const ranges: [number, number][] = [];
      state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
        if (!isProse(node)) return !node.isTextblock;
        const a = Math.max(sel.from, pos + 1);
        const b = Math.min(sel.to, pos + 1 + node.content.size);
        if (b > a) ranges.push([a, b]);
        return false;
      });
      for (const [a, b] of ranges.reverse()) {
        const [open, close] = markersFor(format, state.doc.textBetween(a, b, undefined, "\n"));
        tr.insertText(close, b).insertText(open, a);
      }
      dispatch(tr);
    }
    return true;
  };
}

/** Mod+K (3.6). `clipboardUrl` is the clipboard text when it is a URL. */
export function insertLink(clipboardUrl: string | null): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!isProse(sel.$from.parent) || !sel.$from.sameParent(sel.$to)) return false;
    if (!dispatch) return true;
    if (sel.empty) {
      const tr = state.tr.insertText("[]()", sel.from);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, sel.from + 1)));
      return true;
    }
    const url = clipboardUrl ?? "";
    const tr = state.tr.insertText(`](${url})`, sel.to).insertText("[", sel.from);
    const end = sel.to + 1 + 2 + url.length + (url ? 1 : 0);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, url ? end : end)));
    return true;
  };
}

export function isUrl(text: string): boolean {
  return /^(https?:\/\/|mailto:|ftp:\/\/|file:\/\/)[^\s]+$/i.test(text.trim());
}

/** Mod+\: remove inline syntax of elements fully inside the selection. */
export function clearFormat(opts: EditorOptions): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (sel.empty) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    state.doc.nodesBetween(sel.from, sel.to, (node, pos) => {
      if (!isProse(node)) return !node.isTextblock;
      const start = pos + 1;
      const defs = inlineKey.getState(state)?.defs;
      if (!defs) return false;
      for (const e of flatten(elementsOf(node, defs, opts))) {
        if (start + e.from < sel.from || start + e.to > sel.to) continue;
        if (e.kind === "escape" || e.kind === "entity" || e.kind === "emoji" || e.kind === "image") continue;
        let runs = e.runs;
        if (e.kind === "link") runs = [[e.from, e.contentFrom], [e.contentTo, e.to]];
        for (const [a, b] of [...runs].sort((x, y) => y[0] - x[0])) tr.delete(tr.mapping.map(start + a), tr.mapping.map(start + b));
      }
      return false;
    });
    dispatch(tr);
    return true;
  };
}

// ---- block types (3.6, 12 Paragraph menu) ---------------------------------------------------------

function textblocksInSelection(state: EditorState): { node: Node; pos: number }[] {
  const out: { node: Node; pos: number }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      out.push({ node, pos });
      return false;
    }
    return true;
  });
  return out;
}

export function setHeading(level: number): Command {
  return (state, dispatch) => {
    const blocks = textblocksInSelection(state).filter((b) => isProse(b.node));
    if (!blocks.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { node, pos } of blocks) {
        if (level === 0) {
          if (node.type !== S.paragraph) tr.setNodeMarkup(pos, S.paragraph, keepLeaf(node.attrs));
        } else if (node.type === S.heading) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, level });
        } else {
          tr.setNodeMarkup(pos, S.heading, { ...keepLeaf(node.attrs), level });
        }
      }
      dispatch(tr);
    }
    return true;
  };
}

export function shiftHeading(delta: 1 | -1): Command {
  return (state, dispatch) => {
    const blocks = textblocksInSelection(state).filter((b) => isProse(b.node));
    if (!blocks.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { node, pos } of blocks) {
        if (node.type === S.paragraph) {
          if (delta > 0) tr.setNodeMarkup(pos, S.heading, { ...keepLeaf(node.attrs), level: 6 });
        } else {
          const level = node.attrs.level - delta;
          if (level > 6) tr.setNodeMarkup(pos, S.paragraph, keepLeaf(node.attrs));
          else if (level >= 1) tr.setNodeMarkup(pos, undefined, { ...node.attrs, level });
        }
      }
      dispatch(tr);
    }
    return true;
  };
}

function toggleList(listType: NodeType, attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const d = inList($from);
    if (d > 0 && $from.node(d - 1).type === listType) return liftListItem(S.list_item)(state, dispatch);
    if (d > 0) {
      // Change the type of the surrounding list.
      if (dispatch) {
        const pos = $from.before(d - 1);
        dispatch(state.tr.setNodeMarkup(pos, listType, { ...attrs, uid: freshUid() }));
      }
      return true;
    }
    return wrapInList(listType, { ...attrs, uid: freshUid() })(state, dispatch);
  };
}

export const toggleBulletList = toggleList(S.bullet_list, { bullet: "-", tight: true, items: null });
export const toggleOrderedList = toggleList(S.ordered_list, { start: 1, delim: ".", numbering: "seq", tight: true, items: null });

export const toggleQuote: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  const d = inQuote($from);
  if (d > 0) {
    const range = $from.blockRange($to);
    const target = range && liftTarget(range);
    if (!range || target == null) return false;
    if (dispatch) dispatch(state.tr.lift(range, target));
    return true;
  }
  const range = $from.blockRange($to);
  if (!range) return false;
  if (dispatch) dispatch(state.tr.wrap(range, [{ type: S.blockquote, attrs: { uid: freshUid() } }]));
  return true;
};

export const indent: Command = (state, dispatch) => sinkListItem(S.list_item)(state, dispatch);
export const outdent: Command = (state, dispatch) => liftListItem(S.list_item)(state, dispatch);

/** Alt+Up / Alt+Down: move the current list item (or block) among its siblings. */
export function moveBlock(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    let depth = inList($from);
    if (depth < 0) depth = 1;
    if (depth > $from.depth) return false;
    const parent = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    const target = index + dir;
    if (target < 0 || target >= parent.childCount) return false;
    if (dispatch) {
      const node = parent.child(index);
      const other = parent.child(target);
      const pos = $from.before(depth);
      const tr = state.tr;
      const offset = $from.pos - pos;
      if (dir < 0) {
        const otherPos = pos - other.nodeSize;
        tr.replaceWith(otherPos, pos + node.nodeSize, Fragment.from([node, other]));
        tr.setSelection(TextSelection.create(tr.doc, otherPos + offset));
      } else {
        tr.replaceWith(pos, pos + node.nodeSize + other.nodeSize, Fragment.from([other, node]));
        tr.setSelection(TextSelection.create(tr.doc, pos + other.nodeSize + offset));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// ---- selection (3.7) -----------------------------------------------------------------------

export const selectAll: Command = (state, dispatch) => {
  const { $from, from, to } = state.selection;
  if ($from.parent.type === S.raw) {
    const start = $from.start();
    const end = $from.end();
    if (from !== start || to !== end) {
      if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
      return true;
    }
  }
  if (dispatch) dispatch(state.tr.setSelection(new AllSelection(state.doc)));
  return true;
};

const WORD = /[\p{L}\p{N}_]/u;

export const selectWord: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return false;
  const text = blockSource($from.parent);
  let a = $from.parentOffset;
  let b = a;
  while (a > 0 && WORD.test(text[a - 1])) a--;
  while (b < text.length && WORD.test(text[b])) b++;
  if (a === b) return false;
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.start() + a, $from.start() + b)));
  return true;
};

export const deleteWord: Command = (state, dispatch) => {
  if (!selectWord(state)) return false;
  let sel: Transaction | null = null;
  selectWord(state, (tr) => (sel = tr));
  if (dispatch && sel) dispatch((sel as Transaction).deleteSelection());
  return true;
};

/** Mod+L: select the current source line; repeated presses extend by one line. */
export const selectLine: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if (!$from.parent.isTextblock) return false;
  const text = blockSource($to.parent);
  const lineStartOf = (t: string, off: number) => t.lastIndexOf("\n", off - 1) + 1;
  const lineEndOf = (t: string, off: number) => {
    const i = t.indexOf("\n", off);
    return i < 0 ? t.length : i;
  };
  const fromText = blockSource($from.parent);
  const a = $from.start() + lineStartOf(fromText, $from.parentOffset);
  let b = $to.start() + lineEndOf(text, $to.parentOffset);
  if (state.selection.from === a && state.selection.to === b) {
    // Extend by one line.
    const after = b - $to.start();
    if (after < text.length) b = $to.start() + lineEndOf(text, after + 1);
    else {
      const next = Selection.findFrom(state.doc.resolve($to.after()), 1, true);
      if (next && next.$from.parent.isTextblock) b = next.$from.start() + lineEndOf(blockSource(next.$from.parent), 0);
    }
  }
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, a, b)));
  return true;
};

/** Mod+E: select the innermost styled scope, growing on repeat. */
export function selectScope(opts: EditorOptions): Command {
  return (state, dispatch) => {
    const { $from, from, to } = state.selection;
    if (!$from.parent.isTextblock) return false;
    const start = $from.start();
    const candidates: [number, number][] = [];
    for (const e of elementsAt(state, $from, opts)) {
      if (start + e.from <= from && to <= start + e.to) {
        candidates.push([start + e.contentFrom, start + e.contentTo], [start + e.from, start + e.to]);
      }
    }
    candidates.push([start, $from.end()]);
    candidates.sort((x, y) => x[1] - x[0] - (y[1] - y[0]));
    const next = candidates.find(([a, b]) => a <= from && to <= b && (a < from || b > to));
    if (!next) return false;
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, next[0], next[1])));
    return true;
  };
}
