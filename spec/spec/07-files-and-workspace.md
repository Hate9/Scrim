# 07. Files and workspace

## 7.1 Windows and documents

- Each window shows exactly one document at a time (no tabs). A window may also have a
  **folder** open in its sidebar.
- New window: Mod+Shift+N. New file (Mod+N) and opened files follow the setting
  "Open files in" (Preferences → General): **current window when possible** (default:
  reuse the current window if its document is untitled and unmodified, or saved and
  unmodified; otherwise open a new window) or **always new window**.
- Window title: `<file name> - Scrim`; a `•` before the name when unsaved;
  `Untitled` for new documents (title from front matter `title` if present).
- Closing a window with unsaved changes asks: Save / Don't Save / Cancel. With autosave
  on (7.6), saved files close silently; untitled documents still ask.
- Quitting the app asks for each dirty window in turn.
- On launch (Preferences → General → "On launch"): open a new file (default), restore
  last closed folder, restore last closed files and folders, or open a chosen folder.
- Window size and position are remembered per screen configuration.

## 7.2 Open, save, save as

- Open (Mod+O): native dialog, filters for Markdown (`.md .markdown .mdown .mkd .mkdn
  .mdwn .mdtxt .mdtext .text .txt .Rmd`) and All files. Opening a folder: File → Open
  Folder (no default key). Opening a file that is already open in another window focuses
  that window.
- Save (Mod+S). Untitled documents ask for a path; the default file name is the first
  heading's text (slugified to safe characters) or `Untitled.md`.
- Save As (Mod+Shift+S). Images referenced relatively are NOT moved; if the new folder
  differs, offer: "Update image paths" / "Copy images" / "Leave as is".
- Rename: File → Rename (and, when the custom title bar is in use, clicking the file name
  in it); renames on disk.
- Move To: File → Move To… moves the file on disk.
- Delete: File → Delete moves the file to the system trash after confirmation.
- Reveal in file manager: File → Reveal in Folder.
- Recent: File → Open Recent lists the last 20 files and 10 folders, with "Clear".

## 7.3 External changes

- The open file is watched. When it changes on disk and the document has no unsaved
  edits, the editor reloads silently, keeping the cursor on the same source offset (or
  nearest) and the scroll position. The reload is undoable (one step).
- With unsaved edits: show a bar at the top: "This file changed on disk." with buttons
  **Reload** (discard local edits; undoable) and **Keep mine** (next save overwrites).
- File deleted or moved on disk: the document stays open and becomes dirty; a bar says
  "File no longer exists on disk" with **Save** and **Close**.

## 7.4 Sidebar

Toggle: Mod+Shift+L. Width default 240 px, resizable by dragging its right edge
(min 180, max 50% of window), width remembered. Two tabs at the top: **Files** and
**Outline** (wireframe `wireframes/sidebar.svg`).

### Files tab, tree view (default)

- Shows the open folder as an expandable tree. Only folders and files matching the
  "Show files" filter (Markdown only, default; or all supported, or all files) appear.
- Sorting: by name (natural sort, folders first; default), by modified date, by created
  date. Hidden files (dot-files) hidden unless the setting is on.
- Clicking a file opens it in this window (asking to save if dirty and autosave is off).
  Mod+click opens in a new window. The current file is highlighted (`--active-file-*`
  colors).
- Context menu on items: New File, New Folder, Rename (F2), Duplicate, Delete (trash),
  Copy Path, Reveal in Folder, Open in New Window, Search in Folder, Sort by…, Refresh.
- Inline rename: the item turns into a text field; Enter commits, Escape cancels.
- The tree updates live from the file watcher; expansion state is remembered per folder.
- Bottom bar: `+` (new file in the selected folder), a menu button (open folder, sort,
  filter, toggle hidden files, refresh), and the folder name.

### Files tab, list view

- Toggled by a button next to the tabs. Shows a flat list of all Markdown files in the
  folder (recursive), each as a card with title (first heading or file name), modified
  date, and a two-line excerpt. Same sorting and context menu as the tree.

### Outline tab

- Lists the document's headings as an indented tree (indent 14 px per level). Clicking
  jumps. The heading containing the cursor (or at the top of the viewport while
  scrolling) is highlighted (bold).
- Collapse arrows on headings with children (setting "Collapsible outline", default on).
- Filter box at the top (appears on typing while the outline has focus) filters headings
  by substring.
- Dragging an outline entry moves that heading and all content under it (until the next
  heading of the same or higher level) to the drop position. One undo step.

## 7.5 Quick open (Mod+P)

- A popup horizontally centered in the editor area, 4 px below its top edge (wireframe `wireframes/quick-open.svg`)
  with a search field and a result list.
- Sources, merged: files in the open folder (recursive, respecting the file filter),
  recent files, and recent folders. Each row shows the file name and its directory
  (middle-ellipsized).
- Fuzzy matching on name and path, case-insensitive, name matches ranked above path
  matches, recent files boosted.
- Up/Down select, Enter opens in this window, Mod+Enter opens in a new window, Escape
  closes. Without input, shows recent files.

## 7.6 Autosave and recovery

- Preferences → General → "Auto save" (default off). When on, a saved document is
  written 1 second after the last edit, on window blur, and before switching files. Never
  for untitled documents.
- **Draft recovery** (always on): every 30 seconds and on window blur, each dirty
  document's full text is written to `recovery/<id>.md` with a small JSON sidecar (path,
  time, encoding). Entries are removed when the document is saved or closed without
  saving after the user confirmed "Don't Save" (then the draft is kept for 7 days in
  `recovery/discarded/`).
- After a crash, the next launch offers: "Recovered N unsaved documents" with a list;
  each can be opened, compared (shows source side by side), or discarded.
- File → "Recover Unsaved Drafts" opens the recovery folder list at any time.

## 7.7 Search in files (Mod+Shift+F)

- Opens a Search tab in the sidebar (replacing the Files/Outline view until closed) with
  a query field, options (Case sensitive, Whole word, Regex), and a scope (open folder;
  if none, ask to open one).
- Results stream in as the Rust searcher finds them: grouped by file (file name, match
  count), each match a line with the matched text highlighted and ~40 characters of
  context. Respects `.gitignore` and the file filter; skips binary files and files over
  10 MB.
- Clicking a match opens the file and selects the match.
- Replace across files is out of scope for v1.

## 7.8 Command-line interface

`scrim [paths…]`: each path that is a file opens in its own window; a folder opens as
the sidebar folder of a new window. `--new-window` forces a new window. Paths relative to
the shell's working directory.

## 7.9 File associations

Installers register the app for `.md` and `.markdown` (Linux: desktop file with
`text/markdown` MIME; Windows: "Open with" registration without stealing the default).
