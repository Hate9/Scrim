# Scrim: functional specification

This repository is the complete specification for **Scrim**, a desktop Markdown editor
for Linux and Windows. (A scrim is the theatre fabric that hides or reveals what is
behind it depending on how it is lit; Scrim hides or reveals Markdown syntax depending
on where the cursor is.) It is a **clean-room specification**: it describes behavior only. It was
written by people who studied an existing proprietary editor; it is implemented by
people who have not. The specification is the implementer's only source of truth about
the intended behavior.

The spec's prose says "the editor"; it always means Scrim. Name, binary name, and app id
are defined in `spec/01-architecture.md`, "Identity".

## Read this first

1. [`CLEAN-ROOM.md`](CLEAN-ROOM.md): rules for the implementer. Mandatory.
2. [`spec/00-overview.md`](spec/00-overview.md): what the editor is, the user it serves,
   and the build phases.
3. Then the numbered spec files in order. Each phase in the overview lists which
   sections it needs.

## Layout

| File | Contents |
|---|---|
| `CLEAN-ROOM.md` | Clean-room protocol, allowed and forbidden sources, question channel |
| `spec/00-overview.md` | Product summary, principles, phases, definition of done |
| `spec/01-architecture.md` | Stack, process model, document model, persistence, identity |
| `spec/02-markdown-dialect.md` | Exactly which Markdown is parsed and how it is written back |
| `spec/03-editing-model.md` | Live-preview editing: rendering, syntax reveal, input rules, keys |
| `spec/04-blocks.md` | Per-block behavior: code, math, tables, images, HTML, lists, etc. |
| `spec/05-inline.md` | Per-inline behavior: emphasis, links, code, math, HTML, emoji, etc. |
| `spec/06-clipboard-and-dnd.md` | Copy, cut, paste, drag and drop |
| `spec/07-files-and-workspace.md` | Files, folders, sidebar, quick open, search, recovery, windows |
| `spec/08-find-replace.md` | In-document find and replace |
| `spec/09-export-import.md` | HTML, PDF, Pandoc export and import |
| `spec/10-themes.md` | Theme files and the theme compatibility DOM contract |
| `spec/11-preferences.md` | Preferences window, settings storage, advanced config |
| `spec/12-shortcuts-and-menus.md` | Menu structure and default shortcuts |
| `spec/13-spellcheck.md` | Spell checking with system dictionaries |
| `spec/14-status-and-counts.md` | Status bar, word count, reading time |
| `spec/15-view-modes.md` | Source mode, focus mode, typewriter mode, zoom, full screen |
| `spec/16-snippets.md` | Snippets and the snippet picker |
| `spec/17-custom-tags.md` | Custom HTML tags |
| `spec/18-customize-pane.md` | In-app editors for user CSS and advanced config |
| `spec/19-privacy-and-network.md` | Network policy |
| `spec/20-acceptance-tests.md` | Behavioral acceptance tests per phase |
| `spec/21-non-goals-and-risks.md` | Out of scope, known hard parts |
| `spec/22-visual-design.md` | Measured design values for the built-in themes and chrome |
| `wireframes/*.svg` | Original wireframes: window, sidebar, quick open, find bar, preferences, customize pane, snippet picker |
| `QA-LOG.md` | Questions from the implementer and their answers (spec addenda) |

## Conventions

- **MUST / SHOULD / MAY** have their RFC 2119 meanings.
- `Mod` means Ctrl on both Linux and Windows. Shortcuts are written `Mod+Shift+K`.
- "Cursor" means a collapsed selection. "Selection" means a non-empty one.
- `|` inside an example marks the cursor position. `«…»` marks a selection.
- "Source" means the Markdown text of the document. "Rendered" means what the user sees.
- Examples use `␣` for a significant space and `⏎` for Enter when it matters.
