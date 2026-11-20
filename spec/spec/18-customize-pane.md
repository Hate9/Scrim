# 18. Customize pane

A section of Preferences (`11-preferences.md`) titled **Customize**, last in the section
list. It has three tabs, wireframe `wireframes/customize.svg`:

`Snippets & Tags` | `base.user.css` | `config.jsonc`, and a status text at the right end
of the tab row ("Saving…", "Saved", errors in red).

A tab with unsaved edits shows a `•` after its name. Switching tabs, sections, or
closing Preferences keeps unsaved text in memory for the session (no prompt).

## Tab 1: Snippets & Tags

Saves automatically 400 ms after the last change; every save applies live (menu,
picker, rendering) in all windows.

### Snippets group
Header "Snippets", hint "$0 = cursor, or where selected text goes. $$ = literal $."
One card per snippet (1 px border, 4 px radius, 8 px padding, 8 px gap):

- Row: **Name** text field (flex), **Shortcut** field (170 px, centered text), **✕**
  delete button.
- Below: warnings line (amber, 12 px), hidden when empty.
- Below: **Body** text area, monospace 12 px, 2–8 rows tall by content, resizable
  vertically, placeholder `<bottom>$0</bottom>`.

Below the cards: **Add Snippet** button (adds an empty card and focuses its name). With
no snippets: muted "No snippets yet."

Deleting is immediate (undo by re-adding; no confirm).

### Shortcut field behavior
- Read-only text field showing the accelerator; placeholder "Click, then press keys".
- On focus, placeholder changes to "Press a shortcut…", and all app shortcuts are
  suspended until the field loses focus, so built-in combos like Ctrl+B can be captured. The next key combination with at
  least one of Ctrl/Alt/Super (or a bare F1–F24) is captured, shown as
  `Ctrl+Alt+Shift+Super+Key` (fixed modifier order), saved, and the field blurs.
- Keys are layout-logical (`01-architecture.md`, "Keyboard routing"): letters and
  punctuation are recorded as the character the active layout produces on that key
  without modifiers (so Shift never changes the recorded key), uppercase for letters;
  plus Space, arrows (Up/Down/Left/Right), Enter, Tab, Backspace, Delete, Insert, Home,
  End, PageUp, PageDown, Esc (with modifiers), F-keys.
- Bare Backspace or Delete clears the shortcut. Bare Escape cancels (restores previous).
- Conflicts: after any change, each shortcut field shows "Also used by: …" listing
  menu items (with their menu path, e.g. "Format → Strong") and other snippets or the
  picker that use the same accelerator (normalized: modifier aliases and order ignored).

### Snippet Picker Shortcut group
One shortcut field (same behavior) for the picker; hint "(filter snippets by name)".

### Custom HTML Tags group
Hint "Rendered as real elements. Style them in base.user.css." Two rows:
**Inline** and **Block**, each a monospace text field taking names separated by commas
or spaces. Invalid tokens are listed under the field ("Ignored (not a tag name): 9bad").
A muted note: "Inline tags work like <span> inside paragraphs. A line starting with a
block tag becomes an HTML block (no Markdown inside)."

## Tab 2: base.user.css

- Shows the absolute path of the file (muted monospace, selectable).
- A code editor (CodeMirror 6, CSS mode, theme-aware colors) filling the available
  height (min 200 px) with Tab inserting 2 spaces.
- **Save** (Mod+S) writes the file and applies it live to all windows. **Revert**
  discards unsaved edits.
- If the file changes on disk while the tab has no unsaved edits, reload it silently;
  with unsaved edits, show "Changed on disk: Reload / Keep mine".

## Tab 3: config.jsonc

- Same layout and buttons as tab 2, JSON-with-comments mode.
- **Save** validates first (JSONC parser). Invalid: not saved; the parser error with
  line and column shows in red under the editor, status "Not saved: invalid config".
  Valid: saved verbatim (comments and formatting kept), reloaded; key bindings apply
  live; status notes "Some options apply after restart" when changed keys need it.
- "Open Advanced Settings" in Preferences → General opens this tab.

## Also

- Never launch an external editor for these files. (A user can still open the files
  directly from their file manager.)
