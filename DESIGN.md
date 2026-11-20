# Design notes

Implementation decisions and deviations from the spec's "recommended" designs
(`spec/spec/01-architecture.md` asks for them here). Spec questions live in
`QA-LOG.md`.

## Repository layout

| Path | Contents |
|---|---|
| `crates/scrim-core/` | Platform-independent Rust: identity, config paths, encodings, line endings, atomic save, logging, settings. No GUI dependency, tested headless. |
| `src-tauri/` | Tauri 2 shell: windows, IPC commands, `scrim-file` protocol, webview hardening, single instance. |
| `src/` | Frontend (TypeScript, Vite). In P0 a `<textarea>`; ProseMirror replaces it in P1. |
| `tests/corpus/` | Round-trip corpus (R-1). Marked `-text` in `.gitattributes` so git never touches line endings. |
| `tests/e2e/` | WebDriver acceptance tests (tauri-driver + WebKitWebDriver). |
| `scripts/` | Test wrappers (`e2e.sh`, `n1-network.sh`, `check-no-http.sh`) and generators. |
| `spec/` | The specification (read-only for the implementation team). |

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
| `cargo test --workspace` | Rust unit tests, S-2 (kill -9 during save, via re-running the test binary as a child), R-1 file layer over the corpus and spec examples |
| `npm test` | Frontend unit tests, including R-1 line bookkeeping over the corpus |
| `scripts/e2e.sh` | S-1, S-3, save round trips, CSP (needs Xvfb, D-Bus, tauri-driver, WebKitWebDriver) |
| `scripts/n1-network.sh` | N-1: the e2e suite under a connection trace |
| `scripts/check-no-http.sh` | No HTTP client crate in the Rust graph |

Linux packages needed for building and e2e (Debian/Ubuntu): `libwebkit2gtk-4.1-dev
libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev webkit2gtk-driver xvfb
x11-utils dbus strace`, plus `cargo install tauri-driver --version ^2`.
