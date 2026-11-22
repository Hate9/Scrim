// Source code mode (spec 15): the whole Markdown source in CodeMirror.

import { history, historyKeymap, defaultKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { cmAliases } from "../editor/codeview";
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
    // A layer over the document area, scrolling on its own: the live document stays laid
    // out underneath, so returning from source mode needs no layout of the whole document
    // (PF-1: < 300 ms on 10,000 lines).
    document.querySelector("content")!.after(this.host);
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
    performance.mark("scrim-src-enter");
    flushEscapes(view, this.editor.options);
    const { text, map } = serializeWithMap(view.state.doc, { prettyTables: this.editor.options.prettyTables });
    this.initial = text;
    const sel = view.state.selection;
    const anchor = posToSource(map, sel.anchor);
    const head = posToSource(map, sel.head);
    // The block at the top of the viewport stays at the top (15).
    const scroller = view.dom.closest("content") as HTMLElement;
    const top = view.posAtCoords({ left: view.dom.getBoundingClientRect().left + 40, top: scroller.getBoundingClientRect().top + 8 });
    // Between two blocks (in a margin), the block below is the one at the top.
    const size = view.state.doc.content.size;
    const topPos = top ? (view.state.doc.resolve(top.pos).depth === 0 ? Math.min(top.pos + 1, size) : top.pos) : 0;
    const topOffset = posToSource(map, topPos);
    performance.measure("scrim-src-enter-prep", "scrim-src-enter");
    performance.mark("scrim-src-cm");
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
          cmAliases("cm-s-scrim-default", true),
          this.gutter.of(this.lineNumbersOn() ? lineNumbers() : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) this.onDirty();
          }),
        ],
      }),
    });
    performance.measure("scrim-src-cm-create", "scrim-src-cm");
    this.host.hidden = false;
    document.body.classList.add("md-source-mode");
    this.cm.focus();
    const line = this.cm.lineBlockAt(Math.min(topOffset, text.length));
    // CodeMirror measures the lines it scrolls to (estimates would drift on wrapped lines).
    this.cm.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 8 }) });
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
    performance.mark("scrim-src-leave");
    const scroller = document.querySelector("content") as HTMLElement;
    const topLine = cm.lineBlockAtHeight(scroller.getBoundingClientRect().top + 8 - cm.documentTop);
    const { anchor, head } = cm.state.selection.main;
    const text = cm.state.doc.toString();
    // The whole source-mode session is one undo step (01, "Undo across live and source").
    if (text !== this.initial) this.editor.applyText(text);
    cm.destroy();
    this.cm = null;
    this.host.hidden = true;
    const view = this.editor.view;
    document.body.classList.remove("md-source-mode");
    performance.measure("scrim-src-leave-apply", "scrim-src-leave");
    performance.mark("scrim-src-leave2");
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
    performance.measure("scrim-src-leave-select", "scrim-src-leave2");
    performance.mark("scrim-src-leave3");
    view.focus();
    const topPos = sourceToPos(map, topLine.from);
    if (topPos !== null) {
      const c = view.coordsAtPos(topPos);
      scroller.scrollTop += c.top - scroller.getBoundingClientRect().top - 8;
    }
    performance.measure("scrim-src-leave-scroll", "scrim-src-leave3");
  }

  /** The selected source text (menu Copy). */
  selectedText(): string {
    if (!this.cm) return "";
    const { from, to } = this.cm.state.selection.main;
    return this.cm.state.sliceDoc(from, to);
  }

  /** Edit → Undo / Redo while source mode has focus. */
  history(redoIt: boolean) {
    if (this.cm) (redoIt ? redo : undo)(this.cm);
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
