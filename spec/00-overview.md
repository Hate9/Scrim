# 00. Overview

## What the editor is

A desktop Markdown editor for Linux and Windows in which the document is edited in its
rendered form. There is no split preview pane. Headings look like headings, lists like
lists, tables like tables, math like typeset math, while the file on disk stays plain
Markdown. Markdown syntax characters for an inline element (for example `**` around bold
text) appear only while the cursor is inside that element, so the user can see and edit
them, and disappear again when the cursor leaves.

The editor is quiet and typographic: one centered column of text, generous whitespace,
no toolbars by default, chrome that stays out of the way. The sidebar (files and
outline) and the status bar are optional.

## Who it is for

People who write prose and notes in Markdown and want it to look finished while they
write. They care about: typing speed, not losing work, files staying plain Markdown that
other tools can read, keyboard shortcuts, themes, and the editor not doing anything over
the network behind their back.

## Principles (apply when the spec is silent)

1. **The Markdown file is the truth.** Opening and saving a file without editing it MUST
   produce a byte-identical file. Editing one block MUST NOT reformat other blocks.
2. **Never lose text.** Autosave and draft recovery exist; destructive actions confirm.
3. **The cursor never jumps unexpectedly.** Rendering changes must preserve the user's
   logical cursor position in the source.
4. **Typing is never blocked.** Rendering of expensive things (math, syntax highlight,
   images, spellcheck) happens asynchronously and never delays keystrokes.
5. **Plain over clever.** When two behaviors are plausible, pick the one that a Markdown
   user would predict from looking at the source.
6. **Offline.** No network access except resources a document itself references
   (see `19-privacy-and-network.md`).

## Platforms

- Linux x86_64 (primary; packaged as AppImage, .deb, and an Arch PKGBUILD) and
  Windows 10/11 x86_64 (MSI or NSIS installer).
- macOS is out of scope. Do not spend effort on it, but do not deliberately break it.

## Build phases

Each phase ends with its acceptance tests in `20-acceptance-tests.md` passing. Later
phases may refine earlier behavior but must not regress tests.

| Phase | Name | Spec sections | Outcome |
|---|---|---|---|
| P0 | Skeleton | 01, 19 | Tauri app opens a window, loads/saves a `.md` file as plain text, no network |
| P1 | Core editing | 02, 03, 05, 06 (text only), 12 (editing keys) | Live-preview editing of paragraphs, headings, emphasis, links, inline code, lists, blockquotes, hr; round-trip fidelity |
| P2 | Rich blocks | 04, 06 | Code blocks, math, tables, images, task lists, HTML, front matter, footnotes, TOC |
| P3 | Workspace | 07, 08, 14, 15 | Folders, sidebar (tree, list, outline), quick open, search in files, find/replace, status bar, source/focus/typewriter modes, recovery |
| P4 | Look and settings | 10, 11, 12, 22 | Themes (built-in + user + compatibility), preferences window, menus, all shortcuts |
| P5 | Output | 09 | HTML and PDF export, pandoc export/import, print |
| P6 | Language | 13 | Spell check with system dictionaries |
| P7 | Personal features | 16, 17, 18 | Snippets + picker, custom HTML tags, in-app CSS/config editors |
| P8 | Ship | 21 | Packaging for Linux and Windows, polish, performance budget |

## Definition of done (whole product)

- All acceptance tests pass on Linux (X11 and Wayland) and Windows 11.
- A 10,000-line Markdown document opens in under 2 seconds and typing latency stays
  under 16 ms per keystroke on a mid-range laptop.
- Open-then-save of every file in the round-trip corpus (`20-acceptance-tests.md`, R-1)
  is byte-identical.
- No network connections are made during any acceptance test except to the local test
  server used for remote-image tests.
