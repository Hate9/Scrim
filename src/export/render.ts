// Export rendering (spec 09, 9.1): the whole document as static HTML in collapsed state.
//
// "The same renderer as the editor": the export body is a copy of the editor's own DOM
// (every block and inline construct exactly as the editor builds it, 10.3), with
// everything that only exists for editing taken out: markers and hidden source, cursor
// classes, widgets' editing wrappers, source editors, toolbars, placeholders, search and
// spell marks. Code blocks are rebuilt as static markup with the editor's element
// structure and token classes, because CodeMirror only draws the lines in view.

import { withWholeDocument } from "../editor/viewport";
import { LanguageSupport } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { inlineKey } from "../editor/decorations";
import { loadLanguage, scrimHighlighter } from "../editor/codeview";
import { schema } from "../md/schema";

export interface RenderOptions {
  /** How images are referenced: as the editor does (`scrim-file` URLs, for PDF and
   * print), by their path as written in the document, or embedded as data URLs. */
  images: "scrim-file" | "relative" | "embed";
  /** Fetches a local file for "embed" (returns a data URL, or null if unreadable). */
  embed?: (src: string, resolved: string) => Promise<string | null>;
}

export interface RenderedBody {
  /** `<div id="write">…</div>` content (the inner HTML). */
  html: string;
  /** front matter `title`, else the first h1, else null (the caller uses the file name) */
  title: string | null;
  hasMath: boolean;
  hasCode: boolean;
}

/** Classes that only describe editing state. */
const EDIT_CLASSES = /^(md-expand|md-focus|md-focus-container|md-editing|ProseMirror.*|md-search-.*|md-spell.*|md-auto-escape|md-image-paragraph-editing)$/;
/** Attributes the editor sets for editing only. */
const EDIT_ATTRS = ["contenteditable", "spellcheck", "translate", "draggable", "data-el", "data-kind", "autocorrect", "autocapitalize", "writingsuggestions", "tabindex", "role", "aria-multiline", "aria-hidden-editor"];

/** Wait until the inline structure of every block is in place (it is built in chunks
 * after a document loads). */
async function settled(view: EditorView) {
  for (let i = 0; i < 400; i++) {
    if (inlineKey.getState(view.state)?.pending == null && !inlineKey.getState(view.state)?.touched.length) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

function textOfTitle(doc: PMNode): string | null {
  let title: string | null = null;
  doc.forEach((n) => {
    if (title === null && n.type === schema.nodes.front_matter) {
      const m = /^title:\s*(.+?)\s*$/m.exec(n.textContent);
      if (m) title = m[1].replace(/^(["'])(.*)\1$/, "$2");
    }
  });
  if (title) return title;
  let h1: string | null = null;
  doc.descendants((n) => {
    if (h1 !== null) return false;
    if (n.type === schema.nodes.heading && n.attrs.level === 1) {
      h1 = n.textContent;
      return false;
    }
    return true;
  });
  return h1;
}

/** Static code block markup (9.1 item 2): the editor's structure, its token classes. */
async function staticCode(source: string, lang: string, wrap: boolean, editorClass?: string): Promise<HTMLElement> {
  const editor = document.createElement("div");
  // The editor's own classes, including CodeMirror's generated theme classes, so its
  // (inlined) base styles apply as in the editor.
  editor.className = editorClass ?? `cm-editor CodeMirror cm-s-inner${wrap ? " CodeMirror-wrap" : ""}`;
  editor.classList.remove("cm-focused");
  const scroller = editor.appendChild(document.createElement("div"));
  scroller.className = "cm-scroller CodeMirror-scroll";
  const content = scroller.appendChild(document.createElement("div"));
  content.className = `cm-content${wrap ? " cm-lineWrapping" : ""} CodeMirror-code CodeMirror-lines`;
  const lines = source.split("\n");
  const lineEls = lines.map(() => {
    const l = content.appendChild(document.createElement("div"));
    l.className = "cm-line CodeMirror-line";
    return l;
  });
  // Token spans per line, from the same highlighter the editor uses.
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  const spans: { from: number; to: number; cls: string }[] = [];
  const support = lang ? await loadLanguage(lang).catch(() => null) : null;
  const language = support instanceof LanguageSupport ? support.language : null;
  if (language) highlightTree(language.parser.parse(source), scrimHighlighter, (from, to, cls) => spans.push({ from, to, cls }));
  let si = 0;
  lines.forEach((line, i) => {
    const el = lineEls[i];
    const base = starts[i];
    let pos = 0;
    while (si < spans.length && spans[si].to <= base) si++;
    for (let k = si; k < spans.length && spans[k].from < base + line.length; k++) {
      const from = Math.max(spans[k].from, base) - base;
      const to = Math.min(spans[k].to, base + line.length) - base;
      if (from > pos) el.append(line.slice(pos, from));
      if (to > from) {
        const s = el.appendChild(document.createElement("span"));
        s.className = spans[k].cls;
        s.textContent = line.slice(from, to);
      }
      pos = Math.max(pos, to);
    }
    if (pos < line.length) el.append(line.slice(pos));
    if (!line.length) el.appendChild(document.createElement("br"));
  });
  return editor;
}

function unwrap(el: Element) {
  el.replaceWith(...Array.from(el.childNodes));
}

/**
 * Render the document of `view` for export. The editor's DOM is copied, so this must run
 * in the document's own window.
 */
export async function renderBody(view: EditorView, opts: RenderOptions & { codeWrap?: boolean; preserveLineBreaks?: boolean }): Promise<RenderedBody> {
  await settled(view);
  const live = view.dom as HTMLElement;
  // Large documents render only near the viewport (Q-027): copy the whole document.
  const root = withWholeDocument(view, () => live.cloneNode(true)) as HTMLElement;

  // Checkbox state is a property, not an attribute: carry it over.
  const liveBoxes = live.querySelectorAll<HTMLInputElement>("input.md-task-checkbox");
  root.querySelectorAll<HTMLInputElement>("input.md-task-checkbox").forEach((b, i) => {
    if (liveBoxes[i]?.checked) b.setAttribute("checked", "");
    b.setAttribute("disabled", "");
  });

  // Blocks that are not content.
  root.querySelectorAll("pre.md-meta-block, .md-def-link, .md-lang-box, .md-fences-copy, .md-math-source, .md-htmlblock-source, .md-comment, img.ProseMirror-separator, br.ProseMirror-trailingBreak, .md-table-toolbar").forEach((e) => e.remove());

  // Soft breaks (02, "Line breaks"): `<br>` with "Preserve single line breaks", else a
  // space; hard breaks are always `<br>`.
  root.querySelectorAll(".md-br").forEach((br) => {
    const prev = br.previousSibling ?? br.parentElement?.previousSibling;
    const hard = prev instanceof Element && prev.classList.contains("md-inline-break");
    if (opts.preserveLineBreaks === false && !hard) br.replaceWith(" ");
    else br.replaceWith(document.createElement("br"));
  });

  // Inline: replaced elements keep only their rendered widget; markers and hidden
  // source go.
  root.querySelectorAll(".md-inline.md-replace").forEach((w) => {
    for (const c of Array.from(w.childNodes)) if (!(c instanceof Element && c.classList.contains("md-widget"))) c.remove();
  });
  root.querySelectorAll(".md-meta, .md-hide").forEach((e) => e.remove());
  root.querySelectorAll(".md-widget").forEach(unwrap);
  // Smart punctuation: the displayed characters (spec 03).
  root.querySelectorAll(".md-smart-src").forEach((e) => e.remove());
  root.querySelectorAll(".md-smart").forEach((e) => e.replaceWith(e.textContent ?? ""));

  // Links: real targets (the editor keeps them in data-href, Q-012); titles without the
  // URL the editor appends as a tooltip.
  root.querySelectorAll<HTMLAnchorElement>("a[data-href]").forEach((a) => {
    const url = a.getAttribute("data-href") ?? "";
    a.setAttribute("href", url);
    a.removeAttribute("data-href");
    const t = a.getAttribute("title") ?? "";
    const own = t === url ? "" : t.endsWith(`\n${url}`) ? t.slice(0, -url.length - 1) : t;
    if (own) a.setAttribute("title", own);
    else a.removeAttribute("title");
  });
  root.querySelectorAll<HTMLAnchorElement>("a.md-toc-inner[data-id]").forEach((a) => {
    a.setAttribute("href", `#${a.getAttribute("data-id")}`);
  });

  // Footnotes (9.1 item 3): numbered references linking to their definitions, the
  // definitions collected at the end in section.footnotes.
  root.querySelectorAll<HTMLElement>("sup.md-footnote").forEach((sup) => {
    const n = sup.getAttribute("data-n");
    const label = sup.getAttribute("data-ref") ?? "";
    if (!n) return;
    sup.textContent = "";
    const a = sup.appendChild(document.createElement("a"));
    a.href = `#fn-${n}`;
    a.id = `fnref-${n}`;
    a.textContent = n;
    sup.setAttribute("data-ref", label);
    sup.removeAttribute("data-n");
  });
  const defs = Array.from(root.querySelectorAll<HTMLElement>(".md-def-footnote"));
  if (defs.length) {
    const section = document.createElement("section");
    section.className = "footnotes";
    for (const d of defs) {
      const n = d.getAttribute("data-n");
      const name = d.querySelector(".md-def-name");
      if (n && name) name.textContent = n;
      if (n) d.id = `fn-${n}`;
      const back = d.querySelector<HTMLAnchorElement>("a.reversefootnote");
      if (back && n) back.href = `#fnref-${n}`;
      d.removeAttribute("data-n");
      section.appendChild(d);
    }
    root.appendChild(section);
  }

  // Code blocks: static markup (CodeMirror only draws what is in view).
  const codeNodes: PMNode[] = [];
  view.state.doc.descendants((n) => {
    if (n.type === schema.nodes.code_block) codeNodes.push(n);
    return true;
  });
  const pres = Array.from(root.querySelectorAll<HTMLElement>("pre.md-fences:not(.md-math-source)"));
  for (let i = 0; i < pres.length && i < codeNodes.length; i++) {
    const lang = String(codeNodes[i].attrs.info ?? "").split(/\s/)[0] ?? "";
    const cm = pres[i].querySelector(".cm-editor");
    const wrap = cm ? cm.classList.contains("CodeMirror-wrap") : (opts.codeWrap ?? true);
    pres[i].replaceChildren(await staticCode(codeNodes[i].textContent, lang, wrap, cm?.className));
  }

  // Images.
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-src]"));
  for (const img of imgs) {
    const written = img.getAttribute("data-src") ?? "";
    img.removeAttribute("data-src");
    const t = img.getAttribute("title") ?? "";
    const own = t === written ? "" : t.endsWith(`\n${written}`) ? t.slice(0, -written.length - 1) : t;
    if (own) img.setAttribute("title", own);
    else img.removeAttribute("title");
    if (opts.images === "relative") img.setAttribute("src", written);
    else if (opts.images === "embed" && opts.embed) {
      const data = await opts.embed(written, img.getAttribute("src") ?? "");
      img.setAttribute("src", data ?? written);
    }
  }
  root.querySelectorAll("[data-src]").forEach((e) => e.removeAttribute("data-src"));

  // Editing classes and attributes, everywhere.
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const a of EDIT_ATTRS) el.removeAttribute(a);
    if (el.classList.length) {
      for (const c of Array.from(el.classList)) if (EDIT_CLASSES.test(c)) el.classList.remove(c);
      if (!el.classList.length) el.removeAttribute("class");
    }
  }

  return {
    html: root.innerHTML,
    title: textOfTitle(view.state.doc),
    hasMath: !!root.querySelector(".katex"),
    hasCode: pres.length > 0,
  };
}

export { staticCode };
