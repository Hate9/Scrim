# Custom Themes

A theme is a CSS file in the theme folder (Themes → Open Theme Folder). Every `.css`
file there is listed in the Themes menu: `my-theme.css` appears as "My Theme". Scrim
also supports themes written for other popular live-preview Markdown editors: copy the
theme's `.css` file (and its folder, if it has one) into the theme folder.

## Making your own

The easiest start is to copy `plain.css` to a new name and edit the copy. Saving the
file applies it immediately.

- Put fonts and images in a folder next to the theme (`my-theme/`) and refer to them
  with relative URLs: `url("my-theme/background.png")`.
- `@import "other.css";` works, relative to the theme file.
- To declare a dark theme, set `--color-scheme: dark;` on `:root`.

## Small changes to any theme

`base.user.css` applies on top of every theme; `<theme>.user.css` on top of one theme.
They are created empty when you open the theme folder, and Scrim never overwrites them.

## What to style

| Part | Selector |
|---|---|
| The document column | `#write` |
| The scrolling area | `content` |
| Sidebar | `#scrim-sidebar`, rows `.file-tree-node`, outline `.outline-item` |
| Status bar | `footer`, `.footer-item` |
| Code blocks | `pre.md-fences`, tokens `.cm-s-inner .cm-keyword` and so on |
| Tables | `figure.md-table-fig table` |
| Math | `.md-math-block` |
| Revealed Markdown markers | `.md-meta` |

Colors the app's own panels use come from custom properties on `:root`, for example
`--bg-color`, `--text-color`, `--primary-color`, `--side-bar-bg-color`,
`--active-file-bg-color`, `--select-text-bg-color`, `--search-hit-bg-color`.
