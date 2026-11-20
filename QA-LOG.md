# Q&A log (spec addenda)

Answers here are binding additions to the spec. Format:

```
## Q-NNN: short title
**Asked by:** implementation team, YYYY-MM-DD
**Question:** …
**Answer (spec team, YYYY-MM-DD):** …
```

## Q-000: Trademarked prefix in theme compatibility identifiers
**Asked by:** spec team (owner decision needed), 2026-11-20
**Question:** Existing third-party themes target a few IDs/classes that contain the
reference editor's name (`#typora-sidebar`, `.typora-export`, `#typora-source`,
`.typora-quick-open`). Supporting them requires emitting those names as aliases in the
DOM. May the implementation include them?
**Answer (project owner, 2026-11-20):** Prefer Scrim's own names; still support those
themes. The DOM uses only `scrim-*` names. The theme loader rewrites the other editor's
prefixed selectors to the `scrim-*` equivalents when loading theme and user CSS
(`spec/10-themes.md`, "Compatibility selector rewriting"), behind the build flag
`THEME_COMPAT_REWRITE` (default on). The other editor's name appears only in that
rewrite table and its tests (T-6), never in the DOM, UI, or docs.
