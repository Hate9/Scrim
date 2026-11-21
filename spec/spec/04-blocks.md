# 04. Blocks

For each block: what it looks like, how it is edited, and what it writes. DOM class names
in this file are part of the theme contract (`10-themes.md`).

## 4.1 Paragraph

Rendered as `p`. Inline content per `05-inline.md`. An empty paragraph shows a blinking
cursor and has the normal line height.

## 4.2 Headings

- Rendered as `h1`…`h6` with an `id` attribute (slug, `02-markdown-dialect.md`).
- No `#` marks are shown. When the cursor is in a heading, a small level indicator MAY
  appear in the left margin (`H2` in `--heading-char-color`); it is not part of the
  text and not selectable. Default: shown.
- Setext headings (`Title` + `===`) render the same and keep their setext form when
  edited. Changing a setext heading's level to 3–6 converts it to ATX.
- Empty headings are allowed (Mod+2 on an empty paragraph) and are written as `## `.

## 4.3 Blockquote

- Rendered as `blockquote` containing child blocks. Any block may be inside, including
  nested quotes.
- Typing `>␣` inside a quote's empty paragraph nests one level deeper.
- GFM alert syntax (`> [!NOTE]`) is rendered as an ordinary quote (no special styling
  required in v1).

## 4.4 Lists

- Bullet lists render as `ul`, ordered lists as `ol` with the `start` attribute if not 1.
- Items render as `li`. Tight lists (no blank lines between items) contain inline text
  directly in each `li`'s paragraph without margins; loose lists use normal paragraph
  spacing. Theme contract: the `ul`/`ol` gets class `md-list-loose` when loose.
- Ordered list numbers display sequentially from `start` regardless of the numbers in
  the source; the source numbers are preserved unless the item is edited structurally
  (moved, added, removed), in which case the list is renumbered in its original style
  (all `1.` lists stay all `1.`; sequential lists stay sequential).
- Moving items: Alt+Up / Alt+Down moves the current item (with children) among its
  siblings. (Also moves table rows, `4.7`; elsewhere moves the whole block.)
- Changing type: Mod+Shift+[ toggles ordered list, Mod+Shift+] toggles bullet list,
  Mod+Shift+X toggles task list. Toggling on a selection of paragraphs makes one list of
  them; toggling off lifts the items to paragraphs.
- Task items: `li` gets class `task-list-item`, contains a real `input type=checkbox`
  before the text. Clicking the checkbox toggles `[ ]`/`[x]` in the source (one undo
  step) without moving the cursor. Checked items get class `task-list-done`.

## 4.5 Code blocks (fenced and indented)

- Rendered as a container `pre.md-fences` holding a CodeMirror 6 editor. The container
  carries `lang` attribute with the language name. Theme contract: syntax tokens use
  classes `cm-keyword`, `cm-string`, `cm-comment`, `cm-number`, `cm-def`, `cm-variable`,
  `cm-variable-2`, `cm-variable-3`, `cm-property`, `cm-operator`, `cm-meta`, `cm-tag`,
  `cm-attribute`, `cm-atom`, `cm-builtin`, `cm-qualifier`, `cm-bracket`, `cm-link`,
  `cm-header`, `cm-quote`, `cm-hr`, `cm-error` (map CodeMirror 6 highlight tags to these
  classes so existing themes color code).
- **Language box**: when the cursor is in the block (or the mouse hovers it), a small
  text input appears at the bottom-right corner showing the language ("lang" placeholder
  when none). Typing in it offers an autocomplete list of supported languages (fuzzy, by
  name and alias); Enter or click commits, changing the fence info string. Escape returns
  to the code.
- **Copy button**: optional (Preferences → Markdown → "Show copy button on code blocks",
  default off) icon at the top-right that copies the code text.
- **Line numbers**: Preferences → Markdown → "Display line numbers in code blocks",
  default off.
- **Line wrapping**: Preferences → Markdown → "Wrap lines in code blocks", default on. Off
  gives horizontal scroll inside the block.
- Indented code blocks render identically (no language box; typing a language converts
  them to fenced).
- Arrow keys: Up from the first line of the code moves to the previous block; Down from
  the last line to the next block; Left at position 0 to the end of the previous block;
  Right at the end to the next block. If there is no next block, one empty paragraph is
  created.
- Highlighting is lazy: the language package loads on first use; until it loads, the
  code shows unhighlighted.

## 4.6 Math blocks

- Rendered as `div.md-math-block` containing the rendered formula
  (`div.math-display` / KaTeX output), centered.
- **Editing**: clicking the rendered formula or arrowing into it opens an edit state:
  a CodeMirror editor with the LaTeX source (`div.md-math-source`, monospace) appears
  above the rendered formula, which updates live (debounced 150 ms) as the user types.
  Leaving the block (click elsewhere, Escape, arrow out) closes the editor.
- Render errors show the source in red monospace with the KaTeX error message as a
  tooltip; the document still saves the source unchanged.
- Numbered equations: `\tag{…}` works as KaTeX supports. Auto numbering is a
  Preferences → Markdown option ("Auto-number math equations", default off): when on,
  each display equation without `\tag` gets `(n)` numbering in document order.
- Inline math has the same renderer; errors render as red source text.

## 4.7 Tables

- Rendered as `figure.md-table-fig` containing `table` (with `thead`/`tbody`, `th`/`td`).
  Cells contain inline content.
- Column alignment from the alignment row is applied as `text-align` on cells.
- **Table toolbar**: when the cursor is inside the table, a toolbar appears just above
  the table's top-left corner with: a size button (shows a grid picker to resize the
  table to R×C), align left / center / right for the current column, and a "more" menu
  with: insert row above/below, insert column left/right, delete row, delete column,
  move row up/down, move column left/right, copy table as Markdown, format table source
  (realign the source padding), delete table.
- Keyboard: Tab/Shift+Tab move between cells; Enter moves down (adds a row at the end);
  Mod+Enter inserts a row below; Alt+Up/Down moves the row; Alt+Left/Right moves the
  column; Mod+Shift+Backspace deletes the row.
- Header cells can't be deleted as a row (the header row is mandatory); "delete row" on
  the header deletes the table after confirmation if there are no body rows.
- Pipes typed inside a cell are written escaped as `\|`.
- Insert table: Mod+T opens a small dialog (rows, columns; default 3 columns × 3 rows
  including header) and inserts it after the current block.
- Writing: re-serialized tables pad columns so pipes align (setting "Pretty-print tables
  when edited", default on). Off: minimal `| a | b |` without padding.
- Column widths are determined by content; a table wider than the column scrolls
  horizontally inside its figure.

## 4.8 Images

- An image is inline (`05-inline.md`), but a paragraph whose only content is one image is
  an **image paragraph**: the image is centered (theme dependent) and may be large.
- Rendering: `img` with `src` resolved relative to the document's folder (or to the
  front matter key `root-url` if present, see 4.11). Remote
  `http(s)` images load directly (they are document-requested resources). Missing images
  show a broken-image placeholder box with the alt text and path.
- Source reveal per `03-editing-model.md` 3.2.
- **Resizing**: a size can only be given with HTML (`<img src="a.png" width="50%">`);
  non-CommonMark attribute syntax like `![](a.png){width=50%}` is not supported.
  Right-click → Zoom → 25/33/50/67/80/100/150/200% rewrites the image as an HTML
  `<img>` with `style="zoom: N%"`; "Original size" converts back to `![]()` syntax.
- Click on a rendered image selects it (outline); double-click opens it in the system
  image viewer. Hovering shows the path tooltip.
- **Insert image** (Mod+Shift+I): file dialog; inserts `![](path)` where path follows the
  image insert policy (`06-clipboard-and-dnd.md` 6.4).
- Animated GIF and SVG are supported. Videos via `<video>` HTML render as HTML.

## 4.9 Thematic break

`hr`. Selected as a unit by clicking it or by Backspace from the block after it.

## 4.10 HTML blocks

- Rendered as `div.md-htmlblock` containing a sanitized preview of the HTML
  (`div.md-htmlblock-container`). Sanitization: remove `script`, inline event handlers,
  `javascript:` URLs, `iframe` (unless Preferences → Markdown → "Allow iframes" is on,
  default off; if on, iframes load in a sandbox without scripts unless the
  domain is in the user's allowlist in `config.jsonc`), `object`, `embed`. Allowed
  tags: standard HTML formatting and structure elements plus custom tags
  (`17-custom-tags.md`).
- `<style>` blocks are applied but scoped to `#write` (prefix each selector) so a
  document cannot restyle the app chrome.
- **Editing**: clicking the preview (or arrowing into it) shows a CodeMirror editor
  (HTML mode) with the source above the live preview; leaving closes it. Comments
  `<!-- -->` alone render as a faint "HTML comment" placeholder line (theme class
  `md-comment`), not hidden, so they can be edited.
- Unclosed or malformed HTML is shown with its preview and the source kept verbatim.

## 4.11 Front matter (YAML)

- Only at the start of the document. Rendered as `pre.md-meta-block` holding the YAML as
  plain text: monospace, no syntax highlighting (themes color the block as a whole;
  10.3). Always editable (no preview).
- Recognized keys (all optional): `title` (window title, export title), `root-url`
  (base for resolving relative image paths), `image-folder` (image insert folder,
  `06-clipboard-and-dnd.md` 6.4), `lang` (spell check language and HTML `lang`,
  `13-spellcheck.md`), `export` settings overrides (`09-export-import.md` 9.6). Others
  are ignored but preserved.
- Insert: Paragraph menu → YAML Front Matter, or `---`⏎ on the first line.

## 4.12 Table of contents

- A paragraph that is exactly `[toc]` renders as `div.md-toc` > `p.md-toc-content`
  containing one `span.md-toc-item` per heading (plus class `md-toc-h1`…`md-toc-h6` for
  indentation), each wrapping `a.md-toc-inner` that links to the heading (theme
  contract, `10-themes.md`).
- Updates live as headings change. Clicking an entry jumps to the heading. The cursor
  can select the TOC as a unit; Enter or double-click shows its source `[toc]` for
  editing.

## 4.13 Footnotes

- References render as superscript `sup.md-footnote` with the label (or number in
  document order if Preferences → Markdown → "Number footnotes" is on, default on).
- Definitions render at their source position as `div.md-def-footnote` with the label,
  text, and a `↩` back link. (They are not moved to the end in the editor; export
  collects them at the end.)
- Hover over a reference shows a popover with the definition text rendered.
- Insert footnote: Format menu → Footnote: inserts `[^n]` at the cursor (n = next free
  number) and a definition `[^n]: ` at the end of the document, putting the cursor in
  the definition. Escape returns to the reference.

## 4.14 Link reference definitions

`[label]: url "title"` lines render as a small muted line (`div.md-def-url`) showing
label and URL. They are editable as text.

## 4.15 Diagrams (deferred)

Code blocks with language `mermaid` render as normal code blocks until a post-v1
release adds diagram rendering (a live preview under the code, using the open-source
mermaid library).
