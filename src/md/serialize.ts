// Document → Markdown (spec 01, "Round-trip model").
//
// The document is flattened into its leaf blocks (paragraph, heading, hr, raw), each
// with the chain of containers (blockquote, lists, list items) around it. A leaf whose
// container chain is unchanged since load (`sig` matches) re-emits its first-line prefix,
// line prefixes, and separator exactly as read; otherwise those are generated
// canonically from the current containers. Text inside a leaf is always emitted from
// the node's content, which is its Markdown source.

import type { Node } from "prosemirror-model";
import { CONTAINER_TYPES, tableRows } from "./schema";

export interface LeafEntry {
  node: Node;
  /** container ancestors, outermost first */
  chain: Node[];
  /** per chain entry: this leaf is the first leaf inside that container */
  first: boolean[];
}

/** Signature of a leaf's container chain; equal signatures mean equal prefixes. */
export function signature(chain: { type: string; uid: number | null }[], first: boolean[]): string {
  return chain
    .map((c, i) => `${c.type}:${c.uid}${c.type === "list_item" && first[i] ? "^" : ""}`)
    .join("/");
}

function entrySig(e: LeafEntry): string {
  return signature(
    e.chain.map((c) => ({ type: c.type.name, uid: c.attrs.uid })),
    e.first,
  );
}

export function collectLeaves(doc: Node): LeafEntry[] {
  const out: LeafEntry[] = [];
  const seen = new Set<Node>();
  const walk = (node: Node, chain: Node[]) => {
    node.forEach((child) => {
      if (CONTAINER_TYPES.has(child.type.name)) {
        walk(child, [...chain, child]);
      } else {
        const first = chain.map((c) => {
          if (seen.has(c)) return false;
          return true;
        });
        for (const c of chain) seen.add(c);
        out.push({ node: child, chain, first });
      }
    });
  };
  walk(doc, []);
  return out;
}

/** Current marker text of every list item, applying renumbering rules (item 5). */
export function listMarkers(doc: Node): Map<Node, string> {
  const markers = new Map<Node, string>();
  doc.descendants((node) => {
    if (node.type.name === "bullet_list") {
      node.forEach((item) => markers.set(item, item.attrs.marker ?? node.attrs.bullet));
    } else if (node.type.name === "ordered_list") {
      const { start, delim, numbering } = node.attrs;
      const stored: number[] | null = node.attrs.items;
      const uids: (number | null)[] = [];
      node.forEach((item) => uids.push(item.attrs.uid));
      const unchanged =
        stored !== null && stored.length === uids.length && stored.every((u, i) => u === uids[i]);
      let prevNum = start - 1;
      let index = 0;
      node.forEach((item) => {
        const known = item.attrs.marker !== null && stored?.includes(item.attrs.uid);
        let marker: string;
        if (unchanged && item.attrs.marker !== null) {
          marker = item.attrs.marker;
        } else if (numbering === "seq") {
          marker = `${start + index}${delim}`;
        } else if (numbering === "same") {
          marker = known ? item.attrs.marker : `${start}${delim}`;
        } else {
          marker = known ? item.attrs.marker : `${prevNum + 1}${delim}`;
        }
        const n = parseInt(marker, 10);
        prevNum = Number.isNaN(n) ? prevNum + 1 : n;
        markers.set(item, marker);
        index++;
      });
      return true;
    }
    return true;
  });
  return markers;
}

export function isEmptyParagraph(node: Node): boolean {
  return node.type.name === "paragraph" && node.content.size === 0;
}

export interface SerializeOptions {
  /** Pad table columns when a table is re-serialized (spec 04, 4.7; default on). */
  prettyTables?: boolean;
}

/** Display width of a string in a monospace view: wide East Asian characters count 2. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)
      ? 2
      : 1;
  }
  return w;
}

export class Serializer {
  readonly eol: string;
  readonly markers: Map<Node, string>;

  constructor(readonly doc: Node, readonly opts: SerializeOptions = {}) {
    this.eol = doc.attrs.eol;
    this.markers = listMarkers(doc);
  }

  private ok(e: LeafEntry): boolean {
    return e.node.attrs.sig !== null && e.node.attrs.sig === entrySig(e);
  }

  private markerOf(item: Node): string {
    return this.markers.get(item) ?? item.attrs.marker ?? "-";
  }

  /** Continuation prefix for lines of a leaf in `chain` (no list markers). */
  continuation(chain: Node[]): string {
    let s = "";
    for (const c of chain) {
      if (c.type.name === "blockquote") s += "> ";
      else if (c.type.name === "list_item") s += " ".repeat(this.markerOf(c).length + 1);
      else if (c.type.name === "footnote_def") s += "    ";
    }
    return s;
  }

  private canonicalLead(e: LeafEntry): string {
    let s = "";
    e.chain.forEach((c, i) => {
      if (c.type.name === "blockquote") s += "> ";
      else if (c.type.name === "list_item") {
        const m = this.markerOf(c);
        if (!e.first[i]) s += " ".repeat(m.length + 1);
        else s += c.attrs.task !== null ? `${m} [${c.attrs.task}] ` : `${m} `;
      } else if (c.type.name === "footnote_def") {
        s += e.first[i] ? `[^${c.attrs.label}]: ` : "    ";
      }
    });
    if (e.node.type.name === "code_block" && e.node.attrs.indented && !e.node.attrs.info) s += "    ";
    return s;
  }

  lead(e: LeafEntry, ok: boolean): string {
    const { lead, marks } = e.node.attrs;
    if (!ok || lead === null) return this.canonicalLead(e);
    if (!marks || marks.length === 0) return lead;
    const byUid = new Map<number, Node>();
    for (const c of e.chain) if (c.type.name === "list_item") byUid.set(c.attrs.uid, c);
    let out = lead;
    for (const m of [...marks].sort((a, b) => b.from - a.from)) {
      const item = byUid.get(m.item);
      if (!item) continue;
      if (m.kind === "task") {
        if (item.attrs.task !== null) out = out.slice(0, m.from) + `[${item.attrs.task}]` + out.slice(m.to);
      } else out = out.slice(0, m.from) + this.markerOf(item) + out.slice(m.to);
    }
    return out;
  }

  /** Inline content: text plus line breaks with their terminators and prefixes. */
  inline(e: LeafEntry, ok: boolean, breakAs?: string, node: Node = e.node, extraCont = ""): string {
    let s = "";
    let cont: string | null = null;
    node.forEach((child) => {
      if (child.isText) s += child.text;
      else if (child.type.name === "line_break") {
        if (breakAs !== undefined) {
          s += breakAs;
          return;
        }
        const term = child.attrs.term ?? this.eol;
        let prefix = ok ? child.attrs.prefix : null;
        if (prefix === null) prefix = cont ??= this.continuation(e.chain) + extraCont;
        s += term + prefix;
      }
    });
    return s;
  }

  body(e: LeafEntry, ok: boolean): string {
    const n = e.node;
    switch (n.type.name) {
      case "hr":
      case "toc":
        return n.attrs.text;
      case "code_block":
      case "math_block":
      case "front_matter":
        return this.fenced(e, ok);
      case "table":
        return this.table(e, ok);
      case "heading": {
        const { level, setext } = n.attrs;
        if (setext && level <= 2) {
          let line: string;
          if (ok) {
            line = setext.line.replace(/[=-]+/, (u: string) => (level === 1 ? "=" : "-").repeat(u.length));
          } else {
            line = this.continuation(e.chain) + (level === 1 ? "===" : "---");
          }
          return this.inline(e, ok) + (setext.term ?? this.eol) + line;
        }
        const open =
          n.attrs.open !== null && n.attrs.openLevel === level && !setext ? n.attrs.open : `${"#".repeat(level)} `;
        let close = n.attrs.open !== null && !setext ? n.attrs.close : "";
        const text = this.inline(e, ok, " ");
        if (close && text && !/^[ \t]/.test(close)) close = ` ${close}`;
        return open + text + close;
      }
      default:
        return this.inline(e, ok);
    }
  }

  /** Fenced code, display math, front matter; or indented code. */
  private fenced(e: LeafEntry, ok: boolean): string {
    const n = e.node;
    const a = n.attrs;
    const cont = this.continuation(e.chain);
    if (n.type.name === "code_block" && a.indented && !a.info) {
      return this.inline(e, ok, undefined, n, "    ");
    }
    // Indented code that got a language becomes fenced: its line prefixes held the
    // indentation, so they are written canonically.
    const linesOk = ok && !a.indented;
    let fence: string = a.fence;
    const text = this.inline(e, linesOk);
    const reuseOpen = a.open !== null && a.openInfo === a.info && !a.indented;
    if (!reuseOpen && n.type.name === "code_block") {
      // A fence longer than any run of the fence character that starts a content line.
      let longest = 0;
      for (const line of text.split(/\r\n?|\n/)) {
        const run = new RegExp(`^\\s*(\\${fence[0]}+)`).exec(line);
        if (run) longest = Math.max(longest, run[1].length);
      }
      if (longest >= fence.length) fence = fence[0].repeat(longest + 1);
    }
    let out = reuseOpen ? a.open : n.type.name === "code_block" ? fence + a.info : fence + (a.info ? a.info : "");
    const hasLines = !(a.noLines && n.content.size === 0);
    if (hasLines) {
      const ob = linesOk && a.openBreak ? a.openBreak : { term: this.eol, prefix: cont };
      out += ob.term + ob.prefix + text;
    }
    if (a.unclosed && ok && !a.indented) return out;
    const closeFence = n.type.name === "front_matter" ? "---" : fence;
    const close = linesOk && a.close ? a.close : { term: this.eol, line: cont + closeFence };
    return out + close.term + close.line;
  }

  private table(e: LeafEntry, ok: boolean): string {
    const t = e.node;
    const align: (string | null)[] = t.attrs.align;
    const rows: { node: Node; cells: string[] }[] = [];
    tableRows(t).forEach((row) => {
      const cells: string[] = [];
      row.forEach((cell) => cells.push(cell.textBetween(0, cell.content.size, undefined, " ")));
      rows.push({ node: row, cells });
    });
    const cols = Math.max(align.length, ...rows.map((r) => r.cells.length));
    const same = (a: string[] | null, b: string[]) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);
    const rowChanged = rows.map((r) => r.node.attrs.src === null || !same(r.node.attrs.cells, r.cells));
    const origAlign: (string | null)[] | null = t.attrs.origAlign;
    const alignChanged = !origAlign || origAlign.length !== align.length || origAlign.some((x, i) => x !== align[i]);
    const anyChanged = rowChanged.some(Boolean) || alignChanged || !t.attrs.delim;
    const cont = this.continuation(e.chain);
    const line = (r: { node: Node }, i: number) => {
      if (i === 0) return "";
      const term = r.node.attrs.term ?? this.eol;
      const prefix = ok && r.node.attrs.prefix !== null ? r.node.attrs.prefix : cont;
      return term + prefix;
    };
    const delimLine = (text: string) => {
      const d = t.attrs.delim;
      return (d?.term ?? this.eol) + (ok && d ? d.prefix : cont) + text;
    };
    if (!anyChanged) {
      return rows.map((r, i) => line(r, i) + r.node.attrs.src + (i === 0 ? delimLine(t.attrs.delim.text) : "")).join("");
    }
    const pad = (row: string[]) => Array.from({ length: cols }, (_, j) => row[j] ?? "");
    if (this.opts.prettyTables !== false) {
      const widths = Array.from({ length: cols }, (_, j) => Math.max(3, ...rows.map((r) => textWidth(r.cells[j] ?? ""))));
      const fmt = (cells: string[]) =>
        "| " +
        pad(cells)
          .map((c, j) => {
            const room = widths[j] - textWidth(c);
            if (align[j] === "right") return " ".repeat(room) + c;
            if (align[j] === "center") return " ".repeat(Math.floor(room / 2)) + c + " ".repeat(Math.ceil(room / 2));
            return c + " ".repeat(room);
          })
          .join(" | ") +
        " |";
      const delim =
        "| " +
        widths
          .map((w, j) => {
            const a = align[j];
            if (a === "left") return ":" + "-".repeat(w - 1);
            if (a === "right") return "-".repeat(w - 1) + ":";
            if (a === "center") return ":" + "-".repeat(w - 2) + ":";
            return "-".repeat(w);
          })
          .join(" | ") +
        " |";
      return rows.map((r, i) => line(r, i) + fmt(r.cells) + (i === 0 ? delimLine(delim) : "")).join("");
    }
    const minimal = (cells: string[]) => "| " + pad(cells).join(" | ") + " |";
    const minimalDelim =
      "| " +
      Array.from({ length: cols }, (_, j) => {
        const a = align[j];
        return a === "left" ? ":--" : a === "right" ? "--:" : a === "center" ? ":-:" : "---";
      }).join(" | ") +
      " |";
    const delimText = alignChanged || !t.attrs.delim || cols !== (origAlign?.length ?? cols) ? minimalDelim : t.attrs.delim.text;
    return rows
      .map((r, i) => line(r, i) + (rowChanged[i] ? minimal(r.cells) : r.node.attrs.src) + (i === 0 ? delimLine(delimText) : ""))
      .join("");
  }

  private commonDepth(a: LeafEntry, b: LeafEntry): number {
    let d = 0;
    while (
      d < a.chain.length &&
      d < b.chain.length &&
      a.chain[d].type === b.chain[d].type &&
      a.chain[d].attrs.uid === b.chain[d].attrs.uid &&
      a.chain[d].attrs.uid !== null
    )
      d++;
    return d;
  }

  canonicalSep(prev: LeafEntry | null, e: LeafEntry): string {
    if (!prev) return "";
    const d = this.commonDepth(prev, e);
    const common = e.chain.slice(0, d);
    const next = e.chain[d];
    const prevNext = prev.chain[d];
    const parent = common[common.length - 1];
    const isList = (n?: Node) => n?.type.name === "bullet_list" || n?.type.name === "ordered_list";
    // Sibling items of a tight list.
    if (parent && isList(parent) && next?.type.name === "list_item" && prevNext?.type.name === "list_item" && parent.attrs.tight) {
      return this.eol;
    }
    // A tight nested list directly after the item's paragraph.
    if (parent?.type.name === "list_item" && isList(next) && !prevNext && next.attrs.tight) {
      return this.eol;
    }
    return this.eol + this.continuation(common).trimEnd() + this.eol;
  }

  emittedLeaves(): LeafEntry[] {
    return collectLeaves(this.doc).filter((e) => {
      if (!isEmptyParagraph(e.node)) return true;
      // An empty paragraph is written only as the sole content of a list item or quote
      // (an empty item `-` or an empty quote `>`).
      const parent = e.chain[e.chain.length - 1];
      return (
        !!parent &&
        (parent.type.name === "list_item" || parent.type.name === "blockquote" || parent.type.name === "footnote_def") &&
        parent.childCount === 1
      );
    });
  }

  serialize(): string {
    const leaves = this.emittedLeaves();
    if (leaves.length === 0) return this.doc.attrs.tail ?? "";
    let out = "";
    let prev: LeafEntry | null = null;
    let prevOk = true;
    // Last emitted leaf that existed at load time (new leaves have no signature).
    let lastOriginal: LeafEntry | null = null;
    for (const e of leaves) {
      const ok = this.ok(e);
      const a = e.node.attrs;
      let sepOk = ok && prevOk && a.sep !== null && a.prev === (prev ? prev.node.attrs.uid : null);
      // New blocks were inserted before this one: keep its original separator from the
      // block it followed, as long as that separator holds a blank line (otherwise the
      // inserted block would absorb this one as a lazy continuation).
      if (!sepOk && ok && a.sep !== null && lastOriginal && prev !== lastOriginal) {
        sepOk = a.prev === lastOriginal.node.attrs.uid && this.ok(lastOriginal) && /(\r\n?|\n)[^\r\n]*(\r\n?|\n)/.test(a.sep);
      }
      out += sepOk ? a.sep : this.canonicalSep(prev, e);
      let lead = this.lead(e, ok);
      if (isEmptyParagraph(e.node) && !ok) lead = lead.trimEnd();
      out += lead + this.body(e, ok);
      prev = e;
      prevOk = ok;
      if (e.node.attrs.sig !== null) lastOriginal = e;
    }
    const { tail, lastUid, finalNewline } = this.doc.attrs;
    if (tail !== null && prev && prev.node.attrs.uid === lastUid && prevOk) out += tail;
    else out += finalNewline ? this.eol : "";
    return out;
  }
}

export function serialize(doc: Node, opts: SerializeOptions = {}): string {
  return new Serializer(doc, opts).serialize();
}
