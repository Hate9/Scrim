# Scrim

A desktop Markdown editor for Linux and Windows that edits the document in its rendered
form, showing Markdown syntax only where the cursor is. Built with Tauri 2.

Status: **P2 (rich blocks)**. Live-preview editing with byte-exact round trips:
paragraphs, headings, emphasis, links, lists and task lists, quotes, code blocks
(CodeMirror, highlighted), math (KaTeX), tables (toolbar, keyboard, TSV paste), HTML
blocks (sanitized preview), front matter, footnotes, TOC, and images (insert policy,
paste, drop, zoom). See `spec/spec/00-overview.md` for the phases.

## Open items

- **Windows verification (QA-LOG Q-006).** Until a Windows machine is available, CI's
  Windows job (build + unit tests) is the only Windows coverage. Before P8, run S-1, S-3,
  and N-1 (per-process firewall or ETW trace of `scrim.exe` and its WebView2 children)
  on Windows 11 and confirm the WebView2 settings in `src-tauri/src/hardening.rs` take
  effect.
- **Typing latency on large documents (QA-LOG Q-011).** E-14 is reported, not
  enforced, in CI. The owner runs it on a real laptop before P8 with
  `SCRIM_PERF_STRICT=1 scripts/e2e.sh`; large-document layout is P8 work (DESIGN.md,
  "Performance status").
- **Open time for large files.** Block parsing (micromark) needs a faster path for the
  1 MB / 2 s budget; planned for P8 (DESIGN.md, "Performance status").
- **Manual tests.** E-9 (IME with Japanese input) needs a person.

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
