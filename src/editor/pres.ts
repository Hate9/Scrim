// Inline DOM structure for themes (spec 10.3, "Inline structure"; QA-LOG Q-018).
//
// Themes select on nested structure: one wrapper per inline construct holding its
// markers and its element (`span.md-pair-s > span.md-meta.md-before + strong +
// span.md-meta.md-after`), `span.md-plain` around every plain text run, and so on.
// ProseMirror applies inline decorations per text piece, so a decoration cannot be one
// wrapper around differently decorated pieces; marks can: ProseMirror renders adjacent
// text that shares a mark inside one element. So the structure is expressed as
// presentation marks (`pres`), computed from the inline analysis and kept in sync by
// the inline plugin. They never reach the Markdown (the serializer reads text only),
// the history, or the dirty state.

import type { InlineElement } from "../md/inline";

/** Meta of the transactions that only update presentation marks. */
export const PRES_META = "scrim-pres";

export interface PresSpec {
  tag: string;
  cls: string;
  attrs: Record<string, string>;
  /** distinguishes neighbouring elements with otherwise equal marks */
  key: string;
}

export interface PresSegment {
  from: number;
  to: number;
  marks: PresSpec[];
}

/** `md-inline` names of 10.3 for the emphasis-like kinds. */
const PAIR: Partial<Record<string, string>> = {
  strong: "strong",
  em: "em",
  strike: "del",
  code: "code",
  math: "inline_math",
};
/** Inline HTML elements that are emphasis-like (`<u>` is Mod+U's underline). */
const HTML_PAIR: Record<string, string> = { u: "underline", mark: "mark", sub: "sub", sup: "sup" };

/** The wrapper of an element, by kind (10.3). `index` is its place in the flattened
 * element list (`data-el`, used by the reveal plugin). */
function wrapper(e: InlineElement, index: number, src: string): PresSpec {
  const attrs: Record<string, string> = { "data-el": String(index) };
  let tag = "span";
  let cls = `md-inline md-inline-${e.kind}`;
  if (e.replace) cls += " md-replace";
  if (e.kind === "rawhtml") cls += " md-meta-text";
  if (e.kind === "break" && e.attrs?.["data-spaces"]) cls += " md-break-spaces";
  if (e.kind === "html" && (e.nodeName === "br" || e.nodeName === "wbr")) cls += " md-replace";
  const pair = PAIR[e.kind] ?? (e.kind === "html" && e.nodeName ? HTML_PAIR[e.nodeName] : undefined);
  if (pair) {
    cls += " md-pair-s";
    attrs["md-inline"] = pair;
  } else if (e.kind === "link" || e.kind === "autolink") {
    cls += " md-link";
    const isRef = e.kind === "link" && src[e.contentTo + 1] !== "(";
    attrs["md-inline"] = e.kind === "autolink" ? "autolink" : isRef ? "reflink" : "link";
  } else if (e.kind === "image") {
    cls += " md-image";
    attrs["md-inline"] = "image";
    if (e.replace?.type === "image") attrs["data-src"] = e.replace.src;
  } else if (e.kind === "emoji") {
    cls += " md-emoji";
    attrs["md-inline"] = "emoji";
    if (e.replace?.type === "emoji") attrs["data-content"] = e.replace.name;
  } else if (e.kind === "footnote") {
    tag = "sup";
    cls += " md-footnote";
    attrs["md-inline"] = "footnote";
    attrs["data-ref"] = src.slice(e.contentFrom, e.contentTo);
  } else if (e.kind === "html") {
    cls += " md-html-inline";
    attrs["md-inline"] = "html_inline";
  } else {
    attrs["md-inline"] = e.kind;
  }
  return { tag, cls, attrs, key: `w${index}` };
}

/** The element for an element's content, or null (plain text under the wrapper). */
function contentSpec(e: InlineElement, index: number, sanitize: (a?: Record<string, string>) => Record<string, string>): PresSpec | null {
  if (!e.nodeName || e.contentFrom >= e.contentTo || e.kind === "break" || e.kind === "footnote") return null;
  const attrs: Record<string, string> = e.kind === "html" ? sanitize(e.attrs) : { ...(e.attrs ?? {}) };
  let cls = "";
  if (e.nodeName === "a") {
    // No real href in the editor (QA-LOG Q-012); the URL is the hover tooltip.
    const url = attrs.href ?? "";
    attrs["data-href"] = url;
    attrs.title = attrs.title ? `${attrs.title}\n${url}` : url;
    delete attrs.href;
    if (e.kind === "autolink") cls = "md-url";
  }
  if (cls) attrs.class = cls;
  return { tag: e.nodeName, cls: attrs.class ?? "", attrs: Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== "class")), key: `c${index}` };
}

/** Kinds whose content is not Markdown text (no `md-plain` inside). */
const RAW_CONTENT = new Set(["code", "math", "entity", "escape", "emoji", "comment", "rawhtml", "break"]);

/**
 * Segments of a textblock's source with the presentation marks each piece carries,
 * outermost first. `els` is the element tree (not flattened); `len` the source length.
 */
export function presSegments(
  els: InlineElement[],
  src: string,
  sanitize: (a?: Record<string, string>) => Record<string, string> = (a) => ({ ...(a ?? {}) }),
): PresSegment[] {
  const out: PresSegment[] = [];
  let counter = 0;
  const indexOf = new Map<InlineElement, number>();
  const number = (list: InlineElement[]) => {
    for (const e of list) {
      indexOf.set(e, counter++);
      number(e.children);
    }
  };
  number(els); // same order as `flatten` (pre-order)

  const push = (from: number, to: number, marks: PresSpec[]) => {
    if (from < to) out.push({ from, to, marks });
  };
  const plain = (from: number, to: number, outer: PresSpec[]) =>
    push(from, to, [...outer, { tag: "span", cls: "md-plain", attrs: { "md-inline": "plain" }, key: `p${from}` }]);

  /** Children and plain runs in [from, to) under `outer`. */
  const fill = (list: InlineElement[], from: number, to: number, outer: PresSpec[], plainText: boolean) => {
    let at = from;
    for (const e of [...list].sort((a, b) => a.from - b.from)) {
      if (e.to <= from || e.from >= to) continue;
      if (e.from > at) (plainText ? plain(at, e.from, outer) : push(at, e.from, outer));
      element(e, outer);
      at = Math.max(at, e.to);
    }
    if (at < to) (plainText ? plain(at, to, outer) : push(at, to, outer));
  };

  const element = (e: InlineElement, outer: PresSpec[]) => {
    const i = indexOf.get(e) ?? 0;
    const w = [...outer, wrapper(e, i, src)];
    const meta = (cls: string): PresSpec => ({ tag: "span", cls, attrs: {}, key: `m${i}` });
    const htmlish = e.kind === "html";
    // Pieces of [from, to): runs (markers) first, then hidden source, then content.
    type Piece = { from: number; to: number; what: "run" | "hidden" | "content" | "gap" };
    const bounds = new Set<number>([e.from, e.to, e.contentFrom, e.contentTo]);
    for (const [a, b] of e.runs) bounds.add(a).add(b);
    for (const [a, b] of e.hidden ?? []) bounds.add(a).add(b);
    const points = [...bounds].filter((p) => p >= e.from && p <= e.to).sort((a, b) => a - b);
    const pieces: Piece[] = [];
    for (let k = 0; k + 1 < points.length; k++) {
      const a = points[k];
      const b = points[k + 1];
      const inRun = e.runs.some(([x, y]) => x <= a && b <= y);
      const inHidden = (e.hidden ?? []).some(([x, y]) => x <= a && b <= y);
      const inContent = e.contentFrom <= a && b <= e.contentTo && e.contentFrom < e.contentTo;
      const what = inRun ? "run" : inHidden ? "hidden" : inContent ? "content" : "gap";
      const last = pieces[pieces.length - 1];
      if (last && last.what === what && last.to === a && what !== "run") last.to = b;
      else pieces.push({ from: a, to: b, what });
    }
    let textPieces = 0;
    for (const p of pieces) {
      if (p.what === "run") {
        const side = p.from === e.from ? "md-before" : p.to === e.to ? "md-after" : "md-before";
        push(p.from, p.to, [...w, meta(`md-meta ${side}${htmlish ? " md-raw-inline" : ""}`)]);
      } else if (p.what === "hidden" || p.what === "gap") {
        const text = src.slice(p.from, p.to);
        let cls = "md-meta md-hide";
        if (htmlish) cls = "md-meta md-raw-inline md-hide";
        else if ((e.kind === "link" || e.kind === "image") && text.trim() && p.from >= e.contentTo) {
          cls = textPieces++ === 0 ? "md-content md-url md-hide" : "md-content md-link-title md-hide";
        }
        if (cls.startsWith("md-content")) {
          // Surrounding whitespace is not part of the URL or title.
          const lead = text.length - text.trimStart().length;
          const trail = text.length - text.trimEnd().length;
          push(p.from, p.from + lead, [...w, meta("md-meta md-hide")]);
          push(p.from + lead, p.to - trail, [...w, meta(cls)]);
          push(p.to - trail, p.to, [...w, meta("md-meta md-hide")]);
        } else push(p.from, p.to, [...w, meta(cls)]);
      } else {
        const c = contentSpec(e, i, sanitize);
        const inner = c ? [...w, c] : w;
        fill(e.children, p.from, p.to, inner, !RAW_CONTENT.has(e.kind));
      }
    }
  };

  fill(els, 0, src.length, [], true);
  return out;
}
