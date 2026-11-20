# 16. Snippets

Named pieces of text the user inserts with a shortcut or a picker. Typical use: wrapping
text in custom HTML tags or styled spans.

## Data

Stored in `<config>/local.json`:

```json
{
  "snippets": [
    { "name": "Bottom", "key": "Ctrl+Alt+B", "body": "<bottom>$0</bottom>" },
    { "name": "Red", "key": "", "body": "<span style=\"color:red\">$0</span>" }
  ],
  "customHTMLTags": { "inline": ["bottom"], "block": ["callout"] },
  "pickerKey": "Ctrl+Alt+Space"
}
```

- `name`: shown in menus and the picker. May be empty (then the first 40 characters of
  the body are shown).
- `key`: optional accelerator. Empty = no shortcut.
- `body`: the text to insert, interpreted as Markdown source.

## Body syntax

- `$0` marks the **cursor position** after insertion. Only the first `$0` counts; later
  ones are literal.
- If text was selected when the snippet was triggered, the selection's **Markdown
  source** is inserted at the `$0` position, and after insertion exactly that inserted
  text is selected again (so snippets can be chained: wrap, then wrap again).
- `$$` is a literal `$`.
- The body is scanned left to right, one token at a time: `$$` → literal `$`; `$0` →
  cursor mark (first one only; later ones are literal `$0`); anything else literal. So
  `$$0` is a literal `$` followed by `0` (not a cursor), and `$$$0` is `$` then the
  cursor. A math fence `$$` must be written `$$$$` in a body.
- A body without `$0`: the cursor ends after the inserted text; a selection is replaced
  by the body.
- Example: body `<bottom>$0</bottom>`, selection «hello» → source `<bottom>hello</bottom>`
  with «hello» selected; no selection → `<bottom>|</bottom>`.

## Insertion behavior

- Insertion is one undo step.
- In live mode, the inserted source is parsed and rendered like pasted Markdown; the
  cursor or selection lands on the correct source characters even though rendering
  hides markers. (Recommended: compute the target source offsets before insertion and
  map them through the transaction; do not search the DOM.)
- In source mode, the same text is inserted and the same cursor/selection rule applies.
- Inside a code block, math, or front matter: the body is inserted literally (no
  Markdown rendering), with the same cursor rules.
- Selections spanning several blocks:
  - a body **without** newlines (an inline wrapper like `<bottom>$0</bottom>`) is
    applied to each touched textblock separately, wrapping that block's selected text;
    the selection afterwards runs from the first wrapped text to the last;
  - a body **with** newlines (a block wrapper like `<details>\n$0\n</details>`) receives
    the whole selection's Markdown (blocks included) at `$0`.
- Multi-line bodies are allowed; inserted lines after the first are indented to match
  the current block's indentation when inside a list item.
- Input rules do not fire on inserted text.

## Menu and shortcuts

- A top-level **Snippets** menu (between Format and View): "Insert Snippet…" with the
  picker shortcut, a separator, then one item per snippet in list order, labeled by name,
  showing its shortcut. With no snippets: a disabled item "No snippets: add some in
  Preferences → Customize".
- Snippet shortcuts go through the keyboard dispatcher (`01-architecture.md`,
  "Keyboard routing"): they act when focus is in the document (live or source mode).
  If a snippet shortcut equals a built-in shortcut, the snippet wins (and the Customize
  pane warns, 18).
- The menu rebuilds live whenever `local.json` changes (from the Customize pane or an
  external edit, watched).

## Picker

- Opens with the picker shortcut: `pickerKey` in `local.json` (default Ctrl+Alt+Space),
  set in the Customize pane. This is the only place it is configured. Wireframe `wireframes/snippet-picker.svg`.
- A small floating panel centered horizontally, 20% from the top of the editor area,
  420 px wide (max 90% of the window), rounded 6 px, shadow, theme background and text
  colors. Contains a text field ("Insert snippet…") and a list (max 300 px tall,
  scrolls).
- Each row: snippet name on the left, body preview on the right (monospace, 12 px,
  55% opacity, single line, ellipsized).
- Filtering by name, case-insensitive: prefix matches first (shorter names first), then
  substring matches (earlier position first), then subsequence matches; non-matching
  snippets hidden. Empty query shows all in list order.
- Keys (the picker field owns them, `01-architecture.md` "Keyboard routing"): Up/Down
  or Ctrl+P/Ctrl+N move; Enter inserts the highlighted snippet; Escape
  closes and restores the previous selection; clicking a row inserts it; focus loss
  closes.
- The editor's selection at the moment the picker opened is the one the snippet applies
  to (the picker must save and restore it).
- Empty states: "No match" / "No snippets yet. Add some in Preferences → Customize".
