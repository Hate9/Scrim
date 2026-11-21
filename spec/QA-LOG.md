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

## Q-001: App id contains `_`, which the Tauri bundler rejects
**Asked by:** implementation team, 2026-11-20 (summary: Tauri identifiers allow only
letters, digits, `-`, `.`; D-Bus/desktop ids disallow `-`.)
**Answer (spec team, 2026-11-20):** Option (b). Use one id everywhere:
`io.gitlab.sistersvibecode.Scrim`. `01-architecture.md` "Identity" is updated. Drop the
derived hyphen form.

## Q-002: What is the "parser-only form" of R-1 that runs from P0?
**Asked by:** implementation team, 2026-11-20
**Answer (spec team, 2026-11-20):** Option (a). In P0, R-1 is the file-layer round trip
(decode → editor text → encode is byte-identical for every corpus file). The
parse/serialize round trip starts in P1 against the same corpus. `20-acceptance-tests.md`
is updated.

## Q-003: Launching with a path that does not exist
**Asked by:** implementation team, 2026-11-20
**Answer (spec team, 2026-11-20):** Option (a), as implemented: an empty document bound to
that path, title `new.md - Scrim`, created on first save. If the parent folder does not
exist either, the first save asks "Create folder <path>?" (Create / Cancel). Unreadable
paths (permission denied, a directory, a device) show an error bar and open an untitled
document, as implemented. `07-files-and-workspace.md` 7.8 is updated.

## Q-004: "Latin-1" files and the euro sign (R-8)
**Asked by:** implementation team, 2026-11-20
**Answer (spec team, 2026-11-20):** Option (a). A file detected as windows-1252 with no
byte in 0x80–0x9F is treated as ISO-8859-1; files that use 0x80–0x9F stay windows-1252.
`01-architecture.md` "Persistence" is updated.

## Q-005: Files with bytes that are invalid in their detected encoding
**Asked by:** implementation team, 2026-11-20
**Answer (spec team, 2026-11-20):** Option (a), as implemented. Prompt text on saving after
an edit: "Some bytes in this file could not be read and will be saved as �." with
**Save Anyway** / **Cancel**. (No "Save as UTF-8" choice here: converting would not
recover the unreadable bytes.) Open-then-save without edits writes the original bytes. `01-architecture.md` "Persistence" is updated.

## Q-006: WebView2 settings and arguments need verification on Windows
**Asked by:** implementation team, 2026-11-20
**Answer (spec team, 2026-11-20):** The argument list and settings are acceptable as
implemented (keeping wry's defaults is correct). **Project owner, 2026-11-20:** no Windows
machine for now; the GitHub Actions Windows job (build + unit tests) is sufficient until
later. Manual Windows checks (S-1, S-3, N-1 on Windows) are deferred, not dropped:
track them as an open item in the PR/README and revisit before P8.

## Q-007: Which window is "current" for files passed from a second launch?
**Asked by:** implementation team, 2026-11-20
**Answer (spec team, 2026-11-20):** Option (c). Paths handed over by a second launch (file
manager double-click, command line while running) never replace an open document: if
the file is already open, focus that window; otherwise open a new window. The only
reuse is a window whose document is untitled **and** unmodified and empty (a fresh
"New" window), which is replaced instead of leaving an empty window behind.
`07-files-and-workspace.md` 7.1 is updated.

## Q-008: Does `<file name>` in the window title include the extension?
**Asked by:** implementation team, 2026-11-20
**Answer (spec team, 2026-11-20):** Yes, with the extension: `notes.md - Scrim`.
`07-files-and-workspace.md` 7.1 is updated.

## Q-009: Backspace at the start of a list item that is not the first item
**Asked by:** implementation team, 2026-11-21
**Answer (spec team, 2026-11-21):** (a): the first paragraph of **any** item. Nested: outdent
one level. Top level: the item becomes a paragraph between the two halves of the list;
both halves keep the original marker style and numbering style (`01-architecture.md`
round-trip item 5); the second half of an ordered list continues its numbering from
where it now starts in the source only if the list was sequential. `03-editing-model.md`
3.4 is updated.

## Q-010: Automatic escapes versus Enter- and space-triggered input rules
**Asked by:** implementation team, 2026-11-20
**Answer (spec team, 2026-11-21):** Accepted as proposed, with one addition: deferred
escapes are also applied before every other hand-off of the text, not just save: autosave,
draft-recovery writes, export, copy, and switching to source mode.
`01-architecture.md` round-trip item 6 is updated.

## Q-011: How should E-14 (typing latency) be measured?
**Asked by:** implementation team (owner decision), 2026-11-21
**Answer (spec team recommendation, approved by project owner 2026-11-21):** (a) + (c). Keep the
interim (report in CI, enforce with `SCRIM_PERF_STRICT=1`); the owner runs E-14 on a real
laptop before P8. Treat large-document layout as P8 performance work. First thing to
try there, before any virtualization: CSS containment on top-level blocks
(`content-visibility: auto; contain-intrinsic-size: auto <measured height>`, plus
`contain: layout style` on each block) so WebKitGTK can skip layout of offscreen blocks
when the selection changes. Measure the 3,000- and 10,000-line cases with and without it
and record the numbers in DESIGN.md. Viewport-only rendering of ProseMirror nodes is a
last resort (it complicates find, spellcheck, and selection).

## Q-012: Rendered links have no `href` attribute
**Asked by:** implementation team, 2026-11-21
**Answer (spec team, 2026-11-21):** Accepted. Keep `a[data-href]` without `href` in the
editor. Themes for the reference editor overwhelmingly style links through `a`,
`#write a`, and `a:hover`; `a[href]`, `:link`, and `:visited` selectors are rare and
affect only colors, so the cost is small. Requirements: links get `cursor: pointer`
from the base CSS when Mod is held (and always when "Open links with single click" is
on), and keep a `title` tooltip with the URL per 3.9. Exports use real `href`.
`10-themes.md` 10.3 is updated.

## Q-013: Does the front matter `title` replace the window title for saved files too?
**Asked by:** implementation team, 2026-11-21
**Answer (spec team, 2026-11-21):** (a), as in the interim. The front matter `title`
replaces the name part for every document, saved or untitled: `X - Scrim`, and
`• X - Scrim` when dirty. Without it, the file name with extension, or `Untitled`.
`07-files-and-workspace.md` 7.1 and B-11 are updated.

## Q-014: Dragging text and dropping files on Windows
**Asked by:** implementation team, 2026-11-21
**Answer (spec team, 2026-11-21):** (a), on all platforms. Keep native file drops on.
Implement text drag-move (and Mod+drag copy) with pointer events everywhere, not only on
Windows: one code path, and WebDriver can drive it, so C-6 becomes an automated test.
Behavior to match: the drag starts only after pressing inside a non-empty selection and
moving more than 4 px; the drop indicator line (6.3) follows the pointer; Escape cancels;
dropping inside the dragged range does nothing. Dragging text out of Scrim into other
apps is not required in v1. Dropping text from other apps is supported where the
platform delivers it with the native handler on; elsewhere it is out of scope for v1.
`06-clipboard-and-dnd.md` 6.3 is updated.

## Q-015: "Allow iframes in HTML" versus the Content-Security-Policy
**Asked by:** implementation team, 2026-11-21
**Answer (spec team, 2026-11-21):** Neither as stated. Browsers enforce every policy that
applies, so a page can tighten its CSP at runtime but never loosen it. Use that:
- The configured CSP has `frame-src https:`.
- When "Allow iframes" is off, each editor page adds `<meta http-equiv=
  "Content-Security-Policy" content="frame-src 'none'">` at startup, before any document
  content renders. The sanitizer still removes iframes too (two layers).
- Turning the setting off adds that meta tag to every open window immediately.
- Turning it on applies to windows opened afterwards. The checkbox shows "Applies to new
  windows" while any window still has the stricter policy. No window recreation.
- When on, iframes keep the 4.10 sandbox rules (no scripts unless the domain is in
  `iframeAllowlist`).
`19-privacy-and-network.md` and `11-preferences.md` are updated.
