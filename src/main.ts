// Frontend entry: one document per window.

import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { message, open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { insertFiles } from "./editor/images";
import * as mapModule from "./md/serialize";
import { hideDropLine, showDropLine, textPosAt } from "./editor/dnd";
import { listen } from "@tauri-apps/api/event";
import { rerenderHtmlBlocks } from "./editor/codeview";
import { TextSelection } from "prosemirror-state";
import { FindBar } from "./app/findbar";
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
  toggleTypewriter,
  watchExternalChanges,
  zoom,
} from "./app/workspace";
import type { CommandDef } from "./editor/keys";
import { createCommands } from "./app/commands";
import { suggestedFileName } from "./doc/naming";
import { inlineKey } from "./editor/decorations";
import { createEditor, recordUpdates } from "./editor/editor";
import { Dispatcher } from "./editor/keys";
import { ipc, type LineEndingName, type SaveRequest } from "./ipc";

const EOLS: Record<LineEndingName, string> = { lf: "\n", crlf: "\r\n", cr: "\r" };

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
function setting<T>(key: string, fallback: T): T {
  return (key in settings ? (settings[key] as T) : fallback) ?? fallback;
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
    onFrontMatter(fm) {
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
  o.inlineMath = bool("inlineMath", false);
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
  if (typeof statusBar !== "undefined") statusBar.syncButtons();
  sourceMode?.setLineNumbers(setting("sourceLineNumbers", false));
}

async function init() {
  const d = await ipc.docInit();
  applySettings((d.settings ?? {}) as Record<string, unknown>);
  state.fileName = d.fileName;
  state.path = d.path;
  editor.options.docDir = d.path ? dirname(d.path) : null;
  const eol = EOLS[d.lineEnding ?? d.defaultLineEnding];
  editor.load(d.text, !d.path || d.missing, eol);
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
  const z = setting("zoom", 1);
  if (z !== 1) void getCurrentWebview().setZoom(z);
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
    const savedDoc = editor.view.state.doc;
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
          if (editor.view.state.doc === savedDoc) editor.markSaved();
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

/** E2E stand-ins for native dialogs (set through `window.__scrim.testHooks`). */
const testHooks: { askImagePaths?: () => Promise<"update" | "copy" | "leave"> } = {};

// ---- workspace (P3) ---------------------------------------------------------------------

let pendingSelect: { line: number; start: number; length: number } | null = null;
let recoveryOffered = false;

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
});
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
  global("view.focusMode", "F8", () => toggleFocusMode(editor)),
  global("view.typewriterMode", "F9", toggleTypewriter),
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
const commandList = [
  ...createCommands(editor, { save, isWindows, askTableSize, insertImage: insertImageDialog }),
  ...workspaceCommands,
];
const dispatcher = new Dispatcher(commandList, () => editor.view.hasFocus() || sourceMode.hasFocus());
dispatcher.attach(window);
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
  }
});

// Every CSP violation is logged (spec 19, "Enforcement" item 5).
document.addEventListener("securitypolicyviolation", (e) => {
  void ipc.logCsp({ blockedUri: e.blockedURI, violatedDirective: e.violatedDirective, sourceFile: e.sourceFile || undefined });
});
window.addEventListener("error", (e) => void ipc.log("error", `${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => void ipc.log("error", `unhandled rejection: ${String(e.reason)}`));

// Test hook: lets WebDriver tests read the document and drive the editor.
(window as unknown as { __scrim: unknown }).__scrim = {
  editor,
  save,
  recordUpdates,
  inlineKey,
  /** Run a command by id (menus arrive in P4). */
  command: (id: string) => commandList.find((c) => c.id === id)?.run(),
  setSetting: (key: string, value: unknown) => ipc.setSetting(key, value),
  sidebar,
  findBar,
  quickOpen,
  sourceMode,
  statusBar,
  writeDraft: () => drafts.writeDraft(),
  testHooks,
};

void appWindow.listen("scrim://doc-reload", () => void init());
// Preferences changed in any window (P4 writes them): re-read and re-render what depends
// on them; "Allow iframes" takes effect immediately in both directions (Q-015).
void listen("scrim://settings-changed", async () => {
  applySettings((await ipc.settings()) as Record<string, unknown>);
  rerenderHtmlBlocks();
});
void init();
