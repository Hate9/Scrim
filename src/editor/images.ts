// Images (spec 04, 4.8; 06, 6.2–6.4): insert, paste, drop, zoom.

import { TextSelection, type Command, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { flatten, parseAttributes, type InlineElement } from "../md/inline";
import { elementsOf, isProse, type EditorOptions } from "./context";
import { inlineKey } from "./decorations";

export interface ImageHooks {
  /** Insert per the policy; returns the src to write (or throws with a message). */
  insertImage(source: { path?: string; dataBase64?: string; ext?: string }): Promise<string>;
  /** Link text for a non-image file (relative when possible). */
  linkTarget(path: string): Promise<string>;
  pathKind(path: string): Promise<"dir" | "image" | "file">;
  openMarkdown(path: string): void;
  openFolder(path: string): void;
  notify(message: string): void;
}

const MD_EXT = /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext|rmd)$/i;

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function escapeLinkText(s: string): string {
  return s.replace(/[\\[\]*_`<>]/g, "\\$&");
}

/** Insert Markdown text at `pos` (or the selection) and put the cursor after it. */
function insertAt(view: EditorView, text: string, pos?: number) {
  let tr = view.state.tr;
  if (pos !== undefined) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
  const { $from } = tr.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return;
  tr = tr.insertText(text);
  view.dispatch(tr.scrollIntoView());
}

/** Files from the file manager (pasted or dropped): images per policy, Markdown files
 * as links (pasted) or opened (dropped), other files as relative links (6.2, 6.3). */
export async function insertFiles(view: EditorView, paths: string[], hooks: ImageHooks, mode: "paste" | "drop", pos?: number) {
  const parts: string[] = [];
  for (const p of paths) {
    const kind = await hooks.pathKind(p);
    try {
      if (kind === "dir") {
        if (mode === "drop") hooks.openFolder(p);
      } else if (kind === "image") {
        parts.push(`![](${await hooks.insertImage({ path: p })})`);
      } else if (mode === "drop" && MD_EXT.test(p)) {
        hooks.openMarkdown(p);
      } else {
        parts.push(`[${escapeLinkText(baseName(p))}](${await hooks.linkTarget(p)})`);
      }
    } catch (e) {
      hooks.notify(String(e));
    }
  }
  if (parts.length) insertAt(view, parts.join(" "), pos);
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Image data or a file list on a paste event (6.2 items 3 and 4). True if handled. */
export function pasteFilesOrImages(view: EditorView, event: ClipboardEvent, hooks: ImageHooks): boolean {
  const data = event.clipboardData;
  if (!data) return false;
  if (view.state.selection.$from.parent.type.spec.code) return false;
  const uris = data.getData("text/uri-list");
  const files = uris
    .split(/\r?\n/)
    .filter((l) => l.startsWith("file://"))
    .map((l) => decodeURIComponent(l.replace(/^file:\/\/(localhost)?/, "")));
  if (files.length) {
    void insertFiles(view, files, hooks, "paste");
    return true;
  }
  const image = [...data.items].find((i) => i.kind === "file" && i.type.startsWith("image/"));
  const file = image?.getAsFile();
  if (!file) return false;
  const ext = (file.type.split("/")[1] ?? "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
  void file.arrayBuffer().then(async (buf) => {
    try {
      const src = await hooks.insertImage({ dataBase64: toBase64(buf), ext });
      insertAt(view, `![](${src})`);
    } catch (e) {
      hooks.notify(String(e));
    }
  });
  return true;
}

// ---- zoom (4.8, D-5) -------------------------------------------------------------------

function imageAt(state: EditorState, opts: EditorOptions): { start: number; el: InlineElement; src: string } | null {
  const { $from } = state.selection;
  if (!isProse($from.parent)) return null;
  const defs = inlineKey.getState(state)?.defs;
  if (!defs) return null;
  const off = $from.parentOffset;
  const el = flatten(elementsOf($from.parent, defs, opts)).find(
    (e) => (e.kind === "image" || (e.kind === "html" && e.nodeName === "img")) && e.from <= off && off <= e.to,
  );
  if (!el) return null;
  return { start: $from.start(), el, src: $from.parent.textBetween(el.from, el.to) };
}

function attr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Zoom the image at the cursor to `percent` (rewrites it as `<img … style="zoom: N%">`),
 * or back to `![]()` with `percent` null ("Original size"). */
export function zoomImage(percent: number | null, opts: EditorOptions): Command {
  return (state, dispatch) => {
    const hit = imageAt(state, opts);
    if (!hit) return false;
    const { el, start } = hit;
    let src: string;
    let alt: string;
    let title: string | undefined;
    if (el.kind === "image" && el.replace?.type === "image") {
      src = el.replace.src;
      alt = el.replace.alt;
      title = el.replace.title;
    } else {
      const a = parseAttributes(/^<img\s*([\s\S]*?)\/?>$/i.exec(hit.src)?.[1] ?? "");
      src = a.src ?? "";
      alt = a.alt ?? "";
      title = a.title;
    }
    let text: string;
    if (percent === null) {
      const dest = /[\s()<>]/.test(src) ? `<${src}>` : src;
      text = `![${alt.replace(/[\[\]]/g, "\\$&")}](${dest}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
    } else {
      text = `<img src="${attr(src)}"${alt ? ` alt="${attr(alt)}"` : ""}${title ? ` title="${attr(title)}"` : ""} style="zoom: ${percent}%">`;
    }
    if (dispatch) {
      const tr = state.tr.insertText(text, start + el.from, start + el.to);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, start + el.from + text.length)));
    }
    return true;
  };
}

/** Image paragraphs: the paragraph's only content is one image (4.8). */
export function isImageParagraphSource(src: string): boolean {
  const t = src.trim();
  return /^!\[[^\]]*\]\([^)]*\)$/.test(t) || /^<img\s[^>]*>$/i.test(t);
}
