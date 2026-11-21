// Clipboard (spec 06, text paths; images and files come with P2's image policy).

import { Fragment, Slice, type Node } from "prosemirror-model";
import { TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { markdownToHtml } from "../md/html";
import { flatten } from "../md/inline";
import { parseMdast } from "../md/mdast";
import { parseMarkdown } from "../md/parse";
import { schema } from "../md/schema";
import { serialize } from "../md/serialize";
import { isUrl } from "./commands";
import { blockSource, elementsOf, isProse, type EditorOptions } from "./context";
import { inlineKey } from "./decorations";

// ---- copy ------------------------------------------------------------------------------

/** Markdown source of the selection (6.1). */
export function selectionMarkdown(state: EditorState, opts: EditorOptions): string {
  const { $from, $to, from, to, empty } = state.selection;
  if (empty) return "";
  if ($from.parent === $to.parent && $from.parent.isTextblock) {
    const node = $from.parent;
    const a = $from.parentOffset;
    const b = $to.parentOffset;
    let text = node.textBetween(a, b, undefined, "\n");
    if (!isProse(node)) return text;
    const defs = inlineKey.getState(state)?.defs;
    if (!defs) return text;
    // Elements cut by the selection contribute their markers (copying "ol" in
    // **bold** gives **ol**).
    const src = blockSource(node);
    let before = "";
    let after = "";
    for (const e of flatten(elementsOf(node, defs, opts))) {
      const startsInside = e.from < a && a < e.to;
      const endsInside = e.from < b && b < e.to;
      if (!(startsInside || endsInside) || e.runs.length === 0) continue;
      if (a >= e.contentFrom && b <= e.contentTo) {
        before += src.slice(e.from, e.contentFrom);
        after = src.slice(e.contentTo, e.to) + after;
      }
    }
    text = before + text + after;
    return text;
  }
  // Several blocks: every touched block with its block syntax and container prefixes.
  const slice = state.doc.slice(from, to);
  const depth = $from.sharedDepth(to);
  let content = slice.content;
  for (let d = depth; d > 0; d--) content = Fragment.from($from.node(d).copy(content));
  const doc = schema.topNodeType.create({ ...state.doc.attrs, tail: null, lastUid: null, finalNewline: false }, content);
  return serialize(doc);
}

/** The rendered plain text of the selection (Copy as Plain Text). */
export function selectionPlainText(state: EditorState): string {
  const md = selectionMarkdown(state, { ...defaultPlain });
  const div = document.createElement("div");
  div.innerHTML = markdownToHtml(md);
  return div.innerText.replace(/\n+$/, "");
}
const defaultPlain = { inlineMath: false } as EditorOptions;

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export interface ClipboardFlavors {
  text: string;
  html: string;
}

export function copyFlavors(state: EditorState, opts: EditorOptions, asPlain = false): ClipboardFlavors {
  const md = selectionMarkdown(state, opts);
  const html = `<div data-scrim-source="${toBase64(md)}">${markdownToHtml(md)}</div>`;
  const text = opts.copyMarkdown && !asPlain ? md : selectionPlainText(state);
  return { text, html };
}

// ---- paste -----------------------------------------------------------------------------

let turndown: TurndownService | null = null;

/** HTML from browsers and word processors → Markdown (6.2 item 2). */
export function htmlToMarkdown(html: string): string {
  if (!turndown) {
    turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
      strongDelimiter: "**",
      hr: "---",
    });
    turndown.use(gfm);
    turndown.remove(["script", "style", "noscript", "iframe", "object", "embed", "meta", "link"]);
    turndown.addRule("trackingPixels", {
      filter: (node) => node.nodeName === "IMG" && (node.getAttribute("width") === "1" || node.getAttribute("height") === "1"),
      replacement: () => "",
    });
  }
  return turndown.turndown(html).replace(/\n+$/, "");
}

/** Markdown fragment → nodes to insert. */
function fragmentFor(md: string, opts: EditorOptions): Fragment {
  const { doc } = parseMarkdown(md.replace(/\r\n?/g, "\n"), { inlineMath: opts.inlineMath });
  return doc.content;
}

function inlineOnly(frag: Fragment): Node | null {
  return frag.childCount === 1 && frag.firstChild!.type === schema.nodes.paragraph ? frag.firstChild : null;
}

/** Insert Markdown at the selection, as if typed (6.2). */
export function insertMarkdown(view: EditorView, md: string, opts: EditorOptions) {
  const { state } = view;
  const { $from } = state.selection;
  if ($from.parent.type === schema.nodes.raw) return insertRaw(view, md);
  const frag = fragmentFor(md, opts);
  const para = inlineOnly(frag);
  let tr = state.tr;
  if (para) {
    tr = tr.replaceSelection(new Slice(para.content, 0, 0));
  } else {
    const first = frag.firstChild;
    const last = frag.lastChild;
    const openStart = first && first.isTextblock && $from.parent.isTextblock ? 1 : 0;
    const openEnd = last && last.isTextblock && $from.parent.isTextblock ? 1 : 0;
    tr = tr.replaceSelection(new Slice(frag, openStart, openEnd));
  }
  view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"));
}

function insertRaw(view: EditorView, text: string) {
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  const nodes: Node[] = [];
  parts.forEach((p, i) => {
    if (i) nodes.push(schema.nodes.line_break.create());
    if (p) nodes.push(schema.text(p));
  });
  view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0)).scrollIntoView());
}

const PUNCT = /[!-\/:-@\[-`{-~]/;

/** Literal insertion (6.2): Markdown whose rendered text equals `line`. */
export function literalLine(line: string, opts: EditorOptions): string {
  const text = line.replace(/^[ \t]+/, "");
  const minimal = text.replace(/[\\`*_\[\]<|~=$^]|!(?=\[)|&(?=#?[A-Za-z0-9]+;)|:(?=[a-z0-9_+-]+:)/g, (c) => `\\${c}`);
  const escapeStart = (s: string) =>
    s.replace(/^(#{1,6}(?=\s|$)|[>+\-]|\d{1,9}(?=[.)]))/, (m) => (/^\d/.test(m) ? m : `\\${m}`)).replace(/^(\d{1,9})([.)])/, "$1\\$2");
  const candidate = escapeStart(minimal);
  if (rendersAs(candidate, text, opts)) return candidate;
  const all = [...text].map((c) => (PUNCT.test(c) ? `\\${c}` : c)).join("");
  return all;
}

function rendersAs(md: string, text: string, opts: EditorOptions): boolean {
  if (!md) return true;
  const root = parseMdast(md, { inlineMath: opts.inlineMath, frontMatter: false });
  if (root.children.length !== 1 || root.children[0].type !== "paragraph") return false;
  const p = root.children[0];
  return p.children.every((c) => c.type === "text") && p.children.map((c) => (c as { value: string }).value).join("") === text;
}

export function insertLiteral(view: EditorView, text: string, opts: EditorOptions) {
  const { $from } = view.state.selection;
  if ($from.parent.type === schema.nodes.raw) return insertRaw(view, text);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length === 1) {
    view.dispatch(view.state.tr.insertText(literalLine(lines[0], opts)).scrollIntoView());
    return;
  }
  const paras = lines.map((l) => {
    const md = literalLine(l, opts);
    return schema.nodes.paragraph.create(null, md ? schema.text(md) : null);
  });
  view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(paras), 1, 1)).scrollIntoView());
}

/** Read a paste event's flavors in priority order (6.2) and insert. */
export function handlePaste(view: EditorView, event: ClipboardEvent, opts: EditorOptions, plain: boolean): boolean {
  const data = event.clipboardData;
  if (!data) return false;
  const html = data.getData("text/html");
  const text = data.getData("text/plain");
  if (plain) {
    insertLiteral(view, text || htmlToText(html), opts);
    return true;
  }
  const { state } = view;
  // A URL pasted over a selection turns it into a link.
  if (!state.selection.empty && text && isUrl(text) && state.selection.$from.sameParent(state.selection.$to) && isProse(state.selection.$from.parent)) {
    const { from, to } = state.selection;
    const url = text.trim();
    const tr = state.tr.insertText(`](${url})`, to).insertText("[", from);
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, to + 3 + url.length + 1)));
    return true;
  }
  if (html) {
    const m = /data-scrim-source="([^"]*)"/.exec(html);
    if (m) {
      insertMarkdown(view, fromBase64(m[1]), opts);
      return true;
    }
    if (state.selection.$from.parent.type !== schema.nodes.raw) {
      insertMarkdown(view, htmlToMarkdown(html), opts);
      return true;
    }
  }
  if (text) {
    insertMarkdown(view, text, opts);
    return true;
  }
  return false;
}

function htmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.innerText;
}
