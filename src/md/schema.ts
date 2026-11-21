// ProseMirror schema for Scrim documents (spec 01, "Document model").
//
// Blocks are nodes. The text of a textblock is its literal Markdown inline source, with
// every source line break represented by a `line_break` atom (leafText "\n"), so cursor
// positions map 1:1 to source characters. Round-trip metadata lives in attributes:
//
// - Every block-level node has a `uid`. Leaves also carry what is needed to re-emit
//   their original bytes when nothing about them changed:
//     sep   - text between the previous leaf's content and this leaf's first line
//             (previous terminator, blank lines with their prefixes)
//     prev  - uid of the leaf that preceded this one at load time
//     lead  - full prefix of the first line (container prefixes, list markers,
//             leading spaces); `marks` locates list markers inside it
//     sig   - container signature at load time (see serialize.ts)
// - Each `line_break` stores the terminator of the line it ends and the full prefix of
//   the line that follows.
// Attributes that are null mean "new": the serializer writes canonical Markdown.

import { Schema, type NodeSpec } from "prosemirror-model";

export interface MarkerSpan {
  /** uid of the list item whose marker this is */
  item: number;
  from: number;
  to: number;
  /** "task" for the `[ ]` of a task item; list marker otherwise */
  kind?: "task";
}

/** A line break between two source lines that is not part of a textblock's content. */
export interface LineBreakInfo {
  term: string;
  /** full prefix of the following line */
  prefix: string;
}

/** Closing line of a fenced block (code, math, front matter). */
export interface FenceClose {
  /** terminator before the closing line */
  term: string;
  /** the closing line including its prefix */
  line: string;
}

/** The delimiter row of a table. */
export interface DelimRow {
  term: string;
  prefix: string;
  text: string;
}

export interface SetextInfo {
  /** terminator between the last text line and the underline */
  term: string;
  /** the underline line including its container prefix */
  line: string;
}

const leafAttrs = {
  uid: { default: null as number | null },
  sep: { default: null as string | null },
  prev: { default: null as number | null },
  lead: { default: null as string | null },
  marks: { default: null as MarkerSpan[] | null },
  sig: { default: null as string | null },
};

const containerAttrs = { uid: { default: null as number | null } };

/** Attributes of a fenced block. `open` is the opening line after the lead (e.g.
 * "```js"); `info` the info string it was written with; `close` the closing line. */
function fencedAttrs(fence = "```") {
  return {
    ...leafAttrs,
    open: { default: null as string | null },
    fence: { default: fence },
    info: { default: "" },
    openInfo: { default: null as string | null },
    /** break between the opening line and the first content line */
    openBreak: { default: null as LineBreakInfo | null },
    close: { default: null as FenceClose | null },
    /** the block had no content lines at all */
    noLines: { default: false },
    /** the block had no closing fence (ran to the end of its container) */
    unclosed: { default: false },
  };
}

const nodes: Record<string, NodeSpec> = {
  doc: {
    content: "block+",
    attrs: {
      eol: { default: "\n" },
      finalNewline: { default: true },
      /** text after the last leaf's content (its terminator and trailing blank lines) */
      tail: { default: null as string | null },
      lastUid: { default: null as number | null },
    },
  },
  paragraph: {
    group: "block",
    content: "inline*",
    attrs: { ...leafAttrs },
    parseDOM: [{ tag: "p" }],
    toDOM: () => ["p", 0],
  },
  heading: {
    group: "block",
    content: "inline*",
    defining: true,
    attrs: {
      ...leafAttrs,
      level: { default: 1 },
      /** level the `open` sequence was written for */
      openLevel: { default: null as number | null },
      open: { default: null as string | null },
      close: { default: "" },
      setext: { default: null as SetextInfo | null },
      id: { default: null as string | null },
    },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [`h${node.attrs.level}`, { class: "md-heading", id: node.attrs.id ?? undefined }, 0],
  },
  hr: {
    group: "block",
    atom: true,
    selectable: true,
    attrs: { ...leafAttrs, text: { default: "---" } },
    parseDOM: [{ tag: "hr" }],
    toDOM: () => ["hr"],
  },
  /**
   * Fenced code (``` / ~~~) or indented code. Content is the code (line breaks as
   * `line_break`), fences are attributes.
   */
  code_block: {
    group: "block",
    content: "inline*",
    marks: "",
    code: true,
    defining: true,
    attrs: { ...fencedAttrs(), indented: { default: false } },
    parseDOM: [{ tag: "pre.md-fences", preserveWhitespace: "full" }],
    toDOM: (node) => ["pre", { class: "md-fences", lang: node.attrs.info.split(/\s/)[0] ?? "" }, 0],
  },
  /** `$$` … `$$` display math. */
  math_block: {
    group: "block",
    content: "inline*",
    marks: "",
    code: true,
    defining: true,
    attrs: fencedAttrs("$$"),
    parseDOM: [{ tag: "div.md-math-block", preserveWhitespace: "full" }],
    toDOM: () => ["div", { class: "md-math-block" }, 0],
  },
  /** YAML front matter at the very start of the file. */
  front_matter: {
    group: "block",
    content: "inline*",
    marks: "",
    code: true,
    defining: true,
    attrs: fencedAttrs("---"),
    parseDOM: [{ tag: "pre.md-meta-block", preserveWhitespace: "full" }],
    toDOM: () => ["pre", { class: "md-meta-block" }, 0],
  },
  /** An HTML block: every line is content. */
  html_block: {
    group: "block",
    content: "inline*",
    marks: "",
    code: true,
    defining: true,
    attrs: { ...leafAttrs },
    parseDOM: [{ tag: "div.md-htmlblock", preserveWhitespace: "full" }],
    toDOM: () => ["div", { class: "md-htmlblock" }, 0],
  },
  /** `[toc]`: a live table of contents (spec 04, 4.12). */
  toc: {
    group: "block",
    atom: true,
    selectable: true,
    attrs: { ...leafAttrs, text: { default: "[toc]" } },
    parseDOM: [{ tag: "div.md-toc" }],
    toDOM: () => ["div", { class: "md-toc" }],
  },
  table: {
    group: "block",
    content: "table_row+",
    isolating: true,
    attrs: {
      ...leafAttrs,
      /** per column: null, "left", "center", "right" */
      align: { default: [] as (string | null)[] },
      /** alignment at load; the delimiter row is rewritten only if it changes */
      origAlign: { default: null as (string | null)[] | null },
      delim: { default: null as DelimRow | null },
    },
    parseDOM: [{ tag: "figure.md-table-fig" }],
    toDOM: () => ["figure", { class: "md-table-fig" }, ["table", ["tbody", 0]]],
  },
  table_row: {
    content: "table_cell+",
    attrs: {
      /** row line as read (after its prefix), null for new rows */
      src: { default: null as string | null },
      /** cell texts as read, to detect edits */
      cells: { default: null as string[] | null },
      /** terminator before this row and the row line's prefix (not for the header) */
      term: { default: null as string | null },
      prefix: { default: null as string | null },
    },
    parseDOM: [{ tag: "tr" }],
    toDOM: () => ["tr", 0],
  },
  table_cell: {
    content: "inline*",
    marks: "",
    isolating: true,
    attrs: { header: { default: false } },
    parseDOM: [
      { tag: "th", attrs: { header: true } },
      { tag: "td", attrs: { header: false } },
    ],
    toDOM: (node) => [node.attrs.header ? "th" : "td", 0],
  },
  /** `[^label]: …` footnote definition: a container (spec 04, 4.13). */
  footnote_def: {
    group: "block",
    content: "block+",
    defining: true,
    attrs: { ...containerAttrs, label: { default: "1" } },
    parseDOM: [{ tag: "div.md-def-footnote" }],
    toDOM: (node) => ["div", { class: "md-def-footnote", "data-label": node.attrs.label }, 0],
  },
  /** Any block that is not edited structurally: kept as exact source, shown as text. */
  raw: {
    group: "block",
    content: "inline*",
    marks: "",
    code: true,
    defining: true,
    attrs: { ...leafAttrs, kind: { default: "raw" } },
    parseDOM: [{ tag: "pre.md-raw", preserveWhitespace: "full" }],
    toDOM: (node) => ["pre", { class: `md-raw md-raw-${node.attrs.kind}`, spellcheck: "false" }, 0],
  },
  blockquote: {
    group: "block",
    content: "block+",
    defining: true,
    attrs: { ...containerAttrs },
    parseDOM: [{ tag: "blockquote" }],
    toDOM: () => ["blockquote", 0],
  },
  bullet_list: {
    group: "block",
    content: "list_item+",
    attrs: {
      ...containerAttrs,
      bullet: { default: "-" },
      tight: { default: true },
      /** item uids in order at load time; a different order means the list changed */
      items: { default: null as number[] | null },
    },
    parseDOM: [{ tag: "ul" }],
    toDOM: (node) => ["ul", node.attrs.tight ? {} : { class: "md-list-loose" }, 0],
  },
  ordered_list: {
    group: "block",
    content: "list_item+",
    attrs: {
      ...containerAttrs,
      start: { default: 1 },
      delim: { default: "." },
      /** "seq" | "same" | "irregular" (spec 01, round-trip model item 5) */
      numbering: { default: "seq" },
      tight: { default: true },
      items: { default: null as number[] | null },
    },
    parseDOM: [{ tag: "ol" }],
    toDOM: (node) => {
      const attrs: Record<string, string> = {};
      if (node.attrs.start !== 1) attrs.start = String(node.attrs.start);
      if (!node.attrs.tight) attrs.class = "md-list-loose";
      return ["ol", attrs, 0];
    },
  },
  list_item: {
    content: "block+",
    defining: true,
    attrs: {
      ...containerAttrs,
      marker: { default: null as string | null },
      /** task state: null (not a task), " ", "x" or "X" */
      task: { default: null as string | null },
    },
    parseDOM: [{ tag: "li" }],
    toDOM: (node) =>
      node.attrs.task === null
        ? ["li", 0]
        : ["li", { class: `task-list-item${node.attrs.task === " " ? "" : " task-list-done"}` }, 0],
  },
  text: { group: "inline" },
  line_break: {
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    leafText: () => "\n",
    attrs: {
      /** terminator of the line this break ends; null = document line ending */
      term: { default: null as string | null },
      /** full prefix of the following line; null = canonical continuation */
      prefix: { default: null as string | null },
    },
    parseDOM: [{ tag: "br" }],
    toDOM: () => ["span", { class: "md-br" }, ["br"]],
  },
};

export const schema = new Schema({
  nodes,
  marks: {
    /** A backslash inserted by the editor to keep a line from changing block type. */
    auto_escape: {
      inclusive: false,
      excludes: "",
      parseDOM: [],
      toDOM: () => ["span", { class: "md-auto-escape" }, 0],
    },
  },
});

export const LEAF_TYPES = new Set([
  "paragraph", "heading", "hr", "raw", "code_block", "math_block", "front_matter", "html_block", "toc", "table",
]);
export const CONTAINER_TYPES = new Set(["blockquote", "bullet_list", "ordered_list", "list_item", "footnote_def"]);
/** Leaves whose content is edited as code (CodeMirror), not as Markdown inline source. */
export const CODE_TYPES = new Set(["code_block", "math_block", "front_matter", "html_block", "raw"]);
export const FENCED_TYPES = new Set(["code_block", "math_block", "front_matter"]);

let uidCounter = 1;
export function freshUid(): number {
  return uidCounter++;
}
/** Make sure future uids do not collide with `uid` (after loading a document). */
export function bumpUid(uid: number) {
  if (uid >= uidCounter) uidCounter = uid + 1;
}
