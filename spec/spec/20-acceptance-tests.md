# 20. Acceptance tests

Behavioral tests. Automate them (WebDriver via `tauri-driver`, plus unit tests for the
parser/serializer) wherever possible; tests marked (manual) need a person. Notation:
`|` = cursor, `«»` = selection, `⏎` = Enter, `→` = "results in". "Source" = file text
after save. The **feature document** is `tests/fixtures/feature.md`, which the
implementation team writes to contain at least one instance of every construct in
`02-markdown-dialect.md` and every block in `04-blocks.md`.

## P0 Skeleton

- **S-1** Launch with a path: the file's text appears; window title is `<file name> - Scrim`.
- **S-2** Save writes the file atomically (kill -9 during save never leaves an empty or
  partial file; test with a large file and a fault-injection hook).
- **S-3** Launching a second instance with a path opens it in the first instance; the
  second process exits within 2 s.
- **N-1** Network: run the whole suite under a firewall that logs outbound connections;
  zero connections except to `127.0.0.1:<test-server>`.

## Round trip (part of P1; in P0, R-1 runs as the file-layer round trip: decode → text → encode, Q-002)

- **R-1** Corpus: open and save each file in `tests/corpus/` (the implementation team
  builds it: CommonMark spec examples, GFM spec examples, every construct in
  `02-markdown-dialect.md`, CRLF files, files without final newline, files with tabs,
  trailing spaces, BOM, Latin-1, mixed line endings, deeply nested lists, HTML-heavy
  files, 5 MB file). Source must be byte-identical.
- **R-2** For each corpus file, pick a word inside a **paragraph or heading** (not in
  code, tables, HTML, or front matter), replace it, save: the diff is exactly that
  word.
- **R-3** Toggle source mode on and off 10 times without editing: source unchanged.
- **R-4** Block-trigger escape: in a paragraph type `a`, Shift+Enter, then `#␣b` → the
  rendered paragraph shows "a" and "# b" on two lines; source `a\n\# b`; reopening the
  file shows the same paragraph (no heading). Repeat with `-␣x`, `+␣x`, `*␣x`, `>␣x`,
  `1.␣x`, `---`, `***`, `===`, `` ```js ``, `~~~`, `$$`, `<div>`: each gets an
  automatic escape and reopens unchanged. `***bold***` on a continuation line gets no
  escape. On a paragraph's first line, typing `[x]: https://a.b` (no Enter) keeps it
  visible as text (escaped `\[x]: https://a.b`); leading spaces on a first line are
  removed.
- **R-9** Automatic escapes are temporary: after R-4's `a\n\# b`, delete the `#` → the
  automatic `\` is deleted with it (source `a\n b`); type `#` again → the escape comes
  back. If the user types the backslash themselves (`\#`), deleting the `#` leaves their
  backslash in place.
- **R-5** Separators: a file with three blank lines between two paragraphs and
  whitespace-only lines; edit the second paragraph; the blank/whitespace lines are
  unchanged.
- **R-6** Container prefixes: a blockquote with a lazy continuation line and a list item
  whose continuation uses a tab; edit a word on another line of the same block; the lazy
  line and the tab are unchanged.
- **R-7** Table re-serialization: edit one cell in a table with pretty-printing on → the
  whole table is re-padded, nothing outside the table changes; with pretty-printing off
  → only that row changes.
- **R-8** Encodings after edit: CRLF file, Latin-1 file, UTF-8-with-BOM file; edit a
  word, save → line endings, encoding, and BOM preserved. Typing `€` into the Latin-1
  file and saving asks to save as UTF-8.

## P1 Core editing

- **E-1** Type `#␣Title` in an empty doc → an `h1` "Title"; source `# Title`.
- **E-2** Type `**bold**` then move the cursor away → "bold" in `strong`, no asterisks
  visible. Move the cursor back inside → asterisks visible in meta color.
- **E-3** Click on the word "bold" of a collapsed `**bold**`: cursor lands on the same
  letter that was clicked, after markers appear.
- **E-4** In an empty document type `-␣a⏎b⏎⏎` → list with items a, b, then an empty
  paragraph with the cursor; save → source `- a\n- b\n` (the empty trailing paragraph is
  not saved).
- **E-5** In list item `b|`, Tab → b nested under a (`- a\n  - b`); Shift+Tab → back.
- **E-6** Heading `## |Title` (cursor at the start of the text), Backspace → paragraph
  "Title".
- **E-7** Mod+B with «word» selected → `**word**`; again → `word`.
- **E-8** Undo an input rule: in an empty paragraph type `#␣` (it becomes an empty
  heading); Mod+Z → paragraph with text `# `; Mod+Z → empty paragraph.
- **E-9** IME (manual): type Japanese with an IME inside a strong element and at the
  start of a paragraph with `#`; no premature transformation, no lost characters.
- **E-10** Shift+Enter in a paragraph → displayed line break; source is a newline
  (setting on) or `\` + newline (setting off).
- **E-11** Auto-pair: type `(` → `(|)`; type `)` → `()|`. With «x» selected, type `"` →
  `"«x»"`.
- **E-12** Mod+K with «site» selected and `https://a.b` on the clipboard →
  `[site](https://a.b)|`.
- **E-13** Mod+click on `[x](#heading-two)` scrolls to "Heading Two".
- **E-15** Reveal edges: `a **bold** b`, cursor after "bold**" (collapsed). Left → cursor
  between "d" and `**`, markers visible. Left ×4 → just after the opening `**`. Left →
  before the opening `**`, collapsed. Typing "x" there → `a x**bold** b`.
- **E-16** Click boundary: clicking just left of "b" in collapsed `**bold**` puts the
  cursor after the opening `**` (typing "x" gives `**xbold**`).
- **E-17** Input rule on non-empty paragraph: in paragraph "Hello" put the cursor at its
  start and type `#␣` → heading "Hello".
- **E-18** (runs once P3's find bar exists) Keyboard routing: with the find bar focused, Mod+Z undoes typing in the find
  field, not the document; Mod+B does nothing. In WebView2, Ctrl+R and F5 do not reload.
- **E-19** (runs once P3's source mode exists) Undo across source mode: type "x" in live mode, switch to source mode, type
  "yz", switch back, Mod+Z once → "yz" gone, "x" still there; Mod+Z again → "x" gone.
- **E-14** Typing latency (automated perf): 200 keystrokes into a 10,000-line document,
  95th percentile < 16 ms. In CI it reports numbers only; the budget is enforced with
  `SCRIM_PERF_STRICT=1` when the owner runs it on a real laptop before P8 (Q-011).

## P2 Rich blocks

- **B-1** ` ```js⏎ ` → code block with language "js", cursor inside; typing code shows
  JS highlighting with `cm-keyword` on `const`.
- **B-2** Arrow Down from last code line → next paragraph; Up from paragraph below →
  last code line.
- **B-3** `$$⏎E=mc^2`, click outside → rendered formula; click formula → source editor
  appears with live preview.
- **B-4** `|a|b|⏎` → 2-column table with header a, b and one empty row; Tab cycles
  cells; Enter in last row adds a row; source is a padded pipe table.
- **B-5** Table toolbar: align center on column 2 → alignment row `:---:` for it.
- **B-6** Paste a PNG from the clipboard into a saved doc at `/x/doc.md` with policy
  `./assets` → file `/x/assets/image-<timestamp>.png` exists, source contains
  `![](assets/image-<timestamp>.png)`, image visible.
- **B-7** Task checkbox click toggles `[ ]`→`[x]` in source without moving the cursor;
  undo reverts.
- **B-8** `[toc]⏎` with three headings → TOC with three linked entries; editing a heading
  updates the TOC within 300 ms.
- **B-9** Footnote: hover `[^1]` → popover with definition text.
- **B-10** HTML block `<div style="color:red">hi</div>` renders red "hi"; clicking shows
  the source editor; `<script>` inside never executes.
- **B-11** Front matter `title: X` → window title "X - Scrim" (saved or untitled;
  "• X - Scrim" when dirty; Q-013).

## P3 Workspace

- **W-1** Open folder with 3 nested `.md` files → tree shows them; clicking opens.
- **W-2** Rename a file in the tree (F2) → renamed on disk; open document follows.
- **W-3** External edit to the open (clean) file → reloaded within 1 s, cursor kept.
- **W-4** External edit while dirty → bar with Reload / Keep mine.
- **W-5** Kill the app with a dirty untitled doc after the 30-second draft timer (or a
  window blur) has run → next launch offers recovery with the text intact.
- **W-6** Mod+P, type "nest" → nested.md first; Enter opens it.
- **W-7** Mod+Shift+F "needle" in a 10,000-file folder → first result < 500 ms; clicking
  selects the match in the opened file.
- **W-8** Find "bold" matches `**bo**ld`; Replace All "bold"→"x" in `**bold**` gives
  `**x**`.
- **W-9** Outline click jumps; dragging a heading in the outline moves its section.
- **W-10** Source mode toggle keeps the cursor on the same character and the same top
  line.
- **W-11** Focus mode dims all but the current block; typewriter mode keeps the cursor
  line centered.
- **W-12** Word count of "Hello, wörld! 你好" = 4 words.

## P4 Look and settings

- **T-1** Copy each owner-provided fixture theme (`tests/fixtures/themes/`, local and
  git-ignored, CLEAN-ROOM.md rule 7) into the theme folder → it appears in the Themes
  menu and renders the feature document; compare against owner-approved golden
  screenshots **of Scrim** (pixel diff ≤ 1% after the first approval).
- **T-6** Selector rewrite: a theme with `#typora-sidebar { background: red }` and
  `.typora-export h1 { color: blue }` → the sidebar is red; in HTML export the h1 is blue;
  `url("typora-bg.png")` and a string `"#typora-sidebar"` inside `content:` are
  unchanged.
- **T-7** Dark mode: with a separate dark theme set, switching the OS to dark switches
  the window theme live, cursor and scroll unchanged.
- **T-8** (P3 zoom + P4 settings) Zoom: Mod+Shift+= three times → 130%; restart → still 130%.
- **T-2** Edit `base.user.css` on disk → applied live.
- **T-3** Built-in "paper" theme matches the exact values in `22-visual-design.md` 22.2
  (font sizes, margins, paddings, column width, `--*` tokens) within 1 px / exact colors
  (automated computed-style test). Values marked approximate are not tested.
- **T-4** Preferences search "pair" shows only the two auto-pair options.
- **T-5** `shortcuts` `"Strong": "Ctrl+Shift+B"` in config.jsonc, saved → Mod+B no longer
  bolds, Ctrl+Shift+B does, without restart.

## P5 Output

- **X-1** HTML export of the feature document contains no `md-meta`, no `md-expand`,
  includes theme CSS and `base.user.css`, carries `body.scrim-export`, and code blocks
  have `.cm-s-inner` and `cm-*` tokens. Loaded in Scrim's own hidden webview at the
  editor's width, its screenshot differs from the editor's (all blocks collapsed, cursor
  in no block) by ≤ 2% of pixels.
- **X-2** PDF export produces a PDF with selectable text, correct page size and margins;
  code blocks shorter than a page are not split.
- **X-3** With pandoc installed, export to docx opens in LibreOffice with headings,
  lists, tables, images, and math intact. Without pandoc, menu items are disabled with
  the hint.
- **X-4** Import a docx → new untitled doc with images extracted per policy.
- **X-5** PDF header/footer: footer `{{page}} / {{pages}}` and a header `{{title}}` with
  title `日本語 ✓` on a 3-page doc → pages
  show "1 / 3", "2 / 3", "3 / 3".
- **X-6** Export with Previous (Mod+Shift+E) after an HTML export rewrites the same file.
- **X-7** Custom export command `cp {{input}} {{output}}` (Windows: `copy {{input}}
  {{output}}`) works on a document
  whose path contains spaces, a `'`, and (Windows) a `%`.
- **X-8** A document whose front matter sets `export: { html: { head: "<script>…" } }` or
  a custom command → ignored (no script in output, no command run).

## P6 Language

- **L-1** Linux with `hunspell-en_us` installed: "teh" underlined; context menu suggests
  "the"; choosing it replaces the word in one undo step.
- **L-2** Words in code, URLs, and front matter are never underlined.
- **L-3** No dictionaries installed → status bar shows the warning with the install hint;
  no errors.
- **L-4** Windows: German installed in Windows settings → selectable, works.

## P7 Personal features

- **K-1** Snippet body `<bottom>$0</bottom>`, no selection → `<bottom>|</bottom>`; typing
  "x" gives source `<bottom>x</bottom>`.
- **K-2** Same snippet with «hello» selected → source `<bottom>hello</bottom>` and
  «hello» selected afterwards; undo restores the original in one step.
- **K-3** Body `$$5 and $0 more` → `$5 and | more`.
- **K-4** Picker: query "rd" shows only "Red span" among ["Bottom", "Red span",
  "Price"]; Enter inserts it at the saved selection.
- **K-5** Snippet shortcut set in Customize works immediately; setting Ctrl+B shows
  "Also used by: Format → Strong".
- **K-6** Register inline tag `bottom` → existing `<bottom>x</bottom>` re-renders as an
  element; CSS `bottom{color:green}` in base.user.css colors it in editor and HTML
  export. Unregister → shows as literal text again.
- **K-7** Block tag `callout`: a line `<callout>hi</callout>` becomes an HTML block.
- **K-8** config.jsonc tab: saving `{ broken: [ }` is refused with a line/column error;
  file on disk unchanged.
- **K-10** Body `$$0` inserts the text `$0` (no cursor mark; cursor ends after it). Body
  `$$$0` inserts `$` with the cursor right after it.
- **K-11** Inline snippet over a two-paragraph selection wraps each paragraph's selected
  text separately.
- **K-12** Registering `script` or `iframe` as a custom tag is refused with "standard HTML
  element".
- **K-9** Snippet body using unregistered `<yuki>` shows the warning with Add buttons;
  "Add as inline" registers it and the warning disappears.

## Coverage additions

- **C-1** Copy "ol" inside `**bold**` → clipboard text `**ol**`.
- **C-2** Copy from the middle of list item 1 to the middle of item 3 → clipboard text
  `- end of one\n- two\n- start of three` (with the actual words).
- **C-3** Paste HTML from a browser page with a heading, a bold word, a link, a table →
  equivalent Markdown inserted.
- **C-4** Paste a 3×2 TSV grid with the cursor in a table cell → cells filled, table grown
  as needed. Outside a table → a new table.
- **C-5** Paste as plain text `*not bold*` → rendered text shows the asterisks; source
  `\*not bold\*`.
- **C-6** Drag a selected word to another paragraph → moved, one undo step.
- **D-1** Smart punctuation on: typing `"hi" -- ok...` displays curly quotes, en dash,
  ellipsis; source unchanged.
- **D-2** Emoji autocomplete: `:smi` → list contains smile; Enter → `:smile:` rendered.
- **D-3** Inline math on: `$x^2$` renders; off: literal text.
- **D-4** Insert footnote → `[^1]` at cursor, definition at end, cursor in definition.
- **D-5** Image zoom 50% → source becomes `<img src="…" style="zoom: 50%">`; Original
  size → back to `![](…)`.
- **D-6** Autosave on: edit a saved doc, wait 1.5 s → file on disk updated.
- **D-7** Save As to another folder with relative images → the three-way prompt appears;
  "Update image paths" rewrites them correctly.
- **PF-1** Open a 1 MB file < 2 s; toggle source mode < 300 ms on 10,000 lines; sidebar
  with 5,000 files < 1 s.
- **P8-1** (Ship) AppImage, .deb, PKGBUILD, and Windows installer each install, launch,
  open a file by double-click / "Open with", and uninstall cleanly; the binary contains
  no HTTP client crate (N-1 CI check).
- **KB-1** Copy/paste reach the DOM: with focus in the document, Mod+C then Mod+V
  round-trips `**bold**` with structure (via `data-scrim-source`); Edit → Copy and Edit →
  Paste from the menu do the same through the Rust clipboard path.
- **KB-2** On a Russian layout, Mod+B (the key labeled И / B) toggles strong. On a German
  layout, Mod+Shift+` and Mod+[ are reachable at the US key positions.
- **KB-3** Capture: focus a snippet's shortcut field and press Ctrl+B → captured as
  `Ctrl+B` (no bold applied anywhere), with the "Also used by: Format → Strong" warning.
- **KB-4** One keypress, one command: Mod+B in the document toggles strong exactly once
  even though both the native accelerator and the DOM keydown fire (Windows).
