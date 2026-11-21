// The document's context menu (spec 12, "Context menu (document)"), drawn in HTML.

import { TextSelection } from "prosemirror-state";
import type { Editor } from "../editor/editor";

export interface ContextItem {
  label: string;
  run?: () => void;
  children?: ContextItem[];
  /** a row of small buttons (the formatting quick row) */
  row?: { label: string; title: string; run: () => void }[];
}
export type ContextEntry = ContextItem | null;

export interface ContextHooks {
  command(id: string): void;
  copy(kind?: "markdown"): void;
  paste(plain: boolean): void;
  contextSearch(): { label: string; url: string }[];
  openUrl(url: string): void;
  copyText(text: string): void;
  openLink(href: string): void;
  image: {
    open(src: string): void;
    reveal(src: string): void;
    copyToAssets(src: string): void;
    deleteFile(src: string): void;
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export class DocumentMenu {
  private menus: HTMLElement[] = [];

  constructor(private editor: Editor, private hooks: ContextHooks) {
    editor.view.dom.addEventListener("contextmenu", (e) => this.open(e));
    document.addEventListener("mousedown", (e) => {
      if (!this.menus.some((m) => m.contains(e.target as Node))) this.close();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.menus.length) {
        e.preventDefault();
        this.close();
      }
    });
    window.addEventListener("blur", () => this.close());
  }

  close() {
    for (const m of this.menus) m.remove();
    this.menus = [];
  }

  private open(e: MouseEvent) {
    e.preventDefault();
    const view = this.editor.view;
    const target = e.target as HTMLElement;
    // Right-click outside the selection moves the cursor there first.
    const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
    const sel = view.state.selection;
    if (pos && (sel.empty || pos.pos < sel.from || pos.pos > sel.to)) {
      const $p = view.state.doc.resolve(pos.pos);
      if ($p.parent.inlineContent) view.dispatch(view.state.tr.setSelection(TextSelection.near($p)));
    }
    view.focus();
    this.show(e.clientX, e.clientY, this.items(target));
  }

  private items(target: HTMLElement): ContextEntry[] {
    const h = this.hooks;
    const c = (label: string, id: string): ContextItem => ({ label, run: () => h.command(id) });
    const selected = this.editor.view.state.selection.empty ? "" : window.getSelection()?.toString() ?? "";
    const out: ContextEntry[] = [
      { label: "Cut", run: () => h.command("edit.cut") },
      { label: "Copy", run: () => h.copy() },
      { label: "Paste", run: () => h.paste(false) },
      { label: "Paste as Plain Text", run: () => h.paste(true) },
      null,
      {
        label: "",
        row: [
          { label: "B", title: "Strong", run: () => h.command("format.strong") },
          { label: "I", title: "Emphasis", run: () => h.command("format.em") },
          { label: "</>", title: "Code", run: () => h.command("format.code") },
          { label: "🔗", title: "Hyperlink", run: () => h.command("format.link") },
        ],
      },
      {
        label: "Insert",
        children: [
          c("Image…", "format.image.insert"),
          c("Table…", "para.table"),
          c("Code Block", "para.codeFences"),
          c("Math Block", "para.mathBlock"),
          c("Footnote", "format.footnote"),
          c("Horizontal Line", "para.hr"),
          c("Table of Contents", "para.toc"),
        ],
      },
      { label: "Copy as Markdown", run: () => h.copy("markdown") },
    ];
    if (selected.trim()) {
      const searches = h.contextSearch().filter((s) => s && typeof s.url === "string" && typeof s.label === "string");
      if (searches.length) {
        out.push(null);
        for (const s of searches) out.push({ label: s.label, run: () => h.openUrl(s.url.replace(/%s/g, encodeURIComponent(selected))) });
      }
    }
    const link = target.closest<HTMLElement>("a[data-href]");
    if (link?.dataset.href) {
      const href = link.dataset.href;
      out.push(null, { label: "Open Link", run: () => h.openLink(href) }, { label: "Copy Link Address", run: () => h.copyText(href) });
    }
    const img = target.closest<HTMLElement>(".md-image")?.querySelector<HTMLImageElement>("img") ?? (target instanceof HTMLImageElement ? target : null);
    const src = img?.dataset.src;
    if (src) {
      out.push(
        null,
        { label: "Open Image", run: () => h.image.open(src) },
        { label: "Reveal Image in Folder", run: () => h.image.reveal(src) },
        {
          label: "Zoom Image",
          children: [
            ...[25, 33, 50, 67, 80, 100, 150, 200].map((n) => c(`Zoom ${n}%`, `format.image.zoom${n}`)),
            c("Original Size", "format.image.originalSize"),
          ],
        },
        { label: "Copy Image to Assets Folder", run: () => h.image.copyToAssets(src) },
        { label: "Delete Image File", run: () => h.image.deleteFile(src) },
      );
    }
    return out;
  }

  private show(x: number, y: number, items: ContextEntry[], level = 0) {
    this.menus.splice(level).forEach((m) => m.remove());
    const m = el("div", "scrim-context-menu scrim-document-menu");
    for (const it of items) {
      if (!it) {
        m.appendChild(el("div", "scrim-context-sep"));
        continue;
      }
      if (it.row) {
        const row = el("div", "scrim-context-row");
        for (const b of it.row) {
          const btn = el("button", "scrim-context-quick", b.label);
          btn.type = "button";
          btn.title = b.title;
          btn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            this.close();
            b.run();
          });
          row.appendChild(btn);
        }
        m.appendChild(row);
        continue;
      }
      const row = el("div", `scrim-context-item${it.children ? " scrim-context-sub" : ""}`, it.label);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (it.children) return;
        this.close();
        it.run?.();
      });
      if (it.children) {
        const kids = it.children;
        row.addEventListener("mouseenter", () => {
          const r = row.getBoundingClientRect();
          this.show(r.right - 2, r.top - 4, kids, level + 1);
        });
      } else {
        row.addEventListener("mouseenter", () => this.menus.splice(level + 1).forEach((x) => x.remove()));
      }
      m.appendChild(row);
    }
    document.body.appendChild(m);
    this.menus.push(m);
    m.style.left = `${Math.max(4, Math.min(x, window.innerWidth - m.offsetWidth - 4))}px`;
    m.style.top = `${Math.max(4, Math.min(y, window.innerHeight - m.offsetHeight - 4))}px`;
  }
}
