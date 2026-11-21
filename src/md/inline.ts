// Inline analysis (spec 03, 3.2; spec 05). Input: the Markdown source of one textblock
// (line breaks as "\n"). Output: the inline elements with their source ranges, marker
// runs, and what they render as. Offsets are relative to the textblock's start, so they
// map 1:1 to ProseMirror positions inside the block.
//
// Pure and DOM-free so it can be unit tested; the view turns it into decorations.

import { decodeNamedCharacterReference } from "decode-named-character-reference";
import type { Nodes, PhrasingContent } from "mdast";
import { nameToEmoji } from "gemoji";
import { parseMdast, type ParseOptions } from "./mdast";

export type InlineKind =
  | "strong"
  | "em"
  | "strike"
  | "code"
  | "link"
  | "autolink"
  | "image"
  | "math"
  | "html"
  | "entity"
  | "escape"
  | "emoji"
  | "footnote"
  | "break"
  | "comment"
  | "rawhtml";

export interface InlineElement {
  kind: InlineKind;
  /** whole element, markers included: [from, to) */
  from: number;
  to: number;
  /** rendered content range (between the opening and closing runs) */
  contentFrom: number;
  contentTo: number;
  /** marker runs, each crossed by one arrow-key step */
  runs: [number, number][];
  /** source that is hidden while collapsed but steppable when expanded (link URLs,
   * titles, HTML attributes) */
  hidden?: [number, number][];
  /** element name for the rendered content, if any (`strong`, `a`, `span`, …) */
  nodeName?: string;
  attrs?: Record<string, string>;
  /** while collapsed, hide everything (content too) and show `widget` instead */
  replace?: Widget;
  /** nesting depth; outer elements have smaller depth */
  depth: number;
  /** inner elements */
  children: InlineElement[];
}

export type Widget =
  | { type: "image"; src: string; alt: string; title?: string }
  | { type: "emoji"; char: string; name: string }
  | { type: "char"; char: string }
  | { type: "math"; tex: string }
  | { type: "hidden" };

export interface Definitions {
  /** normalized label → url/title */
  links: Map<string, { url: string; title: string | null }>;
  footnotes: Set<string>;
}

export interface InlineOptions extends ParseOptions {
  definitions?: Definitions;
}

/** Inline HTML tags that render as real elements (spec 05, 5.1). */
export const INLINE_TAGS = new Set(
  (
    "span b i u s small big kbd abbr cite q dfn time var samp sub sup mark ruby rt rp ins del " +
    "font a img br wbr svg button progress meter data acronym tt strike bdi bdo"
  ).split(" "),
);
const VOID_TAGS = new Set(["br", "wbr", "img"]);

export function normalizeLabel(label: string): string {
  return label.replace(/[\t\n\r ]+/g, " ").trim().toLowerCase().toUpperCase();
}

function defsSuffix(defs?: Definitions): string {
  if (!defs || (defs.links.size === 0 && defs.footnotes.size === 0)) return "";
  const lines: string[] = [];
  for (const label of defs.links.keys()) lines.push(`[${label.replace(/[\[\]\\]/g, "\\$&")}]: x`);
  for (const label of defs.footnotes) lines.push(`[^${label}]: x`);
  return "\n\n" + lines.join("\n") + "\n";
}

export function analyzeInline(src: string, opts: InlineOptions = {}): InlineElement[] {
  if (!src) return [];
  const root = parseMdast(src + defsSuffix(opts.definitions), { ...opts, frontMatter: false });
  const first = root.children[0];
  if (!first || !("children" in first) || first.position!.start.offset! >= src.length) return [];
  const a = new Analyzer(src, opts);
  return a.phrasing(first.children as PhrasingContent[], 0);
}

class Analyzer {
  constructor(private src: string, private opts: InlineOptions) {}

  phrasing(nodes: PhrasingContent[], depth: number): InlineElement[] {
    const out: InlineElement[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n.position || n.position.start.offset! >= this.src.length) continue;
      if (n.type === "html") {
        const consumed = this.html(nodes, i, depth, out);
        i += consumed;
        continue;
      }
      const el = this.node(n, depth);
      if (Array.isArray(el)) out.push(...el);
      else if (el) out.push(el);
    }
    return out;
  }

  private span(n: Nodes): [number, number] {
    return [n.position!.start.offset!, Math.min(n.position!.end.offset!, this.src.length)];
  }

  private contentRange(n: Nodes & { children: Nodes[] }, fallback: number): [number, number] {
    if (!n.children.length) return [fallback, fallback];
    return [n.children[0].position!.start.offset!, n.children[n.children.length - 1].position!.end.offset!];
  }

  private node(n: PhrasingContent, depth: number): InlineElement | InlineElement[] | null {
    const [from, to] = this.span(n);
    switch (n.type) {
      case "text":
        return this.textScan(from, to, depth);
      case "strong":
      case "emphasis":
      case "delete": {
        const width = n.type === "strong" ? 2 : n.type === "delete" ? to - from - (this.closeRunStart(n) - from) : 1;
        const [cf, ct] = this.contentRange(n, from + width);
        return {
          kind: n.type === "strong" ? "strong" : n.type === "emphasis" ? "em" : "strike",
          from,
          to,
          contentFrom: cf,
          contentTo: ct,
          runs: [
            [from, cf],
            [ct, to],
          ],
          nodeName: n.type === "strong" ? "strong" : n.type === "emphasis" ? "em" : "del",
          depth,
          children: this.phrasing(n.children, depth + 1),
        };
      }
      case "inlineCode": {
        const raw = this.src.slice(from, to);
        const ticks = /^`+/.exec(raw)![0].length;
        return {
          kind: "code",
          from,
          to,
          contentFrom: from + ticks,
          contentTo: to - ticks,
          runs: [
            [from, from + ticks],
            [to - ticks, to],
          ],
          nodeName: "code",
          depth,
          children: [],
        };
      }
      case "inlineMath": {
        const raw = this.src.slice(from, to);
        const d = /^\$+/.exec(raw)![0].length;
        return {
          kind: "math",
          from,
          to,
          contentFrom: from + d,
          contentTo: to - d,
          runs: [
            [from, from + d],
            [to - d, to],
          ],
          replace: { type: "math", tex: n.value },
          depth,
          children: [],
        };
      }
      case "break": {
        const raw = this.src.slice(from, to);
        const nl = raw.indexOf("\n");
        const end = nl >= 0 ? from + nl : to;
        return {
          kind: "break",
          from,
          to: end,
          contentFrom: end,
          contentTo: end,
          runs: [[from, end]],
          attrs: raw.startsWith("\\") ? {} : { "data-spaces": "1" },
          depth,
          children: [],
        };
      }
      case "link":
        return this.link(n, from, to, depth);
      case "linkReference":
        return this.linkReference(n, from, to, depth);
      case "image":
      case "imageReference":
        return this.image(n, from, to, depth);
      case "footnoteReference": {
        return {
          kind: "footnote",
          from,
          to,
          contentFrom: from + 2,
          contentTo: to - 1,
          runs: [
            [from, from + 2],
            [to - 1, to],
          ],
          nodeName: "sup",
          attrs: { class: "md-footnote" },
          depth,
          children: [],
        };
      }
      default:
        return null;
    }
  }

  /** Start of the closing marker run of a strikethrough (`~~` or `~`). */
  private closeRunStart(n: Nodes & { children?: Nodes[] }): number {
    const [, to] = this.span(n);
    const raw = this.src.slice(0, to);
    const m = /~+$/.exec(raw);
    return m ? to - m[0].length : to;
  }

  private link(n: Extract<PhrasingContent, { type: "link" }>, from: number, to: number, depth: number): InlineElement {
    const first = this.src[from];
    const children = this.phrasing(n.children, depth + 1);
    if (first === "<") {
      return {
        kind: "autolink",
        from,
        to,
        contentFrom: from + 1,
        contentTo: to - 1,
        runs: [
          [from, from + 1],
          [to - 1, to],
        ],
        nodeName: "a",
        attrs: { href: n.url },
        depth,
        children: [],
      };
    }
    if (first !== "[") {
      // GFM literal autolink: no markers.
      return { kind: "autolink", from, to, contentFrom: from, contentTo: to, runs: [], nodeName: "a", attrs: { href: n.url }, depth, children: [] };
    }
    const close = this.matchBracket(from + 1);
    const runs: [number, number][] = [[from, from + 1]];
    runs.push(...this.destinationRuns(close, to));
    const attrs: Record<string, string> = { href: n.url };
    if (n.title) attrs.title = n.title;
    return { kind: "link", from, to, contentFrom: from + 1, contentTo: close, runs, hidden: [[close, to]], nodeName: "a", attrs, depth, children };
  }

  /** Runs of `](url "title")` starting at the `]` at `close`. */
  private destinationRuns(close: number, to: number): [number, number][] {
    const runs: [number, number][] = [[close, close + 2]];
    const inner = this.src.slice(close + 2, to - 1);
    const m = /^([ \t\n]*(?:<[^>\n]*>|[^ \t\n]*))([ \t\n]+)(["'(])([\s\S]*)(["')])[ \t\n]*$/.exec(inner);
    if (m) {
      const q1 = close + 2 + m[1].length + m[2].length;
      const q2 = close + 2 + m[1].length + m[2].length + 1 + m[4].length;
      runs.push([q1, q1 + 1], [q2, q2 + 1]);
    }
    runs.push([to - 1, to]);
    return runs;
  }

  private linkReference(
    n: Extract<PhrasingContent, { type: "linkReference" }>,
    from: number,
    to: number,
    depth: number,
  ): InlineElement {
    const close = this.matchBracket(from + 1);
    const runs: [number, number][] = [[from, from + 1]];
    if (n.referenceType === "full") {
      runs.push([close, close + 2], [to - 1, to]);
    } else if (n.referenceType === "collapsed") {
      runs.push([close, to]);
    } else {
      runs.push([close, close + 1]);
    }
    const def = this.opts.definitions?.links.get(normalizeLabel(n.label ?? n.identifier));
    const attrs: Record<string, string> = { href: def?.url ?? "" };
    if (def?.title) attrs.title = def.title;
    return {
      kind: "link",
      from,
      to,
      contentFrom: from + 1,
      contentTo: close,
      runs,
      hidden: [[close, to]],
      nodeName: "a",
      attrs,
      depth,
      children: this.phrasing(n.children, depth + 1),
    };
  }

  private image(n: PhrasingContent, from: number, to: number, depth: number): InlineElement {
    const close = this.matchBracket(from + 2);
    let runs: [number, number][] = [[from, from + 2]];
    let src = "";
    let title: string | undefined;
    if (n.type === "image") {
      runs.push(...this.destinationRuns(close, to));
      src = n.url;
      title = n.title ?? undefined;
    } else if (n.type === "imageReference") {
      runs = [[from, from + 2], [close, n.referenceType === "shortcut" ? close + 1 : close + 2]];
      if (n.referenceType === "full") runs.push([to - 1, to]);
      if (n.referenceType === "collapsed") runs[1] = [close, to];
      const def = this.opts.definitions?.links.get(normalizeLabel(n.label ?? n.identifier));
      src = def?.url ?? "";
      title = def?.title ?? undefined;
    }
    const alt = "alt" in n ? (n.alt ?? "") : "";
    return {
      kind: "image",
      from,
      to,
      contentFrom: from + 2,
      contentTo: close,
      runs,
      replace: { type: "image", src, alt, title },
      depth,
      children: [],
    };
  }

  /** Offset of the `]` matching the `[` just before `start`. */
  private matchBracket(start: number): number {
    let depth = 0;
    for (let i = start; i < this.src.length; i++) {
      const c = this.src[i];
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === "`") {
        const run = /^`+/.exec(this.src.slice(i))![0];
        const end = this.src.indexOf(run, i + run.length);
        if (end > 0) {
          i = end + run.length - 1;
          continue;
        }
      }
      if (c === "[") depth++;
      else if (c === "]") {
        if (depth === 0) return i;
        depth--;
      }
    }
    return this.src.length;
  }

  /** Escapes, entities, and emoji shortcodes inside a text node's raw source. */
  private textScan(from: number, to: number, depth: number): InlineElement[] {
    const out: InlineElement[] = [];
    const raw = this.src.slice(from, to);
    const re = /\\([!-\/:-@\[-`{-~])|&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});|:([a-z0-9_+\-]+):/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      const s = from + m.index;
      const e = s + m[0].length;
      if (m[1] !== undefined) {
        out.push({ kind: "escape", from: s, to: e, contentFrom: s + 1, contentTo: e, runs: [[s, s + 1]], depth, children: [] });
      } else if (m[2] !== undefined) {
        const char = decodeEntity(m[2]);
        if (char === null) continue;
        out.push({
          kind: "entity",
          from: s,
          to: e,
          contentFrom: s + 1,
          contentTo: e - 1,
          runs: [
            [s, s + 1],
            [e - 1, e],
          ],
          replace: { type: "char", char },
          depth,
          children: [],
        });
      } else if (m[3] !== undefined) {
        const char = (nameToEmoji as Record<string, string>)[m[3]];
        if (!char) {
          re.lastIndex = m.index + m[0].length - 1; // the closing ':' may open the next one
          continue;
        }
        out.push({
          kind: "emoji",
          from: s,
          to: e,
          contentFrom: s + 1,
          contentTo: e - 1,
          runs: [
            [s, s + 1],
            [e - 1, e],
          ],
          replace: { type: "emoji", char, name: m[3] },
          depth,
          children: [],
        });
      }
    }
    return out;
  }

  /** Inline HTML starting at nodes[i]. Returns how many extra siblings were consumed. */
  private html(nodes: PhrasingContent[], i: number, depth: number, out: InlineElement[]): number {
    const n = nodes[i] as Extract<PhrasingContent, { type: "html" }>;
    const [from, to] = this.span(n);
    const raw = this.src.slice(from, to);
    if (raw.startsWith("<!--")) {
      out.push({
        kind: "comment",
        from,
        to,
        contentFrom: from + 4,
        contentTo: Math.max(from + 4, to - 3),
        runs: [
          [from, from + 4],
          [Math.max(from + 4, to - 3), to],
        ],
        replace: { type: "hidden" },
        depth,
        children: [],
      });
      return 0;
    }
    const open = /^<([A-Za-z][A-Za-z0-9-]*)([\s\S]*?)(\/?)>$/.exec(raw);
    const name = open?.[1].toLowerCase();
    if (!open || !name || !INLINE_TAGS.has(name)) {
      out.push(this.rawHtml(from, to, depth));
      return 0;
    }
    const attrs = parseAttributes(open[2]);
    const nameEnd = from + 1 + open[1].length;
    const closeRun: [number, number] = open[3] ? [to - 2, to] : [to - 1, to];
    if (VOID_TAGS.has(name) || open[3]) {
      out.push({
        kind: "html",
        from,
        to,
        contentFrom: to,
        contentTo: to,
        runs: [[from, nameEnd], closeRun],
        hidden: [[from, to]],
        nodeName: name,
        attrs,
        replace: name === "img" ? { type: "image", src: attrs.src ?? "", alt: attrs.alt ?? "" } : undefined,
        depth,
        children: [],
      });
      return 0;
    }
    // Find the matching close tag among the following siblings.
    let level = 0;
    for (let j = i + 1; j < nodes.length; j++) {
      const sib = nodes[j];
      if (sib.type !== "html") continue;
      const sraw = sib.value;
      if (new RegExp(`^<${name}(?:[\\s/>])`, "i").test(sraw)) level++;
      else if (new RegExp(`^</${name}\\s*>$`, "i").test(sraw)) {
        if (level > 0) {
          level--;
          continue;
        }
        const [cFrom, cTo] = this.span(sib);
        const inner = nodes.slice(i + 1, j);
        out.push({
          kind: "html",
          from,
          to: cTo,
          contentFrom: to,
          contentTo: cFrom,
          runs: [[from, nameEnd], closeRun, [cFrom, cTo]],
          hidden: [[from, to], [cFrom, cTo]],
          nodeName: name,
          attrs,
          depth,
          children: this.phrasing(inner, depth + 1),
        });
        return j - i;
      }
    }
    out.push(this.rawHtml(from, to, depth));
    return 0;
  }

  /** Unmatched or unknown tag: literal text shown in meta style (spec 05, 5.1). */
  private rawHtml(from: number, to: number, depth: number): InlineElement {
    return { kind: "rawhtml", from, to, contentFrom: from, contentTo: to, runs: [], depth, children: [] };
  }
}

export function parseAttributes(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return attrs;
}

function decodeEntity(body: string): string | null {
  if (body[0] === "#") {
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code > 0x10ffff) return null;
    if (code === 0 || (code >= 0xd800 && code <= 0xdfff)) return "�";
    return String.fromCodePoint(code);
  }
  const v = decodeNamedCharacterReference(body);
  return v === false ? null : v;
}

/** All elements, flattened, outer first. */
export function flatten(els: InlineElement[]): InlineElement[] {
  const out: InlineElement[] = [];
  const walk = (list: InlineElement[]) => {
    for (const e of list) {
      out.push(e);
      walk(e.children);
    }
  };
  walk(els);
  return out;
}
