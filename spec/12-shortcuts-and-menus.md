# 12. Menus and default shortcuts

The menu bar is native (Tauri menu). Every item that has an action can be rebound via
`config.jsonc` `shortcuts` using the item's English label (case-insensitive, `…` and
`.` ignored) as the key and an accelerator string as the value, e.g.
`"Strong": "Ctrl+Shift+B"`. An empty string unbinds. Snippet items and "Insert
Snippet…" are configured only in the Customize pane (`local.json`), not here. Prefix `global:` registers a
system-wide shortcut (best effort). Bindings reload live when `config.jsonc` is saved.

Mnemonics (Alt+letter) on top-level menus: File F, Edit E, Paragraph P, Format O,
Snippets S, View V, Themes T, Help H.

Items that are toggles show a checkmark; items that apply to the current context (for
example the current block type in Paragraph) show a checkmark for the active one.

## File
| Item | Key |
|---|---|
| New | Mod+N |
| New Window | Mod+Shift+N |
| Open… | Mod+O |
| Open Folder… | |
| Quick Open… | Mod+P |
| Open Recent ▸ | |
| Reveal in Folder | |
| Save | Mod+S |
| Save As… | Mod+Shift+S |
| Rename… / Move To… / Delete | |
| Import… | |
| Export ▸ (09) | Export with Previous: Mod+Shift+E |
| Print… | |
| Recover Unsaved Drafts… | |
| Preferences… | Mod+, |
| Close | Mod+W |
| Quit | Mod+Q |

## Edit
| Item | Key |
|---|---|
| Undo / Redo | Mod+Z / Mod+Y (also Mod+Shift+Z) |
| Cut / Copy / Paste | Mod+X / Mod+C / Mod+V |
| Copy as Plain Text | |
| Copy as Markdown | Mod+Shift+C |
| Copy as HTML Code | |
| Paste as Plain Text | Mod+Shift+V |
| Select All | Mod+A |
| Select Line | Mod+L |
| Select Styled Scope | Mod+E |
| Select Word | Mod+D |
| Delete Word | Mod+Shift+D |
| Jump to Top / Selection / Bottom | Mod+Home / Mod+J / Mod+End |
| Find… / Find Next / Find Previous / Replace… | Mod+F / F3 / Shift+F3 / Mod+H |
| Search in Folder… | Mod+Shift+F |
| Emoji and Symbols… | Super+. (Windows only, opens the OS panel) |
| Spell Check ▸ (13) | |

## Paragraph
| Item | Key |
|---|---|
| Heading 1 … Heading 6 | Mod+1 … Mod+6 |
| Paragraph | Mod+0 |
| Increase / Decrease Heading Level | Mod+= / Mod+- |
| Table… | Mod+T |
| Code Fences | Mod+Shift+K |
| Math Block | Mod+Shift+M |
| Quote | Mod+Shift+Q |
| Ordered List / Unordered List / Task List | Mod+Shift+[ / Mod+Shift+] / Mod+Shift+X |
| Indent / Outdent | Mod+] / Mod+[ |
| Move Row/Item Up / Down | Alt+Up / Alt+Down |
| Insert Paragraph Before / After | |
| Link Reference, Footnote, Horizontal Line, Table of Contents, YAML Front Matter | |

## Format
| Item | Key |
|---|---|
| Strong / Emphasis / Underline | Mod+B / Mod+I / Mod+U |
| Code | Mod+Shift+` |
| Inline Math / Strike / Highlight / Superscript / Subscript | — / Alt+Shift+5 / — / — / — |
| Comment (wrap in `<!-- -->`) | |
| Hyperlink | Mod+K |
| Image ▸ Insert Image… / Zoom ▸ | Mod+Shift+I |
| Clear Format | Mod+\ |

## Snippets
See `16-snippets.md`. First item "Insert Snippet…" (default Ctrl+Alt+Space), separator,
then one item per snippet with its shortcut.

## View
| Item | Key |
|---|---|
| Source Code Mode | Mod+/ |
| Focus Mode / Typewriter Mode | F8 / F9 |
| Show Status Bar | |
| Toggle Sidebar | Mod+Shift+L |
| Outline / File List / File Tree | Mod+Shift+1 / Mod+Shift+2 / Mod+Shift+3 |
| Actual Size / Zoom In / Zoom Out | Mod+Shift+0 / Mod+Shift+= / Mod+Shift+- |
| Toggle Full Screen | F11 |
| Always on Top | |
| Toggle DevTools (only when debugging enabled) | Shift+F12 |

## Themes
Radio list of themes (10.1), separator, "Open Theme Folder", "Reload Themes".

## Help
Local documents only (they ship inside the app, written for this project):
Quick Start, Markdown Reference, Shortcuts, Custom Themes, Snippets and Custom Tags,
then separator, Open Log Folder, Credits (third-party licenses), About. No web links.

## Context menu (document)
Cut, Copy, Paste, Paste as Plain Text; formatting quick row (B, I, code, link);
Insert ▸ (image, table, code block, math, footnote, hr, TOC); Copy as Markdown;
spelling suggestions when on a misspelled word (13); "Search with…" entries from
`contextSearch` (config.jsonc) when text is selected; Open Link / Copy Link Address on links;
image items (open, reveal, zoom, copy to assets folder, delete image file) on images.
