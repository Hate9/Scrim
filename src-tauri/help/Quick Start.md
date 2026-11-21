# Quick Start

Scrim shows your Markdown as formatted text and reveals the Markdown syntax only where
the cursor is. What you see is still a plain `.md` file: Scrim saves exactly what you
typed, and a file you open and save without editing stays byte-for-byte the same.

## Writing

- Type `# ` at the start of a line for a heading (`## ` for level 2, and so on).
- `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, and `[link](https://example.com)`
  format as soon as you close them. Move the cursor into formatted text to see and edit
  its markers.
- Start a line with `- `, `1. `, or `- [ ] ` for lists and task lists, or `> ` for a
  quote.
- Type three backticks and a language name, then Enter, for a code block.
- `$$` then Enter starts a math block (LaTeX).
- `|a|b|` then Enter makes a table.

## Files and folders

- File → Open Folder shows a folder in the sidebar (Ctrl+Shift+L toggles it).
- Ctrl+P opens any file in the folder by typing part of its name.
- Ctrl+Shift+F searches every file in the folder.
- Ctrl+/ switches to source code mode and back.

## Look

The Themes menu switches the look. Themes are CSS files: Themes → Open Theme Folder.
See Help → Custom Themes.

## Settings

File → Preferences (Ctrl+,). Advanced options live in `config.jsonc`, reachable from
Preferences → General.
