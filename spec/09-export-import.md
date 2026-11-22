# 09. Export, import, print

File → Export submenu: **PDF**, **HTML**, **HTML (without styles)**, then pandoc formats
(9.4), then custom commands (9.5), then **Export with Previous** (Mod+Shift+E, repeats
the last export to the same path) and **Export Settings…**. Export never modifies the
document.

## 9.1 Export pipeline (shared)

1. Render the whole document to HTML using the same renderer as the editor, in
   **collapsed state** (no markers, no `md-expand`, no edit UI, no toolbars, no
   placeholders, no spellcheck marks, no search highlights).
2. Math is rendered to static KaTeX HTML + the KaTeX CSS (inlined). Code blocks are
   rendered as static markup that carries the **same classes themes target in the
   editor**: `pre.md-fences[lang]` > `div.cm-editor.CodeMirror.cm-s-inner` >
   `div.cm-content.CodeMirror-lines` > one `div.cm-line.CodeMirror-line` per line, with
   `span.cm-*` tokens. This is the same element structure the editor produces with
   CodeMirror 6 (`10-themes.md` 10.3), so theme rules match identically in both.
3. TOC, footnotes (collected into a footnotes section at the end, `section.footnotes`),
   heading IDs, emoji, custom tags are all rendered.
4. Images: for PDF, local images and theme assets use `scrim-file` URLs (the PDF page is
   loaded in Scrim's webview, `01-architecture.md` "Local files in the webview"); for
   HTML, per export setting: keep relative paths (default), or embed as base64 data URLs.
   Relative `url()`/`@import` in inlined theme CSS are rewritten to absolute `file://`
   URLs (or embedded as data URLs when "embed assets" is on) so they still resolve from
   the export's location.
5. The document is wrapped in
   `<html><head>…</head><body class="scrim-export"><div id="write">…`. The `<title>` is
   front matter `title`, else the first `h1`, else the file name.
6. Theme and user CSS go through the compatibility selector rewrite (10.3) before being
   inlined.

## 9.2 HTML

- **HTML**: includes the current theme's CSS + `base.user.css` + `<theme>.user.css`,
  inlined in `<style>`, with theme-relative URLs (fonts, images) rewritten to absolute
  `file://` or embedded per the "embed assets" setting.
- **HTML (without styles)**: no theme CSS, only a minimal structural stylesheet for
  math and tables.
- Export settings for HTML: extra `<head>` content (string), content appended at the end
  of body (string), embed images (bool), theme to use (current / specific / none).

## 9.3 PDF and print

- The export HTML is written to a temp file in the recovery/temp folder and loaded in a
  hidden webview through the `scrim-file://` protocol (`01-architecture.md`, "Local files
  in the webview"); then the platform print-to-PDF facility runs (WebView2
  `PrintToPdfAsync` on Windows; WebKitGTK print operation to a PDF file on Linux, driven
  from Rust via the webview handle).
- Settings: page size (A4, Letter, Legal, A3, A5, custom mm), orientation, margins
  (top/bottom/left/right mm, default 18/18/16/16), "Page break before each h1" (default
  off), theme for PDF (default current).
- **Header and footer**: neither webview supports templated headers/footers with page
  numbers, so Scrim stamps them onto the finished PDF in Rust by editing it with `lopdf`
  (or an equivalent crate that can modify existing PDFs): text templates with
  `{{title}}`, `{{page}}`, `{{pages}}`, `{{date}}` placeholders, left/center/right slots,
  9 pt, placed inside the top/bottom margins. The text is set in the bundled Noto Sans
  (Latin, Greek, Cyrillic), falling back to the system's sans-serif fonts for anything
  it lacks (CJK, symbols), the same fallback the document body uses. Used glyphs are
  subset and embedded into the PDF. No CJK font is bundled (Q-024). Defaults: header empty, footer center
  `{{page}}`. The webview's own headers/footers are disabled.
- Code blocks and tables avoid breaking inside when shorter than one page
  (`break-inside: avoid`). Headings avoid page breaks right after them.
- File → Print (no default shortcut) opens the native print dialog for the same export
  HTML.
- If the platform cannot produce PDF directly, fall back to the system print dialog with
  "Print to File" preselected, and tell the user.

## 9.4 Pandoc

- Pandoc is detected on `PATH` (or a user-set path in Preferences → Export) when the
  Export menu opens. If missing, pandoc formats are listed but disabled with the note
  "Requires pandoc", and "How to install pandoc…" opens a short local help page.
- Export formats via pandoc: Word (`.docx`), OpenDocument (`.odt`), RTF, EPUB, LaTeX
  (`.tex`), MediaWiki, reStructuredText, Textile, OPML, Org, plain text.
- **Export invocation**: write the document Markdown to a temp file; run pandoc with an
  argument vector (never a shell string):
  `pandoc <tmp> -f gfm+tex_math_dollars+footnotes+yaml_metadata_block<extras> -o <out> --resource-path=<doc dir>`
  where `<extras>` adds `+hard_line_breaks` when "Preserve single line breaks" is on,
  `+mark` when highlight is on, `+emoji` always, `+superscript+subscript` when those
  extensions are on. Before handing the text to pandoc, Scrim pre-processes what pandoc
  doesn't understand: `[toc]` is replaced by a generated nested list of heading links,
  and custom/inline HTML is kept as raw HTML. Per-format options: Word may use a
  reference docx from settings; EPUB takes cover image and metadata from front matter.
  Timeout 120 s; progress notification; pandoc's stderr shown on failure.
- **Import** (File → Import…): pandoc-readable files (docx, odt, rtf, epub, html, latex,
  rst, textile, mediawiki, org, opml) are converted with
  `pandoc <in> -t gfm-tex_math_gfm+tex_math_dollars+footnotes --wrap=none --extract-media=<dir>`
  where `<dir>` is the image insert policy folder relative to where the result will be
  saved; the result opens as a new untitled document.
- HTML files can also be imported without pandoc using the built-in HTML→Markdown
  converter (`06-clipboard-and-dnd.md` 6.2).

## 9.5 Custom export commands

Export Settings lets the user add commands: name, output extension, and a command
template with placeholders `{{input}}` (document path), `{{output}}` (chosen output
path), `{{dir}}` (document folder), `{{name}}` (document file name without extension).
The document is saved first. Listed under Export after the pandoc formats.

- Linux: run `sh -c <template>` with each placeholder replaced by its value in POSIX
  single quotes (`'` inside becomes `'\''`).
- Windows: `cmd /C` can't safely quote `%` inside quotes, so Scrim builds the command
  line itself and passes it with `CommandExt::raw_arg` (Rust's normal argument escaping
  would double-escape it): each placeholder value is wrapped in double quotes, and every
  `%`, `^`, `&`, `|`, `<`, `>`, `(`, `)`, `!`, `"` inside it is caret-escaped.

## 9.6 Per-document export overrides

Front matter `export:` may override **page and formatting settings only**: PDF page size,
orientation, margins, header/footer templates, page break before h1, theme name, embed
images. It may **not** set custom commands, extra head content, appended body content,
or the pandoc path (a document must never be able to run commands or inject scripts).
Example: `export: { pdf: { pageSize: Letter, header: "{{title}}" } }`. Keys mirror the
Export Settings field names in camelCase.
