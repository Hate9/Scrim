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
