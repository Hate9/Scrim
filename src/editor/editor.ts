// The live-preview editor: ProseMirror view over the Markdown document model.

import { baseKeymap } from "prosemirror-commands";
import { closeHistory, history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Node } from "prosemirror-model";
import { EditorState, type Command, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { parseMarkdown } from "../md/parse";
import { schema } from "../md/schema";
import { serialize } from "../md/serialize";
import {
  autoPair,
  backspace,
  del,
  deleteToLineStart,
  enter,
  selectAll,
  shiftEnter,
  shiftTab,
  spaceInputRule,
  tab,
} from "./commands";
import { defaultOptions, type EditorOptions } from "./context";
import { createInlinePlugin, type RenderHooks } from "./decorations";
import { createHeadingPlugin } from "./headings";
import { createNormalizePlugin } from "./normalize";
import { arrowCommand, createRevealPlugin } from "./reveal";

export interface Editor {
  view: EditorView;
  options: EditorOptions;
  /** Markdown text of the current document, with original line endings. */
  markdown(): string;
  /** Replace the document (load). `eol` is the line ending for files without one. */
  load(text: string, newFile: boolean, eol: string): void;
  isDirty(): boolean;
  markSaved(): void;
  run(cmd: Command): boolean;
}

/** Typing groups break after whitespace that follows a word (3.8). */
function typingGroups() {
  let breakNext = false;
  return (view: EditorView, text: string): void => {
    if (breakNext && /\S/.test(text[0] ?? "")) {
      view.dispatch(closeHistory(view.state.tr));
      breakNext = false;
    }
    const prev = view.state.selection.$from.nodeBefore?.text?.slice(-1) ?? "";
    if (/\s/.test(text) && /\S/.test(prev)) breakNext = true;
  };
}

export function createEditor(
  mount: HTMLElement,
  opts: Partial<EditorOptions>,
  hooks: RenderHooks,
  onChange: (dirty: boolean) => void,
): Editor {
  const options: EditorOptions = { ...defaultOptions, ...opts };
  let savedDoc: Node | null = null;
  let dirty = false;
  const groups = typingGroups();

  const keys = keymap({
    Enter: enter(options),
    "Shift-Enter": shiftEnter(options),
    Backspace: backspace(options),
    Delete: del,
    Tab: tab,
    "Shift-Tab": shiftTab,
    ArrowLeft: arrowCommand(options, -1, false),
    ArrowRight: arrowCommand(options, 1, false),
    "Shift-ArrowLeft": arrowCommand(options, -1, true),
    "Shift-ArrowRight": arrowCommand(options, 1, true),
    "Mod-z": undo,
    "Mod-y": redo,
    "Mod-Shift-z": redo,
    "Mod-a": selectAll,
    "Mod-Shift-Backspace": deleteToLineStart,
  });

  const plugins = [
    history({ newGroupDelay: 1000 }),
    keys,
    keymap(baseKeymap),
    createInlinePlugin(options, hooks),
    createHeadingPlugin(),
    createRevealPlugin(options),
    createNormalizePlugin(),
  ];

  const makeState = (doc: Node) => EditorState.create({ doc, plugins });
  const initial = parseMarkdown("").doc;

  const view = new EditorView(
    { mount },
    {
      state: makeState(initial),
      attributes: { spellcheck: "false", class: "scrim-doc" },
      dispatchTransaction(tr: Transaction) {
        const state = view.state.apply(tr);
        view.updateState(state);
        if (tr.docChanged) {
          const now = savedDoc === null || !state.doc.eq(savedDoc);
          if (now !== dirty) {
            dirty = now;
            onChange(dirty);
          }
        }
      },
      handleTextInput(v, from, to, text) {
        groups(v, text);
        if (spaceInputRule(() => v.state, from, to, text, v.dispatch)) return true;
        return autoPair(v.state, from, to, text, options, v.dispatch);
      },
    },
  );

  return {
    view,
    options,
    markdown: () => serialize(view.state.doc),
    load(text: string, newFile: boolean, eol: string) {
      let { doc } = parseMarkdown(text, { inlineMath: options.inlineMath }, eol);
      if (newFile && !text) doc = schema.nodes.doc.create({ ...doc.attrs, finalNewline: true }, doc.content);
      view.updateState(makeState(doc));
      savedDoc = doc;
      dirty = false;
    },
    isDirty: () => dirty,
    markSaved() {
      savedDoc = view.state.doc;
      dirty = false;
    },
    run(cmd: Command) {
      return cmd(view.state, view.dispatch, view);
    },
  };
}
