// Markdown → document (spec 01, "Document model" and "Round-trip model").
//
// Structure comes from mdast. Paragraphs, headings, thematic breaks, blockquotes, and
// lists become editable nodes; every other block (code, math, tables, HTML, front matter,
// definitions, footnote definitions) becomes a `raw` leaf that keeps its exact source
// until P2 gives it a real editor. For every leaf the parser records the bytes needed to
// write it back unchanged (see schema.ts). Two safety nets guarantee the byte-identical
// round trip: each paragraph and heading's extracted inline source is re-parsed and must
// mean the same as the original, and the whole document must serialize back to the
// input. A top-level block that fails either check is kept as a `raw` leaf.

import type { Definition, FootnoteDefinition, Nodes, Root, RootContent } from "mdast";
import type { Node } from "prosemirror-model";
import { fingerprint, parseMdast, type ParseOptions } from "./mdast";
import { bumpUid, freshUid, schema, type MarkerSpan } from "./schema";
import { serialize, signature } from "./serialize";

interface Line {
  start: number;
  /** end of content, excluding the terminator */
  end: number;
  term: string;
}

function splitLines(src: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 10 || c === 13) {
      const crlf = c === 13 && src.charCodeAt(i + 1) === 10;
      lines.push({ start, end: i, term: crlf ? "\r\n" : c === 13 ? "\r" : "\n" });
      if (crlf) i++;
      start = i + 1;
    }
  }
  lines.push({ start, end: src.length, term: "" });
  return lines;
}

/** Majority line ending; LF when there is none (spec 01, "Persistence"). */
export function detectEol(src: string, fallback = "\n"): string {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 13) {
      if (src.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  if (lf + crlf + cr === 0) return fallback;
  if (lf >= crlf && lf >= cr) return "\n";
  return crlf >= cr ? "\r\n" : "\r";
}

interface Ctx {
  type: "blockquote" | "bullet_list" | "ordered_list" | "list_item";
  uid: number;
  /** list items: offset where the item's content starts on its first line */
  contentStart?: number;
  /** list items: line index of the marker */
  firstLine?: number;
  /** list items: continuation indent width */
  width?: number;
  /** list items: marker span */
  markerFrom?: number;
  markerTo?: number;
  /** a leaf inside this container was already emitted */
  hasLeaf?: boolean;
}

class Unsupported extends Error {}

export interface ParseResult {
  doc: Node;
  reasons: string[];
  /** top-level blocks that were kept raw because the structured form did not verify */
  fallbacks: number;
}

export class Parser {
  private lines: Line[];
  private lineStarts: number[];
  private eol: string;
  private prevLeafEnd = 0;
  private prevLeafUid: number | null = null;
  private defsSuffix: string;
  fallbacks = 0;
  /** Why top-level blocks fell back to raw (for diagnostics and tests). */
  reasons: string[] = [];

  constructor(private src: string, private opts: ParseOptions = {}, defaultEol = "\n") {
    this.lines = splitLines(src);
    this.lineStarts = this.lines.map((l) => l.start);
    this.eol = detectEol(src, defaultEol);
    this.defsSuffix = "";
  }

  private lineOf(offset: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  parse(): ParseResult {
    const root = parseMdast(this.src, { ...this.opts, frontMatter: true });
    this.defsSuffix = this.collectDefinitions(root);
    const blocks: Node[] = [];
    for (const child of root.children) blocks.push(...this.topLevel(child));
    let doc = this.finish(blocks);
    if (serialize(doc) !== this.src) {
      // Should not happen; keep the whole file as one raw block rather than lose bytes.
      console.warn("scrim: round trip check failed; opening document as raw text");
      this.fallbacks = root.children.length;
      this.prevLeafEnd = 0;
      this.prevLeafUid = null;
      const all = this.rawFromRange(0, this.src.length, [], "raw");
      doc = this.finish(all ? [all] : []);
    }
    return { doc, fallbacks: this.fallbacks, reasons: this.reasons };
  }

  private finish(blocks: Node[]): Node {
    const tail = this.src.slice(this.prevLeafEnd);
    const content = blocks.length ? blocks : [schema.nodes.paragraph.create({ uid: freshUid() })];
    return schema.nodes.doc.create(
      {
        eol: this.eol,
        finalNewline: /[\r\n]$/.test(this.src),
        tail: blocks.length ? tail : this.src,
        lastUid: this.prevLeafUid,
      },
      content,
    );
  }

  private collectDefinitions(root: Root): string {
    const defs: string[] = [];
    const visit = (n: Nodes) => {
      if (n.type === "definition") defs.push(`[${(n as Definition).label ?? (n as Definition).identifier}]: x`);
      else if (n.type === "footnoteDefinition")
        defs.push(`[^${(n as FootnoteDefinition).label ?? (n as FootnoteDefinition).identifier}]: x`);
      if ("children" in n) for (const c of n.children as Nodes[]) visit(c);
    };
    visit(root);
    return defs.length ? "\n\n" + defs.join("\n") + "\n" : "";
  }

  private topLevel(node: RootContent): Node[] {
    const savedEnd = this.prevLeafEnd;
    const savedUid = this.prevLeafUid;
    const savedFallbacks = this.fallbacks;
    try {
      return this.block(node, []);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      this.reasons.push(`${node.type}@${node.position?.start.line}: ${e.message}`);
      this.prevLeafEnd = savedEnd;
      this.prevLeafUid = savedUid;
      this.fallbacks = savedFallbacks + 1;
      const p = node.position!;
      const raw = this.rawFromRange(p.start.offset!, p.end.offset!, [], kindOf(node));
      return raw ? [raw] : [];
    }
  }

  // ---- containers ------------------------------------------------------------------

  private block(node: RootContent, chain: Ctx[]): Node[] {
    switch (node.type) {
      case "paragraph":
        return [this.paragraph(node, chain)];
      case "heading":
        return [this.heading(node, chain)];
      case "thematicBreak":
        return [this.hr(node, chain)];
      case "blockquote": {
        const ctx: Ctx = { type: "blockquote", uid: freshUid() };
        const inner = [...chain, ctx];
        let children = node.children.flatMap((c) => this.block(c, inner));
        if (!children.length) children = [this.emptyLeaf(node.position!.start.offset!, node.position!.end.offset!, inner)];
        return [schema.nodes.blockquote.create({ uid: ctx.uid }, children)];
      }
      case "list":
        return [this.list(node, chain)];
      default: {
        const p = node.position!;
        const raw = this.rawFromRange(p.start.offset!, p.end.offset!, chain, kindOf(node));
        return raw ? [raw] : [];
      }
    }
  }

  private list(node: Extract<RootContent, { type: "list" }>, chain: Ctx[]): Node {
    const listCtx: Ctx = { type: node.ordered ? "ordered_list" : "bullet_list", uid: freshUid() };
    const items: Node[] = [];
    const markers: string[] = [];
    for (const item of node.children) {
      const start = item.position!.start.offset!;
      const m = /^(?:[-+*]|\d{1,9}[.)])/.exec(this.src.slice(start, start + 10));
      if (!m) throw new Unsupported("list marker");
      const marker = m[0];
      markers.push(marker);
      const firstLine = this.lineOf(start);
      const outer = this.stripContainers(firstLine, [...chain, listCtx]);
      if (outer.lazy) throw new Unsupported("lazy list item");
      const markerEnd = start + marker.length;
      let contentStart: number;
      const firstChild = item.children[0];
      if (firstChild && this.lineOf(firstChild.position!.start.offset!) === firstLine) {
        contentStart = firstChild.position!.start.offset!;
      } else {
        // Empty item, or content starting on the next line: marker + following spaces.
        const rest = /^[ \t]*/.exec(this.src.slice(markerEnd, this.lines[firstLine].end))![0];
        contentStart = markerEnd + Math.min(rest.length, 1);
      }
      let width = contentStart - outer.end;
      if (!firstChild || this.lineOf(firstChild.position!.start.offset!) !== firstLine) {
        width = markerEnd - outer.end + 1;
      }
      if (/\t/.test(this.src.slice(outer.end, contentStart))) throw new Unsupported("tab in list prefix");
      const ctx: Ctx = {
        type: "list_item",
        uid: freshUid(),
        contentStart,
        firstLine,
        width,
        markerFrom: start,
        markerTo: markerEnd,
      };
      const inner = [...chain, listCtx, ctx];
      let children = item.children.flatMap((c) => this.block(c, inner));
      if (!children.length) children = [this.emptyLeaf(start, item.position!.end.offset!, inner)];
      items.push(schema.nodes.list_item.create({ uid: ctx.uid, marker }, children));
    }
    const itemUids = items.map((i) => i.attrs.uid as number);
    const tight = !node.spread;
    if (node.ordered) {
      const nums = markers.map((m) => parseInt(m, 10));
      const delim = markers[0].slice(-1);
      const same = nums.length > 1 && nums.every((n) => n === nums[0]);
      const seq = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
      return schema.nodes.ordered_list.create(
        {
          uid: listCtx.uid,
          start: nums[0],
          delim,
          numbering: same ? "same" : seq ? "seq" : "irregular",
          tight,
          items: itemUids,
        },
        items,
      );
    }
    return schema.nodes.bullet_list.create({ uid: listCtx.uid, bullet: markers[0], tight, items: itemUids }, items);
  }

  /**
   * Strip the container prefixes of line `li`. Returns the offset after them and whether
   * the line is a lazy continuation (a container's marker is missing).
   */
  private stripContainers(li: number, chain: Ctx[]): { end: number; lazy: boolean } {
    const line = this.lines[li];
    let p = line.start;
    for (const c of chain) {
      if (c.type === "blockquote") {
        const m = /^ {0,3}>[ \t]?/.exec(this.src.slice(p, line.end));
        if (!m) return { end: p, lazy: true };
        if (m[0].endsWith("\t")) throw new Unsupported("tab after >");
        p += m[0].length;
      } else if (c.type === "list_item") {
        if (li === c.firstLine) {
          p = c.contentStart!;
        } else {
          const rest = this.src.slice(p, line.end);
          if (/^[ \t]*$/.test(rest)) return { end: line.end, lazy: false };
          if (rest.startsWith(" ".repeat(c.width!))) p += c.width!;
          else return { end: p, lazy: true };
        }
      }
    }
    return { end: p, lazy: false };
  }

  private markerSpans(lineStart: number, chain: Ctx[], li: number): MarkerSpan[] {
    const spans: MarkerSpan[] = [];
    for (const c of chain) {
      if (c.type === "list_item" && c.firstLine === li && !c.hasLeaf) {
        spans.push({ item: c.uid, from: c.markerFrom! - lineStart, to: c.markerTo! - lineStart });
      }
    }
    return spans;
  }

  // ---- leaves ----------------------------------------------------------------------

  /** Common leaf bookkeeping: separator, lead, signature. Call before marking hasLeaf. */
  private leafAttrs(firstLine: number, contentStart: number, chain: Ctx[]) {
    const line = this.lines[firstLine];
    const first = chain.map((c) => !c.hasLeaf);
    const uid = freshUid();
    const attrs = {
      uid,
      sep: this.src.slice(this.prevLeafEnd, line.start),
      prev: this.prevLeafUid,
      lead: this.src.slice(line.start, contentStart),
      marks: this.markerSpans(line.start, chain, firstLine),
      sig: signature(chain, first),
    };
    return attrs;
  }

  private endLeaf(lastLine: number, uid: number, chain: Ctx[]) {
    this.prevLeafEnd = this.lines[lastLine].end;
    this.prevLeafUid = uid;
    for (const c of chain) c.hasLeaf = true;
  }

  /** Inline content for lines [first..last]; each line's text starts at `starts[i]`. */
  private inlineContent(first: number, last: number, starts: number[], lastEnd?: number): Node[] {
    const out: Node[] = [];
    for (let li = first; li <= last; li++) {
      const line = this.lines[li];
      const end = li === last && lastEnd !== undefined ? lastEnd : line.end;
      const text = this.src.slice(starts[li - first], end);
      if (text) out.push(schema.text(text));
      if (li < last) {
        const next = this.lines[li + 1];
        out.push(
          schema.nodes.line_break.create({
            term: line.term,
            prefix: this.src.slice(next.start, starts[li + 1 - first]),
          }),
        );
      }
    }
    return out;
  }

  /** Text starts of continuation lines for prose: after containers and leading spaces. */
  private proseStarts(first: number, last: number, firstStart: number, chain: Ctx[]): number[] {
    const starts = [firstStart];
    for (let li = first + 1; li <= last; li++) {
      const { end } = this.stripContainers(li, chain);
      const ws = /^[ \t]*/.exec(this.src.slice(end, this.lines[li].end))![0].length;
      starts.push(end + ws);
    }
    return starts;
  }

  private verifyInline(original: Nodes & { children: Nodes[] }, content: Node[]) {
    let text = "";
    for (const n of content) text += n.isText ? n.text : "\n";
    const reparsed = parseMdast(text + this.defsSuffix, { ...this.opts, frontMatter: false });
    const first = reparsed.children[0];
    const want = original.children.map(fingerprint).join();
    const got = first && first.type === "paragraph" ? first.children.map(fingerprint).join() : first ? "!" : "";
    if (want !== got) throw new Unsupported("inline content changed meaning");
  }

  private paragraph(node: Extract<RootContent, { type: "paragraph" }>, chain: Ctx[]): Node {
    const p = node.position!;
    const start = this.clampStart(p.start.offset!);
    const first = this.lineOf(start);
    const last = this.lineOf(p.end.offset!);
    const attrs = this.leafAttrs(first, start, chain);
    const content = this.inlineContent(first, last, this.proseStarts(first, last, start, chain));
    this.verifyInline(node, content);
    this.endLeaf(last, attrs.uid, chain);
    return schema.nodes.paragraph.create(attrs, content);
  }

  /** A block may report a start inside lines already consumed (a setext heading after a
   * link definition starts at the definition); move it to the next unconsumed line. */
  private clampStart(start: number): number {
    if (start >= this.prevLeafEnd || this.prevLeafUid === null) return start;
    const li = this.lineOf(this.prevLeafEnd) + 1;
    if (li >= this.lines.length) throw new Unsupported("block overlaps previous");
    const line = this.lines[li];
    return line.start + /^[ \t]*/.exec(this.src.slice(line.start, line.end))![0].length;
  }

  private heading(node: Extract<RootContent, { type: "heading" }>, chain: Ctx[]): Node {
    const p = node.position!;
    const start = this.clampStart(p.start.offset!);
    const end = p.end.offset!;
    const first = this.lineOf(start);
    const last = this.lineOf(end);
    const attrs = this.leafAttrs(first, start, chain);
    const level = node.depth;
    let content: Node[];
    let extra: Record<string, unknown>;
    const atx = this.src[start] === "#";
    if (atx) {
      if (first !== last) throw new Unsupported("multi-line atx");
      const line = this.src.slice(start, this.lines[first].end);
      let textStart: number;
      let textEnd: number;
      if (node.children.length) {
        textStart = node.children[0].position!.start.offset!;
        textEnd = node.children[node.children.length - 1].position!.end.offset!;
      } else {
        const m = /^#{1,6}[ \t]*/.exec(line)!;
        textStart = textEnd = start + m[0].length;
      }
      const text = this.src.slice(textStart, textEnd);
      content = text ? [schema.text(text)] : [];
      extra = {
        open: this.src.slice(start, textStart),
        close: this.src.slice(textEnd, this.lines[first].end),
        openLevel: level,
        setext: null,
      };
    } else {
      const textLast = last - 1;
      content = this.inlineContent(first, textLast, this.proseStarts(first, textLast, start, chain));
      const ul = this.lines[last];
      extra = {
        open: null,
        close: "",
        openLevel: null,
        setext: { term: this.lines[textLast].term, line: this.src.slice(ul.start, ul.end) },
      };
    }
    this.verifyInline(node, content);
    this.endLeaf(last, attrs.uid, chain);
    return schema.nodes.heading.create({ ...attrs, ...extra, level }, content);
  }

  private hr(node: Extract<RootContent, { type: "thematicBreak" }>, chain: Ctx[]): Node {
    const p = node.position!;
    const li = this.lineOf(p.start.offset!);
    const attrs = this.leafAttrs(li, p.start.offset!, chain);
    const text = this.src.slice(p.start.offset!, this.lines[li].end);
    this.endLeaf(li, attrs.uid, chain);
    return schema.nodes.hr.create({ ...attrs, text });
  }

  /** Empty list item or quote: an empty paragraph whose lead is the whole line. */
  private emptyLeaf(start: number, _end: number, chain: Ctx[]): Node {
    const li = this.lineOf(start);
    const attrs = this.leafAttrs(li, this.lines[li].end, chain);
    this.endLeaf(li, attrs.uid, chain);
    return schema.nodes.paragraph.create(attrs);
  }

  /** Raw leaf over the lines spanning [start, end). */
  private rawFromRange(start: number, end: number, chain: Ctx[], kind: string): Node | null {
    if (end <= start && start >= this.src.length) return null;
    start = this.clampStart(start);
    const first = this.lineOf(start);
    const last = this.lineOf(Math.max(start, end));
    const starts: number[] = [];
    for (let li = first; li <= last; li++) {
      if (li === first) {
        starts.push(chain.length ? this.firstLineContentStart(li, chain, start) : this.lines[li].start);
      } else {
        const s = chain.length ? this.stripContainers(li, chain).end : this.lines[li].start;
        starts.push(s);
      }
    }
    const attrs = this.leafAttrs(first, starts[0], chain);
    const content = this.inlineContent(first, last, starts);
    this.endLeaf(last, attrs.uid, chain);
    return schema.nodes.raw.create({ ...attrs, kind }, content);
  }

  private firstLineContentStart(li: number, chain: Ctx[], blockStart: number): number {
    const { end, lazy } = this.stripContainers(li, chain);
    if (lazy) throw new Unsupported("lazy raw line");
    return Math.min(end, blockStart);
  }
}

function kindOf(node: RootContent): string {
  switch (node.type) {
    case "code":
      return "code";
    case "math":
      return "math";
    case "html":
      return "html";
    case "table":
      return "table";
    case "yaml":
      return "frontmatter";
    case "definition":
      return "definition";
    case "footnoteDefinition":
      return "footnote";
    default:
      return "raw";
  }
}

export function parseMarkdown(src: string, opts: ParseOptions = {}, defaultEol = "\n"): ParseResult {
  const result = new Parser(src, opts, defaultEol).parse();
  result.doc.descendants((n) => {
    if (typeof n.attrs.uid === "number") bumpUid(n.attrs.uid);
    return true;
  });
  return result;
}
