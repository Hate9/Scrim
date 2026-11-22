// Frontend entry: one document per window.

import "./editor/cmlayer"; // first: CodeMirror styles in @layer scrim-cm (10.3)
import { setSmartPunctuation } from "./editor/smart";
import { setCodeIndent, setWritingStyle } from "./md/style";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { message, open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { insertFiles } from "./editor/images";
import * as mapModule from "./md/serialize";
import { hideDropLine, showDropLine, textPosAt } from "./editor/dnd";
import { emit, listen } from "@tauri-apps/api/event";
import { rerenderHtmlBlocks } from "./editor/codeview";
import { TextSelection } from "prosemirror-state";
import { FindBar } from "./app/findbar";
import { ThemeLoader } from "./app/themes";
import { QuickOpen } from "./app/quickopen";
import { Sidebar } from "./app/sidebar";
import { SourceMode } from "./app/sourcemode";
import { StatusBar } from "./app/statusbar";
import {
  fixImagesAfterSaveAs,
  offerRecovery,
  recoveryDialog,
  setupTypewriter,
  startAutosaveAndRecovery,
  toggleAlwaysOnTop,
  toggleFocusMode,
  toggleFullscreen,
  watchExternalChanges,
  zoom,
} from "./app/workspace";
import type { CommandDef } from "./editor/keys";
import { createCommands } from "./app/commands";
import { Exporter, PANDOC_FORMATS, customCommands } from "./export/exporter";
import { invoke } from "@tauri-apps/api/core";
import { suggestedFileName } from "./doc/naming";
import { inlineKey } from "./editor/decorations";
import { createEditor, recordUpdates } from "./editor/editor";
import { Dispatcher, normalizeAccelerator } from "./editor/keys";
import { AppMenu, shortcutOverrides } from "./app/menu";
import { menuTree } from "./app/menutree";
import { DocumentMenu } from "./app/contextmenu";
import { Spelling } from "./app/spelling";
import { LocalStore, snippetLabel } from "./app/local";
import { SnippetPicker } from "./app/snippetpicker";
import { CustomizePane } from "./app/customize";
import { EditorView as CMEditorView } from "@codemirror/view";
import type { MenuNode } from "./app/menu";
import { focusedCodeMirror, insertSnippet, type Snippet } from "./editor/snippets";
import { customTags as customTagsRef, setCustomTags } from "./md/customtags";
import { rebuildInline } from "./editor/decorations";
import { reloadKeepingCursor } from "./app/workspace";
import { Preferences } from "./app/preferences";
import { preferenceSections } from "./app/prefsections";
import { redo, undo } from "prosemirror-history";
import { Selection } from "prosemirror-state";
import {
  insertCodeFences,
  insertFrontMatter,
  insertHr,
  insertLinkReference,
  insertMathBlock,
  insertParagraph,
  insertToc,
  selectAll,
  toggleFormat,
  wrapWith,
} from "./editor/commands";
import { ipc, type LineEndingName, type SaveRequest } from "./ipc";

const EOLS: Record<LineEndingName, string> = { lf: "\n", crlf: "\r\n", cr: "\r" };

// Every CSP violation is logged (spec 19, "Enforcement" item 5); registered first, so
// violations during startup are caught too.
document.addEventListener("securitypolicyviolation", (e) => {
  void ipc.logCsp({ blockedUri: e.blockedURI, violatedDirective: e.violatedDirective, sourceFile: e.sourceFile || undefined });
});
const write = document.getElementById("write") as HTMLDivElement;
const notice = document.getElementById("notice") as HTMLDivElement;
const noticeText = document.getElementById("notice-text") as HTMLSpanElement;
const appWindow = getCurrentWebviewWindow();
const isWindows = navigator.userAgent.includes("Windows");
document.body.classList.add(isWindows ? "os-windows" : "os-linux");

const state = {
  fileName: null as string | null,
  path: null as string | null,
  saving: false,
  /** front matter `root-url` (4.8) and `image-folder` (6.4) */
  rootUrl: null as string | null,
  imageFolder: null as string | null,
};

/** The bar at the top of the editor area, optionally with buttons. */
function showNotice(text: string | null, buttons: [string, () => void][] = []) {
  notice.hidden = !text;
  noticeText.textContent = text ?? "";
  const box = document.getElementById("notice-buttons")!;
  box.textContent = "";
  for (const [label, run] of buttons) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "scrim-notice-button";
    b.textContent = label;
    b.addEventListener("click", run);
    box.appendChild(b);
  }
}

/** Preferences as last read; `setSetting` writes through to settings.json. */
let settings: Record<string, unknown> = {};
/** A preference: settings.json first, then config.jsonc (advanced options such as
 * `fileListLimit`), then the default. */
function setting<T>(key: string, fallback: T): T {
  if (key in settings) return (settings[key] as T) ?? fallback;
  const cfg = typeof config !== "undefined" ? config : {};
  return key in cfg ? ((cfg[key] as T) ?? fallback) : fallback;
}
function setSetting(key: string, value: unknown) {
  settings = { ...settings, [key]: value };
  void ipc.setSetting(key, value);
}
document.getElementById("notice-close")!.addEventListener("click", () => showNotice(null));

function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

function resolveLocal(src: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) {
    if (/^file:\/\//i.test(src)) return decodeURIComponent(src.replace(/^file:\/\/(localhost)?/i, ""));
    return null;
  }
  let path = src;
  try {
    path = decodeURIComponent(src);
  } catch {
    /* keep as is */
  }
  path = path.replace(/[?#].*$/, "");
  const absolute = path.startsWith("/") || /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
  if (absolute) return path;
  const dir = state.rootUrl && !/^[a-z][a-z0-9+.-]*:/i.test(state.rootUrl) ? state.rootUrl : editor.options.docDir;
  if (!dir) return null;
  const sep = isWindows ? "\\" : "/";
  return dir + sep + path.replace(/^\.\//, "").replace(/\//g, sep);
}

/** Local files already granted to the `scrim-file` protocol. */
const allowed = new Set<string>();

// Spell check (13); the editor reads its configuration when a document state is made.
const spelling = new Spelling(() => editor.view, setting);

const editorHooks: Parameters<typeof createEditor>[2] = {
    setImageSource(img, src) {
      if (/^(https?:|data:|blob:)/i.test(src)) {
        img.src = src;
        return;
      }
      const local = resolveLocal(src);
      if (!local) {
        img.src = src;
        return;
      }
      const url = convertFileSrc(local, "scrim-file");
      if (allowed.has(local)) {
        img.src = url;
        return;
      }
      // Grant the protocol scope before the webview requests the file (spec 01, scope a).
      void ipc.allowFiles([local]).then(() => {
        allowed.add(local);
        img.src = url;
      });
    },
    renderMath(tex, el, display = false) {
      if (!el.firstChild) el.textContent = tex;
      void import("./editor/math").then((m) => m.renderMath(tex, el, display));
    },
    copyText(text) {
      void ipc.clipboardWrite(text);
    },
    embedUrl(src) {
      // The scrim-embed URL form differs per platform (spec 19): one helper builds it.
      const base = isWindows ? "http://scrim-embed.localhost/" : "scrim-embed://localhost/";
      return `${base}?src=${encodeURIComponent(src)}`;
    },
    images: {
      async insertImage(source) {
        const r = await ipc.imageInsert(source, state.imageFolder);
        if (r.path) allowed.add(r.path);
        return r.src;
      },
      linkTarget: (path) => ipc.linkTarget(path),
      pathKind: (path) => ipc.pathKind(path),
      openMarkdown(path) {
        // Dropped .md files: a new window if this one has unsaved changes (6.3).
        void ipc.openPath(path, editor.isDirty() ? "new" : "current");
      },
      openFolder() {
        showNotice("Opening folders arrives with the sidebar.");
      },
      notify: (m) => showNotice(m),
      readClipboardMedia: () => ipc.clipboardMedia(),
    },
    spell: {
      check: (lang, words) => spelling.check(lang, words),
      config: () => spelling.config(),
    },
    onFrontMatter(fm) {
      // 13: front matter `lang` picks the spelling dictionary.
      spelling.setDocumentLanguage(fm.lang || null);
      // 4.11: title → window title (QA-LOG Q-013), root-url → image base.
      state.rootUrl = fm["root-url"] ?? null;
      state.imageFolder = fm["image-folder"] ?? null;
      void ipc.setTitleOverride(fm.title ?? null).then((t) => (document.title = t));
    },
    openLink(href, newWindow) {
      void openLink(href, newWindow);
    },
};
const imageHooks = editorHooks.images;

const editor = createEditor(write, { pathSep: isWindows ? "\\" : "/" }, editorHooks, (dirty) =>
  void ipc.setDirty(dirty).then((title) => (document.title = title)),
);

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext|text|txt|rmd)$/i;
/** Anchor to scroll to after the next document load (link to `file.md#heading`). */
let pendingAnchor: string | null = null;

/** Open a link from the document (spec 03, 3.9). */
async function openLink(href: string, newWindow: boolean) {
  const [target, hash] = href.split("#", 2) as [string, string | undefined];
  const local = resolveLocal(target);
  if (local === null) {
    await ipc.openExternal(href, false); // http(s), mailto, other schemes
    return;
  }
  if (!MARKDOWN_EXT.test(local)) {
    await ipc.openExternal(local, true); // other files: system default application
    return;
  }
  if (!newWindow && editor.isDirty()) {
    const choice = await message(`Do you want to save the changes you made to ${state.fileName ?? "Untitled"}?`, {
      title: "Scrim",
      kind: "warning",
      buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
    });
    if (choice === "Cancel") return;
    if ((choice === "Save" || choice === "Yes") && !(await save(false))) return;
  }
  if (!newWindow) pendingAnchor = hash ?? null;
  await ipc.openPath(local, newWindow ? "new" : "current");
}

/** Editor options from settings.json (spec 11; P4 adds the preferences window). */
function applySettings(next: Record<string, unknown>) {
  settings = next;
  const o = editor.options;
  const bool = (key: string, fallback: boolean) => (typeof settings[key] === "boolean" ? (settings[key] as boolean) : fallback);
  const inlineBefore = [o.inlineMath, o.subscript, o.superscript, o.highlight].join();
  o.inlineMath = bool("inlineMath", false);
  o.subscript = bool("subscript", false);
  o.superscript = bool("superscript", false);
  o.highlight = bool("highlight", false);
  o.preserveLineBreaks = bool("preserveLineBreaks", true);
  o.autoPairBrackets = bool("autoPairBrackets", true);
  o.autoPairMarkdown = bool("autoPairMarkdown", false);
  o.copyMarkdown = bool("copyAsMarkdown", true);
  o.emojiAutocomplete = bool("emojiAutocomplete", true);
  o.openLinksSingleClick = bool("openLinksSingleClick", false);
  o.codeWrap = bool("codeWrap", true);
  o.codeLineNumbers = bool("codeLineNumbers", false);
  o.codeCopyButton = bool("codeCopyButton", false);
  o.mathAutoNumber = bool("mathAutoNumber", false);
  o.allowIframes = bool("allowIframes", false);
  o.prettyTables = bool("prettyPrintTables", true);
  o.numberFootnotes = bool("numberFootnotes", true);
  document.body.classList.toggle("md-soft-breaks", !o.preserveLineBreaks);
  // Preferences that are view state (11): mirrored by the View menu toggles.
  const focusOn = bool("focusMode", false);
  if (document.body.classList.contains("on-focus-mode") !== focusOn) toggleFocusMode(editor);
  document.body.classList.toggle("scrim-typewriter-mode", bool("typewriterMode", false));
  document.body.classList.toggle("scrim-no-heading-hint", !bool("headingHint", true));
  document.body.classList.toggle("scrim-no-word-count", !bool("showWordCount", true));
  o.pasteHtmlAsPlain = bool("pasteHtmlAsPlain", false);
  o.smartPunctuation = bool("smartPunctuation", false);
  setWritingStyle(settings);
  setCodeIndent(settings.codeIndent);
  setSmartPunctuation(editor.view, o.smartPunctuation);
  // Inline math and the sub/superscript/highlight switches change what is an element:
  // analyze and render every block again (11).
  if ([o.inlineMath, o.subscript, o.superscript, o.highlight].join() !== inlineBefore && editor.view.state.doc.childCount) rebuildInline(editor.view);
  if (typeof statusBar !== "undefined") statusBar.syncButtons();
  sourceMode?.setLineNumbers(setting("sourceLineNumbers", false));
  // Font size: "auto" lets the theme decide (11, Appearance).
  const size = settings.fontSize;
  let fs = document.getElementById("scrim-font-size") as HTMLStyleElement | null;
  if (!fs) {
    fs = document.createElement("style");
    fs.id = "scrim-font-size";
    document.head.appendChild(fs);
  }
  fs.textContent = typeof size === "number" && size >= 12 && size <= 24 ? `#write, #scrim-source { font-size: ${size}px; }` : "";
  if (typeof themes !== "undefined") void themes.apply().then(() => document.head.appendChild(fs!));
}

/** Time from asking for the document to its first frame (PF-1), for tests. */
let openMs: number | null = null;

async function init() {
  const t0 = performance.now();
  const d = await ipc.docInit();
  if (d.testNoRemote && !document.getElementById("scrim-test-csp")) {
    // Debug test hook: a second, stricter policy for theme resources (T-1).
    const meta = document.createElement("meta");
    meta.id = "scrim-test-csp";
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = "style-src 'self' 'unsafe-inline' tauri: scrim-file:; font-src 'self' data: scrim-file:";
    document.head.prepend(meta);
  }
  applySettings((d.settings ?? {}) as Record<string, unknown>);
  state.fileName = d.fileName;
  state.path = d.path;
  editor.options.docDir = d.path ? dirname(d.path) : null;
  const eol = EOLS[d.lineEnding ?? d.defaultLineEnding];
  editor.load(d.text, !d.path || d.missing, eol);
  requestAnimationFrame(() => requestAnimationFrame(() => (openMs = performance.now() - t0)));
  document.title = d.title;
  editor.view.focus();
  if (pendingAnchor) {
    const { jumpToAnchor } = await import("./editor/links");
    jumpToAnchor(editor.view, pendingAnchor);
    pendingAnchor = null;
  }
  if (pendingSelect) {
    selectSourceRange(pendingSelect);
    pendingSelect = null;
  }
  if (d.folder) sidebar.setFolder(d.folder);
  else followDocumentFolder(d.path);
  if (d.recovered) document.title = await ipc.setDirty(true);
  // Zoom is remembered globally (15, T-8).
  const z = setting("zoom", 1);
  if (z !== zoomLevel) {
    zoomLevel = z;
    void getCurrentWebview().setZoom(z);
  }
  if (!launchApplied) {
    launchApplied = true;
    if (setting("showSidebarOnLaunch", false)) {
      if (setting<string>("sidebarView", "tree") === "list") sidebar.showFiles(true);
      else sidebar.toggle(true);
    }
  }
  if (appWindow.label === "doc-1" && !recoveryOffered) {
    recoveryOffered = true;
    void offerRecovery(wsHooks, (drafts) => recoveryDialog(drafts, (draft) => void ipc.recoveryOpen(draft.id)));
  }
  // Large files open in source mode (01, performance budgets).
  if (d.text.length > 5 * 1024 * 1024) {
    sourceMode.enter();
    showNotice("This file is large, so it opened in source code mode.", [["Switch to Live Preview", () => {
      showNotice(null);
      sourceMode.leave();
    }]]);
    return;
  }
  if (d.error) showNotice(d.error);
  else if (d.malformed) showNotice(`Some bytes in this file are not valid ${d.encoding.name} and are shown as �.`);
  else showNotice(null);
}

/** After an untitled document's first save, move its images out of the temporary
 * folder and rewrite their paths (6.4). True if the document changed. */
async function moveTempImages(): Promise<boolean> {
  const moved = await ipc.imageFinalize(state.imageFolder);
  if (!moved.length) return false;
  const view = editor.view;
  const tr = view.state.tr;
  view.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const m of moved) {
      let i = node.text!.indexOf(m.oldSrc);
      while (i >= 0) {
        const from = tr.mapping.map(pos + i);
        tr.insertText(m.newSrc, from, from + m.oldSrc.length);
        i = node.text!.indexOf(m.oldSrc, i + m.oldSrc.length);
      }
    }
    return false;
  });
  if (!tr.docChanged) return false;
  view.dispatch(tr);
  return true;
}

/** Insert Image (Mod+Shift+I, 4.8). */
async function insertImageDialog() {
  const picked = await openDialog({
    multiple: true,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"] }],
  });
  if (!picked) return;
  const paths = Array.isArray(picked) ? picked : [picked];
  await insertFiles(editor.view, paths, imageHooks, "paste");
  editor.view.focus();
}

/** Save; resolves to true when the document ended up saved. */
async function save(saveAs = false): Promise<boolean> {
  if (state.saving) return false;
  state.saving = true;
  sourceMode.sync();
  const oldDir = state.path ? dirname(state.path) : null;
  try {
    const text = editor.markdown();
    const request: SaveRequest = { text, saveAs, suggestedName: suggestedFileName(text) };
    for (;;) {
      const r = await ipc.save(request);
      switch (r.status) {
        case "saved": {
          const wasUntitled = state.path === null;
          state.fileName = r.fileName;
          state.path = r.path;
          editor.options.docDir = dirname(r.path);
          if (wasUntitled && (await moveTempImages())) {
            // Paths changed: write the file again with the final image paths (6.4).
            state.saving = false;
            return save(false);
          }
          if (saveAs && oldDir && oldDir !== dirname(r.path)) {
            const changed = await fixImagesAfterSaveAs(editor, oldDir, dirname(r.path), () => (testHooks.askImagePaths ?? askImagePaths)());
            if (changed) {
              state.saving = false;
              return save(false);
            }
          }
          // Clean if nothing was typed meanwhile (presentation marks are not edits).
          if (editor.markdown() === text) editor.markSaved();
          document.title = await ipc.setDirty(editor.isDirty());
          void ipc.recoveryRemove(false);
          followDocumentFolder(r.path);
          return true;
        }
        case "cancelled":
          return false;
        case "error":
          await message(r.message, { title: "Save failed", kind: "error" });
          return false;
        case "unrepresentable": {
          const choice = await message(
            `This document contains characters that cannot be saved in ${r.encoding} (for example “${r.first}”).`,
            { title: "Save", kind: "warning", buttons: { ok: "Save as UTF-8", cancel: "Cancel" } },
          );
          if (choice !== "Save as UTF-8" && choice !== "Ok") return false;
          request.convertToUtf8 = true;
          break;
        }
        case "lossy": {
          // Wording from QA-LOG Q-005.
          const choice = await message("Some bytes in this file could not be read and will be saved as �.", {
            title: "Save",
            kind: "warning",
            buttons: { ok: "Save Anyway", cancel: "Cancel" },
          });
          if (choice !== "Save Anyway" && choice !== "Ok") return false;
          request.acceptLossy = true;
          break;
        }
        case "needsFolder": {
          // QA-LOG Q-003.
          const choice = await message(`Create folder ${r.folder}?`, {
            title: "Save",
            kind: "info",
            buttons: { ok: "Create", cancel: "Cancel" },
          });
          if (choice !== "Create" && choice !== "Ok") return false;
          request.createFolder = true;
          break;
        }
      }
    }
  } finally {
    state.saving = false;
  }
}

/** Small in-page dialog for Mod+T (4.7): rows and columns, default 3 × 3. */
function askTableSize(): Promise<{ rows: number; cols: number } | null> {
  return new Promise((resolve) => {
    const box = document.createElement("form");
    box.className = "scrim-dialog";
    box.innerHTML =
      '<div class="scrim-dialog-title">Insert Table</div>' +
      '<label>Rows <input name="rows" type="number" min="1" max="100" value="3"></label>' +
      '<label>Columns <input name="cols" type="number" min="1" max="30" value="3"></label>' +
      '<div class="scrim-dialog-buttons"><button type="button" value="cancel">Cancel</button><button type="submit">Insert</button></div>';
    const done = (v: { rows: number; cols: number } | null) => {
      box.remove();
      resolve(v);
    };
    box.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(box);
      done({ rows: Math.max(1, Number(f.get("rows")) || 3), cols: Math.max(1, Number(f.get("cols")) || 3) });
    });
    box.querySelector('button[value="cancel"]')!.addEventListener("click", () => done(null));
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") done(null);
    });
    document.body.appendChild(box);
    (box.querySelector('input[name="rows"]') as HTMLInputElement).select();
  });
}

// Files dropped from the file manager (6.3). Tauri delivers native drops with paths.
void getCurrentWebview().onDragDropEvent((event) => {
  const scale = window.devicePixelRatio || 1;
  const p = event.payload;
  if (p.type === "over" || p.type === "enter") {
    const at = textPosAt(editor.view, p.position.x / scale, p.position.y / scale);
    if (at === null) hideDropLine();
    else showDropLine(editor.view, at); // drop indicator line (6.3)
    return;
  }
  hideDropLine();
  if (p.type !== "drop") return;
  const at = textPosAt(editor.view, p.position.x / scale, p.position.y / scale);
  void insertFiles(editor.view, p.paths, imageHooks, "drop", at ?? undefined);
});

const themes = new ThemeLoader(setting);
/** Show the window's content once the theme is in. Hidden elements cannot take focus, so
 * the editor gets it now if nothing else has. */
function revealPage() {
  if (!document.body.classList.contains("scrim-loading")) return;
  document.body.classList.remove("scrim-loading");
  const a = document.activeElement;
  if (!a || a === document.body) editor.view.focus();
}
themes.onApplied.push(revealPage);
window.setTimeout(revealPage, 1500);

/** E2E stand-ins for native dialogs (set through `window.__scrim.testHooks`). */
const testHooks: { askImagePaths?: () => Promise<"update" | "copy" | "leave"> } = {};

// ---- workspace (P3) ---------------------------------------------------------------------

let pendingSelect: { line: number; start: number; length: number } | null = null;
let recoveryOffered = false;
let launchApplied = false;

/** Select a source range given as line (1-based), column and length (search results). */
function selectSourceRange(sel: { line: number; start: number; length: number }) {
  const view = editor.view;
  const { serializeWithMap, sourceToPos } = mapModule;
  const { text, map } = serializeWithMap(view.state.doc, { prettyTables: editor.options.prettyTables });
  let offset = 0;
  for (let l = 1; l < sel.line; l++) {
    const nl = text.slice(offset).search(/\r\n?|\n/);
    if (nl < 0) break;
    offset += nl + (text.slice(offset + nl, offset + nl + 2) === "\r\n" ? 2 : 1);
  }
  const a = sourceToPos(map, offset + sel.start);
  const b = sourceToPos(map, offset + sel.start + sel.length);
  if (a === null || b === null) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a, b)).scrollIntoView());
  view.focus();
}

/** Without an opened folder, the document's parent folder is the window's implicit
 * folder (QA-LOG Q-016): it scopes the Files tab, quick open, and search in files, and
 * follows the document when it is opened, saved, or moved elsewhere. Untitled documents
 * have none. */
function followDocumentFolder(path: string | null) {
  if (sidebar.folder && !sidebar.implicitFolder) return;
  const dir = path ? dirname(path) : null;
  if (dir === sidebar.folder && sidebar.implicitFolder) return;
  sidebar.setFolder(dir, true);
  if (dir) void ipc.folderWatchImplicit(dir).catch(() => {});
}

/** Open a file from the sidebar, quick open, or search results (7.4, 7.5, 7.7). */
async function openFile(path: string, newWindow: boolean, select?: { line: number; start: number; length: number }) {
  if (!newWindow && path === state.path) {
    if (select) selectSourceRange(select);
    return;
  }
  if (!newWindow && editor.isDirty()) {
    if (setting("autoSave", false) && state.path) {
      if (!(await save(false))) return;
    } else {
      const choice = await message(`Do you want to save the changes you made to ${state.fileName ?? "Untitled"}?`, {
        title: "Scrim",
        kind: "warning",
        buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
      });
      if (choice === "Cancel") return;
      if ((choice === "Save" || choice === "Yes") && !(await save(false))) return;
    }
  }
  if (!newWindow) pendingSelect = select ?? null;
  await ipc.openPath(path, newWindow ? "new" : "current");
}

function askImagePaths(): Promise<"update" | "copy" | "leave"> {
  return message("This document refers to images by relative paths, and it was saved to another folder.", {
    title: "Save As",
    kind: "info",
    buttons: { yes: "Update image paths", no: "Copy images", cancel: "Leave as is" },
  }).then((c) => (c === "Update image paths" || c === "Yes" ? "update" : c === "Copy images" || c === "No" ? "copy" : "leave"));
}

const sourceMode = new SourceMode(
  editor,
  () => {
    if (!editor.isDirty()) void ipc.setDirty(true).then((t) => (document.title = t));
  },
  () => setting("sourceLineNumbers", false),
);
const findBar = new FindBar(editor, sourceMode, (m) => showNotice(m));
const sidebar = new Sidebar(editor, {
  openFile: (p, nw, sel) => void openFile(p, nw, sel),
  confirm: (m) => message(m, { title: "Scrim", kind: "warning", buttons: "OkCancel" }).then((c) => c === "Ok"),
  notify: (m) => showNotice(m),
  currentPath: () => state.path,
  setSetting,
  setting,
});
const quickOpen = new QuickOpen(
  () => sidebar.folder,
  (p, nw, folder) => (folder ? void ipc.folderOpen(p) : void openFile(p, nw)),
);
const statusBar = new StatusBar(editor, {
  toggleSidebar: () => {
    sidebar.toggle();
    statusBar.syncButtons();
  },
  toggleSource: () => sourceMode.toggle(),
  sidebarOpen: () => sidebar.visible,
  setting,
  setSetting,
  sourceText: () => (sourceMode.active() ? editor.markdown() : null),
  spell: {
    enabled: () => spelling.enabled(),
    available: () => spelling.info.available,
    hint: () => spelling.info.hint ?? "",
    language: () => spelling.config().lang,
    languages: () => spelling.info.languages,
    choice: () => setting("spellLanguage", "auto"),
    choose: (l) => setSetting("spellLanguage", l),
  },
});
spelling.onChange.push(() => statusBar.syncSpell());
let lastFindDoc: unknown = null;
editor.onUpdate.push((view) => {
  sidebar.updateOutline();
  // Only document edits re-run the search (its own highlight transactions must not).
  if (findBar.isOpen && view.state.doc !== lastFindDoc) {
    lastFindDoc = view.state.doc;
    findBar.update();
  }
});
const wsHooks = {
  isDirty: () => editor.isDirty(),
  path: () => state.path,
  save: () => save(false),
  notice: showNotice,
  setting,
  title: () => state.fileName ?? "Untitled",
  markSaved: () => editor.markSaved(),
  draftText: () => {
    sourceMode.sync();
    return editor.markdown();
  },
  close: () => void appWindow.destroy(),
};
watchExternalChanges(editor, wsHooks);
const drafts = startAutosaveAndRecovery(editor, wsHooks);
setupTypewriter(editor);
void listen<string>("scrim://folder-opened", (e) => sidebar.setFolder(e.payload));
void appWindow.listen<string>("scrim://doc-moved", async (e) => {
  state.path = e.payload;
  state.fileName = e.payload.split(/[\\/]/).pop() ?? null;
  editor.options.docDir = dirname(e.payload);
  followDocumentFolder(e.payload);
  document.title = await ipc.setDirty(editor.isDirty());
  void sidebar.refreshFiles();
});
let zoomLevel = 1;

const global = (id: string, key: string, run: () => unknown): CommandDef => ({ id, key, scope: "global", run: () => void run() });
const workspaceCommands: CommandDef[] = [
  global("view.sidebar", "Ctrl+Shift+L", () => {
    sidebar.toggle();
    statusBar.syncButtons();
  }),
  global("view.outline", "Ctrl+Shift+1", () => {
    sidebar.toggle(true);
    sidebar.show("outline");
    statusBar.syncButtons();
  }),
  global("view.fileList", "Ctrl+Shift+2", () => sidebar.showFiles(true)),
  global("view.fileTree", "Ctrl+Shift+3", () => sidebar.showFiles(false)),
  global("file.quickOpen", "Ctrl+P", () => quickOpen.show()),
  global("file.openFolder", "", () => sidebar.openFolderDialog()),
  global("edit.searchInFolder", "Ctrl+Shift+F", () => sidebar.startSearch()),
  global("edit.find", "Ctrl+F", () => findBar.open(false)),
  global("edit.replace", "Ctrl+H", () => findBar.open(true)),
  global("edit.findNext", "F3", () => (findBar.isOpen ? findBar.step(1) : findBar.again(1))),
  global("edit.findPrevious", "Shift+F3", () => (findBar.isOpen ? findBar.step(-1) : findBar.again(-1))),
  global("edit.findNextClosed", "Ctrl+G", () => findBar.again(1)),
  global("edit.findPreviousClosed", "Ctrl+Shift+G", () => findBar.again(-1)),
  global("view.sourceMode", "Ctrl+/", () => sourceMode.toggle()),
  global("view.focusMode", "F8", () => setSetting("focusMode", !setting("focusMode", false))),
  global("view.typewriterMode", "F9", () => setSetting("typewriterMode", !setting("typewriterMode", false))),
  global("view.zoomIn", "Ctrl+Shift+=", async () => (zoomLevel = await zoom(0.1, setSetting, zoomLevel))),
  global("view.zoomOut", "Ctrl+Shift+-", async () => (zoomLevel = await zoom(-0.1, setSetting, zoomLevel))),
  global("view.actualSize", "Ctrl+Shift+0", async () => (zoomLevel = await zoom(null, setSetting, zoomLevel))),
  global("view.fullScreen", "F11", toggleFullscreen),
  global("view.alwaysOnTop", "", () => {
    const on = !document.body.classList.contains("scrim-always-on-top");
    document.body.classList.toggle("scrim-always-on-top", on);
    return toggleAlwaysOnTop(on);
  }),
  global("view.statusBar", "", () => {
    setSetting("showStatusBar", !setting("showStatusBar", true));
    statusBar.syncButtons();
  }),
  global("file.rename", "F2", () => sidebar.renameCurrent()),
  global("file.revealInFolder", "", () => state.path && ipc.fsReveal(state.path)),
  global("file.moveTo", "", async () => {
    const dir = await ipc.folderDialog();
    if (dir && state.path) await ipc.fsMove(state.path, dir).catch((e) => showNotice(String(e)));
  }),
  global("file.delete", "", async () => {
    if (!state.path) return;
    const ok = await message(`Move "${state.fileName}" to the trash?`, { title: "Scrim", kind: "warning", buttons: "OkCancel" });
    if (ok === "Ok") await ipc.fsTrash(state.path).catch((e) => showNotice(String(e)));
  }),
  global("file.recoverDrafts", "", async () => {
    const list = await ipc.recoveryList();
    if (!list.length) showNotice("There are no unsaved drafts to recover.");
    else recoveryDialog(list, (d) => void ipc.recoveryOpen(d.id));
  }),
  global("file.clearRecent", "", () => ipc.recentClear()),
];

// ---- menus, config.jsonc, Edit/Help/Themes commands (P4, spec 11, 12) --------------------

/** The element that owns editing keys right now: the document, source mode, or a field. */
function focusOwner(): "doc" | "source" | "field" | "none" {
  if (editor.view.hasFocus()) return "doc";
  if (sourceMode.hasFocus()) return "source";
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement ? "field" : "none";
}
/** Menu-driven Copy/Cut (01 rule 2: no DOM clipboard event; written through Rust). */
async function menuCopy(cut: boolean, kind?: "markdown" | "plain" | "html") {
  const owner = focusOwner();
  if (owner === "doc") {
    const f = editor.flavors(kind === "html" ? undefined : kind);
    if (!f) return;
    if (kind === "html") await ipc.clipboardFlavors(f.html, null);
    else await ipc.clipboardFlavors(f.text, kind === "plain" ? null : f.html);
    if (cut) editor.view.dispatch(editor.view.state.tr.deleteSelection().scrollIntoView());
    return;
  }
  const text = owner === "source" ? sourceMode.selectedText() : (window.getSelection()?.toString() ?? "");
  if (text) await ipc.clipboardFlavors(text, null);
  if (cut && text) document.execCommand("delete");
}
async function menuPaste(plain: boolean) {
  const text = (await ipc.clipboardText().catch(() => null)) ?? null;
  const owner = focusOwner();
  if (owner === "doc") {
    const html = plain ? null : await ipc.clipboardHtml().catch(() => null);
    editor.pasteFrom(text, html, plain);
  } else if (text) document.execCommand("insertText", false, text);
}
function menuHistory(redoIt: boolean) {
  const owner = focusOwner();
  if (owner === "doc") editor.run(redoIt ? redo : undo);
  else if (owner === "source") sourceMode.history(redoIt);
  else document.execCommand(redoIt ? "redo" : "undo");
}
/** Quit (Mod+Q): each dirty window asks in turn (7.1). */
async function quitAll() {
  const { getAllWebviewWindows } = await import("@tauri-apps/api/webviewWindow");
  for (const w of await getAllWebviewWindows()) {
    if (w.label === appWindow.label) continue;
    await w.setFocus().catch(() => {});
    await w.close().catch(() => {});
    // Wait until it is gone or its user pressed Cancel.
    const gone = await new Promise<boolean>((resolve) => {
      const t = window.setInterval(async () => {
        const all = await getAllWebviewWindows();
        if (!all.some((x) => x.label === w.label)) {
          clearInterval(t);
          resolve(true);
        }
      }, 200);
      void listen("scrim://close-cancelled", (e) => {
        if (e.payload === w.label) {
          clearInterval(t);
          resolve(false);
        }
      });
    });
    if (!gone) return;
  }
  await appWindow.close();
}
async function about() {
  const { getVersion } = await import("@tauri-apps/api/app");
  await message(`Scrim ${await getVersion()}\n\nA live-preview Markdown editor for Linux and Windows.\nThird-party licenses: Help → Credits.`, { title: "About Scrim", kind: "info" });
}

const doc = (id: string, key: string, fn: Parameters<typeof editor.run>[0]): CommandDef => ({ id, key, scope: "document", run: () => editor.run(fn) });
const opt = editor.options;
const p4Commands: CommandDef[] = [
  global("file.preferences", "Ctrl+,", () => preferences.open()),
  global("file.close", "Ctrl+W", () => appWindow.close()),
  global("file.quit", "Ctrl+Q", quitAll),
  global("edit.undo", "", () => menuHistory(false)),
  global("edit.redo", "", () => menuHistory(true)),
  global("edit.cut", "", () => menuCopy(true)),
  global("edit.copy", "", () => menuCopy(false)),
  global("edit.paste", "", () => menuPaste(false)),
  global("edit.pastePlain", "", () => menuPaste(true)),
  { id: "edit.copyHtml", key: "", scope: "document", run: () => menuCopy(false, "html") },
  global("edit.selectAll", "", () => (focusOwner() === "doc" ? editor.run(selectAll) : document.execCommand("selectAll"))),
  doc("edit.jumpToTop", "Ctrl+Home", (st, d) => (d?.(st.tr.setSelection(Selection.atStart(st.doc)).scrollIntoView()), true)),
  doc("edit.jumpToBottom", "Ctrl+End", (st, d) => (d?.(st.tr.setSelection(Selection.atEnd(st.doc)).scrollIntoView()), true)),
  global("edit.emojiPanel", "", () => ipc.emojiPanel()),
  doc("para.codeFences", "Ctrl+Shift+K", insertCodeFences),
  doc("para.mathBlock", "Ctrl+Shift+M", insertMathBlock),
  doc("para.insertBefore", "", insertParagraph(-1)),
  doc("para.insertAfter", "", insertParagraph(1)),
  doc("para.linkReference", "", insertLinkReference),
  doc("para.hr", "", insertHr),
  doc("para.toc", "", insertToc),
  doc("para.frontMatter", "", insertFrontMatter),
  doc("format.inlineMath", "", toggleFormat("math", opt)),
  doc("format.highlight", "", toggleFormat("highlight", opt)),
  doc("format.superscript", "", wrapWith("^", "^")),
  doc("format.subscript", "", wrapWith("~", "~")),
  doc("format.comment", "", wrapWith("<!-- ", " -->")),
  global("view.devtools", "Shift+F12", () => setting("debugTools", false) && ipc.devtools()),
  global("themes.openFolder", "", () => ipc.themesOpenFolder(themes.current || null)),
  global("themes.reload", "", async () => {
    await themes.refreshList();
    await themes.apply(true);
    void appMenu.rebuild();
  }),
  global("help.quickStart", "", () => ipc.helpOpen("quick-start")),
  global("help.markdownReference", "", () => ipc.helpOpen("markdown-reference")),
  global("help.shortcuts", "", () => ipc.helpOpen("shortcuts")),
  global("help.customThemes", "", () => ipc.helpOpen("custom-themes")),
  global("help.snippets", "", () => ipc.helpOpen("snippets-and-custom-tags")),
  global("help.credits", "", () => ipc.helpOpen("credits")),
  global("help.logFolder", "", () => ipc.logFolder()),
  global("help.about", "", about),
];

const preferences = new Preferences({
  setting,
  setSetting,
  closed: () => editor.view.focus(),
  sections: () =>
    preferenceSections({
      isWindows,
      themes: () => themes.themes,
      zoom: () => zoomLevel,
      resetZoom: () => void zoom(null, setSetting, zoomLevel).then((z) => ((zoomLevel = z), preferences.refresh())),
      openThemeFolder: () => void ipc.themesOpenFolder(themes.current || null),
      recoverDrafts: () => dispatcher.runId("file.recoverDrafts"),
      resetAdvanced: async () => {
        const ok = await message("Restore the default config.jsonc? Your advanced settings and shortcuts are replaced.", { title: "Reset Advanced Settings", kind: "warning", buttons: "OkCancel" });
        if (ok === "Ok") await ipc.configReset();
      },
      openAdvanced: () => openCustomize("config"),
      customizeAvailable: () => true,
      customizePane: () => {
        void customize().show();
        return customize().root;
      },
      pickFolder: () => {},
      testUpload: () => showNotice("The upload command runs when an image is inserted with the Upload policy."),
      pandocVersion: () => pandocVersion,
      spellLanguages: () => spelling.info.languages,
    }),
});

/** Replace every occurrence of an image source in the document (one undo step). */
function replaceImageSource(oldSrc: string, newSrc: string) {
  const view = editor.view;
  const tr = view.state.tr;
  view.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    let i = node.text.indexOf(oldSrc);
    while (i >= 0) {
      tr.insertText(newSrc, tr.mapping.map(pos + i), tr.mapping.map(pos + i + oldSrc.length));
      i = node.text.indexOf(oldSrc, i + oldSrc.length);
    }
    return false;
  });
  if (tr.docChanged) view.dispatch(tr);
}
new DocumentMenu(editor, {
  command: (id) => void dispatcher.runId(id, "native"),
  copy: (kind) => void menuCopy(false, kind),
  paste: (plain) => void menuPaste(plain),
  contextSearch: () => (Array.isArray(config.contextSearch) ? (config.contextSearch as { label: string; url: string }[]) : []),
  openUrl: (url) => void ipc.openExternal(url, false),
  copyText: (t) => void ipc.clipboardFlavors(t, null),
  openLink: (href) => void openLink(href, false),
  spell: {
    at: (pos) => spelling.wordAt(pos),
    suggestions: (word) => spelling.suggestions(word),
    replace: (w, text) => spelling.replace(w, text),
    add: (word) => void spelling.addToDictionary(word),
    ignore: (word) => spelling.ignore(word),
  },
  image: {
    open: (src) => {
      const p = resolveLocal(src);
      void (p ? ipc.openExternal(p, true) : ipc.openExternal(src, false));
    },
    reveal: (src) => {
      const p = resolveLocal(src);
      if (p) void ipc.fsReveal(p);
    },
    copyToAssets: async (src) => {
      const p = resolveLocal(src);
      if (!p) return showNotice("Only local images can be copied.");
      const r = await ipc.imageInsert({ path: p }, state.imageFolder).catch((e) => (showNotice(String(e)), null));
      if (r && r.src !== src) replaceImageSource(src, r.src);
    },
    deleteFile: async (src) => {
      const p = resolveLocal(src);
      if (!p) return;
      const ok = await message(`Move "${p.split(/[\\/]/).pop()}" to the trash?`, { title: "Delete Image File", kind: "warning", buttons: "OkCancel" });
      if (ok === "Ok") await ipc.fsTrash(p).catch((e) => showNotice(String(e)));
    },
  },
});

// ---- export, print, import (spec 09) ----
const exporter = new Exporter({
  view: editor.view,
  markdown: () => (sourceMode.sync(), editor.markdown()),
  setting,
  currentTheme: () => themes.current,
  path: () => state.path,
  fileName: () => state.fileName ?? suggestedFileName(editor.markdown()) ?? "Untitled",
  save: () => save(false),
  notice: (t, b) => showNotice(t, b),
  error: async (title, text) => void (await message(text, { title, kind: "error" })),
});
let pandocAvailable = false;
let pandocVersion = "";
let pandocPathChecked: string | null = null;
/** Pandoc on PATH or at the set path (9.4); the menu lists its formats either way. */
async function detectPandoc() {
  pandocPathChecked = setting("pandocPath", "");
  const info = await invoke<{ available: boolean; version: string | null }>("pandoc_info", { pandocPath: pandocPathChecked || null }).catch(() => ({ available: false, version: null }));
  pandocVersion = info.version ?? "";
  if (preferences.isOpen) preferences.refresh();
  if (info.available !== pandocAvailable) {
    pandocAvailable = info.available;
    void appMenu.rebuild();
  }
}
async function importDocument() {
  try {
    const r = await invoke<{ kind: "markdown" | "html"; text: string } | null>("import_file", { pandocPath: setting("pandocPath", "") || null });
    if (!r) return;
    const text = r.kind === "html" ? (await import("./editor/clipboard")).htmlToMarkdown(r.text) : r.text;
    await invoke("open_untitled_text", { text });
  } catch (e) {
    await message(String(e), { title: "Import failed", kind: "error" });
  }
}
const exportCommands: CommandDef[] = [
  global("file.import", "", () => void importDocument()),
  global("file.exportPdf", "", () => void exporter.run({ kind: "pdf" })),
  global("file.exportHtml", "", () => void exporter.run({ kind: "html", styled: true })),
  global("file.exportHtmlPlain", "", () => void exporter.run({ kind: "html", styled: false })),
  ...PANDOC_FORMATS.map((f) => global(`file.export.${f.id}`, "", () => void exporter.run({ kind: "pandoc", format: f.id }))),
  global("file.exportPrevious", "Ctrl+Shift+E", () => void (exporter.hasPrevious() ? exporter.previous() : showNotice("Nothing exported yet in this window."))),
  global("file.exportSettings", "", () => preferences.open("export")),
  global("file.print", "", () => void exporter.print()),
  global("edit.spellCheck", "", () => setSetting("spellCheck", !setting("spellCheck", true))),
  global("edit.openPersonalDictionary", "", () => {
    spelling.openPersonalDictionary();
    // Edited outside Scrim: read it again when the window is next focused.
    window.addEventListener("focus", () => void spelling.reloadPersonal(), { once: true });
  }),
];

const commandList = [
  ...createCommands(editor, { save, isWindows, askTableSize, insertImage: insertImageDialog }),
  ...workspaceCommands,
  ...p4Commands,
  ...exportCommands,
];
// Document commands run only with focus in the live document; in source mode the
// CodeMirror keymap owns editing keys.
// Snippets act with focus in the document, live or source mode, code blocks included (16).
const editingFocused = () => editor.view.hasFocus() || !!document.activeElement?.closest?.("#write .cm-editor, #scrim-source");
const dispatcher = new Dispatcher(commandList, () => editor.view.hasFocus(), editingFocused);
dispatcher.attach(window);

/** config.jsonc (11): advanced options, re-read whenever the file is saved. */
let config: Record<string, unknown> = {};
let recentCache: { files: string[]; folders: string[] } = { files: [], folders: [] };
const sourceToggles: Record<string, () => boolean> = {
  "view.sourceMode": () => sourceMode.active(),
  "view.focusMode": () => document.body.classList.contains("on-focus-mode"),
  "view.typewriterMode": () => document.body.classList.contains("scrim-typewriter-mode"),
  "view.statusBar": () => setting("showStatusBar", true),
  "view.sidebar": () => sidebar.visible,
  "view.fullScreen": () => document.body.classList.contains("scrim-full-screen"),
  "view.alwaysOnTop": () => document.body.classList.contains("scrim-always-on-top"),
  "edit.spellCheck": () => setting("spellCheck", true),
};
function blockChecked(id: string): boolean {
  const $h = editor.view.state.selection.$head;
  const parent = $h.parent;
  const inside = (name: string) => {
    for (let d = $h.depth; d > 0; d--) if ($h.node(d).type.name === name) return true;
    return false;
  };
  if (id === "para.paragraph") return parent.type.name === "paragraph";
  const h = /^para\.h(\d)$/.exec(id);
  if (h) return parent.type.name === "heading" && parent.attrs.level === Number(h[1]);
  if (id === "para.quote") return inside("blockquote");
  if (id === "para.orderedList") return inside("ordered_list");
  if (id === "para.bulletList") return inside("bullet_list");
  if (id === "para.taskList") return inside("list_item") && $h.node($h.depth - 1)?.attrs.task != null;
  return false;
}
const appMenu = new AppMenu(
  () =>
    menuTree({
      isWindows,
      recent: () => recentCache,
      openRecent: (p, folder) => void (folder ? ipc.folderOpen(p) : openFile(p, false)),
      clearRecent: () => void ipc.recentClear().then(refreshRecent),
      themes: () => themes.themes,
      currentTheme: () => themes.current,
      setTheme: (id) => setSetting("theme", id),
      checked: (id) => (sourceToggles[id] ? sourceToggles[id]() : blockChecked(id)),
      debugging: () => setting("debugTools", false),
      hasPath: () => state.path !== null,
      pandoc: () => pandocAvailable,
      customExports: () => customCommands(setting).map((c) => c.name),
      runCustomExport: (name) => void exporter.run({ kind: "custom", name }),
      pandocHelp: () => void ipc.helpOpen("pandoc"),
      spellLanguages: () => spelling.info.languages,
      spellLanguage: () => setting("spellLanguage", "auto"),
      setSpellLanguage: (lang) => setSetting("spellLanguage", lang),
      snippets: () => local.data.snippets.map((sn, i) => ({ label: snippetLabel(sn), id: `snippet.${i}` })),
    }),
  dispatcher,
);
async function refreshRecent() {
  recentCache = await ipc.recent().catch(() => recentCache);
  void appMenu.rebuild();
}
async function loadConfig() {
  const info = await ipc.config();
  config = info.config as Record<string, unknown>;
  const tree = menuTree({ isWindows, recent: () => recentCache, openRecent: () => {}, clearRecent: () => {}, themes: () => [], currentTheme: () => "", setTheme: () => {}, checked: () => false, debugging: () => true, hasPath: () => true, pandoc: () => true, customExports: () => [], runCustomExport: () => {}, pandocHelp: () => {}, spellLanguages: () => [], spellLanguage: () => "auto", setSpellLanguage: () => {}, snippets: () => [] });
  const { overrides, global: globals, problems } = shortcutOverrides(tree, (config.shortcuts ?? {}) as Record<string, unknown>);
  dispatcher.rebind(overrides);
  if (globals.size) void ipc.log("info", `global shortcuts are not supported on this platform yet: ${[...globals.keys()].join(", ")}`);
  const errors = [info.error, ...problems.map((p) => `config.jsonc shortcuts: ${p}`)].filter(Boolean);
  if (errors.length) showNotice(errors.join(" · "));
  await appMenu.rebuild();
}
void listen("scrim://config-changed", () => void loadConfig());
themes.onApplied.push(() => void appMenu.rebuild());
void refreshRecent().then(loadConfig).then(detectPandoc);
spelling.onChange.push(() => void appMenu.rebuild());
void spelling.init();

// ---- snippets and custom tags (16, 17) ----
const local = new LocalStore();
function runSnippet(sn: Snippet) {
  if (sourceMode.active() || editingFocused() || focusedCodeMirror()) {
    insertSnippet({ view: editor.view, applyText: (t) => editor.applyText(t), prettyTables: editor.options.prettyTables }, sn.body);
  }
}
const picker = new SnippetPicker({
  snippets: () => local.data.snippets,
  saveSelection: () => {
    const cm = focusedCodeMirror();
    if (cm) {
      const sel = cm.state.selection;
      return () => {
        cm.focus();
        cm.dispatch({ selection: sel });
      };
    }
    const sel = editor.view.state.selection;
    return () => {
      editor.view.focus();
      try {
        editor.view.dispatch(editor.view.state.tr.setSelection(sel.map(editor.view.state.doc, editor.view.state.tr.mapping)));
      } catch {
        /* the document changed meanwhile */
      }
    };
  },
  insert: (sn) => runSnippet(sn),
});
local.onChange.push((d) => {
  const blocksBefore = [...customTagsBlockSnapshot()];
  if (setCustomTags(d.customHTMLTags.inline, d.customHTMLTags.block)) {
    // Re-render every open document; the source does not change, nothing is undoable (17).
    const blockChanged = JSON.stringify(blocksBefore) !== JSON.stringify([...customTagsBlockSnapshot()]);
    if (blockChanged && !sourceMode.active()) {
      reloadKeepingCursor(editor, editor.markdown(), { history: false, markSaved: false });
      void ipc.setDirty(editor.isDirty()).then((t) => (document.title = t));
    } else rebuildInline(editor.view);
    rerenderHtmlBlocks();
  }
  const keyOf = (k: string) => normalizeAccelerator(k) ?? "";
  dispatcher.setExtras([
    { id: "snippets.picker", key: keyOf(d.pickerKey), scope: "editing", run: () => picker.open() },
    ...d.snippets.map((sn, i) => ({ id: `snippet.${i}`, key: keyOf(sn.key), scope: "editing" as const, run: () => runSnippet(sn) })),
  ]);
  void appMenu.rebuild();
});
// Preferences → Customize (18).
let customizePane: CustomizePane | null = null;
function customize(): CustomizePane {
  customizePane ??= new CustomizePane({
    local,
    menuShortcuts: () => {
      const out: { path: string; key: string }[] = [];
      const walk = (nodes: MenuNode[], path: string[]) => {
        for (const n of nodes) {
          const label = n.label.replace(/&/g, "").replace(/…$/, "");
          if (n.id && !n.id.startsWith("snippet")) {
            const key = dispatcher.keyOf(n.id);
            if (key) out.push({ path: [...path, label].join(" → "), key });
          }
          if (n.children) walk(typeof n.children === "function" ? n.children() : n.children, [...path, label]);
        }
      };
      walk(appMenu.nodes(), []);
      return out;
    },
    capturing: (on) => {
      dispatcher.suspended = on;
      void appMenu.suspendAccelerators(on);
    },
  });
  return customizePane;
}
function openCustomize(tab?: "snippets" | "css" | "config") {
  preferences.open("customize");
  void customize().show(tab);
}
function customTagsBlockSnapshot(): Set<string> {
  return new Set(customTagsRef.block);
}
void local.load();
let checksTimer = 0;
editor.onUpdate.push(() => {
  clearTimeout(checksTimer);
  checksTimer = window.setTimeout(() => void appMenu.refreshChecks(), 300);
});
window.addEventListener("focus", () => void refreshRecent());
window.addEventListener("keydown", (e) => {
  if (sidebar.outlineKey(e)) e.preventDefault();
  // Text fields of the chrome (find bar, quick open, sidebar) own Mod+Z / Mod+Shift+Z
  // (E-18). WebKitGTK keeps an undo stack for them but binds no keys to it.
  const t = e.target;
  if ((t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) && e.ctrlKey && !e.altKey) {
    const k = e.key.toLowerCase();
    const cmd = k === "z" ? (e.shiftKey ? "redo" : "undo") : k === "y" && !e.shiftKey ? "redo" : null;
    if (cmd) {
      e.preventDefault();
      document.execCommand(cmd);
    }
  }
});

// Unsaved changes: Save / Don't Save / Cancel (spec 07, 7.1).
void appWindow.onCloseRequested(async (event) => {
  if (!editor.isDirty()) return;
  event.preventDefault();
  const name = state.fileName ?? "Untitled";
  const choice = await message(`Do you want to save the changes you made to ${name}?`, {
    title: "Scrim",
    kind: "warning",
    buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
  });
  if (choice === "Save" || choice === "Yes") {
    if (await save(false)) await appWindow.destroy();
  } else if (choice === "Don't Save" || choice === "No") {
    await ipc.recoveryRemove(true); // kept 7 days in recovery/discarded (7.6)
    await appWindow.destroy();
  } else {
    void emit("scrim://close-cancelled", appWindow.label); // stops Quit (7.1)
  }
});

// Every CSP violation is logged (spec 19, "Enforcement" item 5).
window.addEventListener("error", (e) => void ipc.log("error", `${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => void ipc.log("error", `unhandled rejection: ${String(e.reason)}`));

// Test hook: lets WebDriver tests read the document and drive the editor.
(window as unknown as { __scrim: unknown }).__scrim = {
  editor,
  save,
  recordUpdates,
  inlineKey,
  /** Run a command by id, as a menu click does. */
  command: (id: string) => dispatcher.runId(id, "native"),
  dispatcher,
  appMenu,
  config: () => config,
  preferences,
  setSetting: (key: string, value: unknown) => ipc.setSetting(key, value),
  sidebar,
  findBar,
  quickOpen,
  sourceMode,
  statusBar,
  writeDraft: () => drafts.writeDraft(),
  testHooks,
  exporter,
  spelling,
  local,
  picker,
  /** the CodeMirror view of an element (tests drive the Customize editors) */
  cmFind: (el: HTMLElement) => CMEditorView.findFromDOM(el),
  themes,
  zoomLevel: () => zoomLevel,
  openMs: () => openMs,
};

void appWindow.listen("scrim://doc-reload", () => void init());
// Preferences changed in any window (P4 writes them): re-read and re-render what depends
// on them; "Allow iframes" takes effect immediately in both directions (Q-015).
void listen("scrim://settings-changed", async () => {
  applySettings((await ipc.settings()) as Record<string, unknown>);
  if (setting("pandocPath", "") !== pandocPathChecked) void detectPandoc();
  spelling.apply();
  void appMenu.rebuild(); // custom export commands
  rerenderHtmlBlocks();
  preferences.refresh();
  void appMenu.refreshChecks();
});
void init();
