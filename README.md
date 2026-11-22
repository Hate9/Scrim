# Scrim

A desktop Markdown editor for Linux and Windows that edits the document in its rendered
form, showing Markdown syntax only where the cursor is. Built with Tauri 2.

Status: **P4 (look and settings)**. Live-preview editing with byte-exact round trips,
rich blocks, the workspace (sidebar, quick open, find/replace, source mode, status bar,
focus and typewriter modes, autosave, draft recovery), themes (four built-in themes,
user themes and user CSS with live reload, support for themes written for other popular
live-preview Markdown editors, a separate dark-mode theme), the preferences panel,
`config.jsonc` with rebindable shortcuts, the native menu bar, the document context
menu, and local help documents. See `spec/spec/00-overview.md` for the phases.

## Open items

- **Windows verification (QA-LOG Q-006).** Until a Windows machine is available, the
  Windows workflow (build + unit tests; weekly and on demand, `windows.yml`) is the only
  Windows coverage. Before P8, run S-1, S-3,
  and N-1 (per-process firewall or ETW trace of `scrim.exe` and its WebView2 children)
  on Windows 11 and confirm the WebView2 settings in `src-tauri/src/hardening.rs` take
  effect.
- **Typing latency on large documents (QA-LOG Q-011).** E-14 is reported, not
  enforced, in CI. The owner runs it on a real laptop before P8 with
  `SCRIM_PERF_STRICT=1 scripts/e2e.sh`; large-document layout is P8 work (DESIGN.md,
  "Performance status").
- **Open time for large files.** About 10 s for 1 MB under Xvfb after the P8 work
  (DESIGN.md, "P8: performance and coverage"); a faster block parser or viewport-only
  rendering is the next step, after measuring on real hardware.
- **Settings stored but not yet in effect.** Strict mode, cursor blink,
  window style (custom title bar), language, and `global:` shortcuts. They are saved and
  shown; the features behind them are pending. (Diagrams render as code blocks until
  diagram rendering lands, spec 21.)
- **Window size and position per screen configuration (7.1)** are not remembered yet.
- **T-1 fixture themes.** T-1 runs `scripts/fetch-fixture-themes.mjs` first (the pinned,
  hash-checked list in `spec/fixtures/themes.lock.json`, into the git-ignored
  `tests/fixtures/themes/`). Approved screenshots are committed in `tests/golden/themes/`;
  new or changed renders go to `tests/golden/themes/candidates/` and are committed on a
  `goldens/<date>-<tag>` branch (by the goldens workflow) for review. The goldens come from
  the CI Linux image: elsewhere, themes that use system fonts (notion, orangeheart,
  blackout) differ by a few percent of pixels and T-1 fails; check T-1 in the goldens
  workflow.
- **Export on Windows.** PDF export uses WebView2 `PrintToPdf` and custom commands use
  `cmd` quoting; both compile in CI but have not been run on Windows (see Q-006).
- **Pandoc** is optional: Word, OpenDocument, EPUB, and the other pandoc formats, and
  importing them, need it installed (Help: Installing Pandoc).
- **Spell check on Windows** (Windows Spell Checking API) compiles but has not been run
  on Windows; L-4 is a manual test.
- **Manual tests.** E-9 (IME with Japanese input) and L-4 (a Windows language) need a
  person.

## Documents

- Specification: `spec/` (start with `spec/README.md`)
- Implementation notes: `DESIGN.md`
- Questions for the spec team: `QA-LOG.md`
- Third-party licenses: `THIRD_PARTY.md`; sources consulted: `PROVENANCE.md`

## Build and run

```bash
npm install
```

```bash
npx tauri build --debug --no-bundle
```

```bash
target/debug/scrim path/to/file.md
```

## Test

```bash
cargo test --workspace && npm test
```

```bash
scripts/e2e.sh
```

```bash
scripts/n1-network.sh
```
