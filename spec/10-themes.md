# 10. Themes

## 10.1 Theme files

- Themes are CSS files in `<config>/themes/`. Every `*.css` file directly in that folder
  whose name does not end in `.user.css` is a theme. The Themes menu lists them by name:
  file name without `.css`, `-` and `_` replaced by spaces, words capitalized
  (`my-theme.css` → "My Theme"). Built-in themes are installed into this folder on first
  run and when missing (never overwritten if the user edited them; keep a hash to tell).
- A theme may have a same-named folder (`themes/my-theme/`) for fonts and images,
  referenced with relative URLs from the CSS.
- Load order in each window: app base CSS → theme CSS → `base.user.css` (applies to
  every theme) → `<theme>.user.css` (applies to that theme only). User files are created
  empty on demand, never shipped with content.
- Changing theme applies instantly to all windows without reload, keeping cursor and
  scroll.
- The theme folder is watched; saving a theme or user CSS file re-applies it live.
- Preferences → Appearance: theme picker, "Open Theme Folder", separate theme choice for
  dark mode ("Use separate theme when the system is in dark mode", with a picker).
- `@import` in themes works (relative to the theme file). Remote `@import`/`url()` to
  `http(s)` are allowed (they count as user-requested resources).

## 10.2 Built-in themes

Ship four themes, written from scratch from `22-visual-design.md`:

| File | Character |
|---|---|
| `paper.css` (default) | Warm off-white page, serif body text (22.2) |
| `clean.css` | White page, sans-serif, wide column (22.3) |
| `night.css` | Dark background, light text |
| `plain.css` | Minimal: system fonts, no decoration; a base for user themes |

## 10.3 Theme compatibility DOM contract

The editor must produce the following structure and class names so that themes written
for the editor this project is modeled on work unmodified. This is an interoperability
interface; names are reproduced exactly.

### Page structure

```
html
└─ body.scrim          (plus state classes below)
   ├─ header                     (custom title bar area when frameless; may be empty)
   ├─ #scrim-sidebar             (sidebar root)
   │   ├─ .sidebar-tabs / .info-panel-tab (tab headers; .active on selected)
   │   ├─ #file-library          (files tab)
   │   │   ├─ .file-library-node / .file-tree-node (tree rows; .active current file)
   │   │   └─ .file-list-item   (list view cards; .active current)
   │   └─ #outline-content       (outline tab)
   │       └─ .outline-item      (one per heading; .outline-item-active current;
   │                              wrapped in .outline-h1 … .outline-h6)
   ├─ .scrim-quick-open          (quick open popup root, when shown; rows
   │                              .scrim-quick-open-item, selected row also .active)
   ├─ content                    (custom element: scroll container of the document)
   │   └─ #write                 (the document column; contenteditable)
   │       └─ blocks …
   └─ footer                     (status bar, 14-status-and-counts.md)
       └─ .footer-item, #footer-word-count
```

### Compatibility selector rewriting (QA-LOG Q-000)

Scrim's DOM uses only Scrim's own names (`scrim-*`). Themes written for the reference
editor use a few selectors with that editor's name as prefix. The theme loader rewrites
them when it loads any theme or user CSS file, so such themes work unmodified:

| In theme CSS | Rewritten to |
|---|---|
| `#typora-sidebar` | `#scrim-sidebar` |
| `#typora-source` | `#scrim-source` |
| `.typora-export` | `.scrim-export` |
| `.typora-quick-open` (and any `.typora-quick-open-*`) | `.scrim-quick-open` (`.scrim-quick-open-*`) |
| `.typora-node` | `.scrim` |
| `.ty-on-typewriter-mode` | `.scrim-typewriter-mode` |
| `.cm-s-typora-default` | `.cm-s-scrim-default` |
| any other `#typora-X` / `.typora-X` | `#scrim-X` / `.scrim-X` |

- Rewrite only ID and class selectors inside selector lists (including inside `:is()`,
  `:not()`, `:where()`, `:has()`, and nested rules), using a real CSS parser (for
  example css-tree). Never touch strings, `url()`, comments, custom property values, or
  `@font-face` names.
- The same rewrite applies to theme CSS inlined into HTML/PDF exports.
- Scrim's own built-in themes and documentation use only `scrim-*` names.
- The reference editor's name never appears in Scrim's DOM, UI, or docs; it appears only
  in the theme loader's rewrite table and its tests (T-6). Theme compatibility is described to
  users as "supports themes written for other popular live-preview Markdown editors".
- One build-time flag `THEME_COMPAT_REWRITE` controls the rewrite: on (default) rewrites, off leaves theme CSS untouched.

### Body state classes

| Class | When |
|---|---|
| `pin-outline` | Sidebar visible |
| `on-focus-mode` | Focus mode on (`15-view-modes.md`) |
| `md-source-mode` | Source code mode on |
| `scrim-typewriter-mode` | Typewriter mode on |
| `scrim-export` | Only in exported HTML/PDF |
| `os-windows` / `os-linux` | Platform |
| `dark` (custom) | Optional: set when the active theme declares itself dark via `--color-scheme: dark` |

### Blocks inside `#write`

Exact structure matters: themes use descendant and child selectors (`li p`,
`blockquote p`, `#write h2 > span`, `#write a .md-plain`, `[md-inline=link] a`). Every
leaf block (one that directly holds inline content, plus `pre`, math, HTML, TOC,
footnote and link definitions, and table rows) also carries class `md-end-block`.

| Block | Element / classes |
|---|---|
| Paragraph | `p.md-p` |
| Heading | `h1`…`h6`, class `md-heading`; text inside per "Inline structure" below. No other child elements: the heading level hint is a `::before` pseudo-element on the focused heading (`h2.md-focus::before { content: "h2" }`), never an element |
| Blockquote | `blockquote`; its children are blocks (a quote's text is always inside `p.md-p`) |
| Bullet list | `ul.ul-list` with attribute `data-mark` = the source marker (`-`, `*`, `+`) |
| Ordered list | `ol.ol-list` with attribute `start` (empty when 1) |
| List item | `li.md-list-item`; its text is **always** inside `p.md-p`, for tight and loose lists alike (tight/loose only changes the Markdown written back); nested lists follow the `p` |
| Task item | `li.md-list-item.task-list-item.md-task-list-item` plus `task-list-done` or `task-list-not-done`; first child `input[type=checkbox]` (`checked` when done), then `p.md-p`. Its list is `ul.ul-list.contains-task-list` |
| Code block | `pre.md-fences` with attribute `lang` (empty string when none), see "Code blocks" below |
| Math block | `div.md-math-block.md-rawblock` > `div.md-rawblock-container.md-math-container` > rendered math (`mjx-container.MathJax` or the renderer's equivalent root with class `MathJax`); while editing, the source in `pre.md-fences` (CodeMirror) inside it |
| Table | `figure.md-table-fig` > `table.md-table` > `thead`/`tbody` > `tr.md-end-block` > `th`/`td` > `span.td-span` > inline content |
| Image | inline wrapper `span.md-image` (attribute `data-src` = source path; plus `md-img-error` when it failed to load) > markers + `img`. An image alone in its paragraph: the `p` also gets `md-image-paragraph` |
| HR | `div.md-hr.md-end-block` > `hr` |
| HTML block | `div.md-htmlblock.md-rawblock` > `div.md-htmlblock-container.md-rawblock-container` > the sanitized HTML |
| Front matter | `pre.md-meta-block` containing the YAML as plain text (no syntax-highlight spans; themes color it as one block) |
| TOC | `div.md-toc` > `p.md-toc-content` > `span.md-toc-item.md-toc-h1`… > `a.md-toc-inner` |
| Footnote def | `div.footnotes.md-def-footnote` > `span.md-def-name` (label), `span.md-def-content` (inline content), `span.md-reverse-footnote-area` > `a.reversefootnote` |
| Link def | `div.footnotes.md-def-link` > `span.md-def-name`, `span.md-def-content.md-def-url` (URL), `span.md-def-title` (title, when present) |
| Focused block (cursor inside) | extra class `md-focus` on the leaf block only; the nearest enclosing `li`, if any, gets `md-focus-container` (blockquotes do not); the inline wrapper holding the cursor gets `md-expand` |
| Search hits | `.md-search-hit`, current `.md-search-select` |

### Inline structure

- **Plain text runs** are wrapped in `span.md-plain` with attribute `md-inline="plain"`,
  at every nesting level (inside `p`, headings, `a`, `strong`, `em`, table cells, …).
  So a heading with only text is `h2 > span.md-plain`, and a link's text is
  `a > span.md-plain`.
- **Emphasis-like spans** (`strong`, `em`, `del`, `code`, `u`, `mark`, `sub`, `sup`,
  inline math): an outer `span.md-pair-s` with `md-inline` = `strong`, `em`, `del`,
  `code`, `underline`, `mark`, `sub`, `sup`, `inline_math`, containing
  `span.md-meta.md-before` (opening marker), the element (`strong`, `em`, …), and
  `span.md-meta.md-after` (closing marker). Markers are hidden unless the wrapper has
  `md-expand` (cursor inside). `code` holds raw text directly (no `md-plain`).
- **Links**: `span.md-link` with `md-inline="link"` > `span.md-meta.md-before` (`[`),
  `a` (attribute `data-href`, no `href` in the editor per Q-012) > `span.md-plain`,
  `span.md-meta.md-before` (`](`), `span.md-content.md-url` (URL), optional
  `span.md-content.md-link-title`, `span.md-meta.md-after` (`)`). Reference links:
  `md-inline="reflink"`, `a` with `data-ref`. Autolinks: `md-inline="autolink"`,
  `a.md-url`.
- **Inline HTML** (`<kbd>`, custom tags, …): `span.md-html-inline` with
  `md-inline="html_inline"` > tag markers (`span.md-meta.md-raw-inline`) and the element.
- **Footnote ref**: `sup.md-footnote` with `md-inline="footnote"`, `data-ref` = label.
- **Emoji**: `span.md-emoji` with `md-inline="emoji"`, `data-content` = shortcode.
- Syntax markers anywhere: `span.md-meta`.

### Code blocks

CodeMirror 6 renders the editor; its elements carry CodeMirror 5 alias classes because
themes target them:

| CM6 element | Also has class |
|---|---|
| `.cm-editor` | `CodeMirror cm-s-inner CodeMirror-wrap` (and `CodeMirror-focused` when focused) |
| `.cm-scroller` | `CodeMirror-scroll` |
| `.cm-content` | `CodeMirror-code CodeMirror-lines` |
| `.cm-line` | `CodeMirror-line` |
| `.cm-activeLine` | `CodeMirror-activeline` |
| `.cm-cursor` | `CodeMirror-cursor` |
| `.cm-selectionBackground` | `CodeMirror-selected` |
| `.cm-gutters` / line numbers | `CodeMirror-gutters` / `CodeMirror-linenumber` |

Tokens use the CodeMirror 5 class names in `04-blocks.md` 4.5. The source-mode editor
(`#scrim-source`) uses the same aliases, with `cm-s-scrim-default` in place of
`cm-s-inner`.

### Base stylesheet

Themes are written against a small base stylesheet that the reference editor loads
before them. Scrim's app base CSS provides the equivalents below for content inside
`#write` and nothing else visual. **Every base rule for document content is wrapped in
`:where()`** (zero specificity), so any theme rule wins. Scrim's own look (colors,
fonts, backgrounds, link and code styling, table borders) lives only in its built-in
theme files (10.2), never in the base CSS. `plain.css` is close to the base alone.

- Root: `html { font-size: 14px; line-height: 1.42857 }`, `--bg-color: #fff`,
  `--text-color: #333`, `--monospace` (a system monospace stack); `html` background and
  color from those variables; `* { box-sizing: border-box }`.
- `#write`: centered (`margin: 0 auto`), `padding-top: 36px`, `position: relative`,
  `word-wrap: break-word`.
- Headings: `h1` 2rem, `h2` 1.8rem, `h3` 1.6rem, `h4` 1.4rem, `h5` 1.2rem, `h6` 1rem.
  `p`, headings, math blocks, HTML blocks: `margin: 1rem 0`.
- Lists: `li { margin: 0; position: relative }`; `li p` and math inside `li`:
  `margin: 0.5rem 0`; first child of `li` and of `blockquote`: `margin-top: 0`; last
  child of `blockquote`: `margin-bottom: 0`. `blockquote { margin: 1rem 0 }`.
- Task items: no list bullet; the checkbox absolutely positioned at the item's left,
  `margin-left: -1.2em`.
- Tables: `figure { margin: 1.2em 0; overflow-x: auto; max-width: calc(100% + 16px) }`;
  `table { border-collapse: collapse; width: 100%; text-align: left }`;
  `table.md-table td { min-width: 32px }`. No borders or backgrounds.
- Code: `code, pre` use `var(--monospace)`; `.md-fences { font-size: 0.9rem; display:
  block; background: inherit; position: relative }`; CodeMirror line padding `0 4px`.
  No code colors or backgrounds (tokens are uncolored unless the theme colors them;
  the built-in themes do).
- Front matter: `pre.md-meta-block { font-size: 0.8rem; white-space: pre-wrap;
  background: #ccc; display: block }`.
- Footnote definitions (`.footnotes`): `font-size: 0.9rem; opacity: 0.8`. Footnote
  refs: small rounded light-gray badge.
- Images: `max-width: 100%`; an image alone in its paragraph is centered as a block.
- `kbd`: light key-cap look; `mark`: yellow background, black text.
- Links: `cursor: pointer` only; no color or decoration.
- The heading level hint (`hN.md-focus::before`): `--heading-char-color`, thin border,
  in the left margin; size and offset per `22-visual-design.md`.

### CSS custom properties read by the app chrome

Themes set these on `:root`. The app's own chrome (sidebar, status bar, popovers, find
bar, quick open, menus drawn in HTML) MUST use them, with the defaults in
`22-visual-design.md` when unset:

`--bg-color`, `--text-color`, `--select-text-bg-color`, `--select-text-font-color`,
`--monospace`, `--md-char-color`, `--heading-char-color`, `--meta-content-color`,
`--blur-text-color`, `--primary-color`, `--primary-btn-border-color`,
`--primary-btn-text-color`, `--side-bar-bg-color`, `--active-file-bg-color`,
`--active-file-text-color`, `--active-file-border-color`, `--item-hover-bg-color`,
`--item-hover-text-color`, `--control-text-color`, `--control-text-hover-color`,
`--window-border`, `--panel-border-color`, `--table-border-color`,
`--search-select-bg-color`, `--search-select-text-color`, `--search-hit-bg-color`,
`--color-popover-bg-color`, `--focus-ring-color`, `--drag-placeholder-color`,
`--rawblock-edit-panel-bd`, `--sidebar-width`, `--spell-error-color`.

## 10.4 Dark mode

- Following the system: Preferences → Appearance → "Use separate theme in dark mode".
  When the OS switches, the window switches theme live.
- The window background follows `--bg-color`. The title bar follows it only where Scrim
  controls it: the custom (unified) title bar, and the Windows 11 caption color via DWM.
  Native title bars on Linux (drawn by the window manager) and on Windows 10 only follow
  light/dark: Scrim requests the dark variant when the active theme sets
  `--color-scheme: dark`.
