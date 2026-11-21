// Source code mode (spec 15): the whole Markdown source in CodeMirror.

import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { TextSelection } from "prosemirror-state";
import { scrimHighlighter } from "../editor/codeview";
import type { Editor } from "../editor/editor";
import { buildRegex, type FindQuery } from "../editor/find";
import { flushEscapes } from "../editor/escapes";
import { posToSource, serializeWithMap, sourceToPos } from "../md/serialize";
import type { SourceSearch } from "./findbar";

export class SourceMode implements SourceSearch {
  private cm: EditorView | null = null;
  private host: HTMLDivElement;
  private initial = "";
  private gutter = new Compartment();

  constructor(private editor: Editor, private onDirty: () => void, private lineNumbersOn: () => boolean) {
    this.host = document.createElement("div");
    this.host.id = "scrim-source";
    this.host.hidden = true;
    document.querySelector("content")!.appendChild(this.host);
  }

  active() {
    return this.cm !== null;
  }

  hasFocus() {
    return !!this.cm?.hasFocus;
  }

  /** Mod+/: switch to source mode or back. */
  toggle() {
    if (this.cm) this.leave();
    else this.enter();
  }

  enter() {
    const view = this.editor.view;
    flushEscapes(view, this.editor.options);
    const { text, map } = serializeWithMap(view.state.doc, { prettyTables: this.editor.options.prettyTables });
    this.initial = text;
    const sel = view.state.selection;
    const anchor = posToSource(map, sel.anchor);
    const head = posToSource(map, sel.head);
    // The block at the top of the viewport stays at the top (15).
    const scroller = view.dom.closest("content") as HTMLElement;
    const top = view.posAtCoords({ left: view.dom.getBoundingClientRect().left + 40, top: scroller.getBoundingClientRect().top + 8 });
    const topOffset = top ? posToSource(map, top.pos) : 0;
    this.cm = new EditorView({
      parent: this.host,
      state: EditorState.create({
        doc: text,
        selection: { anchor, head },
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown(),
          syntaxHighlighting(scrimHighlighter),
          EditorView.lineWrapping,
          this.gutter.of(this.lineNumbersOn() ? lineNumbers() : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) this.onDirty();
          }),
        ],
      }),
    });
    view.dom.hidden = true;
    this.host.hidden = false;
    document.body.classList.add("md-source-mode");
    this.cm.focus();
    const line = this.cm.lineBlockAt(Math.min(topOffset, text.length));
    scroller.scrollTop = line.top;
  }

  /** Apply the source editor's text to the document (save while in source mode). */
  sync(): boolean {
    if (!this.cm) return false;
    const text = this.cm.state.doc.toString();
    if (text === this.initial) return false;
    this.editor.applyText(text);
    this.initial = text;
    return true;
  }

  leave() {
    const cm = this.cm;
    if (!cm) return;
    const scroller = this.host.closest("content") as HTMLElement;
    const topLine = cm.lineBlockAtHeight(scroller.scrollTop);
    const { anchor, head } = cm.state.selection.main;
    const text = cm.state.doc.toString();
    // The whole source-mode session is one undo step (01, "Undo across live and source").
    if (text !== this.initial) this.editor.applyText(text);
    cm.destroy();
    this.cm = null;
    this.host.hidden = true;
    const view = this.editor.view;
    view.dom.hidden = false;
    document.body.classList.remove("md-source-mode");
    const { map } = serializeWithMap(view.state.doc, { prettyTables: this.editor.options.prettyTables });
    const a = sourceToPos(map, anchor);
    const h = sourceToPos(map, head);
    if (a !== null && h !== null) {
      try {
        view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(a), view.state.doc.resolve(h))));
      } catch {
        /* keep the selection */
      }
    }
    view.focus();
    const topPos = sourceToPos(map, topLine.from);
    if (topPos !== null) {
      const c = view.coordsAtPos(topPos);
      scroller.scrollTop += c.top - scroller.getBoundingClientRect().top - 8;
    }
  }

  setLineNumbers(on: boolean) {
    this.cm?.dispatch({ effects: this.gutter.reconfigure(on ? lineNumbers() : []) });
  }

  // ---- SourceSearch (find bar in source mode, 8) -----------------------------------------

  find(q: FindQuery) {
    const re = buildRegex({ ...q, source: true });
    if (!this.cm || !re) return [];
    const text = this.cm.state.doc.toString();
    const out: { from: number; to: number; groups: string[] }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      out.push({ from: m.index, to: m.index + m[0].length, groups: [...m] });
    }
    return out;
  }

  select(from: number, to: number) {
    this.cm?.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  }

  replace(ranges: { from: number; to: number; text: string }[]) {
    this.cm?.dispatch({ changes: ranges.map((r) => ({ from: r.from, to: r.to, insert: r.text })) });
  }
}
