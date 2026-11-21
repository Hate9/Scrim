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
| `src/app/` | Command table (ids and default keys). |
| `src/main.ts` | Window glue: load/save, dialogs, link opening, settings. |
| `tests/corpus/` | Round-trip corpus (R-1). Marked `-text` in `.gitattributes` so git never touches line endings. |
| `tests/e2e/` | WebDriver acceptance tests (tauri-driver + WebKitWebDriver). |
| `scripts/` | Test wrappers (`e2e.sh`, `n1-network.sh`, `check-no-http.sh`) and generators. |
| `spec/` | The specification (read-only for the implementation team). |

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
  style (sequential, all-same, irregular) as in item 5.

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
- Rendered links are `<a data-href>` without `href` (Q-012). The URL tooltip is drawn
  in the page after 500 ms; the native `title` tooltip window could swallow clicks.
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
  never touched. Deferred while an input rule may still fire (Q-010).
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
  pause). WebKitGTK's layout dominates under software rendering (Q-011).

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

`src-tauri/src/pdf_proto.rs`: with `SCRIM_PROTO_PRINT_PDF=/abs/out.pdf`, the first window
prints itself to that file through `webkit2gtk::PrintOperation` with GTK print settings
(printer "Print to File", output format pdf, output URI) and no dialog. Verified under
Xvfb: the PDF is written in about 25 ms and contains the document text (checked with
`pdftotext`). Remaining work for P5: waiting for rendering to settle, page setup and
margins from settings, headers/footers (post-processing, 09), and the WebView2 path
(`PrintToPdf`).

```bash
SCRIM_PROTO_PRINT_PDF=/tmp/out.pdf xvfb-run -a dbus-run-session -- target/debug/scrim README.md
```

## Testing

| Command | What |
|---|---|
| `npm test` (src/md, src/editor) | R-1 parse/serialize form, R-2/R-5/R-6, R-4/R-9, structural edits, clipboard, key identity |
| `cargo test --workspace` | Rust unit tests, S-2 (kill -9 during save, via re-running the test binary as a child), R-1 file layer over the corpus and spec examples |
| `npm test` | Frontend unit tests, including R-1 line bookkeeping over the corpus |
| `scripts/e2e.sh` | S-1, S-3, save round trips, CSP; P1: E-1..E-8, E-10..E-17, R-4/R-9 live, KB-1 (DOM part), emoji (needs Xvfb, D-Bus, tauri-driver, WebKitWebDriver, xclip). `node tests/e2e/run.mjs <regex>` runs a subset. |
| `scripts/n1-network.sh` | N-1: the e2e suite under a connection trace |
| `scripts/check-no-http.sh` | No HTTP client crate in the Rust graph |

Linux packages needed for building and e2e (Debian/Ubuntu): `libwebkit2gtk-4.1-dev
libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev webkit2gtk-driver xvfb
x11-utils dbus strace xclip`, plus `cargo install tauri-driver --version ^2`.
