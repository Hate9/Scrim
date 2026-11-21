// CodeMirror 6 node views for code-like blocks (spec 04: 4.5 code, 4.6 math, 4.10 HTML,
// 4.11 front matter). The ProseMirror node stays the source of truth; its content is the
// block's text with each line break as a `line_break` atom, which maps 1:1 onto
// CodeMirror's "\n", so positions translate by a constant offset.

import { defaultKeymap, indentLess, indentMore } from "@codemirror/commands";
import { Compartment, EditorState as CMState, type Extension } from "@codemirror/state";
import {
  Decoration as CMDecoration,
  EditorView as CMView,
  keymap as cmKeymap,
  lineNumbers,
  ViewPlugin,
  type DecorationSet as CMDecorationSet,
  type KeyBinding,
  type ViewUpdate,
} from "@codemirror/view";
import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { tags, tagHighlighter } from "@lezer/highlight";
import { redo, undo } from "prosemirror-history";
import { Fragment, type Node } from "prosemirror-model";
import { Selection, TextSelection } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import { schema } from "../md/schema";
import type { EditorOptions } from "./context";

// ---- shared CodeMirror setup -----------------------------------------------------------

/** Theme contract (spec 04, 4.5): highlight tags → the class names themes expect. */
export const scrimHighlighter = tagHighlighter([
  { tag: tags.keyword, class: "cm-keyword" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], class: "cm-string" },
  { tag: tags.comment, class: "cm-comment" },
  { tag: [tags.number, tags.integer, tags.float], class: "cm-number" },
  { tag: [tags.definition(tags.variableName), tags.function(tags.definition(tags.variableName))], class: "cm-def" },
  { tag: tags.variableName, class: "cm-variable" },
  { tag: tags.local(tags.variableName), class: "cm-variable-2" },
  { tag: [tags.typeName, tags.className], class: "cm-variable-3" },
  { tag: tags.propertyName, class: "cm-property" },
  { tag: [tags.operator, tags.operatorKeyword], class: "cm-operator" },
  { tag: [tags.meta, tags.processingInstruction, tags.documentMeta], class: "cm-meta" },
  { tag: tags.tagName, class: "cm-tag" },
  { tag: tags.attributeName, class: "cm-attribute" },
  { tag: [tags.atom, tags.bool, tags.null, tags.self], class: "cm-atom" },
  { tag: tags.standard(tags.variableName), class: "cm-builtin" },
  { tag: tags.namespace, class: "cm-qualifier" },
  { tag: [tags.bracket, tags.paren, tags.squareBracket, tags.brace, tags.angleBracket], class: "cm-bracket" },
  { tag: [tags.link, tags.url], class: "cm-link" },
  { tag: tags.heading, class: "cm-header" },
  { tag: tags.quote, class: "cm-quote" },
  { tag: tags.contentSeparator, class: "cm-hr" },
  { tag: tags.invalid, class: "cm-error" },
]);

/** `.cm-line` also gets the legacy `CodeMirror-line` class (theme contract 10.3). */
const lineAlias = ViewPlugin.fromClass(
  class {
    decorations: CMDecorationSet;
    constructor(view: CMView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: CMView) {
      const deco = CMDecoration.line({ class: "CodeMirror-line" });
      const ranges = [];
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          ranges.push(deco.range(line.from));
          pos = line.to + 1;
        }
      }
      return CMDecoration.set(ranges);
    }
  },
  { decorations: (v) => v.decorations },
);

let languageList: LanguageDescription[] | null = null;
async function languages(): Promise<LanguageDescription[]> {
  if (!languageList) languageList = (await import("@codemirror/language-data")).languages;
  return languageList;
}

/** Language support for a name, loaded lazily (4.5: highlighting is lazy). */
export async function loadLanguage(name: string): Promise<Extension | null> {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower === "html" || lower === "xml" || lower === "htm") return (await import("@codemirror/lang-html")).html();
  if (lower === "yaml" || lower === "yml") return (await import("@codemirror/lang-yaml")).yaml();
  const desc = LanguageDescription.matchLanguageName(await languages(), name, true);
  if (!desc) return null;
  return desc.support ?? (await desc.load());
}

/** Languages for the language box: names and aliases. */
export async function languageNames(): Promise<{ name: string; alias: readonly string[] }[]> {
  return (await languages()).map((l) => ({ name: l.name, alias: l.alias }));
}

function textOf(node: Node): string {
  return node.textBetween(0, node.content.size, undefined, "\n");
}

/** ProseMirror inline content for a piece of text ("\n" → line_break). */
export function nodesFromText(text: string): Fragment {
  const out: Node[] = [];
  text.split("\n").forEach((part, i) => {
    if (i) out.push(schema.nodes.line_break.create());
    if (part) out.push(schema.text(part));
  });
  return Fragment.from(out);
}

export type CodeKind = "code" | "math" | "html" | "frontmatter";

export interface CodeViewHooks {
  renderMath(tex: string, el: HTMLElement, display: boolean): void;
  /** Sanitized preview of an HTML block into `el`. */
  renderHtml(html: string, el: HTMLElement): void;
  copyText(text: string): void;
}

// ---- the node view ------------------------------------------------------------------------

export class CodeBlockView implements NodeView {
  dom: HTMLElement;
  cm: CMView;
  private updating = false;
  private lang = new Compartment();
  private langName = "";
  private preview: HTMLElement | null = null;
  private source: HTMLElement;
  private previewTimer = 0;
  private langBox: LanguageBox | null = null;

  constructor(
    private node: Node,
    private view: EditorView,
    private getPos: () => number | undefined,
    private kind: CodeKind,
    private opts: EditorOptions,
    private hooks: CodeViewHooks,
  ) {
    this.source = document.createElement("div");
    switch (kind) {
      case "code":
        this.dom = document.createElement("pre");
        this.dom.className = "md-fences";
        this.source = this.dom;
        break;
      case "math":
        this.dom = document.createElement("div");
        this.dom.className = "md-math-block";
        this.source.className = "md-math-source";
        this.preview = document.createElement("div");
        this.preview.className = "math-display";
        this.dom.append(this.source, this.preview);
        break;
      case "html":
        this.dom = document.createElement("div");
        this.dom.className = "md-htmlblock";
        this.source.className = "md-htmlblock-source";
        this.preview = document.createElement("div");
        this.preview.className = "md-htmlblock-container";
        this.dom.append(this.source, this.preview);
        break;
      default:
        this.dom = document.createElement("pre");
        this.dom.className = "md-meta-block";
        this.source = this.dom;
    }
    if (this.preview) {
      this.preview.contentEditable = "false";
      this.preview.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.enter(1);
      });
    }
    this.cm = new CMView({
      parent: this.source,
      state: CMState.create({ doc: textOf(node), extensions: this.extensions() }),
      dispatch: (tr) => this.dispatchInner(tr),
    });
    if (kind === "code") {
      this.langBox = new LanguageBox(this);
      this.dom.appendChild(this.langBox.dom);
      if (opts.codeCopyButton) this.addCopyButton();
    }
    this.syncAttrs();
    this.renderPreview();
  }

  private extensions(): Extension[] {
    const exts: Extension[] = [
      cmKeymap.of([...this.escapeKeys(), ...defaultKeymap]),
      syntaxHighlighting(scrimHighlighter),
      lineAlias,
      this.lang.of([]),
      CMView.editorAttributes.of({ class: "CodeMirror cm-s-inner" }),
      CMView.contentAttributes.of({ class: "CodeMirror-lines", spellcheck: "false" }),
      CMState.tabSize.of(4),
      CMView.updateListener.of((u) => {
        if (u.docChanged && this.preview) this.schedulePreview();
        if (u.focusChanged) this.dom.classList.toggle("md-editing", u.view.hasFocus);
      }),
    ];
    if (this.kind !== "code" || this.opts.codeWrap) exts.push(CMView.lineWrapping);
    if (this.kind === "code" && this.opts.codeLineNumbers) exts.push(lineNumbers());
    return exts;
  }

  // ---- ProseMirror → CodeMirror -------------------------------------------------------

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.syncAttrs();
    const next = textOf(node);
    const cur = this.cm.state.doc.toString();
    if (next !== cur) {
      let start = 0;
      let endCur = cur.length;
      let endNext = next.length;
      while (start < endCur && cur.charCodeAt(start) === next.charCodeAt(start)) start++;
      while (endCur > start && endNext > start && cur.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)) {
        endCur--;
        endNext--;
      }
      this.updating = true;
      this.cm.dispatch({ changes: { from: start, to: endCur, insert: next.slice(start, endNext) } });
      this.updating = false;
      this.schedulePreview();
    }
    return true;
  }

  private syncAttrs() {
    if (this.kind === "code") {
      const lang = (this.node.attrs.info as string).split(/\s+/)[0] ?? "";
      this.dom.setAttribute("lang", lang);
      this.langBox?.setValue(lang);
      this.setLanguage(lang);
    } else if (this.kind === "math") this.setLanguage("latex");
    else if (this.kind === "html") this.setLanguage("html");
    else this.setLanguage("yaml");
  }

  private setLanguage(name: string) {
    if (name === this.langName) return;
    this.langName = name;
    void loadLanguage(name).then((ext) => {
      if (this.langName !== name) return;
      this.cm.dispatch({ effects: this.lang.reconfigure(ext ?? []) });
    });
  }

  private schedulePreview() {
    if (!this.preview) return;
    clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => this.renderPreview(), 150); // 4.6: debounced
  }

  private renderPreview() {
    if (!this.preview) return;
    const text = this.cm.state.doc.toString();
    if (this.kind === "math") this.hooks.renderMath(text, this.preview, true);
    else if (this.kind === "html") this.hooks.renderHtml(text, this.preview);
  }

  // ---- CodeMirror → ProseMirror -------------------------------------------------------

  private dispatchInner(tr: import("@codemirror/state").Transaction) {
    this.cm.update([tr]);
    if (this.updating || !tr.docChanged && !tr.selection) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    const offset = pos + 1;
    const pmTr = this.view.state.tr;
    if (tr.docChanged) {
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
        const from = pmTr.mapping.map(offset + fromA);
        const to = pmTr.mapping.map(offset + toA);
        const content = nodesFromText(text.toString());
        if (content.size) pmTr.replaceWith(from, to, content);
        else pmTr.delete(from, to);
      });
    }
    const sel = this.cm.state.selection.main;
    const anchor = offset + sel.anchor;
    const head = offset + sel.head;
    if (!this.view.state.selection.eq(TextSelection.create(pmTr.doc, anchor, head)) || tr.docChanged) {
      pmTr.setSelection(TextSelection.create(pmTr.doc, anchor, head));
    }
    this.view.dispatch(pmTr);
  }

  setSelection(anchor: number, head: number) {
    this.show();
    this.cm.focus();
    this.updating = true;
    this.cm.dispatch({ selection: { anchor, head } });
    this.updating = false;
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
    if (this.preview) return;
    this.cm.focus();
  }

  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }

  stopEvent(e: Event) {
    // The language box and the copy button handle their own events.
    if (this.langBox?.dom.contains(e.target as globalThis.Node)) return true;
    return this.source.contains(e.target as globalThis.Node);
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    clearTimeout(this.previewTimer);
    this.cm.destroy();
  }

  /** Show the source editor (math/HTML edit state). */
  private show() {
    this.dom.classList.add("md-editing");
  }

  /** Enter the block from outside: `dir` 1 = at the start, -1 = at the end. */
  enter(dir: 1 | -1) {
    const pos = this.getPos();
    if (pos === undefined) return;
    const at = dir > 0 ? pos + 1 : pos + 1 + this.node.content.size;
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, at)));
    this.view.focus();
  }

  /** Leave the block in direction `dir`, creating a paragraph after it if needed. */
  leave(dir: 1 | -1) {
    const pos = this.getPos();
    if (pos === undefined) return;
    const { state } = this.view;
    const target = dir < 0 ? pos : pos + this.node.nodeSize;
    let sel = Selection.findFrom(state.doc.resolve(target), dir, true);
    let tr = state.tr;
    if (dir > 0 && (!sel || sel.from < target)) {
      tr = tr.insert(target, schema.nodes.paragraph.create());
      sel = TextSelection.create(tr.doc, target + 1);
    }
    if (!sel) return;
    this.dom.classList.remove("md-editing");
    this.view.dispatch(tr.setSelection(sel).scrollIntoView());
    this.view.focus();
  }

  private escapeKeys(): KeyBinding[] {
    const at = (unit: "line" | "char", dir: 1 | -1) => (cm: CMView) => {
      const { main } = cm.state.selection;
      if (!main.empty) return false;
      if (unit === "line") {
        const line = cm.state.doc.lineAt(main.head);
        const visual = cm.moveVertically(main, dir > 0);
        if (visual.head !== main.head) return false;
        if (dir < 0 ? line.number !== 1 : line.number !== cm.state.doc.lines) return false;
      } else if (dir < 0 ? main.head > 0 : main.head < cm.state.doc.length) return false;
      this.leave(dir);
      return true;
    };
    const pmCommand = (cmd: typeof undo) => () => cmd(this.view.state, this.view.dispatch);
    return [
      { key: "ArrowUp", run: at("line", -1) },
      { key: "ArrowDown", run: at("line", 1) },
      { key: "ArrowLeft", run: at("char", -1) },
      { key: "ArrowRight", run: at("char", 1) },
      { key: "Escape", run: () => (this.leave(1), true) },
      { key: "Mod-z", run: pmCommand(undo) },
      { key: "Mod-y", run: pmCommand(redo) },
      { key: "Mod-Shift-z", run: pmCommand(redo) },
      { key: "Tab", run: (cm) => (cm.state.selection.main.empty ? (cm.dispatch(cm.state.replaceSelection("    ")), true) : indentMore(cm)) },
      { key: "Shift-Tab", run: indentLess },
      {
        key: "Mod-a",
        run: (cm) => {
          const { main } = cm.state.selection;
          if (main.from === 0 && main.to === cm.state.doc.length) return false; // second press: whole document
          cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } });
          return true;
        },
      },
      {
        key: "Backspace",
        run: (cm) => {
          // An empty code or math block becomes an empty paragraph (3.4).
          if (cm.state.doc.length || (this.kind !== "code" && this.kind !== "math")) return false;
          const pos = this.getPos();
          if (pos === undefined) return false;
          const tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, schema.nodes.paragraph.create());
          this.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)));
          this.view.focus();
          return true;
        },
      },
    ];
  }

  // ---- code block extras ------------------------------------------------------------

  setInfo(lang: string) {
    const pos = this.getPos();
    if (pos === undefined) return;
    const rest = (this.node.attrs.info as string).split(/\s+/).slice(1).join(" ");
    const info = [lang, rest].filter(Boolean).join(" ");
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, info }));
  }

  focusCode() {
    this.cm.focus();
  }

  private addCopyButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "md-fences-copy";
    b.contentEditable = "false";
    b.title = "Copy code";
    b.textContent = "Copy";
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.hooks.copyText(this.cm.state.doc.toString());
    });
    this.dom.appendChild(b);
  }
}

/** Language box (4.5): shows the language, offers an autocomplete list while typing. */
class LanguageBox {
  dom: HTMLDivElement;
  private input: HTMLInputElement;
  private list: HTMLDivElement;
  private items: string[] = [];
  private index = 0;

  constructor(private owner: CodeBlockView) {
    this.dom = document.createElement("div");
    this.dom.className = "md-lang-box";
    this.dom.contentEditable = "false";
    this.input = document.createElement("input");
    this.input.className = "md-lang-input";
    this.input.placeholder = "lang";
    this.input.spellcheck = false;
    this.list = document.createElement("div");
    this.list.className = "md-lang-list";
    this.list.hidden = true;
    this.dom.append(this.input, this.list);
    this.input.addEventListener("input", () => void this.suggest());
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (this.items.length) this.select(this.index + (e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.commit(!this.list.hidden && this.items.length ? this.items[this.index] : this.input.value.trim());
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.list.hidden = true;
        this.owner.focusCode();
      }
    });
    this.input.addEventListener("blur", () => setTimeout(() => (this.list.hidden = true), 150));
    this.list.addEventListener("mousedown", (e) => {
      const row = (e.target as HTMLElement).closest("[data-name]") as HTMLElement | null;
      if (row) {
        e.preventDefault();
        this.commit(row.dataset.name!);
      }
    });
  }

  setValue(lang: string) {
    if (document.activeElement !== this.input) this.input.value = lang;
  }

  private async suggest() {
    const q = this.input.value.trim().toLowerCase();
    if (!q) {
      this.list.hidden = true;
      return;
    }
    const all = await languageNames();
    const scored: [number, string][] = [];
    for (const l of all) {
      const names = [l.name, ...l.alias];
      let best = Infinity;
      for (const n of names) {
        const s = fuzzyScore(q, n.toLowerCase());
        if (s < best) best = s;
      }
      if (best < Infinity) scored.push([best, l.alias[0] ?? l.name.toLowerCase()]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    this.items = [...new Set(scored.map((s) => s[1]))].slice(0, 8);
    this.list.textContent = "";
    for (const name of this.items) {
      const row = document.createElement("div");
      row.className = "md-lang-item";
      row.dataset.name = name;
      row.textContent = name;
      this.list.appendChild(row);
    }
    this.list.hidden = this.items.length === 0;
    this.select(0);
  }

  private select(i: number) {
    if (!this.items.length) return;
    this.index = (i + this.items.length) % this.items.length;
    [...this.list.children].forEach((c, j) => c.classList.toggle("active", j === this.index));
  }

  private commit(lang: string) {
    this.list.hidden = true;
    this.input.value = lang;
    this.owner.setInfo(lang);
    this.owner.focusCode();
  }
}

/** Lower is better; Infinity = no match. Prefix < substring < subsequence. */
export function fuzzyScore(q: string, name: string): number {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1 + name.length - q.length;
  const i = name.indexOf(q);
  if (i >= 0) return 100 + i;
  let j = 0;
  for (const c of name) if (c === q[j]) j++;
  return j === q.length ? 1000 + name.length : Infinity;
}

export function codeNodeViews(opts: EditorOptions, hooks: CodeViewHooks) {
  const make = (kind: CodeKind) => (node: Node, view: EditorView, getPos: () => number | undefined) =>
    new CodeBlockView(node, view, getPos, kind, opts, hooks);
  return {
    code_block: make("code"),
    math_block: make("math"),
    html_block: make("html"),
    front_matter: make("frontmatter"),
  };
}
