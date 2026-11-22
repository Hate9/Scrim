// File → Export, Print, Import (spec 09): runs in the document's window.

import type { EditorView } from "prosemirror-view";
import { invoke } from "@tauri-apps/api/core";
import { buildPage, frontMatter, settingsFrom, themeChoice, withOverrides, type ExportSettings, type PdfSettings } from "./document";
import { renderBody } from "./render";
import { pandocInput } from "./pandoc";

type Setting = <T>(key: string, fallback: T) => T;

export interface ExportHost {
  view: EditorView;
  markdown(): string;
  setting: Setting;
  currentTheme(): string;
  /** the document's path, or null while untitled */
  path(): string | null;
  /** file name shown in the title (for an untitled document: its suggested name) */
  fileName(): string;
  save(): Promise<boolean>;
  notice(text: string | null, buttons?: [string, () => void][]): void;
  error(title: string, text: string): Promise<void>;
}

/** Pandoc formats (9.4): id → label, extension, pandoc writer. */
export const PANDOC_FORMATS = [
  { id: "docx", label: "Word (.docx)", ext: "docx", to: "docx" },
  { id: "odt", label: "OpenDocument (.odt)", ext: "odt", to: "odt" },
  { id: "rtf", label: "RTF", ext: "rtf", to: "rtf" },
  { id: "epub", label: "EPUB", ext: "epub", to: "epub" },
  { id: "latex", label: "LaTeX (.tex)", ext: "tex", to: "latex" },
  { id: "mediawiki", label: "MediaWiki", ext: "wiki", to: "mediawiki" },
  { id: "rst", label: "reStructuredText", ext: "rst", to: "rst" },
  { id: "textile", label: "Textile", ext: "textile", to: "textile" },
  { id: "opml", label: "OPML", ext: "opml", to: "opml" },
  { id: "org", label: "Org", ext: "org", to: "org" },
  { id: "plain", label: "Plain Text", ext: "txt", to: "plain" },
] as const;

export interface CustomCommand {
  name: string;
  ext: string;
  command: string;
}

/** Custom export commands (9.5), from Preferences only (never from a document, 9.6). */
export function customCommands(setting: Setting): CustomCommand[] {
  const raw = setting<unknown>("exportCustomCommands", []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({ name: String(c.name ?? "").trim(), ext: String(c.ext ?? "").replace(/^\./, "").trim(), command: String(c.command ?? "") }))
    .filter((c) => c.name && c.command);
}

export type ExportKind = { kind: "html"; styled: boolean } | { kind: "pdf" } | { kind: "pandoc"; format: string } | { kind: "custom"; name: string };

const stem = (name: string) => name.replace(/\.[^.]+$/, "") || "Untitled";
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");

export class Exporter {
  private last: { what: ExportKind; path: string } | null = null;
  private busy = false;

  constructor(private host: ExportHost) {}

  hasPrevious(): boolean {
    return this.last !== null;
  }

  settings(): ExportSettings {
    return withOverrides(settingsFrom(this.host.setting), frontMatter(this.host.markdown()));
  }

  private title(): string {
    return this.host.fileName().replace(/\.[^.]+$/, "") || "Untitled";
  }

  private async pick(ext: string, label: string): Promise<string | null> {
    const p = this.host.path();
    return invoke<string | null>("export_pick_path", {
      defaultName: `${stem(this.host.fileName())}.${ext}`,
      directory: p ? dirOf(p) : null,
      filterName: label,
      extensions: [ext],
    });
  }

  /** The export page (9.1) for HTML (`paged` false) or PDF/print. */
  async page(styled: boolean, paged: PdfSettings | null): Promise<string> {
    const s = this.settings();
    const embed = !paged && s.html.embedImages;
    const body = await renderBody(this.host.view, {
      images: paged ? "scrim-file" : embed ? "embed" : "relative",
      embed: (_written, resolved) => invoke<string | null>("export_embed_image", { path: localPath(resolved) }),
      preserveLineBreaks: this.host.setting("preserveLineBreaks", true),
    });
    const theme = styled ? themeChoice(paged ? paged.theme : s.html.theme, this.host.currentTheme()) : null;
    const themeCss = theme ? await invoke<string>("export_theme_css", { theme, mode: paged ? "scrim-file" : embed ? "embed" : "file" }) : "";
    return buildPage({
      body: body.html,
      title: body.title ?? this.title(),
      hasMath: body.hasMath,
      hasCode: body.hasCode,
      themeCss,
      styled,
      // Debug test hook (T-1, N-1): the window's stricter resource policy applies to the
      // export page too.
      head: paged ? (document.getElementById("scrim-test-csp")?.outerHTML ?? "") : s.html.head,
      bodyEnd: paged ? "" : s.html.bodyEnd,
      pdf: paged ?? undefined,
    });
  }

  /** Run one export; `path` given for Export with Previous. */
  async run(what: ExportKind, path?: string): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const out = path ?? (await this.pickFor(what));
      if (!out) return false;
      this.host.notice("Exporting…");
      await this.write(what, out);
      this.last = { what, path: out };
      this.host.notice(`Exported to ${out}`, [["Open", () => void invoke("export_open", { path: out })]]);
      window.setTimeout(() => this.host.notice(null), 8000);
      return true;
    } catch (e) {
      this.host.notice(null);
      await this.host.error("Export failed", String(e));
      return false;
    } finally {
      this.busy = false;
    }
  }

  async previous(): Promise<boolean> {
    if (!this.last) return false;
    return this.run(this.last.what, this.last.path);
  }

  private async pickFor(what: ExportKind): Promise<string | null> {
    switch (what.kind) {
      case "html":
        return this.pick("html", "HTML");
      case "pdf":
        return this.pick("pdf", "PDF");
      case "pandoc": {
        const f = PANDOC_FORMATS.find((x) => x.id === what.format);
        return f ? this.pick(f.ext, f.label) : null;
      }
      case "custom": {
        const c = customCommands(this.host.setting).find((x) => x.name === what.name);
        return c ? this.pick(c.ext || "out", c.name) : null;
      }
    }
  }

  private async write(what: ExportKind, out: string) {
    switch (what.kind) {
      case "html":
        await invoke("export_write", { path: out, text: await this.page(what.styled, null) });
        return;
      case "pdf": {
        const pdf = this.settings().pdf;
        const html = await this.page(true, pdf);
        await invoke("export_pdf", { html, out, page: pdfPage(pdf), title: this.pdfTitle(), date: new Date().toLocaleDateString() });
        return;
      }
      case "pandoc": {
        const f = PANDOC_FORMATS.find((x) => x.id === what.format);
        if (!f) throw new Error(`unknown format ${what.format}`);
        await invoke("pandoc_export", {
          markdown: pandocInput(this.host.view.state.doc, this.host.markdown()),
          to: f.to,
          out,
          docDir: this.host.path() ? dirOf(this.host.path()!) : null,
          extensions: pandocExtensions(this.host.setting),
          referenceDoc: f.id === "docx" ? this.host.setting("exportPandocReferenceDocx", "") || null : null,
          pandocPath: this.host.setting("pandocPath", "") || null,
        });
        return;
      }
      case "custom": {
        const c = customCommands(this.host.setting).find((x) => x.name === what.name);
        if (!c) throw new Error(`no custom export "${what.name}"`);
        // The document is saved first (9.5).
        if (!(await this.host.save()) || !this.host.path()) throw new Error("The document must be saved first.");
        await invoke("custom_export", { command: c.command, input: this.host.path(), out });
        return;
      }
    }
  }

  private pdfTitle(): string {
    const t = frontMatter(this.host.markdown())?.title;
    if (typeof t === "string" && t.trim()) return t.trim();
    let h1: string | null = null;
    this.host.view.state.doc.descendants((n) => {
      if (h1 !== null) return false;
      if (n.type.name === "heading" && n.attrs.level === 1) h1 = n.textContent;
      return h1 === null;
    });
    return h1 ?? this.title();
  }

  /** File → Print: the native print dialog for the export page (9.3). */
  async print(): Promise<void> {
    const pdf = this.settings().pdf;
    const html = await this.page(true, pdf);
    try {
      await invoke("export_print", { html, page: pdfPage(pdf) });
    } catch (e) {
      await this.host.error("Print failed", String(e));
    }
  }
}

/** Page settings for Rust (mm; slots per position). */
function pdfPage(p: PdfSettings) {
  const sizes: Record<string, [number, number]> = { A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6], A3: [297, 420], A5: [148, 210] };
  let [w, h] = p.pageSize === "custom" ? [p.customWidth, p.customHeight] : sizes[p.pageSize];
  if (p.orientation === "landscape") [w, h] = [Math.max(w, h), Math.min(w, h)];
  return {
    width: w,
    height: h,
    marginTop: p.marginTop,
    marginBottom: p.marginBottom,
    marginLeft: p.marginLeft,
    marginRight: p.marginRight,
    header: [p.header.left, p.header.center, p.header.right],
    footer: [p.footer.left, p.footer.center, p.footer.right],
  };
}

/** pandoc `-f` extensions that follow the Markdown settings (9.4). */
export function pandocExtensions(setting: Setting): string {
  let ext = "";
  if (setting("preserveLineBreaks", true)) ext += "+hard_line_breaks";
  if (setting("highlight", false)) ext += "+mark";
  ext += "+emoji";
  if (setting("superscript", false) || setting("subscript", false)) ext += "+superscript+subscript";
  return ext;
}

/** A local path from an image `src` the editor uses (`scrim-file` URL). */
function localPath(src: string): string {
  try {
    const u = new URL(src);
    const path = decodeURIComponent(u.pathname);
    return /^\/[a-zA-Z]:\//.test(path) ? path.slice(1) : path;
  } catch {
    return src;
  }
}
