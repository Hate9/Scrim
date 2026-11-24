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

## Q-019: T-1 candidates after Q-018
**Asked by:** spec team (second review of `goldens/2026-11-21-q018`), 2026-11-21
**Question:** Much closer. Remaining differences: blockquotes too tall in every theme;
vue's code tokens uncolored; orangeheart's code block background missing (only its
`::before` bar shows, code text below it); blackout's text touches the window edge;
link cursor (implementation question).
**Answer (spec team, 2026-11-21):** All are base-stylesheet issues; 10.3 "Base
stylesheet" is corrected:
- Drop the `:where()` wrapping from Q-018 (my mistake). Base rules keep their natural
  specificity; themes are tuned against it (the quote height comes from
  `blockquote > :last-child { margin-bottom: 0 }` losing to theme `p` margins).
- CodeMirror 6's injected styles go in `@layer scrim-cm` so any theme rule beats them
  (orangeheart's `.cm-s-inner.CodeMirror` background).
- Base includes CodeMirror 5's default token palette under `.cm-s-inner` (vue relies
  on it).
- `#write` gets `padding: 36px 30px 70px` and `min-height: 100vh` (blackout).
- Link cursor: confirmed as implemented. Text cursor in the editor; `pointer` only
  while Mod is held or with "Open links with single click"; `pointer` in exports.
Regenerate the candidates after these changes.

## Q-020: T-1 candidates after Q-019
**Asked by:** spec team (third review of `goldens/2026-11-21-q019`), 2026-11-21
**Question:** Quotes, vue tokens, orangeheart code background and blackout padding are
fixed. Two differences remain:
- Code block text ignores the theme's font. orangeheart sets `font-family` on
  `.cm-s-inner.CodeMirror`; the reference shows that font in the block, Scrim shows the
  generic monospace and a taller block. notion's code text is also larger than the
  reference.
- orangeheart's front matter renders as a dark code block. The reference shows the
  base `#ccc` strip, because orangeheart has no rule for `pre.md-meta-block`.
**Answer (spec team, 2026-11-21):** Both are fixed in 10.3 "Base stylesheet":
- Everything inside `.CodeMirror` inherits `font-family`, `font-size` and
  `line-height`. CodeMirror 6 declares these on `.cm-scroller`, and the declared
  value beats the theme's inherited one, so the base resets them to `inherit` on
  `.CodeMirror-scroll` and `.CodeMirror-code`.
- Front matter carries no CodeMirror alias classes, whether shown or edited.
Remaining differences come from the fonts installed in CI versus the reference
machine and need no change. Regenerate the candidates after these changes.

## Q-021: T-1 candidates after Q-020
**Asked by:** spec team (fourth review of `goldens/2026-11-22-q020`), 2026-11-22
**Question:** Front matter and code fonts are fixed; seven themes match. orangeheart's
code block still has an extra empty line above the code. The theme's
`.md-fences:before { content: ' '; display: block }` renders as a full line in Scrim,
while in the reference it has zero height.
**Answer (spec team, 2026-11-22):** The code block container (`pre.md-fences`) has
`white-space: normal`, so a pseudo-element whose content is only a space collapses to
nothing. The code lines inside keep their own wrapping. Added to 10.3 "Base
stylesheet". Regenerate the candidates after this change.

## Q-022: T-1 candidates after Q-021
**Asked by:** spec team (fifth review of `goldens/2026-11-22-d506069`), 2026-11-22
**Question:** Q-021 fixed orangeheart's code block, and seven themes match the
reference. One difference is left in orangeheart, which has no `hr` rule. The
reference shows the browser's default rule there: a faint two-tone gray line with
about 0.5em of space above and below. Scrim draws a solid dark line with less space
before the following paragraph.
**Answer (spec team, 2026-11-22):** The base stylesheet gives horizontal rules no
styling. `div.md-hr` and its `hr` keep the browser defaults (1px inset gray border,
`0.5em` margins). Find out what in Scrim draws the solid line (an editor or
node-view default, for example) and remove it. Added to 10.3 "Base stylesheet".
Regenerate the candidates after this change. If orangeheart then matches, all eight
are ready for owner approval.

## Q-023: Default horizontal rule renders darker in WebKitGTK than in the reference
**Asked by:** implementation, 2026-11-22 (full question in Scrim's
`spec-questions/Q-023.md`)
**Question:** Nothing in Scrim styles the rule. WebKitGTK shades the default 1px
`inset` gray border much darker than Chromium does. Options: (1) keep the engine
default, (2) a fixed-color zero-specificity base rule, (3) a `color-mix` rule derived
from `currentColor`.
**Answer (spec team, 2026-11-22):** Option 1. This is a difference between engines'
built-in rendering, not something Scrim draws. Both compensating rules would rest on
a single Chromium sample and could break themes that style `hr` partly. On Windows
the webview is Chromium-based, so the default already matches there. Remove the
`SPEC-QUESTION Q-023` marker. 10.3 notes the accepted difference. The spacing is
fine as is. The T-1 candidates on `goldens/2026-11-22-d506069` pass spec team review
and are now waiting for owner approval.

## Q-024: Which CJK font, if any, to bundle for PDF headers and footers
**Asked by:** implementation, 2026-11-22 (full question in Scrim's
`spec-questions/Q-024.md`)
**Question:** 9.3 asks for a Noto Sans CJK subset "on demand", but the pan-CJK font
adds about 16 MB and a single-region font about 4.5 MB. Symbols such as ✓ are in
neither. Options: (1) bundle all of CJK, (2) bundle one region, (3) bundle Noto Sans
only and fall back to system fonts.
**Answer (spec team, 2026-11-22):** Option 3, as implemented in the interim. A
document whose title needs CJK glyphs nearly always has CJK body text too, and the
body already depends on system fonts, so bundling a font only for the header would
not make that document render on a machine without CJK fonts. 9.3 now describes this
behavior. Remove the `SPEC-QUESTION Q-024` marker. X-5 keeps running with the
system's CJK and symbol fonts installed.

## Q-025: X-1 screenshot comparison and blocks the export leaves out
**Asked by:** implementation, 2026-11-22 (full question in Scrim's
`spec-questions/Q-025.md`)
**Question:** The export leaves out front matter, link reference definitions and HTML
comment placeholders, so a whole-page comparison fails on those blocks alone. Should
the editor screenshot hide them, should the export keep them, or should X-1 compare
block by block? And can the export be loaded in an iframe of the document window
rather than a hidden webview?
**Answer (spec team, 2026-11-22):** Option 1, as implemented in the interim: the
editor screenshot hides the blocks that are not exported content. The export stays as
9.1 describes it. The iframe is fine. It uses the same engine and settings, and X-1
exists to compare rendering. The iframe is a test-harness arrangement: the editor's
CSP (19) still applies in the product, so if the iframe needs a CSP exception, add it
only in test builds. X-1 is updated.

## Q-026: Plan for the P8 performance work after the real-hardware run
**Asked by:** spec team, from the owner's real-hardware run, 2026-11-22
**Question:** On real hardware (Ryzen 5 3600, RTX 3070, KDE on Wayland via XWayland,
debug build, `SCRIM_PERF_STRICT=1`) the results are: PF-1 open 1 MB 6,162 ms (budget
2,000); E-14 median 19.0 ms, p95 34.0 ms (budget 16); first switch to source mode on
10,000 lines 789 ms (budget 300); sidebar with 5,000 files 122 ms (passes). Real hardware
is only about 2 times faster than the software-rendered display, so the budgets are not
met by hardware alone. Which approach?
**Answer (spec team, approved by the project owner, 2026-11-22):** The budgets stand.
Do both of the following, measure each separately, and record the numbers in DESIGN.md.

1. **Block parsing in Rust for whole-document parses** (open, reload, leaving source
   mode). 01 now allows this. The Rust side returns block spans with byte offsets
   together with the file text, in one IPC reply. Requirements:
   - The Rust block model MUST equal the frontend's for all 699 documents in the
     existing equivalence test, with strict mode both on and off. Add that check to CI,
     so the two parsers cannot drift apart.
   - Every Markdown extension the editor supports (front matter, math blocks, footnote
     and link definitions, HTML blocks, `[TOC]`, tables, task lists, lenient headings
     with strict mode off) MUST be covered. Where a crate's behavior differs, a small
     purpose-built block scanner is acceptable.
   - Incremental parsing while typing stays in the frontend, so a keystroke never waits
     on IPC.
   - Measure in a release build too: run the e2e performance tests with
     `SCRIM_APP` pointing at a release binary, and report both numbers.
2. **CSS containment on top-level blocks with measured heights**, as Q-011 described:
   `content-visibility: auto; contain-intrinsic-size: auto <measured height>` plus
   `contain: layout style`. The heights must come from real layout, not a constant. The
   earlier attempt with a fixed 1.6em was 30 times slower. Re-measure after theme
   changes, font changes and window resizes. Before adding containment, profile one
   E-14 run and check whether Scrim's own code forces the layouts (reading geometry
   after each keystroke: cursor coordinates, scroll-into-view, status bar, toolbar).
   Remove any such forced layout first. Provide a way to enable WebKit's inspector in
   debug builds so the owner can profile on real hardware. Containment MUST NOT break
   find, selection across offscreen blocks, spell check, IME, or scroll restore.
   Existing tests cover most of these. Add one that selects from the top of a 10,000-line
   document to the bottom and copies.

Fallback: if E-14 p95 still exceeds 16 ms on the owner's machine after both changes,
report the numbers and the profile before starting viewport-only rendering. That is a
separate decision.

## Q-027: Real-hardware results after Q-026, and the next performance step
**Asked by:** implementation (open decisions after Q-026), with the owner's real-hardware
run, 2026-11-22
**Question:** Containment and Rust block parsing are in, and E-14 is still over budget.
Should viewport-only rendering start? Should the source editor be preloaded to fix the
first switch to source mode?
**Answer (spec team, approved by the project owner, 2026-11-22):**

Owner's machine (Ryzen 5 3600, RTX 3070, KDE on Wayland via XWayland), release build of
eb9d5cd, `SCRIM_PERF_STRICT=1`:

| Measure | Before Q-026 (release) | eb9d5cd | Budget |
|---|---|---|---|
| Open 1 MB | 4,961 ms | 5,941 ms | 2,000 ms |
| E-14 p95 (median) | 35.0 (19.0) ms | 36.0 (19.0) ms | 16 ms |
| E-14 p95 (median), `SCRIM_E14_CONTAIN=1` | n/a | 216.0 (90.0) ms; measuring took 163 ms | 16 ms |
| First switch to source mode, 10,000 lines | 777 ms | 1,042 ms | 300 ms |
| Sidebar, 5,000 files | 48 ms | 45 ms | 1,000 ms |

Containment is confirmed slower on real hardware as well. Remove the
`experimentalContainment` option and its code. The open got about 1 s slower even
though parsing is faster. Find out why (the load-unfocused-then-focus change is the
first suspect), and report the breakdown of the open (read, parse, IPC, view build,
first layout).

1. **Viewport-only rendering: approved.** Only top-level blocks near the viewport are in
   the DOM, with a margin of at least one screen above and below. The other blocks are
   represented by spacers whose heights come from measurement, or an estimate until a
   block has been measured. The document model stays complete, and the editor's
   behavior must not change. Constraints:
   - Find and replace, spell check, word count, outline, select all, copy and cut, and
     export all work from the document model, never from the DOM. Selections and finds
     whose ends are outside the rendered range work: rendering moves to the match or
     selection end, and a selection spanning unrendered blocks copies its full content.
   - Theme compatibility (10.3) holds. A theme's CSS counters (heading or list
     numbering) and sibling selectors (`h2 + p`, `:first-child`) MUST render the same as
     with the whole document in the DOM. For example, carry the counter values into the
     first rendered block, and keep real neighbors on both edges of the rendered range.
     T-1's goldens MUST stay identical. Add a T-1-style test on a long document that
     scrolls to the middle with a theme that numbers headings.
   - The scrollbar, scroll restore (7.x), jump to heading, and outline clicks land
     exactly on the target. When a spacer's estimate is replaced by a measured height,
     the content at the top of the viewport MUST NOT move (scroll anchoring).
   - IME composition, typewriter mode and focus mode keep working at the edges of the
     rendered range.
   - Accessibility: screen readers see only the rendered range. That is accepted. The
     margin keeps reading by line working.
   - Documents below a threshold (start at 2,000 top-level blocks, and record the
     tuning in DESIGN.md) render whole, so small documents behave exactly as before.
   - Measure E-14 and PF-1 before and after. The owner repeats them on real hardware.
2. **Source editor preloading: approved.** Create the source-mode editor in the
   background (idle time after opening) so the first switch costs the same as later
   ones. It must not delay the first frame of the open.

## Q-028: Where PF-1's timers stop
**Asked by:** implementation, after the owner's real-hardware run of c7f07b9, 2026-11-24
**Question:** After every open of a large document, WebKit stalls the main thread once
(about 500 ms on the 1 MB fixture, about 150 ms on 10,000 lines). PF-1 stops its timer at
the second frame, which sometimes lands before the stall and sometimes after it, so the
reported open time swings between about 0.9 s and 1.4 s. Should PF-1 wait until the main
thread is free?
**Answer (spec team, approved by the project owner, 2026-11-24):**

Yes. A PF-1 timing runs from the request (the open command, or the source-mode toggle)
until the first frame showing the result has painted **and** no main-thread task longer
than 50 ms is running. Measure it as the end of the last long task after the second
frame, or the second frame itself if no long task follows within 100 ms. This is when
the user can start working, so it is what the budget measures. The budgets themselves
stay the same.

Results on the owner's machine (Ryzen 5 3600, RTX 3070, KDE on Wayland via XWayland),
release build of c7f07b9, `SCRIM_PERF_STRICT=1`, with the old measurement:

| Measure | Result | Budget |
|---|---|---|
| E-14 p95 (median), 10,000 lines | 8.0 (7.0) ms | 16 ms |
| Open 1 MB, five runs | 936, 1,393, 1,394, 1,372, 1,363 ms | 2,000 ms |
| First switch to source mode, in / out | 224 / 43 ms | 300 ms |
| Later switch to source mode, in / out | 184 / 32 ms | 300 ms |
| Sidebar, 5,000 files | 134 ms | 1,000 ms |

Leave the post-open stall alone. It is WebKit's own work (first paint of a large DOM, or
a timed garbage collection), it happens once per open, and the open is under budget
with it included. Keep the investigation notes in DESIGN.md.

## Q-029: Layout of the notice bar
**Asked by:** the project owner, from a manual run of cc0dbcb, 2026-11-24
**Question:** In the "Recovered 1 unsaved document." notice, the "Show" button sits in
the middle of the bar. Where do a notice's buttons go?
**Answer (spec team, approved by the project owner, 2026-11-24):**

The message is left-aligned. All action buttons sit together at the right edge, in
their given order, 8 px apart, with the close button last. Nothing in the bar is
centered. This applies to every notice bar. See the "Notice bar" row in 22.5.
