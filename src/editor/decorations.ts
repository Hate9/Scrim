// Inline rendering (spec 03, 3.2; spec 05; theme contract spec 10.3).
//
// Every inline element gets the same decorations whether or not it is expanded:
//   span.md-inline.md-inline-<kind>[data-el]   around markers + content
//   <nodeName> (strong, em, a, …)              around the content
//   span.md-meta                               around each marker run
//   span.md-widget[data-el]                    rendered image/emoji/entity/math
// Expansion only toggles the `md-expand` class on those elements (reveal.ts), so cursor
// movement never adds or removes decorations (spec 01, "Decorations must keep a stable
// DOM structure"). Decorations are recomputed only for textblocks a transaction
// touched, and are frozen during IME composition.

import type { Node } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { flatten, type InlineElement, type Widget, type Definitions } from "../md/inline";
import { documentDefinitions, elementsOf, isProse, type EditorOptions } from "./context";
import { sanitizeAttrs } from "./sanitize";

export interface InlineDecoState {
  set: DecorationSet;
  defs: Definitions;
}

export const inlineKey = new PluginKey<InlineDecoState>("scrim-inline");

/** Hooks the decorations need from the environment (image URLs, math rendering). */
export interface RenderHooks {
  imageUrl(src: string): string;
  renderMath(tex: string, el: HTMLElement): void;
}

function widgetDom(w: Widget, index: number, hooks: RenderHooks, kind: string): HTMLElement {
  const span = document.createElement("span");
  span.className = `md-widget md-widget-${w.type}`;
  span.dataset.el = String(index);
  span.dataset.kind = kind;
  span.contentEditable = "false";
  switch (w.type) {
    case "image": {
      const wrap = document.createElement("span");
      wrap.className = "md-image";
      const img = document.createElement("img");
      img.src = hooks.imageUrl(w.src);
      img.alt = w.alt;
      if (w.title) img.title = w.title;
      img.draggable = false;
      wrap.appendChild(img);
      span.appendChild(wrap);
      break;
    }
    case "emoji": {
      const e = document.createElement("span");
      e.className = "md-emoji";
      e.textContent = w.char;
      e.title = `:${w.name}:`;
      span.appendChild(e);
      break;
    }
    case "char":
      span.textContent = w.char;
      break;
    case "math": {
      const m = document.createElement("span");
      m.className = "md-inline-math";
      hooks.renderMath(w.tex, m);
      span.appendChild(m);
      break;
    }
    case "hidden":
      break;
  }
  return span;
}

function widgetKey(w: Widget): string {
  switch (w.type) {
    case "image":
      return `img:${w.src}:${w.alt}:${w.title ?? ""}`;
    case "emoji":
      return `emoji:${w.name}`;
    case "char":
      return `char:${w.char}`;
    case "math":
      return `math:${w.tex}`;
    default:
      return "hidden";
  }
}

export function decorationsForBlock(node: Node, pos: number, defs: Definitions, opts: EditorOptions, hooks: RenderHooks): Decoration[] {
  const els = flatten(elementsOf(node, defs, opts));
  const base = pos + 1;
  const out: Decoration[] = [];
  els.forEach((e: InlineElement, i) => {
    let cls = `md-inline md-inline-${e.kind}`;
    if (e.replace) cls += " md-replace";
    if (e.kind === "rawhtml") cls += " md-meta-text";
    if (e.kind === "break" && e.attrs?.["data-spaces"]) cls += " md-break-spaces";
    if (e.kind === "html" && (e.nodeName === "br" || e.nodeName === "wbr")) cls += " md-replace";
    if (e.from < e.to) out.push(Decoration.inline(base + e.from, base + e.to, { nodeName: "span", class: cls, "data-el": String(i) }));
    if (e.nodeName && e.contentFrom < e.contentTo && e.kind !== "break") {
      const attrs = e.kind === "html" ? sanitizeAttrs(e.attrs) : { ...(e.attrs ?? {}) };
      if (e.nodeName === "a") {
        // No real href: WebKitGTK gives links inside contenteditable its own click
        // handling and Scrim opens links itself (Mod+click, spec 03, 3.9).
        attrs["data-href"] = attrs.href ?? "";
        delete attrs.href;
      }
      out.push(Decoration.inline(base + e.contentFrom, base + e.contentTo, { nodeName: e.nodeName, ...attrs }));
    }
    for (const [a, b] of e.hidden ?? []) if (a < b) out.push(Decoration.inline(base + a, base + b, { class: "md-hide" }));
    for (const [a, b] of e.runs) if (a < b) out.push(Decoration.inline(base + a, base + b, { class: "md-meta" }));
    let widget = e.replace && e.replace.type !== "hidden" ? e.replace : null;
    if (e.kind === "html" && (e.nodeName === "br" || e.nodeName === "wbr")) widget = { type: "char", char: "" };
    if (widget) {
      const w = widget;
      const brTag = e.kind === "html" && e.nodeName === "br";
      out.push(
        Decoration.widget(
          base + e.from,
          () => {
            const dom = widgetDom(w, i, hooks, e.kind);
            if (brTag) dom.appendChild(document.createElement("br"));
            return dom;
          },
          { side: -1, key: `${i}:${e.kind}:${widgetKey(w)}`, ignoreSelection: true, marks: [] },
        ),
      );
    }
  });
  return out;
}

function headingDecorations(node: Node, pos: number): Decoration[] {
  const level = node.attrs.level;
  return [
    Decoration.widget(
      pos + 1,
      () => {
        const s = document.createElement("span");
        s.className = "md-heading-hint";
        s.contentEditable = "false";
        s.textContent = `H${level}`;
        return s;
      },
      { side: -1, key: `hint${level}`, ignoreSelection: true, marks: [] },
    ),
  ];
}

function allDecorations(doc: Node, defs: Definitions, opts: EditorOptions, hooks: RenderHooks): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (isProse(node)) {
      decos.push(...decorationsForBlock(node, pos, defs, opts, hooks));
      if (node.type.name === "heading") decos.push(...headingDecorations(node, pos));
      return false;
    }
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, decos);
}

/** Ranges of the new document touched by a transaction. */
export function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  const maps = tr.mapping.maps;
  maps.forEach((map, i) => {
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      let from = newStart;
      let to = newEnd;
      for (let j = i + 1; j < maps.length; j++) {
        from = maps[j].map(from, -1);
        to = maps[j].map(to, 1);
      }
      ranges.push([from, Math.max(from, to)]);
    });
  });
  return ranges;
}

export function createInlinePlugin(opts: EditorOptions, hooks: RenderHooks): Plugin<InlineDecoState> {
  let composing = false;
  const rebuildMeta = "scrim-rebuild-inline";
  return new Plugin<InlineDecoState>({
    key: inlineKey,
    state: {
      init(_, state) {
        const defs = documentDefinitions(state.doc);
        return { defs, set: allDecorations(state.doc, defs, opts, hooks) };
      },
      apply(tr, value, _old, state: EditorState) {
        if (tr.getMeta(rebuildMeta)) {
          const defs = documentDefinitions(state.doc);
          return { defs, set: allDecorations(state.doc, defs, opts, hooks) };
        }
        if (!tr.docChanged) return value;
        let set = value.set.map(tr.mapping, tr.doc);
        if (composing) return { defs: value.defs, set };
        const defs = documentDefinitions(state.doc);
        if (defs !== value.defs) return { defs, set: allDecorations(state.doc, defs, opts, hooks) };
        const done = new Set<number>();
        for (const [from, to] of changedRanges(tr)) {
          const lo = Math.max(0, Math.min(from, state.doc.content.size));
          const hi = Math.max(lo, Math.min(to, state.doc.content.size));
          state.doc.nodesBetween(lo, hi, (node, pos) => {
            if (!node.isTextblock) return true;
            if (done.has(pos)) return false;
            done.add(pos);
            set = set.remove(set.find(pos, pos + node.nodeSize));
            if (isProse(node)) {
              const add = decorationsForBlock(node, pos, defs, opts, hooks);
              if (node.type.name === "heading") add.push(...headingDecorations(node, pos));
              set = set.add(state.doc, add);
            }
            return false;
          });
        }
        return { defs, set };
      },
    },
    props: {
      decorations(state) {
        return inlineKey.getState(state)?.set;
      },
      handleDOMEvents: {
        compositionstart() {
          composing = true;
          return false;
        },
        compositionend(view: EditorView) {
          composing = false;
          // Apply what was deferred during composition (spec 03, 3.3).
          setTimeout(() => view.dispatch(view.state.tr.setMeta(rebuildMeta, true)), 0);
          return false;
        },
      },
    },
  });
}
