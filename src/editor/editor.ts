// The live-preview editor: ProseMirror view over the Markdown document model.

import { timed, tracePlugins } from "./trace";
import type { Root } from "mdast";
import { createFindPlugin } from "./find";
import { baseKeymap, chainCommands } from "prosemirror-commands";
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
  arrowInto,
  enter,
  selectAll,
  shiftEnter,
  shiftTab,
  laxHeadingInputRule, spaceInputRule,
  tab,
} from "./commands";
import { defaultOptions, type EditorOptions } from "./context";
import { createInlinePlugin, type RenderHooks } from "./decorations";
import { copyFlavors, handlePaste } from "./clipboard";
import { createTextDragPlugin } from "./dnd";
import { createEscapePlugin, flushEscapes } from "./escapes";
import { createEmojiPlugin } from "./emoji";
import { createHeadingPlugin } from "./headings";
import { createLinkPlugin, type LinkHooks } from "./links";
import { createNormalizePlugin } from "./normalize";
import { arrowCommand, createRevealPlugin } from "./reveal";
import { createSpellPlugin, type SpellHooks } from "./spell";
import { createSmartPlugin } from "./smart";
import { createViewportPlugin, viewportNodeViews } from "./viewport";
import { codeNodeViews, createCodeSelectionPlugin, type CodeViewHooks } from "./codeview";
import { blockNodeViews, createBlocksPlugin, escapeFootnote, tocEnter } from "./blocks";
import { cellBreak, cellEnter, cellTextInput, createTablePlugin, deleteRow, insertRowBelow, nextCell } from "./tables";
import { renderHtmlBlock } from "./htmlblock";
import type { ImageHooks } from "./images";

export interface Editor {
  view: EditorView;
  options: EditorOptions;
  /** Markdown text of the current document, with original line endings. */
  markdown(): string;
  /** Replace the document (load). `eol` is the line ending for files without one. */
  load(text: string, newFile: boolean, eol: string, blockTree?: Root): void;
  isDirty(): boolean;
  markSaved(): void;
  run(cmd: Command): boolean;
  /** Copy the selection with the given text/plain flavor (Edit menu variants). */
  copyAs(kind: "markdown" | "plain"): void;
  /** The clipboard flavors for the selection (menu-driven Copy/Cut, 01 rule 2). */
  flavors(kind?: "markdown" | "plain"): { text: string; html: string } | null;
  /** Feed clipboard contents read through Rust into the paste pipeline (menu Paste). */
  pasteFrom(text: string | null, html: string | null, plain: boolean): void;
  /**
   * Replace the document with `text` as one undoable step (source mode, external
   * reload). Unchanged top-level blocks keep their identity; the result serializes to
   * exactly `text`. Returns the transaction's document.
   */
  applyText(text: string, addToHistory?: boolean, blockTree?: Root): Node;
  /** Number of source lines (status bar). */
  markdownLines(): number;
  /** Hook for other modules: called after every view update. */
  onUpdate: ((view: EditorView) => void)[];
  /** Called after the whole text was loaded or replaced (load, applyText). */
  onReplace: (() => void)[];
}

/** Same type and content (attributes such as uids may differ). */
function sameBlock(a: Node, b: Node): boolean {
  return a.type === b.type && a.content.eq(b.content) && sameAttrs(a, b);
}
function sameAttrs(a: Node, b: Node): boolean {
  for (const k of ["level", "info", "task", "align", "kind", "label", "text", "marker"]) {
    if (k in a.attrs && JSON.stringify(a.attrs[k]) !== JSON.stringify(b.attrs[k])) return false;
  }
  return true;
}

/** Test hook (E-14): when set, the time of every document update is recorded. */
let perfLog: number[] | null = null;
export function recordUpdates(on: boolean): number[] | null {
  perfLog = on ? [] : null;
  return perfLog;
}

/** Typing groups break after whitespace that follows a word (3.8). `input` is called for
 * typed text; `mark` closes the history group on the transaction that inserts it (a
 * separate transaction for that cost a second view update on each word, Q-027 follow-up). */
function typingGroups() {
  let breakNext = false;
  let closeNext = false;
  return {
    input(view: EditorView, text: string): void {
      if (breakNext && /\S/.test(text[0] ?? "")) {
        closeNext = true;
        breakNext = false;
      }
      const prev = view.state.selection.$from.nodeBefore?.text?.slice(-1) ?? "";
      if (/\s/.test(text) && /\S/.test(prev)) breakNext = true;
    },
    mark(tr: Transaction): void {
      if (closeNext && tr.docChanged) {
        closeHistory(tr);
        closeNext = false;
      }
    },
  };
}

export function createEditor(
  mount: HTMLElement,
  opts: Partial<EditorOptions>,
  hooks: RenderHooks &
    LinkHooks & {
      copyText(text: string): void;
      onFrontMatter(fm: Record<string, string>): void;
      images: ImageHooks;
      embedUrl(src: string): string;
      spell: SpellHooks;
    },
  onChange: (dirty: boolean) => void,
): Editor {
  const options: EditorOptions = { ...defaultOptions, ...opts };
  /** The Markdown as last loaded or saved (presentation marks do not count as edits). */
  let savedText: string | null = null;
  let dirty = false;
  let cleanCheck = 0;
  const groups = typingGroups();
  const updateHooks: ((view: EditorView) => void)[] = [];
  const replaceHooks: (() => void)[] = [];
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
    createTextDragPlugin(),
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
    createCodeSelectionPlugin(),
    createFindPlugin(),
    createSpellPlugin(hooks.spell),
    createSmartPlugin(() => options.smartPunctuation),
    createViewportPlugin(),
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

  tracePlugins(plugins);
  const makeState = (doc: Node) => EditorState.create({ doc, plugins });

  /**
   * Run a view update that replaces much of the document with the editor unfocused, then
   * focus it again. WebKitGTK makes setting the DOM selection in a focused editable,
   * right after a large DOM change, extremely slow (a 1 MB document: about 30 s in
   * `Selection.collapse`, against 1.6 s for the update plus 0.1 s to focus afterwards;
   * Q-026).
   */
  function withoutFocus(update: () => void) {
    const dom = view.dom as HTMLElement;
    const focused = view.hasFocus();
    if (focused) dom.blur();
    update();
    performance.mark("scrim-refocus");
    if (focused) view.focus();
    performance.measure("scrim-refocus", "scrim-refocus");
  }
  const initial = parseMarkdown("").doc;

  const codeHooks: CodeViewHooks = {
    renderMath: (tex, el, display) => hooks.renderMath(numbered(tex, el), el, display),
    renderHtml: (html, el) =>
      renderHtmlBlock(html, el, { setImageSource: hooks.setImageSource, embedUrl: hooks.embedUrl }),
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
      // Viewport-only rendering of large documents wraps every node view (Q-027).
      nodeViews: viewportNodeViews({ ...codeNodeViews(options, codeHooks), ...blockNodeViews }, schema),
      attributes: { spellcheck: "false", class: "scrim-doc" },
      dispatchTransaction(tr: Transaction) {
        groups.mark(tr);
        const state = timed("state apply", () => view.state.apply(tr));
        timed("view update", () => view.updateState(state));
        updateHooks.forEach((f) => timed(() => `hook ${String(f).slice(0, 60)}`, () => f(view)));
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
            if (dirty && savedText !== null && serialize(view.state.doc, { prettyTables: options.prettyTables }) === savedText) {
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
        const plain = plainPaste || options.pasteHtmlAsPlain;
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
        groups.input(v, text);
        if (cellTextInput(v.state, from, to, text, v.dispatch)) return true;
        if (spaceInputRule(() => v.state, from, to, text, v.dispatch)) return true;
        if (laxHeadingInputRule(() => v.state, from, to, text, v.dispatch)) return true;
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
    load(text: string, newFile: boolean, eol: string, blockTree?: Root) {
      // Timings for PF-1 (performance.getEntriesByType("measure")).
      performance.mark("scrim-load");
      let { doc } = parseMarkdown(text, { inlineMath: options.inlineMath, blockTree }, eol);
      // The tree is large (a 1 MB document: about 10 MB of objects): let it go before
      // the view is built.
      blockTree = undefined;
      performance.measure("scrim-parse", "scrim-load");
      if (newFile && !text) doc = schema.nodes.doc.create({ ...doc.attrs, finalNewline: true }, doc.content);
      performance.mark("scrim-state");
      const state = makeState(doc);
      performance.measure("scrim-make-state", "scrim-state");
      performance.mark("scrim-view");
      withoutFocus(() => view.updateState(state));
      performance.measure("scrim-update-view", "scrim-view");
      // Applies the first presentation marks (spec 10.3); not an edit.
      performance.mark("scrim-kick");
      view.dispatch(view.state.tr.setMeta("scrim-pres-kick", true));
      performance.measure("scrim-first-marks", "scrim-kick");
      performance.mark("scrim-saved");
      savedText = serialize(doc, { prettyTables: options.prettyTables });
      performance.measure("scrim-serialize", "scrim-saved");
      dirty = false;
      for (const h of replaceHooks) h();
    },
    isDirty: () => dirty,
    markSaved() {
      savedText = serialize(view.state.doc, { prettyTables: options.prettyTables });
      dirty = false;
    },
    run(cmd: Command) {
      return cmd(view.state, view.dispatch, view);
    },
    onUpdate: updateHooks,
    onReplace: replaceHooks,
    markdownLines() {
      return serialize(view.state.doc, { prettyTables: options.prettyTables }).split(/\r\n?|\n/).length;
    },
    applyText(text: string, addToHistory = true, blockTree?: Root) {
      const state = view.state;
      const { doc: next } = parseMarkdown(text, { inlineMath: options.inlineMath, blockTree }, state.doc.attrs.eol);
      const old = state.doc;
      let a = 0;
      while (a < old.childCount && a < next.childCount && sameBlock(old.child(a), next.child(a))) a++;
      let b = 0;
      while (b < old.childCount - a && b < next.childCount - a && sameBlock(old.child(old.childCount - 1 - b), next.child(next.childCount - 1 - b))) b++;
      const posOf = (d: Node, i: number) => {
        let p = 0;
        for (let k = 0; k < i; k++) p += d.child(k).nodeSize;
        return p;
      };
      let tr = state.tr;
      const from = posOf(old, a);
      const to = posOf(old, old.childCount - b);
      const nFrom = posOf(next, a);
      const nTo = posOf(next, next.childCount - b);
      tr.replaceWith(from, to, next.slice(nFrom, nTo).content);
      for (const k of Object.keys(next.attrs)) tr.setDocAttribute(k, next.attrs[k]);
      if (serialize(tr.doc, { prettyTables: options.prettyTables }) !== text) {
        // Kept blocks' separators no longer line up: replace everything (exact bytes win).
        tr = state.tr.replaceWith(0, old.content.size, next.content);
        for (const k of Object.keys(next.attrs)) tr.setDocAttribute(k, next.attrs[k]);
      }
      if (!addToHistory) tr.setMeta("addToHistory", false);
      // A replaced text is its own undo step: not merged with typing before or after it.
      else closeHistory(tr);
      // Large replacements: see `withoutFocus`.
      if (to - from > 50_000) withoutFocus(() => view.dispatch(tr));
      else view.dispatch(tr);
      if (addToHistory) view.dispatch(closeHistory(view.state.tr));
      for (const h of replaceHooks) h();
      return view.state.doc;
    },
    flavors(kind) {
      if (view.state.selection.empty) return null;
      flushEscapes(view, options);
      const prev = options.copyMarkdown;
      if (kind === "markdown") options.copyMarkdown = true;
      const f = copyFlavors(view.state, options, kind === "plain");
      options.copyMarkdown = prev;
      return f;
    },
    pasteFrom(text, html, plain) {
      const dt = new DataTransfer();
      if (text) dt.setData("text/plain", text);
      if (html && !plain) dt.setData("text/html", html);
      const event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      if (!handlePaste(view, event, options, plain, hooks.images) && text) view.dispatch(view.state.tr.insertText(text).scrollIntoView());
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
