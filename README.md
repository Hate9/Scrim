# Scrim

A desktop Markdown editor for Linux and Windows that edits the document in its rendered
form, showing Markdown syntax only where the cursor is. Built with Tauri 2.

Status: **P8 (performance, coverage, packaging)**, the last phase. All features of the
specification are in: live-preview editing with byte-exact round trips, rich blocks, the
workspace, themes, preferences, export (HTML, PDF, pandoc formats), spell check, snippets
and custom tags. What remains is listed under "Open items" below. See
`spec/spec/00-overview.md` for the phases.

## Background

Scrim is an independent clean-room reimplementation of Typora's editing behavior. It
contains no Typora code or assets, and it is not affiliated with or endorsed by Typora's
developers. Its behavior is modeled on Typora's, from a written specification
(`spec/CLEAN-ROOM.md` describes the process). Themes written for Typora work in Scrim.

## Open items

- **Windows verification (QA-LOG Q-006).** Until a Windows machine is available, the
  Windows workflow (build + unit tests; weekly and on demand, `windows.yml`) is the only
  Windows coverage. Before P8, run S-1, S-3,
  and N-1 (per-process firewall or ETW trace of `scrim.exe` and its WebView2 children)
  on Windows 11 and confirm the WebView2 settings in `src-tauri/src/hardening.rs` take
  effect.
- **Performance budgets on real hardware (QA-LOG Q-011, Q-026, Q-027).** E-14 and PF-1
  are reported, not enforced, in CI; the owner runs them on real hardware with
  `SCRIM_PERF_STRICT=1 scripts/e2e.sh` (`SCRIM_APP=target/release/scrim` for a release
  build). Latest numbers, the open's stages, and the viewport-only rendering they
  measure: DESIGN.md, "P8: performance and coverage".
- **Settings with platform limits.** Cursor blink on Windows (WebView2 has no switch;
  the system setting applies). `global:` shortcuts need X11 or Windows (Wayland has no
  global key grabs; the failure is shown and logged). The UI exists only in English, so
  Language has nothing to switch to yet. The custom title bar is checked on
  Linux only; on Windows it needs a look (menu popup, snapping, DWM caption color). (Diagrams render as code blocks until
  diagram rendering lands, spec 21.)
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

## AI use

Scrim is written by AI. Two instances of Anthropic's Claude work on it: one writes and
maintains the specification (`spec/`) on a local machine, and one, working as a coding
agent, writes the implementation, its tests, and this documentation from that
specification. Questions from the implementation and the specification's answers are
recorded in `QA-LOG.md`. The project's owners relay between the two, approve the
specification's decisions, and test the app on real machines. Commits made by the
coding agent carry a `Co-Authored-By: Claude` trailer.

The implementation follows clean-room rules (`spec/CLEAN-ROOM.md`): the specification is the
only description of the behavior it reproduces, and no other program's code,
documentation, or themes were used to write it. Outside sources that were consulted are
listed in `PROVENANCE.md`. Like any code, it may contain mistakes; please report what you
find.

## License

Scrim is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version. See `LICENSE`.

It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

Third-party components keep their own licenses, all compatible with the GPL; they are
listed in `THIRD_PARTY.md`. The bundled fonts (Noto Sans, PT Serif, Open Sans) are under
the SIL Open Font License 1.1.
