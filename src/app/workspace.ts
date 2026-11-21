// Window-level workspace behavior (spec 07, 15): external changes, autosave, draft
// recovery, view modes, Save As image paths.

import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Editor } from "../editor/editor";
import { posToSource, serializeWithMap, sourceToPos } from "../md/serialize";
import { flatten } from "../md/inline";
import { elementsOf, isProse } from "../editor/context";
import { inlineKey } from "../editor/decorations";
import { ipc, type DraftMeta } from "../ipc";

export interface WorkspaceHooks {
  isDirty(): boolean;
  path(): string | null;
  save(): Promise<boolean>;
  notice(text: string | null, buttons?: [string, () => void][]): void;
  setting<T>(key: string, fallback: T): T;
  title(): string;
  markSaved(): void;
  /** The text to write as a draft (flushes source mode). */
  draftText(): string;
  close(): void;
}

// ---- external changes (7.3) ----------------------------------------------------------------

/** Replace the document with the file's new text, keeping the cursor on the same source
 * offset and the scroll position; one undo step (7.3). */
export function reloadKeepingCursor(editor: Editor, text: string) {
  const view = editor.view;
  const scroller = view.dom.closest("content") as HTMLElement;
  const scroll = scroller.scrollTop;
  const { map } = serializeWithMap(view.state.doc, { prettyTables: editor.options.prettyTables });
  const offset = posToSource(map, view.state.selection.head);
  editor.applyText(text);
  const after = serializeWithMap(view.state.doc, { prettyTables: editor.options.prettyTables }).map;
  const pos = sourceToPos(after, offset);
  if (pos !== null) {
    try {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(Math.min(pos, view.state.doc.content.size)))));
    } catch {
      /* keep */
    }
  }
  editor.markSaved();
  scroller.scrollTop = scroll;
}

export function watchExternalChanges(editor: Editor, hooks: WorkspaceHooks) {
  void listen<{ kind: "modified" | "removed" }>("scrim://file-changed", async (e) => {
    if (e.payload.kind === "removed") {
      hooks.notice("File no longer exists on disk.", [
        ["Save", () => void hooks.save().then((ok) => ok && hooks.notice(null))],
        ["Close", () => hooks.close()],
      ]);
      void ipc.setDirty(true).then((t) => (document.title = t));
      return;
    }
    if (!hooks.isDirty()) {
      const text = await ipc.reload();
      reloadKeepingCursor(editor, text);
      return;
    }
    hooks.notice("This file changed on disk.", [
      [
        "Reload",
        async () => {
          hooks.notice(null);
          reloadKeepingCursor(editor, await ipc.reload());
          document.title = await ipc.setDirty(false);
        },
      ],
      ["Keep mine", () => hooks.notice(null)],
    ]);
  });
}

// ---- autosave and draft recovery (7.6) ---------------------------------------------------

export function startAutosaveAndRecovery(editor: Editor, hooks: WorkspaceHooks) {
  let autosaveTimer = 0;
  const writeDraft = () => {
    if (hooks.isDirty()) void ipc.recoveryWrite(hooks.draftText(), hooks.title());
  };
  editor.onUpdate.push(() => {
    if (!hooks.setting("autoSave", false) || !hooks.path() || !hooks.isDirty()) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => void hooks.save(), 1000);
  });
  window.setInterval(writeDraft, 30_000);
  window.addEventListener("blur", () => {
    writeDraft();
    if (hooks.setting("autoSave", false) && hooks.path() && hooks.isDirty()) void hooks.save();
  });
  return { writeDraft };
}

/** At launch: offer drafts left by a crash (7.6). Only the first window asks. */
export async function offerRecovery(hooks: WorkspaceHooks, show: (drafts: DraftMeta[]) => void) {
  const drafts = await ipc.recoveryList();
  if (!drafts.length) return;
  hooks.notice(`Recovered ${drafts.length} unsaved document${drafts.length > 1 ? "s" : ""}.`, [["Show", () => show(drafts)]]);
}

/** The recovery list: open, compare, or discard each draft. */
export function recoveryDialog(
  drafts: DraftMeta[],
  open: (d: DraftMeta, text: string) => void,
) {
  const box = document.createElement("div");
  box.className = "scrim-dialog scrim-recovery";
  const title = document.createElement("div");
  title.className = "scrim-dialog-title";
  title.textContent = "Recover Unsaved Drafts";
  box.appendChild(title);
  const close = () => box.remove();
  for (const d of drafts) {
    const row = document.createElement("div");
    row.className = "scrim-recovery-row";
    const label = document.createElement("span");
    label.textContent = `${d.title} — ${new Date(d.time).toLocaleString()}${d.path ? ` (${d.path})` : ""}`;
    const button = (text: string, run: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.addEventListener("click", run);
      return b;
    };
    row.append(
      label,
      button("Open", async () => {
        open(d, await ipc.recoveryRead(d.id));
        row.remove();
      }),
      button("Compare", async () => {
        const draft = await ipc.recoveryRead(d.id);
        const disk = d.path ? await ipc.readText(d.path).catch(() => "(file not found)") : "(untitled)";
        const cmp = document.createElement("div");
        cmp.className = "scrim-recovery-compare";
        for (const [h, t] of [["Draft", draft], ["On disk", disk]] as const) {
          const col = document.createElement("div");
          const hh = document.createElement("div");
          hh.className = "scrim-dialog-title";
          hh.textContent = h;
          const pre = document.createElement("pre");
          pre.textContent = t;
          col.append(hh, pre);
          cmp.appendChild(col);
        }
        row.after(cmp);
      }),
      button("Discard", async () => {
        await ipc.recoveryDiscard(d.id);
        row.remove();
      }),
    );
    box.appendChild(row);
  }
  const done = document.createElement("div");
  done.className = "scrim-dialog-buttons";
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "Close";
  b.addEventListener("click", close);
  done.appendChild(b);
  box.appendChild(done);
  box.addEventListener("keydown", (e) => e.key === "Escape" && close());
  document.body.appendChild(box);
}

// ---- view modes (15) --------------------------------------------------------------------

export function toggleFocusMode(editor?: Editor) {
  document.body.classList.toggle("on-focus-mode");
  // Re-run decorations so the focused block gets (or loses) `md-focus`.
  if (editor) editor.view.dispatch(editor.view.state.tr.setMeta("scrim-focus-mode", true));
}

/** Typewriter mode: the cursor line stays centered while typing or moving with keys. */
export function setupTypewriter(editor: Editor) {
  let keyboard = false;
  window.addEventListener("keydown", () => (keyboard = true), true);
  window.addEventListener("mousedown", () => (keyboard = false), true);
  editor.onUpdate.push((view: EditorView) => {
    if (!document.body.classList.contains("scrim-typewriter-mode") || !keyboard || !view.hasFocus()) return;
    const scroller = view.dom.closest("content") as HTMLElement;
    const c = view.coordsAtPos(view.state.selection.head);
    const r = scroller.getBoundingClientRect();
    const delta = (c.top + c.bottom) / 2 - (r.top + r.height / 2);
    if (Math.abs(delta) > 2) scroller.scrollBy({ top: delta, behavior: "smooth" });
  });
}

export function toggleTypewriter() {
  document.body.classList.toggle("scrim-typewriter-mode");
}

/** Zoom 50%–300% in 10% steps, remembered globally (15). */
export async function zoom(step: number | null, setSetting: (k: string, v: unknown) => void, current: number) {
  const next = step === null ? 1 : Math.min(3, Math.max(0.5, Math.round((current + step) * 10) / 10));
  await getCurrentWebview().setZoom(next);
  setSetting("zoom", next);
  return next;
}

export async function toggleFullscreen() {
  const w = getCurrentWindow();
  await w.setFullscreen(!(await w.isFullscreen()));
}

export async function toggleAlwaysOnTop(on: boolean) {
  await getCurrentWindow().setAlwaysOnTop(on);
}

// ---- Save As with relative images (7.2, D-7) -------------------------------------------------

function relative(from: string, to: string, sep: string): string {
  const a = from.split(/[\\/]/).filter(Boolean);
  const b = to.split(/[\\/]/).filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join(sep === "\\" ? "/" : "/");
}

function join(dir: string, rel: string): string {
  const parts = dir.split(/[\\/]/);
  for (const p of rel.split("/")) {
    if (p === "..") parts.pop();
    else if (p && p !== ".") parts.push(p);
  }
  return parts.join(dir.includes("\\") && !dir.includes("/") ? "\\" : "/");
}

/** Relative image references in the document: [doc position range of the src, src]. */
export function relativeImages(editor: Editor): { from: number; to: number; src: string }[] {
  const state = editor.view.state;
  const defs = inlineKey.getState(state)?.defs;
  const out: { from: number; to: number; src: string }[] = [];
  if (!defs) return out;
  state.doc.descendants((node, pos) => {
    if (!isProse(node)) return !node.isTextblock;
    const text = node.textBetween(0, node.content.size, undefined, "\n");
    for (const e of flatten(elementsOf(node, defs, editor.options))) {
      if (e.kind !== "image" || e.replace?.type !== "image") continue;
      const src = e.replace.src;
      if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("/") || /^[a-z]:[\\/]/i.test(src)) continue;
      const raw = text.slice(e.contentTo, e.to);
      const i = raw.indexOf(src);
      if (i >= 0) out.push({ from: pos + 1 + e.contentTo + i, to: pos + 1 + e.contentTo + i + src.length, src });
    }
    return false;
  });
  return out;
}

/** After Save As to another folder: "Update image paths" / "Copy images" / "Leave as is". */
export async function fixImagesAfterSaveAs(
  editor: Editor,
  oldDir: string,
  newDir: string,
  ask: () => Promise<"update" | "copy" | "leave">,
): Promise<boolean> {
  if (oldDir === newDir) return false;
  const images = relativeImages(editor);
  if (!images.length) return false;
  const choice = await ask();
  if (choice === "leave") return false;
  if (choice === "copy") {
    for (const im of images) {
      let src = im.src;
      try {
        src = decodeURIComponent(src);
      } catch {
        /* as is */
      }
      await ipc.copyFile(join(oldDir, src), join(newDir, src)).catch(() => undefined);
    }
    return false;
  }
  const view = editor.view;
  const tr = view.state.tr;
  for (const im of [...images].reverse()) {
    let src = im.src;
    try {
      src = decodeURIComponent(src);
    } catch {
      /* as is */
    }
    const abs = join(oldDir, src);
    const rel = relative(newDir, abs, "/").replace(/ /g, "%20");
    tr.insertText(rel, im.from, im.to);
  }
  view.dispatch(tr);
  return true;
}
