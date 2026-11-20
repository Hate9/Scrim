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
