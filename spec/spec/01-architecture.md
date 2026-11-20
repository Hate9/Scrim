# 01. Architecture

Normative requirements use MUST/SHOULD. "Recommended" design notes are advice from the
spec team: deviate if you have a better design that meets the requirements, and note
why in your repo's `DESIGN.md`.

## Identity

- Product name: **Scrim**, after the theatre fabric that hides or reveals what is behind
  it depending on the light, the way the editor hides or reveals Markdown syntax
  depending on where the cursor is.
- Display name `Scrim`; package/binary name `scrim`; app id
  `io.gitlab.sistersvibecode.Scrim` (one id for Tauri, desktop file, AppStream, D-Bus;
  QA-LOG Q-001). Keep each in one constant so a rename stays a
  three-line change.
- Config directory: Linux `~/.config/scrim/`, Windows `%APPDATA%\scrim\`.
- The spec says "the editor" in prose; it always means Scrim.

## Stack

- **Shell**: Tauri 2 (Rust backend, system webview: WebKitGTK on Linux, WebView2 on
  Windows).
- **Frontend**: TypeScript, bundled with Vite. No UI framework is required; a small one
  (Solid, Preact, Svelte) is acceptable for chrome such as preferences and dialogs.
- **Editor core**: ProseMirror. Recommended reasons: it renders real semantic elements
  (`h1`, `p`, `blockquote`, `ul`, `table`), which the theme contract requires
  (`10-themes.md`); it has a mature transaction, selection, and undo model.
- **Code inside documents and source mode**: CodeMirror 6 (embedded as ProseMirror node
  views for code blocks, math source, HTML source, front matter; standalone for source
  mode).
- **Markdown parsing**: markdown-it with plugins, or micromark/mdast. Whichever is used
  MUST expose source positions for every block (start and end offsets) so round-trip
  fidelity is possible.
- **Math**: KaTeX (fast, synchronous, small). Fall back to showing the source with an
  error style when KaTeX cannot render an expression.
- **Syntax highlighting in code blocks**: CodeMirror 6 language packages, loaded lazily.
- **Search in files**: Rust, using the `ignore` and `grep` crates (ripgrep's libraries).
- **File watching**: Rust `notify` crate.
- **Spell check**: Rust (see `13-spellcheck.md`).
- **Pandoc**: external `pandoc` executable, never bundled (see `09-export-import.md`).

## Process model

- One Tauri app process. Each document window is a separate webview window.
- The Rust side owns: file IO, atomic saves, file watching, directory listing, search,
  spell check, pandoc invocation, settings persistence, single-instance handling,
  recent-files list, draft recovery store, the native menu.
- The frontend owns: the editor, rendering, sidebar UI, dialogs, preferences UI.
- IPC: Tauri commands (request/response) and events (push). All commands are
  async; none may block the UI thread.

### Single instance

Launching the app while it is running MUST hand the command-line arguments (paths) to
the running instance, which opens them (focusing an existing window if that file is
already open), and the second process exits. On Linux use a per-user socket or D-Bus;
on Windows a named pipe. Tauri's single-instance plugin is acceptable.

## Document model

### Required properties

1. **Byte-identical round trip.** `serialize(parse(text)) == text` for any input,
   including unusual whitespace, CRLF line endings, tabs, trailing spaces, HTML,
   reference definitions, and constructs the editor does not understand.
2. **Local edits stay local.** After an edit, every block the user did not touch
   serializes exactly as it was read.
3. **Style memory.** When a block is re-serialized, it keeps its original style choices:
   bullet character (`-`, `*`, `+`), ordered delimiter (`.` or `)`), starting number,
   emphasis character (`*` vs `_`), fence character and length, heading style (ATX `#`
   vs setext underline), indentation width of nested lists, table cell padding and
   alignment row form, trailing `#`s on ATX headings, hard-break style (two spaces vs
   backslash).
4. **Unknown is preserved.** Anything not recognized is kept as raw source in a block
   that renders as plain text (or as an HTML block if it is HTML).

### Recommended design: blocks as nodes, inline as source

- Block structure (paragraph, heading, list, list item, blockquote, code block, math
  block, table and cells, HTML block, front matter, hr, footnote definition, TOC,
  link reference definitions) is a ProseMirror node tree. Each block node carries the
  original source slice and style attributes from item 3.
- The text content of a textblock (paragraph, heading, table cell) is the **literal
  Markdown inline source** (for example `see **this** and [x](y)`). Inline formatting
  is computed by parsing that text after each change and is shown with ProseMirror
  decorations:
  - inline decorations with `nodeName` (`strong`, `em`, `code`, `del`, `mark`, `a`,
    `sub`, `sup`) so themes see the real elements;
  - syntax characters wrapped in decorations with class `md-meta` that hide them unless
    the cursor is inside the owning inline element (`03-editing-model.md`, "Syntax
    reveal");
  - widget decorations for rendered images, inline math, and emoji next to their hidden
    source.
- Consequences: cursor positions map 1:1 to source offsets inside a block, inline round
  trip is trivial, and undo works on source text.
- Serialization: a block whose node and content are unchanged since load emits its
  original slice verbatim. A changed block is re-emitted from its node type, its style
  attributes, and its inline source text.
- Decorations must keep a **stable DOM structure**: the marker spans and inline wrappers
  for an element exist whether or not it is expanded; expanding/collapsing toggles a
  class (`md-expand`) on the existing wrapper and CSS hides collapsed markers. Do not
  add/remove decorations on cursor movement (that re-creates text nodes and breaks IME,
  caret painting, and WebKitGTK selection). Nested inline decorations produce nested
  elements (`strong > a`), and ProseMirror may split an element around inner
  decorations; theme selectors in the contract must be tested against that structure.

### Round-trip model in detail

1. **Lines and terminators.** Every line terminator (`\n`, `\r\n`, `\r`) is stored with
   the line it ends, so mixed line endings survive. Inside a textblock, each newline
   character of the inline source carries metadata: its original terminator and the
   exact container prefix of the line that follows it (see 3). A newline the user
   creates gets the document's line-ending style and the container's continuation
   prefix.
2. **Blocks and separators.** A block's source is its lines **without** the terminator of
   its last line. The **separator** is everything from that terminator up to the first
   character of the next block's first line: the terminator, then any blank or
   whitespace-only lines, each with its own container prefix (`>` inside a quote) and
   terminator. Separators are stored as tokens and emitted verbatim. The **final
   separator** runs from the last block's end to EOF (empty when the file has no final
   newline). Canonical separators for new blocks: at top level, one terminator + one
   blank line + terminator; inside a container, the same but the blank line carries the
   container's prefix (`>` in a quote; nothing extra in a list item); between items of a
   tight list, just a terminator. **Empty paragraphs** (no text) serialize to nothing and
   contribute no separator; this is why a trailing empty paragraph never adds lines.
3. **Container prefixes.** Every line of a leaf inside containers records its exact
   prefix string: `> `, `>`, lazy continuation (no prefix), list continuation indent,
   tabs vs spaces. A re-emitted leaf keeps each surviving line's prefix (stored on the
   newline before it, item 1). A new line gets the container's **continuation prefix**
   (`> ` style used by the quote's other lines; the list item's content indent), never a
   list marker (`- `, `1. `). Line identity across splits and joins follows the newline
   characters: splitting a line inserts a new newline (continuation prefix), joining
   removes one (its prefix goes with it).
4. **Re-emission granularity.** Editing text inside a leaf re-emits only that leaf's
   lines. Structural edits re-emit the smallest affected unit: adding, removing,
   moving, or re-indenting a list item re-emits that item; converting a block type
   re-emits that block; wrapping/unwrapping a quote re-emits only the wrapped blocks'
   prefixes. Siblings and parents keep their original slices, except list renumbering
   (item 5), which changes only the marker text of affected siblings.
5. **List numbering style**, detected at load per ordered list: *sequential* (each
   number is the previous + 1), *all-same* (every item has the same number, e.g. all
   `1.`), or *irregular*. On adding, removing, or moving items: sequential lists renumber
   following items; all-same lists give new items the same number; irregular lists give
   a new item previous + 1 and change nothing else.
6. **Parse/display invariant.** After every transaction (outside IME composition; checked
   at composition end), every textblock's source must parse back as exactly that
   textblock, with the same type and displayed content. When an edit (typing, paste,
   deletion, Shift+Enter, replace) makes a line of a textblock parse as something else,
   the editor inserts a minimal **automatic escape**, but only when the parser confirms
   the line would actually change meaning. Triggers to check:
   - **Any line** (these can interrupt a paragraph): ATX heading (`#`…`######` + space,
     or `#letter` with strict mode off), fence openers (`` ``` ``, `~~~`), `$$` alone,
     thematic breaks (`---`, `***`, `___`, with spaces allowed between), setext
     underlines (`===`, `---` under a line), blockquote `>`, bullet items `-`/`+`/`*` +
     space + text, ordered items (`1.`/`1)` + space + text; any number when strict mode
     is off), HTML block starts of CommonMark types 1–6 (including custom block tags,
     `17-custom-tags.md`), a GFM table delimiter row under a line containing pipes.
   - **First line only** (these can only start, not interrupt): link reference
     definition (`[x]: url`), `[toc]`, footnote definition (`[^x]: `), HTML block type 7
     (any other complete tag alone on the line), and leading whitespace of 4+ columns.
   - Escape forms: a backslash before the trigger character (`\#`, `\>`, `\-`, `\+`,
     `\*`, `1\.`, `` \``` ``, `\~~~`, `\$$`, `\---`, `\===`, `\<div>`, `\[toc]`,
     `\[x]: url`, `\|`). Leading whitespace on a paragraph's first line is simply
     removed (CommonMark ignores it when rendering, so the display does not change).
   - Automatic escapes are remembered as automatic: deleting the escaped trigger
     character deletes its escape too, and an automatic escape that is no longer needed
     (the line no longer parses as a block) is removed. Backslashes the user typed are
     never touched.
   - `***bold***` is never escaped (it is not a thematic break). Tests R-4 and R-9.

### Undo across live and source mode

ProseMirror and CodeMirror have separate histories. Semantics:
- While in source mode, undo/redo use the CodeMirror history of that source-mode
  session only (starting at the moment the user entered source mode).
- When the user returns to live mode, if the text changed, the whole source-mode session
  becomes **one** ProseMirror undo step (replace changed range), so one undo in live mode
  reverts everything done in that source session.
- Entering source mode again starts a fresh CodeMirror history.

### Source positions and selection mapping

Every position inside a textblock maps to an offset in the file. Switching to source
mode (`15-view-modes.md`) and back MUST keep the cursor on the same source character, and
the same holds for scroll position (the block at the top of the viewport stays at the
top).

## Persistence

- **Saving** is atomic: resolve symlinks first and write to the link's target; write a
  temp file in the target's directory, fsync, then replace the original (Linux:
  `rename`; Windows: `ReplaceFileW`, which keeps ACLs and attributes). Preserve
  permissions, and on Linux also ownership (when permitted) and extended attributes. If
  the atomic replace fails (for example another process holds the file open on
  Windows), fall back to writing in place.
- **Encoding**: read with BOM detection; files without BOM are decoded as UTF-8 if
  valid, otherwise with a detected legacy encoding (chardet-style detection in Rust, for
  example `chardetng`). A file detected as windows-1252 that contains no byte in
  0x80–0x9F is treated as ISO-8859-1 (Q-004). Save in the encoding the file was read with, keeping the BOM
  if it had one. New files are UTF-8 without BOM. If the document contains characters
  the original encoding cannot represent, saving asks: "Save as UTF-8" (default) /
  Cancel; it never writes replacement characters silently.
- **Undecodable bytes** (invalid sequences in the detected encoding, Q-005): shown as
  U+FFFD with a notice bar on open. Saving without edits writes the original bytes
  unchanged; saving after an edit asks "Some bytes in this file could not be read and
  will be saved as �." (Save Anyway / Cancel).
- **Line endings**: detect on load (majority wins), save with the same. New files use
  the platform default from settings (default LF on Linux, CRLF on Windows, user
  configurable). Mixed files: lines the user did not touch keep their original endings.
- **Trailing newline**: preserve presence or absence of a final newline. New files end
  with one newline.

## Settings storage

- `settings.json` in the config directory: everything set through the preferences
  window. Written by the app only.
- `config.jsonc` in the config directory: advanced settings (JSON with comments),
  edited by the user (in the app's Customize pane or any editor). The app writes it only
  in three cases: creating the commented default on first run, "Reset Advanced
  Settings" (11), and saving the user's exact text from the Customize pane.
- `local.json` in the config directory: snippets, custom tags, picker shortcut
  (`16-snippets.md`, `17-custom-tags.md`). Written by the app.
- `themes/` in the config directory: user themes and `base.user.css`.
- `dictionary.txt`: personal spelling dictionary (`13-spellcheck.md`).
- `recovery/`: draft recovery store (`07-files-and-workspace.md`).
- `history.json`: recent files and folders.
- Settings changes made in one window apply to all open windows immediately.

## Local files in the webview

The app page is served from Tauri's app origin, where `file://` URLs do not load on
either WebView2 or WebKitGTK. Local images, media, theme CSS and fonts, and user CSS are
served by a Rust URI-scheme handler registered as `scrim-file`.

- **URL form differs per platform**: Linux `scrim-file://localhost/<percent-encoded
  absolute path>`; Windows `http://scrim-file.localhost/<percent-encoded absolute
  path>` (how WebView2 exposes custom schemes). The frontend MUST build these URLs only
  through one helper (Tauri's `convertFileSrc` with the `scrim-file` protocol), never
  by hand. CSP source per platform: `scrim-file:` on Linux,
  `http://scrim-file.localhost` on Windows (19).
- **Scope**: the handler serves (a) any file whose resolved absolute path is referenced
  by an open document (relative references resolved against the document's folder or
  its `root-url`, including `../` paths outside the folder), (b) files under the
  sidebar's open folder, (c) the theme folder, (d) the temp/recovery image folder.
  Anything else gets 403 and a log line.
- **Theme and user CSS** are requested through the handler too, and the handler applies
  the compatibility selector rewrite (`10-themes.md` 10.3) while serving them. Relative
  `url()` and `@import` therefore resolve against the theme file's own `scrim-file` URL.
- **Exports**: HTML exports contain real relative paths or `file://` URLs (or data URLs
  when embedding). The PDF pipeline loads its HTML in Scrim's hidden webview and uses
  `scrim-file` URLs, like the editor (09).

## Keyboard routing

Native menu accelerators are live in Tauri (on Windows they fire in the message loop
before WebView2 sees the key), WebView2 has its own browser shortcuts, and copy/paste
must still reach the DOM. Rules:

1. **One dispatcher** in the frontend owns all commands. Keys arrive two ways: a
   capturing `keydown` listener in the webview, and native accelerator events from the
   menu (forwarded to the frontend). Both call the dispatcher with the normalized
   accelerator. **Deduplication**: one physical keypress may produce both; the
   dispatcher runs a command at most once per keypress (match on accelerator within
   100 ms, preferring whichever arrives first).
2. **Clipboard and text-editing keys have no native accelerators** and are never
   `preventDefault`ed in the webview: Mod+C, Mod+X, Mod+V, Mod+Shift+V, Mod+A, Mod+Z,
   Mod+Y, Mod+Shift+Z. The webview's native handling fires DOM `copy`/`cut`/`paste`
   events, where Scrim does its clipboard work (06), and ProseMirror/CodeMirror handle
   undo/select-all. Their menu items display the shortcut as label text only.
   - Menu-driven Edit → Copy/Cut/Paste (and the context menu) produce no DOM clipboard
     event, so they go through Rust: Copy/Cut build the same flavors in the frontend and
     write them with a Rust clipboard crate that supports HTML (for example
     `clipboard-rs`); Paste reads HTML/text/image/file-list from Rust and feeds the same
     paste pipeline as the DOM event.
3. **Focus-aware rules**:
   - Focus in the document: run the command.
   - Focus in a list/picker field (quick open, snippet picker, emoji list, language box,
     find bar while a result list is shown): that field owns Up, Down, Enter, Escape,
     Tab, Ctrl+P, Ctrl+N.
   - Focus in any other text field (find bar, preferences inputs, dialogs, the
     Customize pane's code editors): editing keys act on that field (they are DOM-native
     per rule 2); `Mod+S` in a Customize code tab saves that tab; formatting and block
     commands are ignored; file, window, and view commands still run.
   - A shortcut-capture field has focus: the dispatcher runs no command; native
     accelerator events are forwarded to the capture field as the captured combination.
4. **Webview defaults off**: WebView2 `AreBrowserAcceleratorKeysEnabled = false` (no
   Ctrl+P print, Ctrl+R/F5 reload, Ctrl+Shift+I, Ctrl+F find, Ctrl+± zoom). WebKitGTK: no
   reload or zoom bindings reach the page.
5. **Key identity** (capture, stored strings, menu display, matching):
   - Letters: if the key produces a single Latin letter without modifiers, use it
     (layout-logical, so AZERTY's A key is `A`). If the layout produces a non-Latin
     letter (Cyrillic, Greek, Hebrew…), use the US-QWERTY letter for `event.code`, so
     Mod+B stays reachable.
   - Punctuation and digits: when no Shift is held and `event.key` is ASCII punctuation
     or a digit, use it. Otherwise (Shift held, AltGr, dead keys, non-ASCII) use the
     US-QWERTY character for `event.code`. This makes Mod+[ reachable on German layouts
     (physical US position) and makes Mod+Shift+= work on WebKitGTK, which has no
     `navigator.keyboard.getLayoutMap()`.
   - Named keys (F1–F24, arrows, Enter, Tab, Space, Backspace, Delete, Home, End,
     PageUp, PageDown, Insert, Esc) use their names.
   - On Windows, Ctrl+Alt+<letter or punctuation> is AltGr on many layouts. The capture
     field shows a warning for such combinations, and Scrim's defaults avoid them
     (Ctrl+Alt+Space is safe).
   - Verify in P4 that native accelerators match the same combinations; where they don't,
     rule 1 still guarantees the DOM path.

## Performance budgets

| Operation | Budget |
|---|---|
| Keystroke to screen | < 16 ms at the 95th percentile on a 10,000-line document |
| Open a 1 MB Markdown file | < 2 s to first paint, interactive immediately after |
| Switch to source mode and back | < 300 ms on a 10,000-line document |
| Sidebar listing of a folder with 5,000 files | < 1 s, no UI freeze |
| Search in files over 10,000 files | streaming results, first result < 500 ms |

Large documents: if a file exceeds 5 MB, open it in source mode with a notice offering to
switch to live preview anyway.

## Logging

A rotating log file (`app.log`, max 2 MB, keep one previous) in the config directory.
Log startup, errors, file operations (paths only), and every blocked network request
(`19-privacy-and-network.md`). Never log document contents.
