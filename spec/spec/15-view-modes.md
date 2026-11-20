# 15. View modes

## Source code mode (Mod+/)

- Replaces the live view with a CodeMirror 6 editor showing the entire Markdown source
  with Markdown syntax highlighting, using the theme's fonts and `#write` column width.
  The editor element has id `scrim-source`, and `body` gets class `md-source-mode`
  (theme hooks).
- Cursor and selection are preserved across the switch (source offsets), and the line at
  the top of the viewport stays at the top.
- Undo across the switch follows `01-architecture.md`, "Undo across live and source
  mode".
- Line wrapping on; line numbers off (setting "Line numbers in source mode", default off).
- Find/replace works with regex here.
- Switching back re-parses only changed regions; untouched blocks keep their identity.

## Focus mode (F8)

All blocks except the one containing the cursor are dimmed to `--blur-text-color`
(rendered text color). `body.on-focus-mode`; the focused block has `md-focus`. Inside
lists, the focused unit is the list item, not the whole list.

## Typewriter mode (F9)

The line with the cursor stays vertically centered in the viewport while typing and
moving with the keyboard (smooth scroll, 100 ms). Mouse scrolling is free; the next
keystroke recenters. Adds top padding of half the viewport height so the first line can
be centered. `body.scrim-typewriter-mode`.

## Zoom

Mod+Shift+= / Mod+Shift+- / Mod+Shift+0 zoom the whole window content in 10% steps
(50%–300%). The level is remembered globally.

## Full screen and always on top

F11 toggles full screen; in full screen the menu bar hides and shows when the pointer
reaches the top edge. View → Always on Top toggles the window's always-on-top flag.
