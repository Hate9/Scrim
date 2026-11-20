# 08. Find and replace (in document)

## Bar

- Mod+F opens the find bar; Mod+H opens it with the replace row. The bar is a strip
  fixed at the top of the editor area (not covering the sidebar), 39 px per row,
  wireframe `wireframes/find-bar.svg`.
- Find row: search field; match counter inside the field's right end (`3 of 17`);
  toggle buttons **Case sensitive** (`Aa`), **Whole word** (`ab`), **Regex** (`.*`);
  a **⋯** menu with "Match Markdown source"; previous / next buttons; close (×).
- Replace row: replace field; **Replace** and **Replace All** buttons.
- Opening the bar with a single-line selection pre-fills the search field.
- In source code mode (`15-view-modes.md`) the bar always matches source text and the
  "Match Markdown source" item is checked and disabled.

## What is matched

Two match targets:

1. **Rendered text** (default in live mode). Each textblock is projected to the text the
   user sees, with a map back to source offsets:
   - markers, link URLs and titles, image sources, HTML tags: excluded;
   - link text, image alt text: included;
   - emoji: the emoji character (searching `:smile:` does not match);
   - inline math: its LaTeX source;
   - entities and escapes: the displayed character (`&amp;` → `&`, `\*` → `*`);
   - smart punctuation: the displayed character.
   - code (inline and blocks), math blocks, front matter, HTML block source: their
     source text.
2. **Markdown source** ("Match Markdown source" checked): raw source text including
   markers.

Matching rules (both targets, regex or not):

- Matches never cross a textblock boundary. A soft break inside a paragraph is `\n` in
  the projection, so only a regex (`\n`) can match across it.
- **Typographic equivalence** (non-regex queries only, always on): `"` ≡ `“` ≡ `”`,
  `'` ≡ `‘` ≡ `’`, `-` ≡ `–` ≡ `—`. Equivalence is character-for-character only, so
  `--` does not match `–` and `...` does not match `…`. Regex queries match characters
  literally.
- Case-insensitive matching uses Unicode simple case folding.
- **Hidden hits**: a match inside text that is not currently visible (inline math
  source, image alt text, collapsed footnote content, a collapsed HTML/math block's
  source) is shown by outlining the rendered widget/element with the hit color; when it
  becomes the current match, its element expands (or its block enters edit state) so
  the matched source is visible and selected.

Regex is available with either target; in rendered mode the regex runs over the
projection.

## Behavior

- All matches are highlighted (`.md-search-hit`, current one also `.md-search-select`;
  colors `--search-hit-bg-color`, `--search-select-bg-color` /
  `--search-select-text-color`). Highlights update live while typing (debounced 100 ms)
  and are computed only for blocks near the viewport on large documents.
- Enter / F3: next match; Shift+Enter / Shift+F3: previous; wraps around. The current
  match scrolls into the middle third of the viewport.
- Escape closes the bar and returns focus to the document with the current match
  selected.
- Mod+G / Mod+Shift+G: next/previous match while the bar is closed (last query).
- A code block's CodeMirror highlights its own matches with the same classes.

## Replace

- Replace replaces the current match and moves to the next. Replace All replaces all
  matches as **one** undo step and reports the count ("Replaced 12").
- Source-target replacements replace the source range exactly.
- Rendered-target replacements, inside one segment (no marker between matched
  characters): replace those source characters. `**bold**`, find "bold", replace "x" →
  `**x**`.
- Rendered-target replacements spanning element boundaries: delete the matched
  characters from every segment, insert the replacement at the match start position,
  then remove any inline element whose content became empty (with its markers).
  "Element" and "segment" always refer to the parse **before** the edit; the empty-check
  is done on those elements, not by re-parsing the intermediate text.
  Examples:
  - `bo**ld**`, find "bold", replace "xy" → `xy` (the strong lost all content).
  - `a **bold** b`, find "a bold", replace "z" → `z b`.
  - `**bo**ld`, find "bold", replace "BOLD" → `**BOLD**` (inserted at match start, which
    is inside the strong; "ld" deleted from the plain segment).
- Escapes and entities are atomic: a match covering the displayed `*` of `\*` covers both
  source characters `\*`; a match can't cover only part of `&amp;`.
- The replacement text is inserted so that it **renders literally** (escaped like paste
  as plain text, `06-clipboard-and-dnd.md` 6.2), in rendered-target mode. In source-target
  mode it is inserted as raw source.
- Regex replacement supports `$1`…`$9` and `$&`.
