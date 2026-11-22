# Provenance

Outside sources consulted beyond library documentation (CLEAN-ROOM.md rule 8). The
original program, its documentation, its website, its themes, and code derived from it
have not been consulted.

| Date | Source | Reason |
|---|---|---|
| 2026-11-20 | CommonMark Spec 0.31.2, `spec.txt` from github.com/commonmark/commonmark-spec (tag 0.31.2) | Examples extracted into the round-trip corpus (spec 20, R-1); allowed by CLEAN-ROOM rule 4 |
| 2026-11-20 | GFM Spec 0.29, `test/spec.txt` from github.com/github/cmark-gfm | Extension examples (tables, strikethrough, task lists, autolinks, disallowed raw HTML) for the corpus |
| 2026-11-20 | Source of the `tauri` 2.12 crate (local cargo registry) | Checked why `reqwest` appears in the dependency graph: only for Android/iOS targets, for the dev-server proxy |
| 2026-11-20 | Howard Hinnant, "chrono-Compatible Low-Level Date Algorithms" (public domain) | `days_from_civil` inverse used for log timestamps (`crates/scrim-core/src/time.rs`) |
| 2026-11-21 | Source of `prosemirror-view` 1.43 (node_modules) | How the DOM observer treats attribute mutations on decoration wrappers (reveal toggles classes with the observer paused) and how decoration sets are compared |
| 2026-11-21 | Source of `chardetng` 1.0 and `tauri` 2.12 (local cargo registry) | API signatures; tauri's mobile-only `reqwest` dependency |
| 2026-11-22 | `NotoSans-Regular.ttf` and `OFL.txt` from raw.githubusercontent.com/notofonts (notofonts.github.io and latin-greek-cyrillic repositories) | Bundled font for PDF header and footer text (spec 09, 9.3) |
| 2026-11-22 | Source of `lopdf` 0.38, `webview2-com` 0.39 and its macros, `tauri` 2 (`on_page_load`, `PlatformWebview`), local cargo registry | API signatures for PDF overlay and printing |
| 2026-11-22 | Source of `prosemirror-view` 1.43 (node_modules), DOM observer mutation handling | Found why image markers lost their wrapper: an attribute change on the mark element made ProseMirror re-read the paragraph |
