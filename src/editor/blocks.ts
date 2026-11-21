// Block-level extras (spec 04): task items (4.4), table of contents (4.12), footnotes
// (4.13), and front matter keys (4.11).

import type { Node } from "prosemirror-model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "prosemirror-view";
import { markdownToHtml } from "../md/html";
import { freshUid, schema } from "../md/schema";
import { blockSource } from "./context";
import { changedRanges } from "./decorations";
import { headingKey, type HeadingInfo } from "./headings";
import { isStructural } from "./normalize";
import { isImageParagraphSource } from "./images";
import { jumpToAnchor } from "./links";

const S = schema.nodes;

// ---- task items (4.4) ------------------------------------------------------------------

/** Checkbox widget at the start of a task item's first textblock. */
function taskCheckbox(checked: boolean): HTMLElement {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "md-task-checkbox";
  box.checked = checked;
  box.contentEditable = "false";
  box.tabIndex = -1;
  return box;
}

/** Toggle the task item owning the checkbox `box` (B-7: cursor stays, one undo step). */
function toggleTaskAt(view: EditorView, box: HTMLElement): boolean {
  const pos = view.posAtDOM(box, 0);
  const $p = view.state.doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--) {
    const node = $p.node(d);
    if (node.type === S.list_item && node.attrs.task !== null) {
      const task = node.attrs.task === " " ? "x" : " ";
      view.dispatch(view.state.tr.setNodeMarkup($p.before(d), undefined, { ...node.attrs, task }));
      return true;
    }
  }
  return false;
}

/** Mod+Shift+X: toggle task items on the list items in the selection. */
export const toggleTask: Command = (state, dispatch) => {
  const items: { pos: number; node: Node }[] = [];
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type === S.list_item) items.push({ pos, node });
    return true;
  });
  if (!items.length) return false;
  if (dispatch) {
    const anyTask = items.some((i) => i.node.attrs.task !== null);
    const tr = state.tr;
    for (const { pos, node } of items) tr.setNodeMarkup(pos, undefined, { ...node.attrs, task: anyTask ? null : " " });
    dispatch(tr);
  }
  return true;
};

// ---- table of contents (4.12) ------------------------------------------------------------

const tocViews = new Set<TocView>();

class TocView implements NodeView {
  dom: HTMLDivElement;

  constructor(private node: Node, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = document.createElement("div");
    this.dom.className = "md-toc md-end-block";
    this.dom.contentEditable = "false";
    this.dom.addEventListener("mousedown", (e) => {
      const a = (e.target as HTMLElement).closest("a.md-toc-inner") as HTMLElement | null;
      if (a?.dataset.id) {
        e.preventDefault();
        jumpToAnchor(this.view, a.dataset.id);
      }
    });
    this.dom.addEventListener("dblclick", (e) => {
      e.preventDefault();
      showTocSource(this.view, this.getPos());
    });
    tocViews.add(this);
    this.render(headingKey.getState(view.state)?.list ?? []);
  }

  render(list: HeadingInfo[]) {
    const p = document.createElement("p");
    p.className = "md-toc-content";
    for (const h of list) {
      const item = document.createElement("span");
      item.className = `md-toc-item md-toc-h${h.level}`;
      const a = document.createElement("a");
      a.className = "md-toc-inner";
      a.dataset.id = h.id;
      a.textContent = h.text;
      item.appendChild(a);
      p.appendChild(item);
    }
    this.dom.replaceChildren(p);
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    return true;
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }
  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }
  stopEvent(e: Event) {
    return e.type === "mousedown" && !!(e.target as HTMLElement).closest("a.md-toc-inner");
  }
  ignoreMutation() {
    return true;
  }
  destroy() {
    tocViews.delete(this);
  }
}

/** Show `[toc]` as an editable paragraph (Enter or double-click on the TOC). */
export function showTocSource(view: EditorView, pos: number | undefined) {
  if (pos === undefined) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type !== S.toc) return;
  const { uid, sep, prev, lead, marks, sig, text } = node.attrs;
  const para = S.paragraph.create({ uid, sep, prev, lead, marks, sig }, schema.text(text));
  const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, para);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1 + text.length)));
  view.focus();
}

export const tocEnter: Command = (state, _dispatch, view) => {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type !== S.toc || !view) return false;
  showTocSource(view, sel.from);
  return true;
};

// ---- footnotes (4.13) ----------------------------------------------------------------------

/** Footnote definition (10.3): div.footnotes.md-def-footnote > span.md-def-name (label),
 * span.md-def-content (the definition's blocks), span.md-reverse-footnote-area >
 * a.reversefootnote. The label is the `[^label]:` source, shown as a name. */
class FootnoteDefView implements NodeView {
  dom: HTMLDivElement;
  contentDOM: HTMLSpanElement;
  private name: HTMLSpanElement;
  private back: HTMLSpanElement;

  constructor(private node: Node, private view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "footnotes md-def-footnote";
    this.name = document.createElement("span");
    this.name.className = "md-def-name";
    this.name.contentEditable = "false";
    this.contentDOM = document.createElement("span");
    this.contentDOM.className = "md-def-content md-def-footnote-content";
    this.back = document.createElement("span");
    this.back.className = "md-reverse-footnote-area md-def-footnote-back";
    this.back.contentEditable = "false";
    const a = document.createElement("a");
    a.className = "reversefootnote";
    a.textContent = "↩";
    a.title = "Back to reference";
    this.back.appendChild(a);
    this.back.addEventListener("mousedown", (e) => {
      e.preventDefault();
      jumpToReference(this.view, this.node.attrs.label);
    });
    this.dom.append(this.name, this.contentDOM, this.back);
    this.sync();
  }

  private sync() {
    this.dom.dataset.label = this.node.attrs.label;
    this.name.textContent = this.node.attrs.label;
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.sync();
    return true;
  }

  ignoreMutation(m: MutationRecord | { type: "selection"; target: globalThis.Node }) {
    return m.type !== "selection" && (this.back.contains(m.target) || this.name.contains(m.target) || (m.target === this.dom && m.type === "attributes"));
  }
}

/** Positions of footnote references `[^label]` in document order. */
function footnoteRefs(doc: Node): { label: string; pos: number }[] {
  const out: { label: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type === S.paragraph || node.type === S.heading || node.type === S.table_cell) {
      const src = blockSource(node);
      const re = /\[\^([^\]\s]+)\](?!:)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (m.index > 0 && src[m.index - 1] === "\\") continue;
        out.push({ label: m[1], pos: pos + 1 + m.index });
      }
      return false;
    }
    return !node.isTextblock;
  });
  return out;
}

export function jumpToReference(view: EditorView, label: string) {
  const ref = footnoteRefs(view.state.doc).find((r) => r.label === label);
  if (!ref) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, ref.pos + label.length + 3)).scrollIntoView());
  view.focus();
}

export function jumpToDefinition(view: EditorView, label: string): boolean {
  let at = -1;
  view.state.doc.descendants((n, pos) => {
    if (at < 0 && n.type === S.footnote_def && n.attrs.label === label) at = pos;
    return at < 0;
  });
  if (at < 0) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at + 1))).scrollIntoView());
  view.focus();
  return true;
}

/** Insert footnote (4.13, D-4): `[^n]` at the cursor, `[^n]: ` at the end. */
export const insertFootnote: Command = (state, dispatch) => {
  const used = new Set<string>();
  state.doc.descendants((n) => {
    if (n.type === S.footnote_def) used.add(n.attrs.label);
    return true;
  });
  for (const r of footnoteRefs(state.doc)) used.add(r.label);
  let n = 1;
  while (used.has(String(n))) n++;
  const label = String(n);
  if (dispatch) {
    const tr = state.tr.insertText(`[^${label}]`);
    const def = S.footnote_def.create({ uid: freshUid(), label }, S.paragraph.create({ uid: freshUid() }));
    const end = tr.doc.content.size;
    tr.insert(end, def);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 2)).scrollIntoView());
  }
  return true;
};

/** Escape inside a footnote definition returns to its reference (4.13). */
export const escapeFootnote: Command = (state, _dispatch, view) => {
  const $h = state.selection.$head;
  for (let d = $h.depth; d > 0; d--) {
    const n = $h.node(d);
    if (n.type === S.footnote_def) {
      if (view) jumpToReference(view, n.attrs.label);
      return true;
    }
  }
  return false;
};

/** Hover popover with the definition (B-9) and footnote numbering (default on). */
class FootnotePopover {
  dom: HTMLDivElement;
  private timer = 0;
  constructor() {
    this.dom = document.createElement("div");
    this.dom.className = "md-footnote-popover";
    this.dom.hidden = true;
    document.body.appendChild(this.dom);
  }
  schedule(view: EditorView, sup: HTMLElement) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.show(view, sup), 300);
  }
  show(view: EditorView, sup: HTMLElement) {
    const label = (sup.dataset.ref ?? sup.dataset.label) ?? "";
    let def: Node | null = null;
    view.state.doc.descendants((n) => {
      if (!def && n.type === S.footnote_def && n.attrs.label === label) def = n;
      return !def;
    });
    if (!def) return;
    const parts: string[] = [];
    (def as Node).forEach((c) => parts.push(c.isTextblock ? blockSource(c) : c.textContent));
    this.dom.innerHTML = markdownToHtml(parts.join("\n\n"));
    const r = sup.getBoundingClientRect();
    this.dom.style.left = `${r.left}px`;
    this.dom.style.top = `${r.bottom + 6}px`;
    this.dom.hidden = false;
  }
  hide() {
    clearTimeout(this.timer);
    this.dom.hidden = true;
  }
}

// ---- front matter (4.11) ---------------------------------------------------------------

/** Top-level `key: value` pairs of the front matter (enough for the recognized keys). */
export function frontMatter(doc: Node): Record<string, string> {
  const first = doc.firstChild;
  if (!first || first.type !== S.front_matter) return {};
  const out: Record<string, string> = {};
  for (const line of blockSource(first).split("\n")) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// ---- plugin ------------------------------------------------------------------------------

export const blocksKey = new PluginKey<DecorationSet>("scrim-blocks");

/** Decorations for one textblock: image paragraph class, task checkbox before it. */
/** Link definition parts (10.3): span.md-def-name, span.md-def-content.md-def-url,
 * span.md-def-title, with the brackets and colon as markers. One per source line. */
function definitionDecorations(node: Node, pos: number): Decoration[] {
  const out: Decoration[] = [];
  const src = blockSource(node);
  const re = /^([ \t]*)(\[)((?:\\.|[^\]\\])+)(\]:)([ \t]*)(<[^>\n]*>|\S+)?(?:([ \t]+)(["'(].*["')]))?/gm;
  let m: RegExpExecArray | null;
  const span = (from: number, len: number, cls: string) => {
    if (len > 0) out.push(Decoration.inline(pos + 1 + from, pos + 1 + from + len, { class: cls }));
  };
  while ((m = re.exec(src))) {
    let at = m.index + m[1].length;
    span(at, 1, "md-meta md-before");
    at += 1;
    span(at, m[3].length, "md-def-name");
    at += m[3].length;
    span(at, 2, "md-meta md-after");
    at += 2 + m[5].length;
    if (m[6]) span(at, m[6].length, "md-def-content md-def-url");
    at += (m[6]?.length ?? 0) + (m[7]?.length ?? 0);
    if (m[8]) span(at, m[8].length, "md-def-title");
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

function textblockDecorations(doc: Node, node: Node, pos: number): Decoration[] {
  const out: Decoration[] = [];
  if (node.type.name === "raw" && node.attrs.kind === "definition") return definitionDecorations(node, pos);
  if (node.type === S.paragraph && isImageParagraphSource(blockSource(node))) {
    out.push(Decoration.node(pos, pos + node.nodeSize, { class: "md-image-paragraph" }));
  }
  const $p = doc.resolve(pos);
  const item = $p.depth > 0 ? $p.parent : null;
  if (item && item.type === S.list_item && item.attrs.task !== null && $p.index() === 0) {
    const checked = item.attrs.task !== " ";
    // The checkbox is the list item's first child, before its paragraph (10.3).
    out.push(Decoration.widget(pos, () => taskCheckbox(checked), { side: -1, key: `task-${checked}`, ignoreSelection: true }));
  }
  return out;
}

/** Text-only edits: map, then redo the decorations of the touched textblocks. */
function updateDecorations(tr: Transaction, set: DecorationSet): DecorationSet {
  if (isStructural(tr)) return listDecorations(tr.doc);
  let next = set.map(tr.mapping, tr.doc);
  const doc = tr.doc;
  for (const [from, to] of changedRanges(tr)) {
    doc.nodesBetween(Math.min(from, doc.content.size), Math.min(to, doc.content.size), (node, pos) => {
      if (!node.isTextblock) return true;
      next = next.remove(next.find(pos, pos + node.nodeSize, (spec) => spec.block !== true));
      next = next.add(doc, textblockDecorations(doc, node, pos));
      return false;
    });
  }
  return next;
}

function listDecorations(doc: Node): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if ((node.type === S.bullet_list || node.type === S.ordered_list) && someTask(node)) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "contains-task-list" }, { block: true }));
    }
    if (node.isTextblock) {
      decos.push(...textblockDecorations(doc, node, pos));
      return false;
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

function someTask(list: Node): boolean {
  let any = false;
  list.forEach((i) => {
    if (i.attrs.task !== null) any = true;
  });
  return any;
}

export interface BlockHooks {
  onFrontMatter(fm: Record<string, string>): void;
  numberFootnotes(): boolean;
}

export function createBlocksPlugin(hooks: BlockHooks): Plugin {
  const popover = new FootnotePopover();
  let lastTitle: string | undefined;
  return new Plugin({
    key: blocksKey,
    state: {
      init: (_, s) => listDecorations(s.doc),
      apply: (tr, set) => (tr.docChanged ? updateDecorations(tr, set) : set),
    },
    appendTransaction(trs: readonly Transaction[], _old: EditorState, state: EditorState) {
      // A `[toc]` paragraph shown for editing turns back into a TOC when the cursor leaves.
      if (!trs.some((t) => t.selectionSet || t.docChanged)) return null;
      const head = state.selection.$head;
      const tr = state.tr;
      state.doc.forEach((node, pos) => {
        if (node.type === S.paragraph && /^\[toc\]$/i.test(node.textContent) && !(head.pos >= pos && head.pos <= pos + node.nodeSize)) {
          const { uid, sep, prev, lead, marks, sig } = node.attrs;
          tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize), S.toc.create({ uid, sep, prev, lead, marks, sig, text: node.textContent }));
        }
      });
      return tr.docChanged ? tr : null;
    },
    view(view) {
      // Document-wide scans (TOC, front matter title, footnote numbers) run shortly
      // after edits instead of on every keystroke (B-8 asks for TOC updates < 300 ms).
      let timer = 0;
      let lastDoc: Node | null = null;
      const refresh = (v: EditorView) => {
        const list = headingKey.getState(v.state)?.list ?? [];
        for (const t of tocViews) t.render(list);
        const fm = frontMatter(v.state.doc);
        if (fm.title !== lastTitle) {
          lastTitle = fm.title;
          hooks.onFrontMatter(fm);
        }
        // Footnote numbers in document order (4.13).
        const numbers = new Map<string, number>();
        if (hooks.numberFootnotes()) for (const r of footnoteRefs(v.state.doc)) if (!numbers.has(r.label)) numbers.set(r.label, numbers.size + 1);
        const observer = (v as unknown as { domObserver: { stop(): void; start(): void } }).domObserver;
        observer.stop();
        try {
          v.dom.querySelectorAll<HTMLElement>("sup.md-footnote, .md-def-footnote").forEach((el) => {
            const label = el.dataset.ref ?? el.dataset.label ?? el.textContent ?? "";
            const n = numbers.get(label);
            if (n === undefined) delete el.dataset.n;
            else el.dataset.n = String(n);
          });
        } finally {
          observer.start();
        }
      };
      const update = (v: EditorView) => {
        if (v.state.doc === lastDoc) return;
        lastDoc = v.state.doc;
        clearTimeout(timer);
        timer = window.setTimeout(() => !v.isDestroyed && refresh(v), 120);
      };
      // Plugin views are recreated when a document is loaded: re-attach the popover.
      if (!popover.dom.isConnected) document.body.appendChild(popover.dom);
      lastDoc = view.state.doc;
      refresh(view);
      return {
        update,
        destroy: () => {
          clearTimeout(timer);
          popover.hide();
        },
      };
    },
    props: {
      decorations: (state) => blocksKey.getState(state),
      nodeViews: {
        toc: (node, view, getPos) => new TocView(node, view, getPos),
        footnote_def: (node, view) => new FootnoteDefView(node, view),
      },
      handleClick(view, _pos, event) {
        const sup = (event.target as HTMLElement).closest?.("sup.md-footnote") as HTMLElement | null;
        if (sup && (event.ctrlKey || event.metaKey) && (sup.dataset.ref ?? sup.dataset.label)) return jumpToDefinition(view, (sup.dataset.ref ?? sup.dataset.label)!);
        return false;
      },
      handleDOMEvents: {
        mousedown(view, e) {
          const t = e.target as HTMLElement;
          if (t.classList?.contains("md-task-checkbox")) {
            e.preventDefault();
            return toggleTaskAt(view, t);
          }
          return false;
        },
        mouseover(view, e) {
          const sup = (e.target as HTMLElement).closest?.("sup.md-footnote") as HTMLElement | null;
          if (sup) popover.schedule(view, sup);
          return false;
        },
        mouseout(_view, e) {
          if ((e.target as HTMLElement).closest?.("sup.md-footnote")) popover.hide();
          return false;
        },
      },
    },
  });
}
