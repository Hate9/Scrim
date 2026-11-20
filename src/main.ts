// P0 frontend: a plain-text editing surface for one document per window.
// The live-preview editor (ProseMirror) replaces the <textarea> in P1.

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { message } from "@tauri-apps/plugin-dialog";
import { displayText, rebuild, splitLines, type Line } from "./doc/lines";
import { suggestedFileName } from "./doc/naming";
import { ipc, type LineEndingName, type SaveRequest } from "./ipc";

const NEWLINES: Record<LineEndingName, "\n" | "\r\n" | "\r"> = { lf: "\n", crlf: "\r\n", cr: "\r" };

const editor = document.getElementById("editor") as HTMLTextAreaElement;
const notice = document.getElementById("notice") as HTMLDivElement;
const noticeText = document.getElementById("notice-text") as HTMLSpanElement;
const appWindow = getCurrentWebviewWindow();

const doc = {
  lines: [] as Line[],
  savedDisplay: "",
  newline: "\n" as "\n" | "\r\n" | "\r",
  fileName: null as string | null,
  dirty: false,
  saving: false,
};

function showNotice(text: string | null) {
  notice.hidden = !text;
  noticeText.textContent = text ?? "";
}
document.getElementById("notice-close")!.addEventListener("click", () => showNotice(null));

async function init() {
  const d = await ipc.docInit();
  doc.lines = splitLines(d.text);
  doc.newline = NEWLINES[d.lineEnding ?? d.defaultLineEnding];
  doc.fileName = d.fileName;
  doc.savedDisplay = displayText(doc.lines);
  doc.dirty = false;
  editor.value = doc.savedDisplay;
  document.title = d.title;
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  editor.focus();
  if (d.error) showNotice(d.error);
  else if (d.malformed)
    showNotice(`Some bytes in this file are not valid ${d.encoding.name} and are shown as �.`);
  else showNotice(null);
}

function updateDirty() {
  const dirty = editor.value !== doc.savedDisplay;
  if (dirty !== doc.dirty) {
    doc.dirty = dirty;
    void ipc.setDirty(dirty).then((title) => (document.title = title));
  }
}
editor.addEventListener("input", updateDirty);

/** Save; resolves to true when the document ended up saved. */
async function save(saveAs = false): Promise<boolean> {
  if (doc.saving) return false;
  doc.saving = true;
  try {
    const display = editor.value;
    const request: SaveRequest = {
      text: rebuild(doc.lines, display, doc.newline),
      saveAs,
      suggestedName: suggestedFileName(display),
    };
    for (;;) {
      const r = await ipc.save(request);
      switch (r.status) {
        case "saved":
          doc.lines = splitLines(request.text);
          doc.savedDisplay = display;
          doc.fileName = r.fileName;
          document.title = r.title;
          doc.dirty = false; // Rust marked the document clean; report if edited meanwhile
          updateDirty();
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
          const choice = await message(
            `This file contained bytes that are not valid ${r.encoding}. They are shown as � and will be saved that way.`,
            { title: "Save", kind: "warning", buttons: { ok: "Save Anyway", cancel: "Cancel" } },
          );
          if (choice !== "Save Anyway" && choice !== "Ok") return false;
          request.acceptLossy = true;
          break;
        }
      }
    }
  } finally {
    doc.saving = false;
  }
}

/** P0 key handling. The full dispatcher (spec 01, "Keyboard routing") arrives in P1. */
function keyName(e: KeyboardEvent): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toUpperCase();
  const m = /^Key([A-Z])$/.exec(e.code);
  return m ? m[1] : e.key;
}

window.addEventListener(
  "keydown",
  (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) {
      if (e.key === "F5") e.preventDefault(); // no reload (spec 01, rule 4)
      return;
    }
    const k = keyName(e);
    const run = (fn: () => unknown) => {
      e.preventDefault();
      e.stopPropagation();
      void fn();
    };
    if (k === "S" && !e.shiftKey) run(() => save(false));
    else if (k === "S" && e.shiftKey) run(() => save(true));
    else if (k === "O" && !e.shiftKey) run(() => ipc.openDialog());
    else if (k === "N" && !e.shiftKey) run(() => ipc.newDoc(false));
    else if (k === "N" && e.shiftKey) run(() => ipc.newDoc(true));
    else if (k === "R" || k === "P" || (k === "I" && e.shiftKey)) e.preventDefault(); // browser keys off
  },
  true,
);

// Unsaved changes: Save / Don't Save / Cancel (spec 07, 7.1).
void appWindow.onCloseRequested(async (event) => {
  if (!doc.dirty) return;
  event.preventDefault();
  const name = doc.fileName ?? "Untitled";
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

void appWindow.listen("scrim://doc-reload", () => void init());
void init();
