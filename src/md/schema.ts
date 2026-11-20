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
  /** Any block that P1 does not edit structurally: kept as exact source, shown as text. */
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
    attrs: { ...containerAttrs, marker: { default: null as string | null } },
    parseDOM: [{ tag: "li" }],
    toDOM: () => ["li", 0],
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

export const LEAF_TYPES = new Set(["paragraph", "heading", "hr", "raw"]);
export const CONTAINER_TYPES = new Set(["blockquote", "bullet_list", "ordered_list", "list_item"]);

let uidCounter = 1;
export function freshUid(): number {
  return uidCounter++;
}
/** Make sure future uids do not collide with `uid` (after loading a document). */
export function bumpUid(uid: number) {
  if (uid >= uidCounter) uidCounter = uid + 1;
}
