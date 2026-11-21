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
**Answer (spec team, 2026-11-21, revised same day):** Neither; route iframes through
an app-served wrapper so the setting applies live in both directions without
recreating windows. (The first version of this answer used a runtime meta-tag CSP and
"Applies to new windows"; it is withdrawn.)
- App pages' CSP: `frame-src` lists only the new `scrim-embed` protocol, never `https:`.
- The sanitizer rewrites each iframe in an HTML block to
  `scrim-embed://localhost/?src=<url>` (Windows form `http://scrim-embed.localhost/…`),
  copying `width`, `height`, `title`, and `style` onto that outer frame.
- The Rust handler checks the current setting on every request. On (and `https:`
  source): a static, script-free page whose own CSP allows `frame-src https:`, holding
  the real iframe at 100% size with the 4.10 sandbox rules (`allow-scripts` only for
  `iframeAllowlist` domains). Off: a static "Iframe blocked" placeholder with the URL.
- Changing the setting re-renders HTML blocks in every open window.
- Exports emit the original iframe with the sandbox rules, no wrapper.
`19-privacy-and-network.md` and `11-preferences.md` are updated.

## Q-016: Files tab when no folder is open
**Asked by:** implementation team, 2026-11-21
**Answer (spec team, 2026-11-21):** The interim is accepted, with these details. The
document's parent folder is an implicit folder: it scopes the Files tab, quick open, and
search in files, but is not added to recent folders and is not restored on launch as a
folder. It follows the document: opening or saving a file in another folder moves it,
and saving an untitled document sets it. Untitled, never-saved documents show "No folder
open" with **Open Folder**. Opening a folder replaces the implicit one. The file
watcher and tree behave as for an opened folder (so W-2 holds), and the existing limits
(`fileListLimit`, 10 MB/binary skip in search) protect against large parents such as the
home folder. `07-files-and-workspace.md` 7.4 is updated.

## Q-017: Menu accelerators that GTK takes before the webview
**Asked by:** implementation team, 2026-11-21
**Answer (spec team, 2026-11-21):** Yes, generalized into a rule instead of a list. Only
focus-independent commands (file, window, view, app) get native accelerators, on both
platforms. Every document command (formatting, block, selection, navigation,
paragraph) is label-only and goes through the DOM `keydown`. Classify by the command's
kind, not by its key, so user `shortcuts` overrides follow the same split; snippet
keybinds (16) are always label-only. The capturing listener runs focus-independent
commands from any focus and `preventDefault`s them, including inside CodeMirror (so
Mod+/ always toggles source mode and never reaches CodeMirror's comment command).
Document commands run only when the live document has focus; otherwise the key passes
through to CodeMirror or the text field. `01-architecture.md` "Keyboard routing" rule 2
is updated.

## Q-018: T-1 candidates do not match the fixture themes
**Asked by:** spec team (from reviewing the T-1 golden candidates), 2026-11-21
**Question:** The 8 candidates on `goldens/2026-11-21` render, but many theme rules do
not apply: list and quote spacing, code block backgrounds, table width and header
backgrounds, front matter colors, link and inline-code colors, and orangeheart's H2
badge. Cause: the 10.3 DOM contract was too coarse, and app base CSS rules outrank
theme rules.
**Answer (spec team, 2026-11-21):** `10-themes.md` 10.3 is rewritten with the exact
structure themes select on, and a new "Base stylesheet" subsection:
- text runs in `span.md-plain`; `li` and `blockquote` text always in `p.md-p`; inline
  wrappers (`span.md-pair-s`, `span.md-link`, `md-inline` attributes, `md-meta`
  markers); `ul.ul-list[data-mark]`, `ol.ol-list`, `li.md-list-item`, task-item classes;
  `table.md-table`, `span.td-span`; `div.md-hr > hr`; `md-end-block`;
  `md-focus-container`;
- the heading level hint is a `::before` pseudo-element, never a span (it was picking
  up `#write h2 span` rules);
- CodeMirror 5 alias classes for all CM6 parts; the source editor uses
  `cm-s-scrim-default` (new rewrite row for the other editor's equivalent);
- front matter is plain text, no YAML highlighting (`04-blocks.md` 4.11);
- base CSS for document content is wrapped in `:where()` and carries no colors,
  borders, or backgrounds; Scrim's look lives only in its built-in theme files.
Discard the current candidates; regenerate after these changes.
