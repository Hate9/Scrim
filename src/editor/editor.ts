// The live-preview editor: ProseMirror view over the Markdown document model.

import { baseKeymap, chainCommands } from "prosemirror-commands";
import { closeHistory, history, redo, undo } from "prosemirror-history";
import { dropCursor } from "prosemirror-dropcursor";
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
  arrowInto,
  enter,
  selectAll,
  shiftEnter,
  shiftTab,
  spaceInputRule,
  tab,
} from "./commands";
import { defaultOptions, type EditorOptions } from "./context";
import { createInlinePlugin, type RenderHooks } from "./decorations";
import { copyFlavors, handlePaste } from "./clipboard";
import { createEscapePlugin, flushEscapes } from "./escapes";
import { createEmojiPlugin } from "./emoji";
import { createHeadingPlugin } from "./headings";
import { createLinkPlugin, type LinkHooks } from "./links";
import { createNormalizePlugin } from "./normalize";
import { arrowCommand, createRevealPlugin } from "./reveal";
import { codeNodeViews, type CodeViewHooks } from "./codeview";
import { createBlocksPlugin, escapeFootnote, tocEnter } from "./blocks";
import { cellBreak, cellEnter, cellTextInput, createTablePlugin, deleteRow, insertRowBelow, nextCell } from "./tables";
import { renderHtmlBlock } from "./htmlblock";
import type { ImageHooks } from "./images";

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
  /** Copy the selection with the given text/plain flavor (Edit menu variants). */
  copyAs(kind: "markdown" | "plain"): void;
}

/** Test hook (E-14): when set, the time of every document update is recorded. */
let perfLog: number[] | null = null;
export function recordUpdates(on: boolean): number[] | null {
  perfLog = on ? [] : null;
  return perfLog;
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
  hooks: RenderHooks &
    LinkHooks & { copyText(text: string): void; onFrontMatter(fm: Record<string, string>): void; images: ImageHooks },
  onChange: (dirty: boolean) => void,
): Editor {
  const options: EditorOptions = { ...defaultOptions, ...opts };
  let savedDoc: Node | null = null;
  let dirty = false;
  let cleanCheck = 0;
  const groups = typingGroups();
  /** Set by Mod+Shift+V keydown; the paste event that follows inserts literally. */
  let plainPaste = false;
  /** Set by Copy as Plain Text; the copy event that follows writes rendered text. */
  let copyPlain = false;

  const keys = keymap({
    Enter: chainCommands(tocEnter, cellEnter, enter(options)),
    "Mod-Enter": insertRowBelow,
    Escape: escapeFootnote,
    "Shift-Enter": chainCommands(cellBreak, shiftEnter(options)),
    Backspace: backspace(options),
    Delete: del,
    Tab: chainCommands(nextCell(1), tab),
    "Shift-Tab": chainCommands(nextCell(-1), shiftTab),
    ArrowLeft: chainCommands(arrowCommand(options, -1, false), arrowInto("left")),
    ArrowRight: chainCommands(arrowCommand(options, 1, false), arrowInto("right")),
    ArrowUp: arrowInto("up"),
    ArrowDown: arrowInto("down"),
    "Shift-ArrowLeft": arrowCommand(options, -1, true),
    "Shift-ArrowRight": arrowCommand(options, 1, true),
    "Mod-z": undo,
    "Mod-y": redo,
    "Mod-Shift-z": redo,
    "Mod-a": selectAll,
    "Mod-Shift-Backspace": chainCommands(deleteRow(() => window.confirm("Delete this table?")), deleteToLineStart),
  });

  const plugins = [
    createEmojiPlugin(() => options.emojiAutocomplete),
    createLinkPlugin(options, hooks),
    history({ newGroupDelay: 1000 }),
    keys,
    keymap(baseKeymap),
    createInlinePlugin(options, hooks),
    createHeadingPlugin(),
    createRevealPlugin(options),
    createNormalizePlugin(),
    createEscapePlugin(options),
    createTablePlugin({
      copyText: hooks.copyText,
      confirm: (m) => window.confirm(m),
      prettyTables: () => options.prettyTables,
    }),
    createBlocksPlugin({ onFrontMatter: hooks.onFrontMatter, numberFootnotes: () => options.numberFootnotes }),
    dropCursor({ class: "scrim-drop-cursor", width: 2 }),
  ];

  function writeClipboard(v: EditorView, event: ClipboardEvent, cut: boolean): boolean {
    if (v.state.selection.empty || !event.clipboardData) return false;
    // The clipboard never receives an unescaped trigger (Q-010).
    flushEscapes(v, options);
    const { text, html } = copyFlavors(v.state, options, copyPlain);
    copyPlain = false;
    event.clipboardData.setData("text/plain", text);
    event.clipboardData.setData("text/html", html);
    event.preventDefault();
    if (cut) v.dispatch(v.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut"));
    return true;
  }

  const makeState = (doc: Node) => EditorState.create({ doc, plugins });
  const initial = parseMarkdown("").doc;

  const codeHooks: CodeViewHooks = {
    renderMath: (tex, el, display) => hooks.renderMath(numbered(tex, el), el, display),
    renderHtml: (html, el) =>
      renderHtmlBlock(html, el, { allowIframes: options.allowIframes, setImageSource: hooks.setImageSource }),
    copyText: hooks.copyText,
  };
  /** Auto-numbering of display equations (4.6, default off). */
  function numbered(tex: string, el: HTMLElement): string {
    if (!options.mathAutoNumber || /\\(tag|notag|nonumber)\b/.test(tex)) return tex;
    const blocks = [...document.querySelectorAll("#write .md-math-block .math-display")];
    const n = blocks.indexOf(el) + 1;
    return n > 0 ? `${tex}\\tag{${n}}` : tex;
  }

  const view = new EditorView(
    { mount },
    {
      state: makeState(initial),
      nodeViews: codeNodeViews(options, codeHooks),
      attributes: { spellcheck: "false", class: "scrim-doc" },
      dispatchTransaction(tr: Transaction) {
        const state = view.state.apply(tr);
        view.updateState(state);
        if (tr.docChanged && perfLog) perfLog.push(performance.now());
        if (tr.docChanged) {
          // Comparing whole documents is O(n): mark dirty at once, and check for a
          // return to the saved state (undo) only after typing pauses.
          if (!dirty) {
            dirty = true;
            onChange(true);
          }
          clearTimeout(cleanCheck);
          cleanCheck = window.setTimeout(() => {
            if (dirty && savedDoc !== null && view.state.doc.eq(savedDoc)) {
              dirty = false;
              onChange(false);
            }
          }, 300);
        }
      },
      handleKeyDown(_v, event) {
        // Clipboard keys stay native (01, rule 2); only remember the variant.
        plainPaste = event.ctrlKey && event.shiftKey && (event.key === "V" || event.key === "v" || event.code === "KeyV");
        return false;
      },
      handlePaste(v, event) {
        const plain = plainPaste;
        plainPaste = false;
        return handlePaste(v, event, options, plain, hooks.images);
      },
      handleDOMEvents: {
        dblclick(_v, event) {
          // Double-click on an image opens it in the system viewer (4.8).
          const img = (event.target as HTMLElement).closest?.(".md-image img") as HTMLImageElement | null;
          if (img?.dataset.src) {
            hooks.openLink(img.dataset.src, false);
            return true;
          }
          return false;
        },
        copy(v, event) {
          return writeClipboard(v, event as ClipboardEvent, false);
        },
        cut(v, event) {
          return writeClipboard(v, event as ClipboardEvent, true);
        },
      },
      handleTextInput(v, from, to, text) {
        groups(v, text);
        if (cellTextInput(v.state, from, to, text, v.dispatch)) return true;
        if (spaceInputRule(() => v.state, from, to, text, v.dispatch)) return true;
        return autoPair(v.state, from, to, text, options, v.dispatch);
      },
    },
  );

  return {
    view,
    options,
    markdown() {
      flushEscapes(view, options);
      return serialize(view.state.doc, { prettyTables: options.prettyTables });
    },
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
    copyAs(kind) {
      copyPlain = kind === "plain";
      const prev = options.copyMarkdown;
      if (kind === "markdown") options.copyMarkdown = true;
      document.execCommand("copy");
      options.copyMarkdown = prev;
      copyPlain = false;
    },
  };
}
