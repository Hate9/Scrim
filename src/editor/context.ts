// Per-document context shared by the editor plugins.
import type { Node } from "prosemirror-model";
import { analyzeInline, normalizeLabel, type Definitions, type InlineElement } from "../md/inline";
import { parseMdast } from "../md/mdast";

export interface EditorOptions {
  /** Inline `$…$` math (Preferences → Markdown, default off). */
  inlineMath: boolean;
  /** Show single line breaks as breaks (Preferences → Markdown, default on). */
  preserveLineBreaks: boolean;
  /** Auto pair brackets and quotes (default on). */
  autoPairBrackets: boolean;
  /** Auto pair Markdown symbols (default off). */
  autoPairMarkdown: boolean;
  /** Copy Markdown source as text/plain (default on). */
  copyMarkdown: boolean;
  /** Folder of the document, for relative image paths; null when untitled. */
  docDir: string | null;
  /** Path separator of the platform. */
  pathSep: string;
  /** Emoji autocomplete (Preferences → Editor, default on). */
  emojiAutocomplete: boolean;
  /** Open links with a plain click (Preferences → Editor, default off). */
  openLinksSingleClick: boolean;
}

export const defaultOptions: EditorOptions = {
  inlineMath: false,
  preserveLineBreaks: true,
  autoPairBrackets: true,
  autoPairMarkdown: false,
  copyMarkdown: true,
  docDir: null,
  pathSep: "/",
  emojiAutocomplete: true,
  openLinksSingleClick: false,
};

/** Textblocks whose content is Markdown inline source. */
export function isProse(node: Node): boolean {
  return node.type.name === "paragraph" || node.type.name === "heading";
}

/** Inline source of a textblock (line breaks as "\n"). */
export function blockSource(node: Node): string {
  return node.textBetween(0, node.content.size, undefined, "\n");
}

// ---- definitions ---------------------------------------------------------------------

let defsCache: { key: string; defs: Definitions } | null = null;

/** Link and footnote definitions anywhere in the document. */
export function documentDefinitions(doc: Node): Definitions {
  const sources: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === "raw" && (n.attrs.kind === "definition" || n.attrs.kind === "footnote")) {
      sources.push(blockSource(n));
      return false;
    }
    return !n.isTextblock;
  });
  const key = sources.join("\u0000");
  if (defsCache && defsCache.key === key) return defsCache.defs;
  const defs: Definitions = { links: new Map(), footnotes: new Set() };
  for (const src of sources) {
    const root = parseMdast(src, { frontMatter: false });
    for (const n of root.children) {
      if (n.type === "definition") {
        const label = normalizeLabel(n.label ?? n.identifier);
        if (!defs.links.has(label)) defs.links.set(label, { url: n.url, title: n.title ?? null });
      } else if (n.type === "footnoteDefinition") {
        defs.footnotes.add(n.label ?? n.identifier);
      }
    }
  }
  defsCache = { key, defs };
  return defs;
}

// ---- inline element cache --------------------------------------------------------------

const cache = new WeakMap<Node, { defs: Definitions; math: boolean; els: InlineElement[] }>();

export function elementsOf(node: Node, defs: Definitions, opts: EditorOptions): InlineElement[] {
  if (!isProse(node)) return [];
  const hit = cache.get(node);
  if (hit && hit.defs === defs && hit.math === opts.inlineMath) return hit.els;
  const els = analyzeInline(blockSource(node), { inlineMath: opts.inlineMath, definitions: defs });
  cache.set(node, { defs, math: opts.inlineMath, els });
  return els;
}
