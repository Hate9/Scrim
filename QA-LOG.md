# Q&A log (implementation team)

Questions for the spec team, relayed by the project owner (CLEAN-ROOM.md, "Question
channel"). Until an answer arrives the code follows the stated interim behavior, marked
`SPEC-QUESTION Q-NNN`. Answers, once given, are copied here verbatim from
`spec/QA-LOG.md` and are binding; code then cites `QA-LOG Q-NNN` instead.

Q-000 is the spec team's own entry; its answer is in `spec/QA-LOG.md`.

## Q-001: App id contains `_`, which the Tauri bundler rejects
**Asked by:** implementation team, 2026-11-20
**Question:** `01-architecture.md` gives the app id `io.gitlab.sisters_vibecode.Scrim`.
Tauri's `identifier` (used for bundles, the Windows installer, and Tauri's own data
paths) only allows letters, digits, `-` and `.`, so the build fails with it. D-Bus and
desktop-file ids, on the other hand, disallow `-` in that position, which is presumably
why the spec uses `_`. Options: (a) keep `io.gitlab.sisters_vibecode.Scrim` as the
desktop/AppStream/D-Bus id and use `io.gitlab.sisters-vibecode.Scrim` as the Tauri
bundle identifier; (b) pick one id without either character (for example
`io.gitlab.sistersvibecode.Scrim`) everywhere.
**Interim:** (a). `APP_ID` stays as specified; `identity::bundle_identifier()` derives the
hyphen form, and a unit test keeps `tauri.conf.json` in sync with it.
**Answer (spec team, 2026-11-20):** Option (b). Use one id everywhere:
`io.gitlab.sistersvibecode.Scrim`. `01-architecture.md` "Identity" is updated. Drop the
derived hyphen form.

## Q-002: What is the "parser-only form" of R-1 that runs from P0?
**Asked by:** implementation team, 2026-11-20
**Question:** `20-acceptance-tests.md` says "Round trip (part of P1; R-1 parser-only form
runs from P0)". P0 has no Markdown parser; it loads and saves plain text. Is the P0 form
of R-1 meant to be (a) the file layer only (decode → editor text → encode is
byte-identical for every corpus file, including encodings, BOMs and mixed line endings),
with the parse/serialize form starting in P1, or (b) a standalone parser/serializer
round trip that should already exist in P0 even though the editor does not use it yet?
**Interim:** (a). The corpus (`tests/corpus/`, including all CommonMark 0.31.2 and GFM
extension examples) and the file-layer round trip tests exist now; the parser form is
added in P1 against the same corpus.
**Answer (spec team, 2026-11-20):** Option (a). In P0, R-1 is the file-layer round trip
(decode → editor text → encode is byte-identical for every corpus file). The
parse/serialize round trip starts in P1 against the same corpus. `20-acceptance-tests.md`
is updated.

## Q-003: Launching with a path that does not exist
**Asked by:** implementation team, 2026-11-20
**Question:** What should `scrim notes/new.md` do when the file does not exist? Options:
(a) open an empty document bound to that path; the file is created on first save (the
title shows `new.md - Scrim`); (b) show an error and open nothing (or an untitled
document).
**Interim:** (a), logged as "does not exist; new document". Unreadable files (permission
denied, a directory) show an error bar and open as an untitled document, so a later
save cannot overwrite them by accident.
**Answer (spec team, 2026-11-20):** Option (a), as implemented: an empty document bound to
that path, title `new.md - Scrim`, created on first save. If the parent folder does not
exist either, the first save asks "Create folder <path>?" (Create / Cancel). Unreadable
paths (permission denied, a directory, a device) show an error bar and open an untitled
document, as implemented. `07-files-and-workspace.md` 7.8 is updated.

## Q-004: "Latin-1" files and the euro sign (R-8)
**Asked by:** implementation team, 2026-11-20
**Question:** R-8 expects that typing `€` into a Latin-1 file and saving asks to save as
UTF-8. Encoding detectors (and the WHATWG Encoding Standard) treat unlabeled Latin-1
text as windows-1252, which does contain `€` (byte 0x80), so with a plain detector the
save would succeed silently in windows-1252. Options: (a) when the detected encoding is
windows-1252 but the file has no byte in 0x80–0x9F (so it is also valid ISO-8859-1),
treat it as true ISO-8859-1, where `€` is unrepresentable and triggers the prompt; files
that do use 0x80–0x9F stay windows-1252; (b) always windows-1252 (R-8's `€` case would
then not prompt).
**Interim:** (a). The detected encoding name (`ISO-8859-1` or `windows-1252`) is logged on
open.
**Answer (spec team, 2026-11-20):** Option (a). A file detected as windows-1252 with no
byte in 0x80–0x9F is treated as ISO-8859-1; files that use 0x80–0x9F stay windows-1252.
`01-architecture.md` "Persistence" is updated.

## Q-005: Files with bytes that are invalid in their detected encoding
**Asked by:** implementation team, 2026-11-20
**Question:** A file can start with a UTF-8 or UTF-16 BOM but contain invalid sequences
(or be corrupt in another way). Decoding shows those bytes as U+FFFD. Saving them back
would write U+FFFD, which the "never writes replacement characters silently" rule
forbids. What should happen? Options: (a) show a notice on open ("Some bytes in this
file are not valid UTF-8 and are shown as �"); open-then-save without edits writes the
original bytes unchanged; saving after an edit asks "Save Anyway" / Cancel; (b) open
such files read-only; (c) refuse to open them.
**Interim:** (a).
**Answer (spec team, 2026-11-20):** Option (a), as implemented. Prompt text on saving after
an edit: "Some bytes in this file could not be read and will be saved as �." with
**Save Anyway** / **Cancel**. (No "Save as UTF-8" choice here: converting would not
recover the unreadable bytes.) Open-then-save without edits writes the original bytes. `01-architecture.md` "Persistence" is updated.

## Q-006: WebView2 settings and arguments need verification on Windows
**Asked by:** implementation team, 2026-11-20
**Question:** `19-privacy-and-network.md` asks to verify the WebView2 browser argument
names in P0. The implementation team has only Linux available. The code passes
`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Translate,SpareRendererForSitePerProcess
--disable-background-networking --disable-component-update --disable-domain-reliability
--no-pings` (the first three features are wry's defaults, which must be repeated because
setting arguments replaces them), and sets `IsReputationCheckingRequired = false` and
`AreBrowserAcceleratorKeysEnabled = false`. The Windows code type-checks but has not run.
Can the owner run P0 on Windows 11 (S-1, S-3, N-1 with a per-process firewall or ETW
trace), or provide a Windows machine/CI runner?
**Interim:** as above, unverified. A GitHub Actions Windows job builds and runs the unit
tests.
**Answer (spec team, 2026-11-20):** The argument list and settings are acceptable as
implemented (keeping wry's defaults is correct). **Project owner, 2026-11-20:** no Windows
machine for now; the GitHub Actions Windows job (build + unit tests) is sufficient until
later. Manual Windows checks (S-1, S-3, N-1 on Windows) are deferred, not dropped:
track them as an open item in the PR/README and revisit before P8.

## Q-007: Which window is "current" for files passed from a second launch?
**Asked by:** implementation team, 2026-11-20
**Question:** "Open files in: current window when possible" (7.1) reuses the current
window if its document is untitled and unmodified, or saved and unmodified. When a
second launch hands over a path (double-click in a file manager), which window is
"current": (a) the focused window of the running instance, if any, else none (new
window); (b) the most recently focused window even if the app is in the background;
(c) never reuse for handed-over paths?
Note that with (a) or (b), double-clicking a file in the file manager replaces a saved,
unmodified document the user was reading, which may surprise.
**Interim:** (a), implemented as the window that reports itself focused at that moment.
In practice the app is usually in the background when the user double-clicks a file,
so this usually opens a new window.
**Answer (spec team, 2026-11-20):** Option (c). Paths handed over by a second launch (file
manager double-click, command line while running) never replace an open document: if
the file is already open, focus that window; otherwise open a new window. The only
reuse is a window whose document is untitled **and** unmodified and empty (a fresh
"New" window), which is replaced instead of leaving an empty window behind.
`07-files-and-workspace.md` 7.1 is updated.

## Q-008: Does `<file name>` in the window title include the extension?
**Asked by:** implementation team, 2026-11-20
**Question:** S-1 and 7.1 say the window title is `<file name> - Scrim`. Is that
`notes.md - Scrim` or `notes - Scrim`?
**Interim:** with the extension (`notes.md - Scrim`).
**Answer (spec team, 2026-11-20):** Yes, with the extension: `notes.md - Scrim`.
`07-files-and-workspace.md` 7.1 is updated.

## Q-009: Backspace at the start of a list item that is not the first item
**Asked by:** implementation team, 2026-11-21
**Question:** 3.4's Backspace table says "First list item paragraph: Lift out of the list:
becomes a paragraph (nested: outdent one level)". Does "first list item paragraph" mean
(a) the first paragraph of *any* list item (Backspace at the start of item 3 turns it
into a paragraph between two lists, or outdents it if nested), or (b) only the
paragraph of the list's first item (Backspace at the start of item 3 merges it into
item 2's text)?
**Interim:** (a), the first paragraph of any item. `SPEC-QUESTION Q-009` in
`src/editor/commands.ts`.
**Answer (spec team, 2026-11-21):** (a): the first paragraph of **any** item. Nested: outdent
one level. Top level: the item becomes a paragraph between the two halves of the list;
both halves keep the original marker style and numbering style (`01-architecture.md`
round-trip item 5); the second half of an ordered list continues its numbering from
where it now starts in the source only if the list was sequential. `03-editing-model.md`
3.4 is updated.

## Q-010: Automatic escapes versus Enter- and space-triggered input rules
**Asked by:** implementation team, 2026-11-20
**Question:** The parse/display invariant (01, round-trip model item 6) escapes any line
that would change block type "after every transaction". Taken literally, it would
escape the first line of an empty paragraph as soon as the user types `#` or `-` (an
empty ATX heading, an empty list item) or ```` ``` ```` (a fence), and the input rules of
3.3 (`#␣`, `-␣`, ```` ```⏎ ````) could then never fire. Proposed behavior: while the
cursor is in a single-line paragraph and the text before it could still become a
space-triggered rule (`#`…`######`, `>`, `-`, `+`, `*`, `1.`/`1)`), or the paragraph is
exactly an Enter-triggered rule (fence, `$$`, `---`/`***`/`___`, an HTML open tag) with
the cursor at its end, the escape is deferred. It is applied when the cursor leaves the
paragraph and before every save, so the file is never written with the unescaped
trigger. Undo and redo restore earlier states exactly; their escapes also wait until
the cursor leaves. Is that acceptable?
**Interim:** as proposed. `SPEC-QUESTION Q-010` in `src/editor/escapes.ts`.
**Answer (spec team, 2026-11-21):** Accepted as proposed, with one addition: deferred
escapes are also applied before every other hand-off of the text, not just save: autosave,
draft-recovery writes, export, copy, and switching to source mode.
`01-architecture.md` round-trip item 6 is updated.

## Q-011: How should E-14 (typing latency) be measured?
**Asked by:** implementation team (owner decision), 2026-11-21
**Question:** E-14 asks for p95 < 16 ms per keystroke on a 10,000-line document "on a
mid-range laptop". The only automated environment available is a CI-style Linux
container with Xvfb and software rendering. There, Scrim's own work per keystroke
(transaction plus plugins) is about 2 ms, but WebKitGTK's synchronous layout of the
whole document when the selection is set grows linearly with document size: measured
p95 is 7 ms at 1,000 lines, 17 ms at 3,000 lines, and about 60 ms at 10,000 lines.
Options: (a) the owner measures E-14 manually on a real laptop before P8 (the test
prints the numbers; `SCRIM_PERF_STRICT=1` enforces the budget); (b) a CI runner with GPU
compositing; (c) treat large-document layout as part of P8's performance work (for
example rendering only the blocks near the viewport).
**Interim:** E-14 runs in the suite, reports its numbers, and fails only with
`SCRIM_PERF_STRICT=1`. Tracked in README "Open items".
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
**Question:** The theme contract (10.3) renders links as `a`. Inside the editor, Scrim
renders them as `<a data-href="…">` without `href`: WebKitGTK handles clicks on real
links inside the editable area itself (no events reach the editor in automation, and
the native URL tooltip window can swallow clicks), and Scrim opens links on Mod+click
on its own (3.9). Exports (P5) will use real `href`s. Do known themes style `a[href]`
specifically, such that the editor needs a real `href` (for example with navigation
blocked another way)?
**Interim:** no `href` in the editor; `#write a` is styled by the base CSS.
**Answer (spec team, 2026-11-21):** Accepted. Keep `a[data-href]` without `href` in the
editor. Themes for the reference editor overwhelmingly style links through `a`,
`#write a`, and `a:hover`; `a[href]`, `:link`, and `:visited` selectors are rare and
affect only colors, so the cost is small. Requirements: links get `cursor: pointer`
from the base CSS when Mod is held (and always when "Open links with single click" is
on), and keep a `title` tooltip with the URL per 3.9. Exports use real `href`.
`10-themes.md` 10.3 is updated.

## Q-013: Does the front matter `title` replace the window title for saved files too?
**Asked by:** implementation team, 2026-11-21
**Question:** 7.1 says the window title is `<file name> - Scrim`, and "`Untitled` for new
documents (title from front matter `title` if present)", which reads as if the front
matter title only replaces "Untitled". B-11 says "Front matter `title: X` → window title
'X'", without saying whether the document is saved, and 4.11 lists `title` as "window
title". Options: (a) the front matter title replaces the name part for every document
(`X - Scrim`, `• X - Scrim` when dirty); (b) only for untitled documents; (c) the whole
title becomes exactly `X`.
**Interim:** (a). `SPEC-QUESTION Q-013` in `src-tauri/src/commands.rs`.
**Answer (spec team, 2026-11-21):** (a), as in the interim. The front matter `title`
replaces the name part for every document, saved or untitled: `X - Scrim`, and
`• X - Scrim` when dirty. Without it, the file name with extension, or `Untitled`.
`07-files-and-workspace.md` 7.1 and B-11 are updated.

## Q-014: Dragging text and dropping files on Windows
**Asked by:** implementation team, 2026-11-21
**Question:** File drops from the file manager (6.3) need the files' paths, which only
Tauri's native drag-and-drop handler provides. On Windows, Tauri documents that this
handler must be turned off for HTML5 drag and drop inside the page to work, and moving
selected text by dragging (6.3, C-6) uses HTML5 drag and drop. On Linux both work at the
same time. Options for Windows: (a) keep native file drops; implement text drag-move
without HTML5 drag and drop (pointer events); (b) keep HTML5 drag-move; file drops on
Windows insert only what the browser exposes (no paths, so images would be pasted as
data, other files not linked); (c) accept that text drag-move does not work on Windows
in v1.
**Interim:** native file drops on, nothing Windows-specific yet (untested on Windows,
Q-006). C-6 is a manual test on Linux, where WebDriver cannot drive HTML5 drag and drop.
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
**Question:** 19's CSP has `frame-src <per settings>`. The CSP is fixed at window
creation in Tauri's configuration, so turning on "Allow iframes" (4.10) needs either a
`frame-src` that already lists `https:` (and relies on the HTML sanitizer, plus
`sandbox` on every iframe, to keep iframes out when the setting is off), or windows that
are recreated with a different CSP when the setting changes. Which is preferred?
**Interim:** `frame-src 'none'`; iframes are removed by the sanitizer unless the setting
is on, and when it is on they are sandboxed but still blocked by the CSP. To be resolved
with the preferences window (P4).
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
**Question:** 01 "Keyboard routing" rule 2 lists the keys that get no native
accelerator (clipboard and undo). On Linux, GTK runs a menu accelerator before the
webview sees the key at all, whatever has focus. So a native accelerator for Mod+Home,
Mod+End, Mod+L, Mod+D, Mod+[, Mod+], Mod+I, Mod+E, Mod+/, Mod+Shift+K, Mod+Shift+D,
Alt+Up, or Alt+Down also takes that key away from CodeMirror in source mode and in code
blocks, and from text fields (where Mod+Home/End move the caret). May these items
follow rule 2 too (shortcut shown in the menu label only; the key reaches the
dispatcher as a DOM keydown)?
**Interim:** yes. Those items show their key in the label and get no native
accelerator; every other menu item has one. The dispatcher runs document commands only
when the live document has focus, so in source mode CodeMirror's own keymap handles
these keys. Marked `// SPEC-QUESTION Q-017`.
