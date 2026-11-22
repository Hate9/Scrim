// The export page around the rendered body (spec 09, 9.1 items 5 and 6; 9.2; 9.3).

import { parse as parseYaml } from "yaml";
import contentCss from "../content.css?raw";
import { bundledFontsCss } from "./fonts";
import katexCss from "katex/dist/katex.min.css?raw";

type Setting = <T>(key: string, fallback: T) => T;

export type PageSize = "A4" | "Letter" | "Legal" | "A3" | "A5" | "custom";

export interface Slots {
  left: string;
  center: string;
  right: string;
}

export interface PdfSettings {
  pageSize: PageSize;
  /** mm, for "custom" */
  customWidth: number;
  customHeight: number;
  orientation: "portrait" | "landscape";
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  pageBreakBeforeH1: boolean;
  /** "current", "none", or a theme id */
  theme: string;
  header: Slots;
  footer: Slots;
}

export interface HtmlSettings {
  head: string;
  bodyEnd: string;
  embedImages: boolean;
  theme: string;
}

export interface ExportSettings {
  html: HtmlSettings;
  pdf: PdfSettings;
}

const SIZES: PageSize[] = ["A4", "Letter", "Legal", "A3", "A5", "custom"];

/** Export settings from Preferences (`settings.json`, flat keys). */
export function settingsFrom(setting: Setting): ExportSettings {
  const num = (k: string, d: number) => {
    const v = Number(setting(k, d));
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  const size = setting<string>("exportPdfPageSize", "A4");
  return {
    html: {
      head: setting("exportHtmlHead", ""),
      bodyEnd: setting("exportHtmlBodyEnd", ""),
      embedImages: setting("exportHtmlEmbedImages", false),
      theme: setting("exportHtmlTheme", "current"),
    },
    pdf: {
      pageSize: SIZES.includes(size as PageSize) ? (size as PageSize) : "A4",
      customWidth: num("exportPdfCustomWidth", 210),
      customHeight: num("exportPdfCustomHeight", 297),
      orientation: setting<string>("exportPdfOrientation", "portrait") === "landscape" ? "landscape" : "portrait",
      marginTop: num("exportPdfMarginTop", 18),
      marginBottom: num("exportPdfMarginBottom", 18),
      marginLeft: num("exportPdfMarginLeft", 16),
      marginRight: num("exportPdfMarginRight", 16),
      pageBreakBeforeH1: setting("exportPdfPageBreakBeforeH1", false),
      theme: setting("exportPdfTheme", "current"),
      header: { left: setting("exportPdfHeaderLeft", ""), center: setting("exportPdfHeaderCenter", ""), right: setting("exportPdfHeaderRight", "") },
      footer: { left: setting("exportPdfFooterLeft", ""), center: setting("exportPdfFooterCenter", "{{page}}"), right: setting("exportPdfFooterRight", "") },
    },
  };
}

/** The front matter of a document, parsed (null if none or unreadable). */
export function frontMatter(markdown: string): Record<string, unknown> | null {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!m) return null;
  try {
    const v = parseYaml(m[1]);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Per-document overrides (9.6): front matter `export:` may change page and formatting
 * settings only. Extra head content, appended body content, custom commands, and the
 * pandoc path are never read from a document (it must not be able to run commands or
 * inject scripts, X-8).
 */
export function withOverrides(base: ExportSettings, fm: Record<string, unknown> | null): ExportSettings {
  const out: ExportSettings = { html: { ...base.html }, pdf: { ...base.pdf, header: { ...base.pdf.header }, footer: { ...base.pdf.footer } } };
  const exp = fm?.export;
  if (!exp || typeof exp !== "object") return out;
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
  const mm = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 2000 ? v : null);
  const html = obj((exp as Record<string, unknown>).html);
  if (html) {
    if (typeof html.embedImages === "boolean") out.html.embedImages = html.embedImages;
    const t = str(html.theme);
    if (t !== null) out.html.theme = t;
  }
  const pdf = obj((exp as Record<string, unknown>).pdf);
  if (pdf) {
    const size = str(pdf.pageSize);
    const match = SIZES.find((s) => s.toLowerCase() === size?.toLowerCase());
    if (match) out.pdf.pageSize = match;
    for (const k of ["customWidth", "customHeight", "marginTop", "marginBottom", "marginLeft", "marginRight"] as const) {
      const v = mm(pdf[k]);
      if (v !== null) out.pdf[k] = v;
    }
    if (pdf.orientation === "portrait" || pdf.orientation === "landscape") out.pdf.orientation = pdf.orientation;
    if (typeof pdf.pageBreakBeforeH1 === "boolean") out.pdf.pageBreakBeforeH1 = pdf.pageBreakBeforeH1;
    const t = str(pdf.theme);
    if (t !== null) out.pdf.theme = t;
    for (const k of ["header", "footer"] as const) {
      const v = pdf[k];
      const s = str(v);
      if (s !== null) out.pdf[k] = { left: "", center: s, right: "" };
      else if (obj(v)) {
        const o = obj(v)!;
        out.pdf[k] = { left: str(o.left) ?? "", center: str(o.center) ?? "", right: str(o.right) ?? "" };
      }
    }
  }
  return out;
}

/** Resolve "current" to the theme in use; "none" to null. */
export function themeChoice(choice: string, current: string): string | null {
  if (!choice || choice === "current") return current || null;
  if (choice === "none") return null;
  return choice;
}

// ---- CSS -----------------------------------------------------------------------------

/** CodeMirror's styles as they are in this window (its base theme, in @layer scrim-cm),
 * so static code blocks look as in the editor. */
function codeMirrorCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of Array.from(rules)) if (r instanceof CSSLayerBlockRule && r.name === "scrim-cm") out.push(r.cssText);
  }
  return out.join("\n");
}

const katexFonts = import.meta.glob("/node_modules/katex/dist/fonts/*.woff2", { query: "?url", import: "default" }) as Record<string, () => Promise<string>>;
let katexInlined: Promise<string> | null = null;

/** KaTeX's CSS with its fonts embedded (9.1 item 2: "the KaTeX CSS (inlined)"). */
function katexCssInlined(): Promise<string> {
  if (!katexInlined) {
    katexInlined = (async () => {
      const urls = new Map<string, string>();
      await Promise.all(
        Object.entries(katexFonts).map(async ([path, load]) => {
          const name = path.split("/").pop()!;
          try {
            const blob = await (await fetch(await load())).blob();
            const data = await new Promise<string>((res, rej) => {
              const fr = new FileReader();
              fr.onload = () => res(String(fr.result).replace(/^data:[^;,]*/, "data:font/woff2"));
              fr.onerror = () => rej(fr.error);
              fr.readAsDataURL(blob);
            });
            urls.set(name, data);
          } catch {
            /* that face falls back to a system font */
          }
        }),
      );
      // Keep only the woff2 source of each face, embedded.
      return katexCss.replace(/src:([^;}]*)/g, (_m: string, list: string) => {
        const w = /url\(fonts\/([^)]+\.woff2)\)/.exec(list);
        const data = w ? urls.get(w[1]) : undefined;
        return data ? `src:url(${data}) format("woff2")` : `src:${list}`;
      });
    })();
  }
  return katexInlined;
}

/** Rules for paged output (9.3). */
function printCss(pdf: PdfSettings | null): string {
  if (!pdf) return "";
  const size = pdf.pageSize === "custom" ? `${pdf.customWidth}mm ${pdf.customHeight}mm` : `${pdf.pageSize} ${pdf.orientation}`;
  return `@page { size: ${size}; margin: ${pdf.marginTop}mm ${pdf.marginRight}mm ${pdf.marginBottom}mm ${pdf.marginLeft}mm; }
@media print {
  html, body { background: var(--bg-color, #fff); }
  #write { max-width: none; }
  pre.md-fences, figure, table, .md-math-block, img { break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
  ${pdf.pageBreakBeforeH1 ? "#write > h1:not(:first-child) { break-before: page; }" : ""}
}`;
}

export interface PageParts {
  body: string;
  title: string;
  hasMath: boolean;
  hasCode: boolean;
  /** theme + user CSS, already rewritten (from Rust); "" for none */
  themeCss: string;
  /** false for "HTML (without styles)" */
  styled: boolean;
  head?: string;
  bodyEnd?: string;
  /** paged output (PDF, print) */
  pdf?: PdfSettings;
  /** front matter `lang` (13: also the HTML `lang`) */
  lang?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Minimal structure for "HTML (without styles)": math and tables only (9.2). */
const STRUCTURAL_CSS = `table { border-collapse: collapse; } th, td { border: 1px solid #ccc; padding: 4px 8px; }
.md-math-container { text-align: center; } img { max-width: 100%; }
.md-toc-item { display: block; } .md-toc-h2 { padding-left: 1.2em; } .md-toc-h3 { padding-left: 2.4em; } .md-toc-h4 { padding-left: 3.6em; } .md-toc-h5 { padding-left: 4.8em; } .md-toc-h6 { padding-left: 6em; }`;

/** The complete export page (9.1 item 5). */
export async function buildPage(p: PageParts): Promise<string> {
  const css: string[] = [];
  if (p.styled) {
    css.push(contentCss);
    if (p.hasCode) css.push(codeMirrorCss());
  } else css.push(STRUCTURAL_CSS);
  if (p.hasMath) css.push(await katexCssInlined());
  if (p.styled && p.themeCss) css.push(p.themeCss);
  // Bundled theme fonts the page uses, embedded (22, 9.1).
  if (p.styled) css.unshift(await bundledFontsCss(`${contentCss}\n${p.themeCss ?? ""}`));
  css.push("html, body { margin: 0; }");
  css.push(printCss(p.pdf ?? null));
  const styles = css
    .filter(Boolean)
    .map((c) => `<style>\n${c.replace(/<\/style/gi, "<\\/style")}\n</style>`)
    .join("\n");
  return `<!doctype html>
<html${p.lang ? ` lang="${escapeHtml(p.lang)}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
${styles}
${p.head ?? ""}
</head>
<body class="scrim scrim-export">
<div id="write">${p.body}</div>
${p.bodyEnd ?? ""}
</body>
</html>
`;
}
