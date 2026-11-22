# Design notes

Implementation decisions and deviations from the spec's "recommended" designs
(`spec/spec/01-architecture.md` asks for them here). Spec questions live in
`QA-LOG.md`.

## Repository layout

| Path | Contents |
|---|---|
| `crates/scrim-core/` | Platform-independent Rust: identity, config paths, encodings, line endings, atomic save, logging, settings. No GUI dependency, tested headless. |
| `src-tauri/` | Tauri 2 shell: windows, IPC commands, `scrim-file` protocol, webview hardening, single instance. |
| `src/md/` | Markdown layer, DOM-free: schema, parser, serializer, inline analyzer, HTML for the clipboard. |
| `src/editor/` | The live-preview editor: decorations, reveal, commands, escapes, clipboard, links, emoji, key dispatcher. |
| `src/app/` | Command table (ids and default keys) and the window chrome: sidebar, find bar, quick open, source mode, status bar, workspace behavior (external changes, autosave, recovery, view modes). |
| `src/app/customize.ts`, `src/app/local.ts`, `src/app/snippetpicker.ts`, `src/editor/snippets.ts`, `src/md/customtags.ts` | Snippets, custom tags, the Customize pane (16–18). |
| `src/app/spelling.ts`, `src/editor/spell.ts` | Spell check (13): language choice, marks, suggestions. |
| `src/export/` | Export (09): the static export page from the editor's DOM, settings and front matter overrides, the export/print/import controller, pandoc pre-processing. |
| `src/content.css` | Document content CSS shared by the editor and exports (the 10.3 base stylesheet and static rendering rules); `styles.css` has the editing mechanics. |
| `src/main.ts` | Window glue: load/save, dialogs, link opening, settings, wiring of the chrome. |
| `src/chrome.css` | Layout and look of the chrome, from the theme custom properties (10, 22.1). |
| `src-tauri/themes/`, `src-tauri/help/` | Built-in themes and help documents (written for Scrim). |
| `tests/corpus/` | Round-trip corpus (R-1). Marked `-text` in `.gitattributes` so git never touches line endings. |
| `tests/e2e/` | WebDriver acceptance tests (tauri-driver + WebKitWebDriver). |
| `scripts/` | Test wrappers (`e2e.sh`, `n1-network.sh`, `check-no-http.sh`) and generators. |
| `spec/` | The specification (read-only for the implementation team). |

## P8: performance and coverage

### Performance (spec 20, PF-1; QA-LOG Q-011)

Numbers from `tests/e2e/p8.mjs` and E-14 under Xvfb with software rendering (CI-like
container); they are reported, and enforced only with `SCRIM_PERF_STRICT=1` on real
hardware.

| Measure | Before P8 | Now | Budget |
|---|---|---|---|
| Open 1 MB (47,000 lines) | over 60 s | about 10 s (parse 4.9 s, of which mdast 4.6 s; view update 1.2 s; rest layout) | 2 s |
| Enter source mode, 10,000 lines | 2.2 s | about 180 ms warm (first switch about 1 s) | 300 ms |
| Leave source mode, 10,000 lines | 2.2 s | 100–130 ms | 300 ms |
| Sidebar, 5,000 files | about 2.5 s | about 235 ms | 1 s |
| E-14 typing p95, 10,000 lines | 37–62 ms | about 60 ms (layout-bound) | 16 ms |

What changed:

- The document parse builds block-level mdast only (inline constructs disabled; the
  inline analyzer handles each textblock). `src/md/blockonly.test.ts` checks that 699
  documents parse to the same model either way.
- `micromark-util-edit-map` is quadratic in the number of edits on large documents;
  `scripts/patch-deps.mjs` (postinstall) patches its `consume` to linear time, in both
  the production and development builds of the package.
- Per-block work avoids `doc.resolve`/`nodeAt` (linear scans of the parent's children):
  block decorations receive the parent and index, heading ids take a plain-text fast
  path, and the "clean again" check skips paragraphs with no Markdown characters.
- The sidebar tree is virtual above 1,000 rows (only visible rows are in the DOM).
- Source mode is an absolutely positioned layer over the live document, which stays
  laid out, so switching does not re-layout 10,000 blocks.
- Tried and reverted: `content-visibility: auto` on `#write > *` again made E-14 p95
  about 1,121 ms and the 1 MB open over 60 s in WebKitGTK.

Still over budget here: the 1 MB open (JavaScriptCore's mdast parse is most of it) and
E-14. Remaining options are a faster block parser (markdown-it, allowed by spec 01) and
viewport-only rendering (Q-011's last resort). Both need the measurements on real
hardware first.

### Coverage tests

C-1, C-2, C-5, KB-2 are unit tests (`clipboard.test.ts`, `keys.test.ts`); D-1, D-2, D-3
are end-to-end tests in `tests/e2e/p1.mjs`.

### Packaging (spec 00, 7.9; P8-1)

- `npx tauri build` makes the AppImage, .deb, MSI and NSIS installer (`bundle.targets`).
  `bundle.fileAssociations` registers `.md` and `.markdown` as `text/markdown` (role
  Editor): on Linux it goes into the desktop file's `MimeType`, on Windows into the
  installers' ProgId and "Open with" entries. Windows 10/11 keep the user's chosen default
  (UserChoice), so installing does not take over `.md`; P8-1 checks this by hand on
  Windows. The NSIS installer installs per user (no administrator prompt).
- The .deb recommends `hunspell-en-us` (spell check works without it, with "No
  dictionaries", L-3).
- Arch: `packaging/arch/PKGBUILD` builds a tagged release from source (`npm ci`,
  `tauri build --no-bundle`), runs `scripts/check-no-http.sh` in `check()`, and installs
  the binary, `packaging/linux/scrim.desktop` and the icons. Help documents, built-in
  themes and fonts are compiled into the binary, so nothing else is installed.
- The desktop file is ours (`packaging/linux/scrim.desktop`, the .deb's
  `desktopTemplate`): Tauri's generated one had `Exec=scrim` without `%F`, so a
  double-clicked file would not reach the app.
- Checked in the Linux container (2026-11-22): the release .deb installs (Depends
  `libwebkit2gtk-4.1-0, libgtk-3-0`, Recommends `hunspell-en-us`), GIO lists it for
  `text/markdown`, `gio open note.md` opens a window titled `note.md - Scrim`, and
  `dpkg -r` leaves no binary, desktop file or icon behind. The AppImage (about 83 MB,
  WebKitGTK bundled) carries the same desktop file and opens a file given on its command
  line. PKGBUILD and the Windows installers still need their P8-1 run on the target
  systems.

### Subscript, superscript, highlight (spec 02)

The inline analyzer (`src/md/inline.ts`, `delimited`) finds `==…==`, `^…^` and `~…~`
in the plain text of each nesting level after micromark's own inline parse, so code
spans, links and escapes hide markers, and the elements nest either way (`==**a**==`,
`**==a==**`). A marker is a run of exactly its width (`===` and `~~` are not markers;
`~~` stays GFM strikethrough). An opener is not followed by whitespace and a closer not
preceded by it; sub/superscript content has no unescaped whitespace, and `\ ` there is
an escaped space (an escape element). Wrappers follow 10.3: `md-inline` = `mark`, `sup`,
`sub`. Toggling any of these or inline math re-analyzes every block (not an edit).

### Writing style (spec 02, "Writing Markdown")

`src/md/style.ts` holds the preferences (bullet, emphasis and strong characters, heading
style), set by the app with the other settings. Format → Strong/Emphasis, Format →
List, pasted rich text (Turndown), and new headings at levels 1–2 use them; existing
source keeps its markers, and a heading typed as `# ` stays ATX. The code indent
(Preferences → Editor) is CodeMirror's indent unit and what Tab inserts in code blocks
and source mode; code blocks pick it up when they are created.

### Strict mode off (spec 02)

`src/md/lenient.ts` adds two micromark constructs, tried before CommonMark's when
`dialect.strict` (in `mdast.ts`) is false: `#Heading` produces CommonMark's ATX heading
tokens (CommonMark's resolver builds the content), and the ordered list construct runs
with a view of the tokenizer context in which "interrupting a paragraph" is hidden until
the marker, so any start number may interrupt while an empty item still cannot. Every
parse in the window (load, re-parse, escapes, paste) follows the setting. Changing it
takes the Markdown as written under the old dialect, then re-parses it (not an edit,
the dirty state is kept). With it off, typing a letter after `#`–`######` at the start
of a one-line paragraph makes the heading (`laxHeadingInputRule`); otherwise the
parse/display invariant would escape the `#`.

### Custom title bar (spec 11, Window style; 10.3 `header`)

Rust decides per new window (`windows::custom_title_bar`: the setting, else custom on
Windows and native on Linux), builds it without decorations, and loads
`index.html?frameless` so the page knows before its first menu build. The page
(`src/app/titlebar.ts`) fills `body > header`: a menu button (the native menu as a
popup at the button), the document title centered on the window (a click starts File →
Rename when the document has a file, 07), and minimize / maximize / close; the header
is the drag region and a double click maximizes. In that mode the menu is not the
window's menu bar and carries no native accelerators: the dispatcher runs every key from
the DOM (the global commands included, which it already handles). Colors come from the
theme's sidebar and control variables (10.4).

### `global:` shortcuts (spec 12)

Each window sends the `global:` entries of `config.jsonc` (command id → key) to
`hotkeys::global_shortcuts_set` after reading the config; Rust skips a map it already
applied, so registration happens once per change (tauri-plugin-global-shortcut, X11 key
grabs on Linux). A press runs the command in the document window that had focus last
(shown and focused first) through the `scrim://global-shortcut` event and the dispatcher;
with no window open it opens one, which picks the command up at startup
(`global_shortcut_take`). Keys that cannot be registered (taken by another program,
Wayland) are shown in the config notice and logged.

### Cursor blink (spec 11)

`src-tauri/src/caret.rs` sets GTK's `gtk-cursor-blink` at startup and when the
preference changes; WebKitGTK (and CodeMirror, which uses the native caret) follow it.
It logs the value GTK reports back, which the e2e test reads. WebView2 offers no caret
setting, so on Windows the system's blink setting applies.

### Smart punctuation (spec 03, D-1)

`src/editor/smart.ts`: in plain text runs (the `md-plain` presentation marks), each
replacement is a widget with the typographic character next to the source characters,
which take no space (`.md-smart-src`, font-size 0 like collapsed markers). A sequence
with the cursor inside (between the hyphens of `--`) shows its source. Quotes open after
the start, whitespace, opening brackets or dashes, and close otherwise (an apostrophe
closes); emphasis markers before a quote are skipped. Copy as plain text applies the
same replacements outside code; HTML export keeps the displayed characters.

## P7: personal features

### local.json (`src-tauri/src/local.rs`, `src/app/local.ts`)

Snippets, custom HTML tags, and the picker shortcut. Rust reads it (missing keys from
the defaults) and writes it atomically, pretty-printed, keeping unknown keys; the config
folder watcher reports any change, including external edits, as `scrim://local-changed`
to every window.

### Snippets (`src/editor/snippets.ts`, `src/app/snippetpicker.ts`)

The body is scanned left to right (`$$` → `$`, the first `$0` → cursor). Insertion works
on source offsets: within one textblock (inline body, plain text) it is a single
`insertText`; otherwise the selection becomes source ranges of the serialized document
(one range for a multi-line body, one per touched textblock for an inline body), the
body is applied to the text, the document is updated with `applyText` (one transaction,
one undo step, minimal block diff), and the selection is set from the precomputed source
offsets through the new source map. Multi-line bodies are indented to the list item's
content column. With a CodeMirror editor focused (code block, math, front matter, source
mode) the same rules insert literal text there. Snippet shortcuts are run-time dispatcher
commands with scope "editing" (live document or one of its CodeMirror editors); their
keys win over built-in ones. The Snippets menu lists them by name with their keys. The
picker saves the selection (ProseMirror or CodeMirror) when it opens and restores it
before inserting; Escape restores it.

### Custom HTML tags (`src/md/customtags.ts`)

A registry shared by the inline analyzer (registered inline names are elements like
`span`), the sanitizer (`ADD_TAGS` for HTML blocks; attributes are sanitized as for any
element), and the block parser: registered block names are appended to micromark's
CommonMark type-6 tag list (`micromark-util-html-tag-name`'s `htmlBlockNames`, the one
copy micromark reads), so a line starting with `<callout` starts an HTML block ending at
the next blank line, and removed again on unregistering. Names must match
`^[a-z][a-z0-9-]*$` and not be HTML, SVG, MathML, or obsolete element names. When the
registry changes, inline-only changes re-render every block (`rebuildInline`, the inline
analysis cache is keyed by the registry version); block changes re-parse the unchanged
text (cursor, scroll, and dirty state kept, not an undo step).

### Customize pane (`src/app/customize.ts`)

A Preferences section drawn by its owner (control kind `custom`), one DOM tree for the
window's lifetime so unsaved text survives switching tabs or closing Preferences.
Snippets & Tags saves 400 ms after the last change. Shortcut fields capture with every
app shortcut suspended (the dispatcher's `suspended` flag and a menu rebuild without
native accelerators), record layout-logical keys as `Ctrl+Alt+Shift+Super+Key`, and list
conflicts with menu items (with their menu path), other snippets, and the picker.
`base.user.css` and `config.jsonc` are CodeMirror editors; config is validated with the
JSONC parser before saving (the error carries line and column) and saved verbatim. Files
changed on disk reload silently, or ask when the tab has edits.

## P6: spell check

### Provider (`src-tauri/src/spell.rs`)

`SpellProvider` (languages, check, suggest, system locale) has two implementations.
Linux: Hunspell `.dic`/`.aff` pairs from `$DICPATH`, `~/.local/share/hunspell`,
`/usr/share/hunspell`, `/usr/share/myspell`, `/usr/share/myspell/dicts` (first location
wins; `hyph_*` and `th_*` files skipped), read in the encoding their `.aff` names (`SET`)
and checked with `spellbook` (pure Rust, MPL-2.0); a dictionary loads on first use and
stays cached. Windows: the Spell Checking API (`ISpellCheckerFactory`, languages
installed in Windows settings), COM initialized per worker thread. Tags are BCP 47
(`en-US`). "Auto": the locale's dictionary (`LC_ALL`/`LC_MESSAGES`/`LANG`, or the user
locale on Windows), then the first English one, then the first. The personal dictionary
`<config>/dictionary.txt` is Scrim's own on both platforms; it is re-read after Open
Personal Dictionary when the window is next focused. Checks and suggestions run on
blocking worker threads.

### Marks (`src/editor/spell.ts`, `src/app/spelling.ts`)

The words are those in text carrying a `md-plain` presentation mark: exactly the rendered
prose (link text included, autolink text excluded); code, math, URLs and destinations,
HTML tags, emoji shortcodes, markers, front matter, and code blocks have none. Tokens
with digits or underscores and all-caps words of up to five letters are skipped. Changed
blocks lose their marks and are queued; 300 ms after the last change the queued blocks'
distinct words go to Rust in one batch, and the result applies only if the text has not
changed since (presentation-mark updates do not count). The word under the cursor after
an edit stays unmarked until the cursor leaves it. Marks are inline decorations
(`span.md-spell-error`, wavy underline in `--spell-error-color`, default `#e5484d`);
exports strip them.

Language: front matter `lang` (matched exactly, else by primary language; also the
export page's `<html lang>`), else the setting (Preferences → Editor, Edit → Spell Check,
the status bar's language menu), else Auto. The status bar shows the code (`EN-US`) or ⚠
with the install hint. Context menu on a marked word: up to six suggestions (replace is
one undo step), Add to Dictionary, Ignore (this document, this session).

L-4 (German installed in Windows settings) is manual until a Windows machine is
available.

## P5: output

### Export page (`src/export/render.ts`, `src/export/document.ts`)

The export body is a copy of the editor's own DOM (9.1: "the same renderer as the
editor"), so every construct carries exactly the 10.3 structure themes target. The copy
is cleaned: markers and hidden source (`.md-meta`, `.md-hide`), the non-widget children
of replaced elements, source editors, language boxes, toolbars, comment placeholders,
link definitions, and front matter are removed; editing classes (`md-expand`,
`md-focus`, `ProseMirror-*`, search marks) and attributes (`contenteditable`, `data-el`,
…) are stripped. Links get their real `href` (the editor keeps it in `data-href`,
Q-012), TOC entries link to heading ids, footnote references become numbered links and
the definitions move into `section.footnotes` at the end. Soft breaks follow "Preserve
single line breaks". Code blocks are rebuilt (CodeMirror only draws visible lines) with
the editor's element structure and classes, including CodeMirror's generated theme
classes, and tokens from the same highlighter.

The page inlines, in the editor's order: `content.css`, CodeMirror's layer (the
`@layer scrim-cm` rules of the window, captured from its style sheets), KaTeX's CSS with
its woff2 fonts embedded (only when the document has math), then the theme,
`base.user.css`, `<theme>.user.css` from Rust (`export_theme_css`): compatibility
rewrite (10.3) and every `url()`/`@import` resolved against the sheet's folder
(`scrim_core::theme_css::map_urls`) as `file://` URLs (HTML), `scrim-file` URLs (PDF,
print), or data URLs ("embed assets"). Imported sheets are always inlined as data URLs,
so they get the rewrite too. `body.scrim.scrim-export > #write`. Title: front matter
`title`, else the first h1, else the file name.

Images: HTML keeps the path as written (default) or embeds data URLs
(`export_embed_image`, image files only); PDF and print keep the editor's `scrim-file`
URLs.

### Settings and per-document overrides

Flat keys in `settings.json` (`exportPdfPageSize`, `exportPdfMarginTop`,
`exportPdfHeaderCenter`, `exportHtmlEmbedImages`, `exportCustomCommands`, …; Preferences
→ Export). Front matter `export: { pdf: {…}, html: {…} }` overrides page size, custom
size, orientation, margins, page break before h1, theme, header and footer (a string is
the center slot, or `{left, center, right}`), and `embedImages`; nothing else is read
from a document (9.6, X-8). Custom commands run only if their template is in
`settings.json` (checked again in Rust).

### PDF and print (`src-tauri/src/pdf.rs`, `pdf_windows.rs`)

The page is written to `<config>/tmp-export/` and loaded in a hidden window (navigation
locked to that URL) through `scrim-file`. Only HTML files in that folder are served as
`text/html`; every other `.html` stays `application/octet-stream`, so local HTML is never
run as a page. 700 ms after the load event (fonts, late layout) the platform prints:
WebKitGTK `PrintOperation` to a file with a GTK page setup (paper size and margins in
mm) on Linux, WebView2 `PrintToPdf` with print settings (inches, backgrounds on,
headers/footers off) on Windows.

Header and footer: the page count is read from the printed PDF with `lopdf`, a second
page is laid out with one sheet per page (header and footer slots inside the margins,
9 pt, the bundled Noto Sans embedded as a data URL, system fonts as fallback, Q-024),
printed with no base background so everything else stays transparent, and each of its
pages is drawn over the matching export page as a form XObject (the page's own content
is wrapped in `q`/`Q` first). The PDF writer subsets and embeds the fonts; the text stays
selectable. Print (File → Print) opens the native print dialog on the same hidden page.

### Pandoc and custom commands (`src-tauri/src/pandoc.rs`, `src/export/pandoc.ts`)

Pandoc is found at the set path or on `PATH` when a window opens and when the path
setting changes; without it the formats are listed, disabled, followed by "Requires
pandoc" and "How to install pandoc…" (a help document). Export writes the Markdown to a
temporary file (with `[toc]` paragraphs replaced by a nested list of heading links) and
runs pandoc with an argument vector (`-f gfm+tex_math_dollars+footnotes+yaml_metadata_block…`,
`-t`, `-o`, `--resource-path`, optional `--reference-doc`), 120 s timeout, stderr shown on
failure. Import: `-t gfm-tex_math_gfm+…` when the installed pandoc knows `tex_math_gfm`
(pandoc 3.1.4 and later; older ones reject the name), media extracted to
`<config>/tmp-images/import-<time>/`, where untitled documents keep images until their
first save (6.4); the result opens as a new untitled, unsaved window. HTML imports
without pandoc go through the clipboard's HTML→Markdown converter. Custom commands:
`sh -c` with POSIX single-quoted values on Linux; `cmd /C` through `raw_arg` with
caret-escaped double-quoted values on Windows.

### Tests

X-1 compares the export page in an iframe of the document window with the editor at the
same size, with front matter, link definitions, and comment placeholders hidden in the
editor (QA-LOG Q-025). The iframe needs no CSP exception: its `srcdoc` page inherits the
window's policy, which allows the inline styles it uses. CI installs pandoc, poppler-utils, LibreOffice
Writer (X-3 converts the docx with `soffice --headless`), and `fonts-noto-cjk` (X-5).
`tests/fixtures/feature.md` is the feature document (20).

## P4: look and settings

### Themes (`src-tauri/src/themes.rs`, `src/app/themes.ts`, `crates/scrim-core/src/theme_css.rs`)

- The built-in themes (`src-tauri/themes/`: paper, clean, night, plain) are written from
  22.2–22.4 and installed into `<config>/themes/` on first run and when missing. A
  `.builtin-hashes.json` records the hash of each file as installed: a later version
  replaces a built-in file only while its hash still matches (the user has not edited
  it).
- Theme and user CSS load as `<link>`s after the app's CSS, in the order theme →
  `base.user.css` → `<theme>.user.css`. Their URLs are `scrim-file` URLs with real path
  segments (`convertFileSrc` makes the whole path one encoded segment, which breaks
  relative `@import` and `url()`). Swapping themes replaces the links after the new
  ones loaded: no reload, no flash, cursor and scroll untouched (T-7).
- The compatibility rewrite (10.3) runs in the `scrim-file` handler for CSS files in the
  theme folder (01 asks for it there), so `@import`ed files are rewritten too. It is a
  CSS Syntax 3 tokenizer plus the rule structure (style rules, conditional group rules,
  nesting), in scrim-core so P5's exports can use it. Only ID and class selectors in
  style-rule preludes change; everything else is copied byte for byte (tests: T-6 and
  `theme_css::tests`). The build flag is the cargo feature `theme-compat-rewrite`.
- The theme folder is watched; any change re-applies the theme in every window (T-2).
  "Use separate theme in dark mode" follows `prefers-color-scheme`. A theme that sets
  `--color-scheme: dark` gets `body.dark` and asks for the dark native title bar
  (unless the separate dark theme is on: then the system already chose).
- The base CSS keeps only mechanics and neutral fallbacks; colors and fonts come from
  the theme. CodeMirror token defaults use `:where(#write)` so `.cm-s-inner .cm-*` in
  any theme wins (10.3, "Code block theme hooks").

### Theme DOM contract (QA-LOG Q-018, 10.3)

- **Inline structure as presentation marks** (`src/editor/pres.ts`). Themes select on
  one wrapper per inline construct (`span.md-pair-s > span.md-meta.md-before + strong +
  span.md-meta.md-after`), `span.md-plain` around every plain run, `a > span.md-plain`,
  and so on. ProseMirror applies inline decorations per text piece, so a decoration
  cannot wrap differently decorated pieces in one element; marks can (ProseMirror renders
  adjacent text sharing a mark inside one element). The inline plugin computes the marks
  from the inline analysis and re-marks touched textblocks in an appended transaction
  (meta `scrim-pres`, `addToHistory: false`; progressive for large documents; frozen
  during IME composition). Mark steps are not structural, are skipped by the escape
  plugin, and never make the document dirty: the "back to the saved state" check compares
  serialized Markdown. Rendered replacements (images, emoji, inline math) remain widget
  decorations, placed inside their wrapper through the widget's `marks`.
- **Blocks** follow the 10.3 table in their `toDOM`s and node views: `p.md-p`,
  `md-end-block` on leaf blocks and table rows, `ul.ul-list[data-mark]`, `ol.ol-list`,
  `li.md-list-item` (task items with the checkbox as the item's first child, before its
  paragraph), `div.md-hr > hr`, `table.md-table` with `span.td-span` cells,
  `md-rawblock` containers for math and HTML (the math source editor is a
  `pre.md-fences` inside the block), footnote and link definitions with
  `md-def-name` / `md-def-content` parts. `md-focus` is on the leaf block holding the
  cursor and `md-focus-container` on its nearest list item (reveal plugin). The heading
  level hint is `hN.md-focus::before`.
- **CodeMirror 5 aliases** (`cmAliases` in `codeview.ts`): editor, scroller, content,
  lines, active line, cursor, selection, gutters; `cm-s-inner` in code blocks and
  `cm-s-scrim-default` in source mode (new rewrite-table row).
- **Base stylesheet** (`src/styles.css`, QA-LOG Q-019): the document-content base of
  10.3 with its selectors as listed, at their natural specificity and loaded before the
  theme, because themes are tuned against those exact rules (for example
  `blockquote > :last-child` beating a theme's plain `p` margins). It includes
  CodeMirror 5's default token palette under `.cm-s-inner` and `#write` padding. Editing
  mechanics (marker reveal, widgets, source editors, footnote numbering) follow it.
  Scroll past end is `#write::after`, so a theme's `#write` padding cannot remove it.
  Links keep a text cursor except while Mod is held or with single-click opening (Q-012,
  confirmed in Q-019). Scrim's look (colors, code tokens, borders) is in the built-in
  themes only.
- **CodeMirror fonts** (QA-LOG Q-020): `.CodeMirror-scroll` and `.CodeMirror-code`
  inherit `font-family`, `font-size` and `line-height`, so a theme's font on
  `.CodeMirror` (or on `pre.md-fences`) reaches the code; Scrim sets no font on the
  editor itself. Front matter gets no CodeMirror alias classes, so code block theme
  rules never reach it.
- **Code block wrapping** (QA-LOG Q-021): `pre.md-fences` has `white-space: normal`, so
  theme pseudo-elements with `content: ' '` collapse to zero height; CodeMirror's own
  content rule keeps the code lines' pre-style wrapping.
- **Horizontal rules** (QA-LOG Q-022): no base styling; `div.md-hr > hr` keeps the
  engine defaults. WebKitGTK shades the default `1px inset gray` border darker than the
  reference engine (`#2C2C2C`/`#D4D4D4` against `#9A9A9A`/`#EEEEEE`); accepted, no
  compensating rule (Q-023).
- **CodeMirror's injected styles** are wrapped in `@layer scrim-cm`
  (`src/editor/cmlayer.ts` wraps each style-mod module's rules before CodeMirror first
  mounts them), so unlayered theme CSS beats them at any specificity.

### Preferences (`src/app/preferences.ts`, `src/app/prefsections.ts`)

An overlay over the editor area, generated from a table of sections, groups, and
controls, so search (T-4) filters the same data it renders. Every change writes
`settings.json` through Rust, which tells every window (`scrim://settings-changed`).

### config.jsonc (`crates/scrim-core/src/config.rs`, `src-tauri/src/config.rs`)

Written fully commented on first run; read as JSONC (comments, trailing commas) and
overlaid on the defaults; the config folder is watched and every window reloads it
when the file is saved. A broken file keeps the defaults and shows the parse error.
`setting()` in the frontend falls back to config.jsonc, so `fileListLimit` works where
the sidebar asks for it; `iframeAllowlist` is read by the `scrim-embed` handler.

### Menus and shortcuts (`src/app/menu.ts`, `src/app/menutree.ts`)

- The menu bar is built per window with Tauri's JS menu API from one tree of labels and
  command ids. Clicks run commands through the dispatcher (`runId`, with the same
  cross-source deduplication as keys). The menu is rebuilt when shortcuts, themes, or
  recent files change; checkmarks update after edits (300 ms debounce).
- `shortcuts` in config.jsonc map English labels to accelerators. They are normalized
  to the dispatcher's form and applied with `Dispatcher.rebind`: an override takes its
  key from any default owner, and an empty string unbinds (T-5). `global:` entries are
  logged as unsupported for now.
- Native accelerators (QA-LOG Q-017): GTK runs them before the webview sees the key,
  regardless of focus. Only focus-independent commands (dispatcher scope `global`:
  file, window, view, app) get one; document commands are label-only and arrive as DOM
  keydowns, which run them only with focus in the live document and otherwise leave the
  key to CodeMirror or the text field. Global keys are taken in the capture phase from
  any focus (Mod+/ never reaches CodeMirror's comment command). Overrides follow the
  command's kind.
- Menu-driven Copy/Cut/Paste go through Rust (`clipboard_write_flavors`,
  `clipboard_read_html`), feeding the same flavors and paste pipeline as the DOM events
  (01, rule 2).
- The document context menu is HTML (`src/app/contextmenu.ts`) with the items of 12.
- Help documents ship inside the app (`src-tauri/help/`), are written to
  `<config>/help/` when opened, and open as documents.

## P3: workspace

### Rust services (`src-tauri/src/workspace.rs`)

- **File tree and list**: `fs_list_dir` (one level, filter, natural sort with folders
  first, hidden files) and `fs_walk` (recursive, `ignore` crate, respects `.gitignore`).
  File operations (create, rename, move, duplicate, trash via the `trash` crate, reveal)
  update every window whose document lives under the moved path and emit
  `scrim://doc-moved` with the new path.
- **Watching** (`notify`): the open file per window, and the sidebar folder. A change
  whose bytes equal what this window last saved is our own save and is ignored; anything
  else emits `scrim://file-changed` (`modified` / `removed`). Folder changes are
  debounced into `scrim://folder-changed`.
- **Search in files**: a background thread per query (`grep-searcher` + `grep-regex`,
  binary detection, 10 MB cap, file filter, `.gitignore`), streaming one event per file
  (`scrim://search-result`) and a final `scrim://search-done`; a new query or
  `search_cancel` stops the old one. W-7: first result in about 180 ms on 10,000 files
  under software rendering.
- **Recent** (`history.json`: 20 files, 10 folders) and **draft recovery**
  (`recovery/<id>.md` + `<id>.json`; "Don't Save" moves the pair to
  `recovery/discarded/`, purged after 7 days at startup). A draft opened from the
  recovery list becomes that window's own draft, so the next draft write replaces it.

### Frontend

- **Sidebar** (`src/app/sidebar.ts`): tabs, tree with remembered expansion
  (localStorage per folder), list cards, context menu, inline rename, outline with
  collapse/filter/drag (a drag is one transaction, so one undo step; only top-level
  headings move), search tab. Without an opened folder, the document's parent folder is
  an implicit folder (QA-LOG Q-016): it scopes the Files tab, quick open, and search,
  is watched like an opened folder (`folder_watch_implicit`), follows the document on
  open, save, Save As, and move, and is never stored in recent folders or restored.
- **Find bar** (`src/editor/find.ts`, `src/app/findbar.ts`): matches run over the
  *displayed* text of each prose block (markers removed, so `**bo**ld` matches "bold"),
  mapped back to source ranges per character; "Match Markdown source", code and math
  blocks, and source mode search the source. Replacing inside formatting rewrites only
  the displayed characters, so Replace All in `**bold**` gives `**x**`. Highlights are a
  decoration plugin (`md-search-hit`, current `md-search-select`).
- **Source mode** (`src/app/sourcemode.ts`): a CodeMirror 6 editor over the serialized
  text; cursor and top line map through `serializeWithMap`. Leaving applies the new text
  with `applyText`, which replaces only the changed top-level blocks (untouched blocks
  keep their identity) and is one closed undo step, so E-19's two undos work. Files over
  5 MB open in source mode with a notice.
- **Status bar and counts** (`src/editor/counts.ts`): counting rules of 14 over the
  displayed text; computed on idle (300 ms) and with a selection.
- **External changes, autosave, recovery** (`src/app/workspace.ts`): silent reload keeps
  the source offset (7.3 says source offset, so an edit above the cursor moves it
  relative to the text) and is undoable; autosave 1 s after the last edit, on blur, and
  before switching files; drafts every 30 s and on blur.
- **View modes**: focus mode marks the block (or innermost list item) at the cursor with
  a node decoration `md-focus`; typewriter mode recenters after ProseMirror's own
  scroll-into-view (next animation frame). Zoom uses the webview zoom, remembered in
  settings.
- **Chrome text fields own Mod+Z** (E-18): WebKitGTK keeps an undo stack for inputs but
  binds no keys, so a window-level handler runs `execCommand("undo"/"redo")` for focused
  inputs. Document commands such as Mod+B never run there (dispatcher scope).

### Test hooks

Debug builds read a Save As target from the file named by `SCRIM_TEST_SAVE_AS` (one use
per write), because WebDriver cannot drive the native dialog; release builds compile
the hook out. `window.__scrim.testHooks.askImagePaths` stands in for D-7's three-way
native prompt.

## P2: rich blocks

### Model

- New node types (`src/md/schema.ts`): `code_block` (fenced or indented), `math_block`,
  `front_matter`, `html_block`, `table` > `table_head`/`table_body` > `table_row` >
  `table_cell`, `footnote_def` (a container, like a list item with a 4-space
  continuation), `toc`, and a `task` attribute on list items. Link reference definitions
  stay `raw` leaves rendered as `div.md-def-url`.
- **Fenced blocks** keep the opening line, the break before the first content line, and
  the closing line (or "unclosed") as attributes; the content is only the code, with the
  same per-line `line_break` prefixes as paragraphs. A changed info string rewrites only
  the opening line; a new fence grows past any run of the fence character in the code.
  Indented code that gets a language becomes fenced and is re-emitted canonically.
- **Tables** store each row's source line and its cell texts as read. Unchanged rows are
  written verbatim; when a cell, the alignment, or the column set changes, the whole
  table is re-padded ("Pretty-print tables", default on, R-7) or only the changed rows
  are written minimally (off). Missing and extra cells in the source survive while
  their row is unchanged.
- **Task items**: the `[ ]` is located in the first leaf's lead (a marker span of kind
  `task`), so toggling rewrites one character.
- Every new type is checked against mdast at load (code, math, YAML, HTML values must
  equal the extracted content) and falls back to `raw` otherwise. Over the spec
  examples: 15 fallbacks, 78 code blocks, 58 HTML blocks, 7 tables structured.

### Views

- **CodeMirror 6** node views (`src/editor/codeview.ts`) for code, math source, HTML
  source, and front matter. Content maps 1:1 (`line_break` ↔ `"\n"`). Highlighting uses
  a tag highlighter that emits the theme contract's `cm-*` classes; the editor carries
  `CodeMirror cm-s-inner`, the content `CodeMirror-lines`, each line `CodeMirror-line`.
  Languages load lazily from `@codemirror/language-data` (HTML and YAML from their own
  packages). Undo/redo go to ProseMirror's history. Arrow keys leave the block at its
  edges (Down past the end creates a paragraph). A plugin keeps CodeMirror's selection
  in step with ProseMirror's, because `setSelection` is not called for every
  programmatic selection.
- **Math** renders with KaTeX (display mode) under a source editor that shows while
  editing, preview debounced 150 ms; errors show red source with the message as a
  tooltip. Auto numbering appends `\tag{n}` when enabled.
- **HTML blocks** preview through DOMPurify (no `script`, `object`, `embed`, event
  handlers, `javascript:`); every `iframe` is rewritten to the `scrim-embed` wrapper
  (below), keeping only `width`, `height`, `title`, `style`; `<style>`
  rules are rewritten with a `#write` prefix through CSSOM; ids get `user-`; a lone
  comment shows as "HTML comment".
- **Tables**: grid operations rebuild the table in one step (row attributes travel with
  their rows); toolbar with size picker, alignment, and the "more" menu; Mod+T dialog;
  `|` typed in a cell becomes `\|`; Shift+Enter writes `<br>`; TSV paste fills or
  creates a table.
- **TOC** is an atom node view re-rendered from the heading list; Enter or double-click
  turns it into an editable `[toc]` paragraph, which becomes a TOC again when the
  cursor leaves.
- **Footnotes**: references show numbers in document order (CSS `::after` from a
  `data-n` attribute set by a debounced plugin view); definitions get a label and a `↩`
  back link; hover shows a popover with the rendered definition; Mod+click jumps to the
  definition; Insert Footnote adds `[^n]` and a definition at the end; Escape returns.
- **Task checkboxes** are widgets at the start of the item's first paragraph (inside the
  `li`, as the theme contract asks); a node view's own `<input>` was removed by
  ProseMirror when it re-rendered the content.
- **Front matter** `title` replaces the file name in the window title (Q-013),
  `root-url` is the base for relative images, `image-folder` overrides the image folder.

### Images and files (6.2–6.4)

- The policy lives in Rust (`crates/scrim-core/src/images.rs`, `src-tauri/src/images.rs`):
  target folder per policy or front matter, `image-YYYYMMDDHHMMSSmmm.png` names,
  `-1`/`-2` on collisions (unless the content is identical), relative paths with
  optional `./`, URL escaping, and the upload command (run through `sh -c`/`cmd /C`
  with the image paths; the URLs it prints replace them). Untitled documents keep images
  in `<config>/tmp-images/<window>/`; after the first save they move and their paths are
  rewritten, and the file is written again.
- **WebKitGTK's paste event exposes no image data or file list.** When a paste event
  has no data at all, Scrim reads image data (as PNG) or a file list from the system
  clipboard through `clipboard-rs` (the same path as menu paste in 01).
- File drops use Tauri's native drop events (paths and position): images per policy,
  `.md` files open (a new window if the current document has unsaved changes), other
  files become relative links, folders wait for the sidebar (P3). Tauri's "over" events
  drive the same drop line as text drags.
- **Text drag-move uses pointer events on every platform (Q-014)**, not HTML5 drag and
  drop, so it coexists with native file drops on Windows and WebDriver can drive it
  (C-6). `src/editor/dnd.ts`: press inside a non-empty selection, move more than 4 px,
  a drop line follows the pointer, Escape cancels, a drop inside the range does nothing,
  Mod at the drop copies; one transaction, one undo step. HTML5 `dragstart` on text is
  cancelled. Dragging text out to other apps is not supported (v1).

### Iframes: the `scrim-embed` wrapper (Q-015)

- The app pages' CSP has `frame-src scrim-embed:` (Windows `http://scrim-embed.localhost`)
  and nothing else. The sanitizer rewrites each iframe's `src` to
  `scrim-embed://localhost/?src=<url>`; one helper in `main.ts` builds the URL per
  platform.
- `src-tauri/src/embed.rs` reads "Allow iframes" (`allowIframes`) on every request. On,
  with an `https:` source: a static page with its own CSP
  (`default-src 'none'; style-src 'unsafe-inline'; frame-src https:`) and the real
  iframe at 100% size, `sandbox` empty or, for `iframeAllowlist` domains (read from
  `settings.json` until P4 moves it to `config.jsonc`), `allow-scripts allow-same-origin
  allow-popups`; `referrerpolicy=no-referrer`. Off, or not `https:`: a static "Iframe
  blocked" placeholder with the URL.
- `settings_set` writes `settings.json` (unknown keys kept) and emits
  `scrim://settings-changed`; every window re-reads its settings and re-renders its HTML
  blocks, so the setting applies immediately in both directions.
- Image paragraphs get `p.md-image-paragraph`; missing images show a dashed placeholder
  with the alt text and path; double-click opens the image with the system viewer; zoom
  commands rewrite `![]()` as `<img … style="zoom: N%">` and back ("Original size").
  The right-click menu that offers them arrives with P4's context menu.

### Settings read in P2

`codeWrap`, `codeLineNumbers`, `codeCopyButton`, `mathAutoNumber`, `allowIframes`,
`prettyPrintTables`, `numberFootnotes`, `imagePolicy` (`none`, `current`, `assets`,
`docAssets`, `custom`, `upload`), `imageCustomFolder`, `imageApplyToLocal`,
`imageRelativePath`, `imagePreferDotSlash`, `imageEscapeUrl`, `imageUploadCommand`.

### Not yet / manual

- D-7 (Save As image prompt) belongs with Save As in P3.
- Mermaid stays a normal code block (4.15, deferred past v1).

## P1: document model and editor

### Round trip (spec 01, "Document model")

The recommended design is followed: blocks are ProseMirror nodes, a textblock's text is
its literal Markdown inline source. Deviations and details:

- **Line breaks are `line_break` atoms**, not `"\n"` characters. Each stores the
  terminator of the line it ends and the full prefix of the next line (container
  prefixes plus the line's leading whitespace). ProseMirror keeps atom identity
  through edits, so a surviving line keeps its exact prefix; a new break has null
  attributes and gets the canonical continuation prefix. `leafText` is `"\n"`, so
  positions still map 1:1 to source characters.
- **Leaves carry the rest** (`src/md/schema.ts`): `sep` (bytes between the previous leaf
  and this one), `prev` (that leaf's uid), `lead` (first-line prefix, with list-marker
  spans in `marks` so renumbering can rewrite them), and `sig`, a signature of the
  container chain (types, uids, whether the leaf is an item's first). The serializer
  reuses stored prefixes only while `sig` matches, so wrapping, unwrapping, or
  re-indenting re-emits exactly the leaves whose containers changed; nest-then-lift of
  a list item is byte-exact. A stored separator survives new blocks inserted before its
  leaf only if it contains a blank line (otherwise the leaf would become a lazy
  continuation of the new block).
- **Copies made by splits** (Enter) share attributes; `normalize.ts` gives every block a
  unique uid after structural steps, keeping the original identity on the first copy
  (or the non-empty one when Enter was pressed at a block's start).
- **Parser** (`src/md/parse.ts`): mdast from micromark (CommonMark + GFM tables,
  strikethrough, autolink literals, footnotes; front matter; block math; inline math
  when enabled). The GFM task-list extension is not used in P1, so `[ ]` stays text.
  Container prefixes are stripped per line by CommonMark's rules. Two safety nets: a
  paragraph or heading inside containers is re-parsed from its extracted inline source
  and must produce the same inline tree (top-level blocks skip this: nothing was
  stripped), and the whole document must serialize back to the input. A top-level
  block that fails becomes a `raw` leaf (exact source, shown as plain text). Over the
  CommonMark and GFM spec examples about 1.4% of top-level blocks fall back, nearly all
  of them tab-indented list items.
- **`raw` leaves** hold every block P2 will give a real editor (code, math, tables, HTML,
  front matter, definitions, footnote definitions). They are editable as plain text.
- **Ordered list numbering**: the list stores its item uids at load. While they are
  unchanged every marker is written as read; otherwise markers follow the detected
  style (sequential, all-same, irregular) as in item 5. When Backspace lifts a middle
  item out (Q-009), ProseMirror splits the list; the second half keeps the marker and
  numbering style and continues from the number its first item already has, so
  `1. 2. 3. 4.` with item 2 lifted writes `1.`, then the paragraph, then `3. 4.`.

### Inline rendering and reveal (spec 03, 3.2)

- `src/md/inline.ts` turns a textblock's source into elements (ranges, marker runs,
  "hidden while collapsed" ranges for link destinations and HTML tags, widgets) using
  micromark on the block's source plus stub definitions, so reference links and
  footnotes resolve.
- Decorations follow 01's stable-DOM rule: wrappers, content elements, and `md-meta`
  runs exist regardless of the cursor; `reveal.ts` toggles `md-expand`/`md-focus` on the
  DOM with ProseMirror's DOM observer paused.
- **Collapsed markers are `font-size: 0`, not `display: none`.** WebKitGTK moves the
  caret out of `display: none` text, which made the cursor drift across hidden
  markers (typed closing `**` landed inside the element, Right skipped positions).
  Zero-size text stays a valid caret position.
- Arrow keys cross each marker run in one step; other selection changes snap out of
  collapsed runs (7a); clicks on a boundary next to hidden markers resolve to the
  content side, using the pointer's x where two elements meet (7, 7b).
- Decorations are recomputed only for textblocks a transaction touched, frozen during
  IME composition, and computed progressively at load (150 textblocks at once, the
  rest in background chunks).
- Rendered links are `<a data-href title="URL">` without `href` (Q-012); themes'
  `a`, `a:hover`, and `#write a` rules apply, `:link`/`a[href]` only in exports. The
  pointer cursor appears over links while Mod is held (body class `scrim-mod-held`) or
  always with "Open links with single click" (`scrim-links-single-click`). An earlier
  version set `title` on hover, which made the native tooltip window swallow the click
  under Xvfb; a static `title` does not.
- Local images: the frontend asks Rust to add the file to the `scrim-file` scope
  before setting `src` (otherwise the first request races the grant and gets 403).

### Editing

- Commands (`src/editor/commands.ts`) implement 3.3–3.7 and the list/quote parts of 04.
  Space-triggered input rules dispatch the typed space first, then the transformation
  as its own history step, so one undo restores the trigger as typed (E-8).
  Enter-triggered rules for code, math, tables, HTML, and front matter create `raw`
  blocks until P2.
- Automatic escapes (`escapes.ts`, 01 item 6): each changed paragraph is re-parsed line
  by line; the first line that would start another block gets a backslash with the
  `auto_escape` mark (leading whitespace on the first line is removed instead).
  Automatic escapes that are no longer needed are removed; typed backslashes are
  never touched. Deferred while an input rule may still fire (Q-010), and flushed
  before every hand-off of the text: save and copy/cut now; autosave, draft recovery,
  export, and source mode (later phases) must take the text through
  `Editor.markdown()` or `flushEscapes`, which apply deferred escapes first.
- Undo grouping: prosemirror-history with a 1 s delay, plus a group break after
  whitespace that follows a word (3.8).
- Clipboard (`clipboard.ts`, 06 text paths): copy writes the Markdown source as
  `text/plain`, rendered HTML as `text/html` whose root carries `data-scrim-source`
  (base64 of the source). Paste prefers that attribute, then HTML (turndown + GFM
  plugin), then plain text as Markdown; Mod+Shift+V inserts literally (6.2's algorithm,
  verified with the parser, falling back to escaping all ASCII punctuation). Image and
  file pastes arrive with P2's image policy.
- Keyboard routing (01): `src/editor/keys.ts` normalizes key identity (rule 5) and
  owns command keys; clipboard and undo keys stay native (rule 2). Deduplication drops
  the second arrival of an accelerator from the *other* source within 100 ms, so two
  real presses of Mod+B both run.
- Settings read in P1 (`settings.json`, read-only until P4): `inlineMath`,
  `preserveLineBreaks`, `autoPairBrackets`, `autoPairMarkdown`, `copyAsMarkdown`,
  `emojiAutocomplete`, `openLinksSingleClick`, `defaultLineEnding`.

### Not yet in P1 (spec text that depends on later phases)

- Footnote hover/jump (3.9) and footnote/link definition rendering: footnote
  definitions are blocks (P2).
- Highlight, sub- and superscript extensions (default off) and strict mode off (lenient
  `#Heading`, any-number list interruption): with the preferences window (P4).
- Escapes in setext heading lines and ATX closing-`#` ambiguity: paragraphs only so far.
- E-9 (IME) is manual; E-18 and E-19 need P3's find bar and source mode.

### Performance status

- Parsing uses micromark/mdast, about 1.4 s for a 213 KB, 9,000-line file; 1 MB would
  exceed the 2 s open budget. The model only needs line-level block positions, so P8
  can move block parsing to a faster parser (markdown-it) and keep micromark for small
  inline strings.
- Typing: Scrim's own work per keystroke is about 2 ms on 10,000 lines (incremental
  decorations, heading ids, definitions; the "clean again" check runs after a 300 ms
  pause). WebKitGTK's synchronous layout when the selection is set dominates under
  software rendering. Q-011: E-14 reports in CI and is enforced with
  `SCRIM_PERF_STRICT=1` when the owner runs it on a laptop before P8; large-document
  layout is P8 work, trying CSS containment first and viewport-only rendering last.
- Containment numbers from a quick P1 experiment (Xvfb, software rendering, E-14
  setup, 200 keystrokes, p95 of keydown → end of view update), to compare against in
  P8 on real hardware:

  | Document | Base CSS | `content-visibility: auto` + `contain-intrinsic-size: auto 1.6em` on `#write > *` | `contain: layout style` on `#write > *` |
  |---|---|---|---|
  | 1,000 lines | 7 ms | not measured | not measured |
  | 3,000 lines | 17 ms | not measured | not measured |
  | 10,000 lines | 37–62 ms | 1,371 ms (median 410 ms) | about 290 ms per update (profiling loop, not E-14) |

  Both containment variants were much slower here, probably because the estimated
  intrinsic height (1.6em) is wrong for most blocks and WebKitGTK re-measures them as
  the selection moves. Q-011 asks for a measured height; P8 should rerun these with
  measured heights, on real hardware, for the 3,000- and 10,000-line cases.

## P0 decisions

**Document state lives in Rust.** Each window label maps to a `DocState` (path,
encoding, the text and bytes as loaded or last saved, dirty flag). When the text to save
equals the text as loaded, the original bytes are written back verbatim, so open-then-save
is byte-identical even for legacy encodings whose decode/encode is not a bijection.

**Line endings in the plain-text editor.** A `<textarea>` normalizes every line break to
`\n`. The frontend keeps the original lines with their terminators (`src/doc/lines.ts`);
on save, the unchanged prefix and suffix lines keep their own terminators and edited or
new lines get the document's majority ending (or the settings default for files without
any line break). This meets "lines the user did not touch keep their original endings"
for P0; P1 replaces it with per-newline metadata in the document model (01, "Round-trip
model" item 1).

**Encodings.** BOM first (UTF-8, UTF-16LE/BE), then strict UTF-8, then `chardetng`.
`encoding_rs` implements the WHATWG standard, where "latin1" means windows-1252; true
ISO-8859-1 is handled separately (Q-004). Unrepresentable characters are found before
writing and returned to the frontend, which asks "Save as UTF-8" / Cancel.

**Atomic save** (`crates/scrim-core/src/save.rs`). Symlinks are resolved by hand so a
dangling link creates its target. The temp file is `.<name>.scrim-save-<pid>-<nanos>.tmp`
in the target directory. Unix: permissions, ownership (when permitted), and `user.*`
xattrs are copied, then `rename` and a directory fsync. Windows: `ReplaceFileW` (keeps
ACLs and attributes), or `MoveFileExW` when the target is new. Any failure falls back to
writing in place. The fault-injection hook (`SaveHooks`) is a parameter, not an
environment variable, so it cannot be triggered in production. After a crash a temp file
can remain next to the document; P3's recovery work will decide whether to clean these
up on start.

**Window title.** Computed in Rust (`identity::window_title`) and returned to the
frontend, which mirrors it into `document.title` so WebDriver can read it. The e2e tests
also check the native X11 title.

**Opening files.** A file that is already open focuses its window. Otherwise:
- the Open dialog follows "Open files in: current window when possible" (default): the
  window it was opened from is reused if its document is unmodified, untitled or saved;
- paths from a launch (first launch, or handed over by a second launch) never replace an
  open document (Q-007): only a fresh untitled, unmodified, empty window is reused (the
  focused one if fresh, else the oldest fresh one); each further path gets its own
  window. `--new-window` disables even that reuse.

**Missing paths** (Q-003): open as an empty document bound to the path; if the parent
folder is missing at save time, the frontend asks "Create folder <path>?" (Create /
Cancel) and Rust creates it with `create_dir_all`.

**Keyboard.** P0 has a minimal capturing keydown handler for Mod+S, Mod+Shift+S, Mod+O,
Mod+N, Mod+Shift+N, and swallows Ctrl+R, F5, Ctrl+P, Ctrl+Shift+I. Clipboard and undo
keys are left to the webview (01, "Keyboard routing" rule 2). The real dispatcher, native
menu, and accelerator deduplication come in P1/P4.

**Settings.** P0 reads `settings.json` (read-only) for one key, `defaultLineEnding`
(`"lf"` / `"crlf"`; absent means the platform default). Writing, with unknown keys
preserved, comes with the preferences window in P4.

**Config directory override.** `SCRIM_CONFIG_DIR` replaces the config directory; the
test suites use it so they never touch the real profile.

## Network policy (spec 19)

- **CSP** in `src-tauri/tauri.conf.json` (Linux) and `tauri.windows.conf.json` (Windows
  origins). `dangerousDisableAssetCspModification: ["style-src"]` stops Tauri adding
  nonces to `style-src`, which would otherwise disable the `'unsafe-inline'` that themes
  need. `frame-src 'none'` until iframes become a setting. `connect-src` has no http(s).
  An e2e test checks that `fetch()` to an http URL is blocked and logged.
- **CSP violations** reach `app.log` through the `securitypolicyviolation` event.
- **WebKitGTK**: DNS prefetching and the page cache are turned off per webview.
- **WebView2**: browser arguments and `IsReputationCheckingRequired = false`,
  `AreBrowserAcceleratorKeysEnabled = false` (`src-tauri/src/hardening.rs`). Type-checked
  for `x86_64-pc-windows-msvc`, not yet run (Q-006: accepted; manual Windows checks are
  an open item, see README).
- **No HTTP client crates**: `scripts/check-no-http.sh` checks the resolved graph for the
  Linux and Windows targets. `tauri` 2 depends on `reqwest` only for Android/iOS (its dev
  server proxy), so the allowlist is empty.
- **N-1**: `scripts/n1-network.sh` runs a command (default: the e2e suite) under `strace
  -f`, recording `connect`/`sendto`/`sendmsg` of the whole process tree including the
  WebKit helper processes, and fails on any non-loopback internet address (DNS lookups
  included). A positive control (`node -e "fetch('https://example.com')"`) is caught.
  The Windows form (per-process firewall or ETW) is deferred to before P8 (Q-006).

## `scrim-file` protocol

Registered with `register_asynchronous_uri_scheme_protocol`; requests are served on the
blocking thread pool. The path is percent-decoded and canonicalized (so `..` and
symlinks cannot escape the scope), checked against the scope, and served with a MIME type
from the extension; out-of-scope paths get 403 and a log line. In P0 the scope holds the
theme and recovery folders; P1 adds files referenced by open documents, P3 the sidebar
folder, P4 the theme CSS selector rewrite.

## PDF prototype (spec 21, risk 5)

`src-tauri/src/pdf_proto.rs` (P0): with `SCRIM_PROTO_PRINT_PDF=/abs/out.pdf`, the first
window prints itself to that file without a dialog. The P5 pipeline ("P5: output") grew
out of it.

## CI budget

`ci.yml` (Linux: lint, unit tests, build, full E2E under the N-1 trace) runs on pushes
that change code or tests, not on spec pulls, questions, or documents; a newer push
cancels a running check. `windows.yml` (build and unit tests, billed double) runs weekly
and on demand. `goldens.yml` runs only when files that affect rendering change. The full
E2E suite also runs locally before each push.

## Testing

| Command | What |
|---|---|
| `npm test` (src/md, src/editor) | R-1 parse/serialize form, R-2/R-5/R-6, R-4/R-9, structural edits, clipboard, key identity |
| `cargo test --workspace` | Rust unit tests, S-2 (kill -9 during save, via re-running the test binary as a child), R-1 file layer over the corpus and spec examples |
| `npm test` | Frontend unit tests, including R-1 line bookkeeping over the corpus |
| `scripts/e2e.sh` | S-1, S-3, save round trips, CSP; P4: T-2..T-8, menu commands; P3: W-1..W-12, E-18, E-19, D-6, D-7; P2: B-1..B-11, C-3, C-4, D-4; P1: E-1..E-8, E-10..E-17, R-4/R-9 live, KB-1 (DOM part), emoji (needs Xvfb, D-Bus, tauri-driver, WebKitWebDriver, xclip). `node tests/e2e/run.mjs <regex>` runs a subset. |
| `scripts/n1-network.sh` | N-1: the e2e suite under a connection trace |
| `scripts/check-no-http.sh` | No HTTP client crate in the Rust graph |

Linux packages needed for building and e2e (Debian/Ubuntu): `libwebkit2gtk-4.1-dev
libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev webkit2gtk-driver xvfb
x11-utils dbus strace xclip`, plus `cargo install tauri-driver --version ^2`.
