# 06. Clipboard, drag and drop

## 6.1 Copy and cut

- Copy puts three flavors on the clipboard:
  1. `text/plain`: the **Markdown source** of the selection (Preferences → Editor →
     "Copy as Markdown by default", default on). When off, the rendered plain text.
  2. `text/html`: rendered HTML of the selection, styled minimally (no theme CSS), with
     images as absolute `file://` or remote URLs.
  3. Lossless round trip inside Scrim: the `text/html` flavor's root element carries
     `data-scrim-source="<base64 of the exact Markdown source>"`. (Custom clipboard MIME
     types are unreliable on WebKitGTK and unsupported by the Tauri clipboard plugin.)
     Read clipboard flavors from the DOM `paste` event's `DataTransfer`, which exposes
     `text/html` on both webviews.
- A selection that starts or ends inside an inline element copies the partial content
  with that element's markers included (selecting "ol" in `**bold**` copies `**ol**`).
- A selection inside one block copies only inline source (no block prefix).
- A selection that touches two or more blocks copies every touched block with its
  block syntax and container prefixes (`# `, `- `, `> `, fences); the first and last
  blocks contribute only their selected inline text after the prefix. Example: from the
  middle of list item 1 to the middle of item 3 copies `- end of one\n- two\n- start of three`.
- Explicit commands (Edit menu): Copy as Markdown (Mod+Shift+C), Copy as Plain Text,
  Copy as HTML Code (the HTML source as text).

## 6.2 Paste

Priority order of clipboard flavors:

1. `text/html` with `data-scrim-source`: insert that exact source and structure.
2. `text/html` (from browsers, word processors): convert to Markdown (turndown-style
   conversion, GFM tables, fenced code with language from `class="language-x"`), then
   insert as if typed as Markdown. Strip styles, scripts, comments, tracking images (1×1
   pixel). Keep links, images, emphasis, headings, lists, tables, code, blockquotes.
   Preference: "Paste HTML as plain text" (default off).
3. Image data (`image/png` etc.): saved per the image insert policy (6.4), then inserted
   as `![](path)`.
4. File list (copied files): images → inserted per 6.4; `.md` files → their text is not
   pasted, they are inserted as relative links; other files → relative links.
5. `text/plain`: parsed as Markdown and inserted. Pasting inside a code-like block or
   inline code always inserts the raw text.

- Paste as plain text (Mod+Shift+V): insert `text/plain` so that the **rendered** text
  equals the clipboard text exactly. Algorithm ("literal insertion", also used by
  find/replace): split on newlines into paragraphs; in each, backslash-escape every ASCII
  punctuation character that would otherwise change rendering in Scrim's dialect
  (check with the parser; when in doubt, escape; CommonMark allows a backslash before
  any ASCII punctuation). This covers emphasis/strike/highlight/sub/sup markers,
  backticks, `$`, brackets, `!`, `<`, `|`, `\`, the first `:` of emoji shortcodes, `&`
  that starts an entity, and every line-start block trigger (`#`, `>`, `-`, `+`, `*`,
  `1.`, fences, `---`). Leading spaces are dropped. Input rules do not fire. Inside
  code-like blocks it inserts the raw text.
- Pasting a URL while text is selected turns the selection into a link to that URL.
- Pasting block content into the middle of a paragraph splits the paragraph.
- Pasting into a table cell: multi-line content becomes `<br>`-joined text; pasting a
  tab-separated grid (from a spreadsheet) when the cursor is in a table fills cells
  rightward and downward, adding rows/columns as needed. Pasting a TSV grid outside a
  table creates a new table.

## 6.3 Drag and drop

- Dragging selected text inside the document moves it (Mod held: copies). One undo step.
- Dropping files from the file manager onto the document:
  - images: insert per 6.4 at the drop point;
  - `.md` files: open them (new window if the current one has unsaved changes or a
    different folder is open; setting decides "open in current window" otherwise);
  - other files: insert a relative link.
- Dropping a folder: open it as the sidebar folder.
- Dropping on the sidebar file tree: move/copy files into that folder (Mod = copy).
- A drop indicator line shows where the content will land.

## 6.4 Image insert policy (Preferences → Image)

Applies to pasted, dropped, and inserted local images.

| Option | Behavior |
|---|---|
| No special action | Reference the image where it is (relative path if in or below the document folder, else absolute) |
| Copy to current folder (`./`) | Copy next to the document |
| Copy to `./assets` | Copy into `assets/` next to the document (default) |
| Copy to `./<document-name>.assets` | Per-document assets folder |
| Copy to custom folder | User path; may use `{{name}}` (document name without extension) and `{{dir}}` (document folder) |
| Upload via command | Run a user command with the image paths; insert the URLs it prints, one per line (enables PicGo-style uploaders without bundling one) |

- Remote images pasted from the web are always referenced by their URL; Scrim never
  downloads them (`19-privacy-and-network.md`).
- Options: "Apply to local images" (default on), "Use relative path if possible"
  (default on), "Prefer `./` in relative paths" (default off), "Auto-escape image URLs"
  (encode spaces as `%20`, default on).
- Pasted image data without a name is saved as `image-YYYYMMDDHHMMSSmmm.png`. Name
  collisions get `-1`, `-2` suffixes.
- Unsaved (new) documents: images are copied to a temporary folder and moved to the
  policy folder on first save, rewriting the paths.
- The front matter key `image-folder` (string) overrides the policy folder for that
  document.
