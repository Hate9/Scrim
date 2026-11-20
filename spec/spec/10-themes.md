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

| Block | Element / classes |
|---|---|
| Paragraph | `p` |
| Heading | `h1`…`h6` (`.md-heading` also) |
| Blockquote | `blockquote` |
| Lists | `ul`, `ol`, `li`; `ul.contains-task-list`, `li.task-list-item` (+ `.task-list-done`), `input[type=checkbox]` inside |
| Code block | `pre.md-fences` with attribute `lang`. Inside it, CodeMirror 6 elements get alias classes: `.cm-editor` also `.CodeMirror`, `.cm-content` also `.CodeMirror-lines`, each `.cm-line` also `.CodeMirror-line` (CM6 supports extra classes via editor/content attributes and line decorations). Tokens `span.cm-*` (`04-blocks.md` 4.5) |
| Math block | `div.md-math-block` > `div.math-display` (rendered) and, while editing, `div.md-math-source` |
| Table | `figure.md-table-fig` > `table` > `thead`/`tbody` > `tr` > `th`/`td` |
| Image | `span.md-image` > `img`; image paragraph `p.md-image-paragraph` |
| HR | `hr` |
| HTML block | `div.md-htmlblock` > `div.md-htmlblock-container` |
| Front matter | `pre.md-meta-block` |
| TOC | `div.md-toc` > `p.md-toc-content` > `span.md-toc-item.md-toc-h1`… > `a.md-toc-inner` |
| Footnote ref | `sup.md-footnote` |
| Footnote def | `div.md-def-footnote` |
| Link def | `div.md-def-url` |
| Focused block (cursor inside) | extra class `md-focus` on the block element |
| Block with cursor in inline element | inline wrapper gets `md-expand` |
| Syntax markers | `span.md-meta`; heading level hint `span.md-heading-hint` |
| Inline | `strong`, `em`, `code`, `del`, `mark`, `sub`, `sup`, `u`, `a`, `span.md-inline-math`, `span.md-emoji` |
| Search hits | `.md-search-hit`, current `.md-search-select` |

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

### Code block theme hooks

Themes commonly style code via `.cm-s-inner` + token classes. The CodeMirror container in
code blocks MUST carry class `cm-s-inner`, and the editor's own CodeMirror theme must
have lower specificity than these selectors.

## 10.4 Dark mode

- Following the system: Preferences → Appearance → "Use separate theme in dark mode".
  When the OS switches, the window switches theme live.
- The window background follows `--bg-color`. The title bar follows it only where Scrim
  controls it: the custom (unified) title bar, and the Windows 11 caption color via DWM.
  Native title bars on Linux (drawn by the window manager) and on Windows 10 only follow
  light/dark: Scrim requests the dark variant when the active theme sets
  `--color-scheme: dark`.
