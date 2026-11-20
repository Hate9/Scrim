# 03. Editing model

This is the heart of the product. Read it fully before writing editor code.

## 3.1 What the user sees

- The document is one scrolling column (`#write`, see `10-themes.md`). Every block is
  always rendered: a heading is a large heading, a list has bullets, a table is a grid.
- Block-level Markdown markers are **never shown** in the live view: no `#` before
  headings, no `>` before quotes, no `-` before list items, no `|` in tables. The block's
  type is its appearance. (The user sees them in source mode.)
- Inline Markdown markers (`**`, `*`, `_`, `` ` ``, `~~`, `==`, `[`, `](url)`, `$`, `<tag>`)
  are **hidden except around the cursor** (3.2).
- Rich blocks (code, math, HTML, front matter, TOC, images) have their own editing UI,
  described in `04-blocks.md`.

## 3.2 Syntax reveal (inline)

An **inline element** is any inline construct with syntax characters: emphasis,
strong, strikethrough, highlight, sub/superscript, inline code, link, image, autolink,
inline math, inline HTML pair (`<span>…</span>`), footnote reference, emoji shortcode,
escaped character, hard break.

1. Let an element span source offsets `[s, e)` including its markers. It is
   **expanded** when the cursor offset `p` satisfies `s < p < e`, or a selection endpoint
   does. At `p == s` (just before the opening marker) and `p == e` (just after the
   closing marker) the element is **collapsed** and the cursor is outside it.
2. An expanded element shows all its syntax characters in the `--md-char-color` color
   (meta style). A collapsed element hides them completely (they take no space).
3. Expansion nests: with the cursor inside `**bold *italic* text**` at "italic", both the
   strong and the emphasis show their markers.
4. Expansion is purely visual; it never changes the source.
5. The element containing the cursor gets the class `md-expand` on its wrapper (theme
   contract).
6. Arrow keys step through content one character at a time, but each **marker run**
   (`**`, `](url "title")`, `<span …>`, a backslash, etc.) is crossed in one step.
   Example for `a **bold** b` with the cursor after "bold**" (collapsed, `p == e`): Left
   lands between "d" and the closing `**` (expanded, markers now visible); Left again
   moves between "l" and "d"; … from just after the opening `**`, Left crosses the
   opening run to `p == s` (collapsed again). Right mirrors this. Revealing markers
   shifts later text; the cursor stays on the same source position.
7. Clicking in rendered text places the cursor at the source offset of the clicked
   character boundary, computed from the layout *before* any reveal. A click at a
   boundary next to hidden markers resolves to the **content side**: just left of "b"
   in a collapsed `**bold**` gives the offset after the opening `**` (inside, so the
   element expands), and just right of "d" gives the offset before the closing `**`.
   Clicking beyond the rendered text of the element (in surrounding text) is outside.
7a. **Snapping.** Any operation that would put the cursor strictly inside a marker run
   while the element is collapsed (Up/Down, Home/End, Mod+arrows, page keys, find
   results, undo/redo selection restore, snippet cursor placement) snaps it to the run's
   content-side boundary (end of an opening run, start of a closing run). Once an
   element is expanded its markers are visible text: clicking directly on a visible
   marker character places the cursor exactly there, and typing edits the source.
7b. **Adjacent runs.** Each marker run is one step, and every position between two runs
   is a valid stop, because it is inside one element and outside another. In
   `**a *b***` with the cursor after "b": Right → after the `*` (emphasis collapsed,
   strong still expanded, cursor before `**`); Right → after `**` (both collapsed). In
   `**a**_b_` with the cursor after "a": Right → between `**` and `_` (both collapsed);
   Right → after `_` (inside the emphasis). A click on such a boundary resolves to the
   content side of the element whose character is under the pointer.
8. Links and images show their full source while expanded (`[text](url "title")`,
   `![alt](src)`). For images, the rendered image stays visible under the source line.
   Their marker runs are `[` / `![`, `](`, the title's quotes, and `)`; the URL and the
   title text are ordinary characters that arrows step through one by one, so they can
   be edited with the keyboard. Same for the attributes inside an HTML tag: the run is
   `<span`, then the attribute text is steppable, then `>`.
9. Inline math expanded: the source `$…$` is shown, and a floating preview of the
   rendered formula appears just below the line.

## 3.3 Typing and input rules

All transformations below happen only **outside IME composition**. During composition,
the editor must not re-render, transform, or move the cursor (Chinese, Japanese, Korean
input must work perfectly). Apply pending transformations when composition ends.

### Block input rules

Two kinds of trigger:

- **Space-triggered** (headings, quote, lists, task, footnote): fire when the user types
  the final space and the text from the paragraph start up to the cursor is exactly the
  trigger. Text after the cursor may exist; it becomes the new block's content. Example:
  in a paragraph "Hello", typing `#␣` at its start gives a heading "Hello".
- **Enter-triggered** (code, math, hr, table, TOC, front matter, HTML block): fire on
  Enter only when the paragraph's entire text is the trigger.

The trigger text is removed and the paragraph becomes:

| Type this at start of paragraph | Result |
|---|---|
| `#␣` … `######␣` | Heading level 1–6 (remaining text, if any, becomes the heading text) |
| `>␣` | Blockquote containing the paragraph |
| `-␣`, `*␣`, `+␣` | Bullet list item, bullet char remembered |
| `1.␣` or `1)␣` (any number ≤ 9 digits) | Ordered list starting at that number, delimiter remembered |
| `[␣]␣`, `[x]␣` inside a list item (or `-␣[␣]␣` in a paragraph) | Task item, unchecked/checked |
| ` ``` ` or `~~~`, optional language, then ⏎ | Code block with that language; cursor inside it |
| `$$` then ⏎ | Math block; cursor inside it |
| `---`, `***`, `___` (3 or more) then ⏎ | Thematic break; a new empty paragraph follows with the cursor |
| `\|a\|b\|` (pipes with ≥ 1 cell text) then ⏎ | Table: header row with those cells, one empty body row, cursor in first body cell |
| `[toc]` then ⏎ | Table of contents block |
| `[^id]:␣` | Footnote definition |
| `---` then ⏎ on the first line of an empty document | Front matter block; cursor inside it |
| A line starting with a block-level HTML open tag, then ⏎ | HTML block in edit state |

Undo immediately after an input rule restores the trigger text as typed (one undo step
undoes only the transformation, a second undoes the typing).

### Inline typing

- Because inline content is Markdown source, typing `**word**` simply produces strong
  text once the closing `**` is typed. No special rule needed.
- Typing at `p == e` (after a collapsed element) inserts outside it; typing just before
  the closing marker (expanded, reached with Left or by clicking on the content side)
  inserts inside. Same for the opening side.
- Text typed or pasted on a continuation line (after a soft break) that would start a
  block gets an automatic backslash escape (`01-architecture.md`, "Round-trip model",
  item 4).

### Auto-pairing (Preferences → Editor)

- **Auto pair brackets and quotes** (default on): typing `(`, `[`, `{`, `"`, `'`
  inserts the closing char after the cursor. Typing the closing char when it is the next
  character just moves over it. Backspace between an empty pair deletes both. Quotes do
  not pair when the previous character is a letter or digit (apostrophes).
- **Auto pair Markdown symbols** (default off): the same for `*`, `_`, `` ` ``, `~`, `=`,
  `$`.
- With a selection, typing any pairable character (both settings honored) wraps the
  selection in the pair instead of replacing it; the selection is kept, now inside the
  pair.

### Smart punctuation (Preferences → Markdown, default off)

Display-only: straight quotes display as curly quotes, `--` as en dash, `---` inside text
as em dash, `...` as ellipsis. The source keeps the ASCII characters. Copy as plain text
copies the displayed form; copy as Markdown copies the source.

## 3.4 Enter, Backspace, Delete

| Context | Enter | Shift+Enter |
|---|---|---|
| Paragraph | Split into two paragraphs at the cursor | Line break (see `02-markdown-dialect.md`, Line breaks) |
| Heading, cursor at end | New empty paragraph after | Same as Enter |
| Heading, cursor in middle | Split: text after the cursor becomes a new paragraph | Same as Enter |
| List item with text | Split into a new item of the same list (new task items are unchecked) | Line break inside the item |
| Empty list item | Outdent one level; at top level, leave the list as a new paragraph | Line break |
| Blockquote | New paragraph inside the quote; Enter on an empty paragraph that is the last in the quote leaves the quote | Line break |
| Code / math / HTML / front matter | Newline in the code (auto-indent to previous line's indent) | Newline |
| Table cell | Move to the same column in the next row; in the last row, add a new row | Line break inside the cell (written as `<br>`) |
| Mod+Enter in table | Insert a new row below and move to it | |

| Context | Backspace at block start | Delete at block end |
|---|---|---|
| Paragraph after a paragraph or heading | Merge into the previous block's end | Merge next block's text into this one (next must be a paragraph or heading) |
| Heading | Turn into paragraph (keep text) | As paragraph |
| First list item paragraph | Lift out of the list: becomes a paragraph (nested: outdent one level) | Merge next item's text |
| Blockquote first paragraph | Lift out of the quote | |
| Empty code/math block | Remove the block, leave an empty paragraph | |
| Paragraph after a rich block (code, math, table, image paragraph, hr, HTML) | Select the rich block (one press); a second press deletes it | |
| Thematic break selected | Delete it | |

Mod+Backspace / Mod+Delete delete by word. Mod+Shift+Backspace deletes to line start
(inside a table it deletes the current row instead, `04-blocks.md` 4.7).

A selection that spans several blocks and is deleted (or typed over) merges the first and
last block's remaining text into the first block's type; fully covered blocks are
removed.

## 3.5 Tab and indentation

- In a list item: Tab indents the item (makes it a child of the previous sibling);
  Shift+Tab outdents. Works on a selection spanning several items.
- In a table cell: Tab moves to the next cell (adding a row at the end); Shift+Tab to the
  previous cell.
- In code-like blocks: Tab inserts indentation (setting: spaces or tab, width 2/4/8;
  default 4 spaces); Shift+Tab dedents selected lines.
- Elsewhere: Tab is ignored. (Inserting spaces at a paragraph start would create an
  indented code block on save, which surprises users.)

## 3.6 Formatting commands

All formatting commands are toggles. With a selection they apply to it. Without one: if
the cursor is inside an element of that kind, the command removes that element's
markers; otherwise it inserts an empty pair with the cursor between them.

| Command | Default key | With selection | Without selection |
|---|---|---|---|
| Strong | Mod+B | Wrap in `**`, or remove if the selection is exactly a strong element's content | Inside a strong element: remove its markers. Otherwise insert `****` with cursor in the middle |
| Emphasis | Mod+I | Same with `*` | Same |
| Underline | Mod+U | Wrap in `<u>…</u>` | Same pattern |
| Inline code | Mod+Shift+` | Wrap in backticks (more if content has backticks) | Same pattern |
| Strikethrough | Alt+Shift+5 | `~~` | Same pattern |
| Highlight | (none) | `==` (enables nothing; if extension off, inserts literally) | Same pattern |
| Inline math | Mod+Shift+M is block math; inline has no default key | `$` | Same pattern |
| Link | Mod+K | Turn into `[selection]()` with the cursor in the `()`; if the clipboard holds a URL, fill it in and put the cursor after the link | Insert `[]()` with cursor in `[]` |
| Clear format | Mod+\ | Remove all inline syntax from the selection | (nothing) |
| Heading 1–6 | Mod+1…6 | Applies to every block the selection touches | Applies to current block |
| Paragraph | Mod+0 | Same | Same |
| Increase / decrease heading level | Mod+= / Mod+- | h3→h2 / h3→h4; paragraph→h6 on increase, h6→paragraph on decrease | |

Formatting a selection that spans blocks applies the inline format separately in each
block.

## 3.7 Selection

- Mod+A: first press selects the current block's content if inside a code-like block or
  table cell; otherwise (and on second press) the whole document.
- Mod+D: select the word at the cursor.
- Mod+L: select the current line; repeated presses extend by one line.
- Mod+E: select the innermost styled scope (inline element, then table cell, then block);
  repeat to grow.
- Double-click: word. Triple-click: whole block.
- Shift+click and Shift+arrows extend; Alt-drag is not supported.
- Rich blocks (images, math, HTML, TOC, hr) can be selected as a unit: they get a
  visible selected outline, and Backspace/Delete removes them.

## 3.8 Undo and redo

- Mod+Z undo, Mod+Shift+Z and Mod+Y redo.
- Typing is grouped: a run of typing becomes one step, broken by a pause of 1 second, by
  cursor movement with arrows or mouse, or by typing whitespace after a word.
- Every command (format, input rule, paste, snippet insert, table operation, drop) is
  one step, even if it makes several internal changes.
- Undo restores the selection that existed before the step; redo restores the selection
  after it.
- Undo history is per document. Switching to source mode and back follows
  `01-architecture.md`, "Undo across live and source mode".
- External reload (`07-files-and-workspace.md`) is itself one undoable step.

## 3.9 Links and navigation in the document

- Hovering a link shows a tooltip with its URL after 500 ms.
- Mod+click on a link (or plain click if Preferences → Editor → "Open links with single
  click" is on, default off) opens it:
  - `#anchor` scrolls to the matching heading and moves the cursor there;
  - relative path to a `.md` file opens it in this window (asking to save if dirty) or
    a new window with Mod+Shift+click; `file.md#heading` also scrolls;
  - other relative or absolute file paths open with the system default application;
  - `http(s)`, `mailto`, and other schemes open with the system handler.
- Footnote references: hovering shows the definition in a popover; Mod+click jumps to the
  definition; the definition shows a back link `↩` that jumps to the first reference.
- The outline panel and TOC entries jump to headings.

## 3.10 Mouse and scroll behavior

- Clicking below the last block puts the cursor at the end; if the last block is not a
  paragraph, an empty paragraph is added first (and removed again if left empty when the
  cursor leaves it; it is never saved).
- Clicking above the first block when it is not a paragraph (for example a table) inserts
  a temporary empty paragraph the same way.
- The document keeps at least 40% of the viewport height of empty space below the last
  block so the end of the document can be scrolled to mid-screen ("scroll past end").
- Scrolling with the cursor offscreen does not move the cursor.
