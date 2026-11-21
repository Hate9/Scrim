// Frontend entry: one document per window.

import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { message } from "@tauri-apps/plugin-dialog";
import { createCommands } from "./app/commands";
import { suggestedFileName } from "./doc/naming";
import { createEditor } from "./editor/editor";
import { Dispatcher } from "./editor/keys";
import { ipc, type LineEndingName, type SaveRequest } from "./ipc";

const EOLS: Record<LineEndingName, string> = { lf: "\n", crlf: "\r\n", cr: "\r" };

const write = document.getElementById("write") as HTMLDivElement;
const notice = document.getElementById("notice") as HTMLDivElement;
const noticeText = document.getElementById("notice-text") as HTMLSpanElement;
const appWindow = getCurrentWebviewWindow();
const isWindows = navigator.userAgent.includes("Windows");
document.body.classList.add(isWindows ? "os-windows" : "os-linux");

const state = { fileName: null as string | null, path: null as string | null, saving: false };

function showNotice(text: string | null) {
  notice.hidden = !text;
  noticeText.textContent = text ?? "";
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
  const dir = editor.options.docDir;
  if (!dir) return null;
  const sep = isWindows ? "\\" : "/";
  return dir + sep + path.replace(/^\.\//, "").replace(/\//g, sep);
}

const pendingScope = new Set<string>();
let scopeTimer = 0;

const editor = createEditor(
  write,
  { pathSep: isWindows ? "\\" : "/" },
  {
    imageUrl(src) {
      if (/^(https?:|data:|blob:)/i.test(src)) return src;
      const local = resolveLocal(src);
      if (!local) return src;
      pendingScope.add(local);
      clearTimeout(scopeTimer);
      scopeTimer = window.setTimeout(() => {
        const paths = [...pendingScope];
        pendingScope.clear();
        void ipc.allowFiles(paths);
      }, 0);
      return convertFileSrc(local, "scrim-file");
    },
    renderMath(tex, el) {
      el.textContent = tex;
      void import("./editor/math").then((m) => m.renderMath(tex, el));
    },
  },
  (dirty) => void ipc.setDirty(dirty).then((title) => (document.title = title)),
);

async function init() {
  const d = await ipc.docInit();
  state.fileName = d.fileName;
  state.path = d.path;
  editor.options.docDir = d.path ? dirname(d.path) : null;
  const eol = EOLS[d.lineEnding ?? d.defaultLineEnding];
  editor.load(d.text, !d.path || d.missing, eol);
  document.title = d.title;
  editor.view.focus();
  if (d.error) showNotice(d.error);
  else if (d.malformed) showNotice(`Some bytes in this file are not valid ${d.encoding.name} and are shown as �.`);
  else showNotice(null);
}

/** Save; resolves to true when the document ended up saved. */
async function save(saveAs = false): Promise<boolean> {
  if (state.saving) return false;
  state.saving = true;
  try {
    const savedDoc = editor.view.state.doc;
    const text = editor.markdown();
    const request: SaveRequest = { text, saveAs, suggestedName: suggestedFileName(text) };
    for (;;) {
      const r = await ipc.save(request);
      switch (r.status) {
        case "saved":
          state.fileName = r.fileName;
          state.path = r.path;
          editor.options.docDir = dirname(r.path);
          if (editor.view.state.doc === savedDoc) editor.markSaved();
          document.title = await ipc.setDirty(editor.isDirty());
          return true;
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

const dispatcher = new Dispatcher(
  createCommands(editor, { save, isWindows }),
  () => editor.view.hasFocus(),
);
dispatcher.attach(window);

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
(window as unknown as { __scrim: unknown }).__scrim = { editor, save };

void appWindow.listen("scrim://doc-reload", () => void init());
void init();
