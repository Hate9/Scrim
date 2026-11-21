# 11. Preferences

Opened with Mod+, (comma) or File → Preferences. It is an overlay panel covering the
editor area of the current window (not a separate OS window), wireframe
`wireframes/preferences.svg`: header with title "Preferences" and a close button (×);
left column with a search field and section list; right column with the selected
section's controls. Escape or × closes it. Changes apply immediately (no OK button)
and propagate to all windows.

The search field filters controls across all sections by label text; matching sections
stay in the list and non-matching controls hide. Clearing the search restores the
normal view.

Controls are grouped under small bold group headers with optional muted hints, e.g.
**Save & Recover** *(applies to all windows)*.

## Sections and settings

Defaults in parentheses.

### General
- On launch: open new file / restore last closed folder / restore last files and folders
  / open custom folder (open new file)
- Auto save (off)
- Save without asking when switching files in the sidebar (off)
- Recover unsaved drafts (button)
- Language: system / list of UI languages (system); "applies after restart"
- Open files in: current window when possible / always new window
- Advanced: "Open Advanced Settings" (opens Customize → config.jsonc tab, 18; until
  phase P7 ships the Customize pane, this button is hidden) and "Reset Advanced
  Settings" (confirm, then restores the commented default `config.jsonc`)
- Debug: "Enable debugging tools" (off; when on, View menu shows Toggle DevTools)

### Appearance
- Theme (picker), Open Theme Folder
- Separate theme in dark mode (off) + picker
- Font size: auto / 12–24 px (auto = theme decides)
- Sidebar: show file tree vs list by default; "Show sidebar on launch" (off)
- Status bar: show (on); show word count (on); count code in words (off, 14)
- Window style: native title bar (default on Linux) / unified custom title bar
- Zoom: reset (button), current zoom shown
- Show "outline" collapse arrows (on)

### Editor
- Default indent for code blocks and source mode: 2 / 4 / 8 spaces or tab (4 spaces)
- Auto pair brackets and quotes (on); Auto pair Markdown symbols (off)
- Typewriter mode, Focus mode (toggles, mirror View menu)
- Spell check: on/off (on) and language: auto / list from system (auto) (13)
- Emoji autocomplete (on)
- Open links with single click (off)
- Copy as Markdown by default (on)
- Paste HTML as plain text (off)
- Show heading level hint in margin (on)
- Cursor blink (on)

### Image
- Image insert policy and options (`06-clipboard-and-dnd.md` 6.4)
- Upload command (string) and "Test" button (runs the command on a sample image)

### Markdown
- Strict mode (on)
- Extensions: inline math (off), subscript (off), superscript (off), highlight (off),
  diagrams (on)
- Smart punctuation (off)
- Preserve single line breaks (on)
- Code blocks: line numbers (off), wrap (on), copy button (off)
- Source mode: line numbers (off, 15)
- Math: auto numbering (off)
- Number footnotes (on)
- Writing style: bullet char, emphasis char, strong char, heading style, pretty-print
  tables (on)
- Allow iframes in HTML (off). Turning it on shows "Applies to new windows" under the
  checkbox (Q-015).
- Default line ending for new files: LF / CRLF (platform)

### Export
- Per-format settings (PDF, HTML, pandoc formats), custom export commands (9.5)
- Pandoc path (auto-detected; shows the detected version)

### Customize
- The pane from `18-customize-pane.md`.

## Storage

- Everything above is stored in `settings.json` (flat keys, camelCase; unknown keys are
  preserved when writing).
- `config.jsonc` holds advanced options not shown in the UI (Scrim's own schema):
  - `shortcuts`: `{ "<menu item label>": "<accelerator>" }` overrides for menu items
    (12). Snippet items and the snippet picker are not configured here; their keys live
    in `local.json` (16).
  - `contextSearch`: array of `{ "label": …, "url": … }` for "Search with…" in the
    context menu (`%s` = selected text, URL-encoded). Default
    `[{ "label": "Search with DuckDuckGo", "url": "https://duckduckgo.com/?q=%s" }]`.
    Opening uses the system browser (user-initiated).
  - `iframeAllowlist`: domains allowed for iframes when iframes are enabled.
  - `webviewFlags`: extra webview command-line flags (best effort; ignored where the
    platform webview doesn't support them).
  - `defaultFonts`: `{ "body", "serif", "sans", "mono" }` families used when a theme
    does not set them.
  - `fileListLimit`: maximum number of files shown in the sidebar list view (500).
- The default `config.jsonc` written on first run is fully commented (every option
  explained with its default).
