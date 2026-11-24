# 22. Visual design

The look is calm and bookish: a single centered text column, lots of air, almost no
chrome. Everything below is measured values (sizes in CSS px at 100% zoom, colors in
hex), plus wireframes in `../wireframes/`. Build the built-in themes from these
numbers; don't hunt for any other reference. Most values are exact measurements; the
code token colors, the Preferences panel colors, and a few hover/selected states are
close approximations and serve as design targets.

Fonts: bundle **PT Serif** and **Open Sans** (both SIL Open Font License) inside the app
so Linux and Windows look the same. Monospace uses system fonts:
`"Lucida Console", Consolas, "Courier", monospace` (paper/clean) and
`Monaco, Consolas, "Andale Mono", "DejaVu Sans Mono", monospace` (night). Don't
bundle Lucida Console or Consolas; they are proprietary.

## 22.1 Window layout (all themes)

Wireframe: `wireframes/window.svg`, `wireframes/sidebar.svg`.

| Element | Value |
|---|---|
| Sidebar width | 240 px (`--sidebar-width`), full window height, left |
| Sidebar right edge | 1 px dashed, color `--text-color` (paper) / none (clean, night: background contrast only) |
| Sidebar tabs | "Files" and "Outline", centered pair at top, 14 px text, tab label width 84 px, label baseline ~26 px from top. Active tab: bold, 4 px solid bar under the label in `--text-color`, bar 84 px wide, 15 px below the label |
| Sidebar content | starts 58 px from top; 18 px left padding |
| Outline rows | 14 px text, row pitch 25 px, indent 14 px per heading level; active heading bold |
| Sidebar bottom bar | 30 px; `+` button at left (16 px icon, `--primary-color`) |
| Editor area | right of sidebar (or full width when hidden); scroll container |
| Document column `#write` | see per-theme table; horizontally centered in the editor area when the area is wider than the column |
| Status bar | 30 px tall at the bottom of the editor area, 12 px text, top border 1 px `#dddddd` (paper) |
| Status bar left buttons | 30 × 30 px each: sidebar toggle, source mode `</>` |
| Status bar right | spell language (warning triangle + `EN-GB` style code), then `N Words`, 12 px, 20 px right padding |
| Find bar | spans the editor area at the top, 39 px per row, background `--bg-color`, bottom shadow `0 1px 0 rgba(12,13,14,.1), 0 1px 3px rgba(12,13,14,.1)`; input 26 px tall, 12 px text, 1 px solid `#cccccc` border, inset shadow `0 1px 1px rgba(0,0,0,.075)`; icon buttons to the right (case `Aa`, whole word `ab`, regex `.*`, ⋯ menu, ▲, ▼), close × at far right |
| Quick open | panel 420 px wide, horizontally centered in the editor area, 4 px below its top edge; search input full width at top (30 px); result rows 40 px tall with name (14 px) and path (11 px, muted, middle-ellipsized); selected row background `--active-file-bg-color`, text `--active-file-text-color`; panel shadow `0 4px 12px rgba(0,0,0,.25)`; max 8 rows visible, scrollbar |

## 22.2 Theme "paper" (default, warm serif)

| Token / element | Value |
|---|---|
| `--bg-color` | `#f3f2ee` |
| `--text-color` | `#1f0909` |
| `--select-text-bg-color` / font | `rgba(32, 43, 51, 0.63)` / `white` |
| `--md-char-color` | `#c7c5c5` |
| `--heading-char-color` | `#dddddd` |
| `--meta-content-color` | `#5b808d` |
| `--blur-text-color` | `#c8c8c8` |
| `--side-bar-bg-color` | `#f3f2ee` (same as page) |
| `--active-file-bg-color` / text | `rgba(32, 43, 51, 0.63)` / `white` |
| `--control-text-color` / hover | `#444444` / `#1f0909` |
| `--item-hover-bg-color` | `rgba(229, 229, 229, 0.59)` |
| `--primary-color` | `#428bca` |
| `--table-border-color` | `#cccccc` |
| `--search-select-bg-color` / text | `#000000` / `#ffffff` |
| `--rawblock-edit-panel-bd` | `#e5e5e5` |
| Body font | `"PT Serif", "Times New Roman", Times, serif`, 16 px, line height 24 px (1.5) |
| `#write` | max-width 640 px, padding 36 px top, 30 px sides, 70 px bottom (text measure 580 px) |
| `h1` | 30 px, weight 400, line height 39 px (1.3), margin 60 px top / 15 px bottom, padding-bottom 24.4 px, border-bottom 1 px solid `#c5c5c5` |
| `h2` | 21 px, weight 700, line height 1.15, margin 48 px / 15.75 px |
| `h3` | 21 px, weight 400, line height 1.15, margin 48 px / 15.75 px |
| `h4` | 18 px, weight 700, line height 24 px, margin 48 px / 27 px |
| `h5`, `h6` | 16 px, weight 700, margin 16 px / 24 px |
| `p` | margin 16 px top / 24 px bottom |
| `a` | color `#065588`, no underline |
| `strong` / `em` | weight 700 / italic, same color |
| Inline `code` | monospace 14 px, background `#dadada`, padding 0 2 px, no radius |
| `blockquote` | color `#656565`, italic, margin-left 32 px, padding-left 16 px, border-left 5 px solid `#bababa` |
| `ul`, `ol` | margin-left 24 px, padding-left 40 px, margin-bottom 24 px; items 16 px, tight item pitch 32 px (8 px gap) |
| Task checkbox | rendered as a `√` glyph: unchecked faint (`#dddddd`), checked `--text-color`; positioned 27 px left of the item text |
| Code block `.md-fences` | monospace 14.4 px (0.9 em), line height 1.71, background `#dadada`, margin-left 28.8 px, padding 0 8.4 px, margin 14.4 px top / 43.2 px bottom, no border, no radius |
| Code tokens | keyword `#8959a8`-ish purple, string/number green `#718c00`, comment `#a67f59`-ish brown, variable blue `#4271ae`; operator `#3e999f` |
| `table` | full column width; `th` bold uppercase (`text-transform: uppercase`), background `#dadada`; cells padding 4 px 4 px 4 px 6.4 px; no cell borders |
| `hr` | 1 px solid `#c5c5c5` (border-bottom), margin 20 px |
| Math block | centered, margin 16 px |
| Front matter | monospace 12.8 px, color `#555555`, margin 12.8 px, no background |
| Footnote ref | 12 px, color `#555555`, background `rgba(238,238,238,.7)`, padding 2 px 4 px, radius 4 px |
| Footnote def | 14.4 px |
| Status bar / sidebar font | same serif, 12 px / 14 px |

## 22.3 Theme "clean" (white, sans)

| Token / element | Value |
|---|---|
| `--bg-color` / `--text-color` | `#ffffff` / `#333333` |
| `--select-text-bg-color` | `#dae3ea` |
| `--side-bar-bg-color` | `#fafafa` |
| `--active-file-bg-color` | `#eeeeee` (text inherits), left border 4 px `#777777` |
| `--control-text-color` | `#777777` |
| Body font | `"Open Sans", "Clear Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`, 16 px, line height 1.6 |
| Chrome font | `"Segoe UI", Arial, sans-serif` (falls back to Open Sans on Linux) |
| `#write` | max-width 860 px, padding 30 px top, 30 px sides, 100 px bottom |
| `h1` | 36 px bold, line height 1.2, margin 16 px, border-bottom 1 px `#eeeeee` |
| `h2` | 28 px bold, line height 1.225, border-bottom 1 px `#eeeeee` |
| `h3` / `h4` / `h5` | 24 / 20 / 16 px bold, margins 16 px |
| `h6` | 16 px bold, color `#777777` |
| `p` | margin 12.8 px (0.8 em) |
| `a` | `#4183c4` |
| Inline `code` | 14.4 px, background `#f3f4f4`, 1 px solid `#e7eaed` border, radius 3 px, padding 0 2 px |
| `blockquote` | color `#777777`, border-left 4 px solid `#dfe2e5`, padding 0 15 px |
| `ul`/`ol` | padding-left 30 px, margin 12.8 px |
| Code block | 14.4 px, background `#f8f8f8`, 1 px solid `#e7eaed`, radius 3 px, padding 8 px 4 px 6 px |
| `table` | `th` bold; cells padding 6 px 13 px; 1 px solid `#dfe2e5` cell borders; even rows background `#f8f8f8` |
| `hr` | 2 px tall, background `#e7e7e7`, no border, margin 16 px |
| Front matter | 13.6 px monospace, color `#777777`, background `#f7f7f7`, padding 16 px, radius 3 px |

## 22.4 Theme "night"

| Token / element | Value |
|---|---|
| `--bg-color` / `--text-color` | `#363b40` / `#b8bfc6` |
| `--select-text-bg-color` | `#4a89dc` |
| `--side-bar-bg-color` | `#2e3033` |
| `--active-file-bg-color` / text | `#222222` / `white` |
| `--item-hover-bg-color` | `#70717d` |
| `--control-text-color` | `#b7b7b7` |
| `--primary-color` | `#6dc1e7` |
| `--search-select-bg-color` | `#428bca` |
| Body font | `"Helvetica Neue", Helvetica, Arial, sans-serif`, 16 px, line height 26 px |
| Headings font | `"Lucida Grande", Corbel, sans-serif` (system; falls back to Open Sans), color `#dedede` |
| `#write` | max-width 914 px, padding 36/30/70 px |
| `h1` | 40 px, weight 400, line height 44 px, letter-spacing −1.5 px, margin 80 px top / 24 px bottom |
| `h2` | 26 px bold, line height 30 px, letter-spacing −1 px, margin-bottom 24 px |
| `h3` | 18.7 px bold, letter-spacing −1 px |
| `h4` / `h6` | 17.9 / 14.9 px, weight 400, white |
| `h5` | 15.5 px bold |
| `p` | margin-bottom 24 px |
| `a` | `#e0e0e0`, underline on hover |
| Inline `code` | 14 px monospace, background `rgba(0,0,0,.05)`, padding 2 px 5 px |
| `blockquote` | color `#9da2a6`, margin 35 px top / 30 px bottom / 30 px left, padding-left 30 px, left border 2 px `#474d54` |
| Code block | 14.4 px, background `#333333`, padding 10 px 10 px 10 px 30 px, margin-bottom 20 px |
| `table` | `th` `#dedede` bold, cells padding 5 px 10 px, row borders 1 px `#474d54` |
| `hr` | 2 px, `#474d54`, margin 24 px |
| Front matter | 12.8 px monospace, dashed bottom border 1 px `#cccccc` |
| Footnote ref | color `#dddddd`, background `#555555` |

## 22.5 Interaction states (all themes)

| State | Look |
|---|---|
| Meta characters (revealed markers) | `--md-char-color`, same font size as surrounding text |
| Heading level hint | 12 px, `--heading-char-color`, in the left margin 30 px left of the heading |
| Focused rich block (code/math/HTML editing) | 1 px solid `--rawblock-edit-panel-bd` outline around the editing area |
| Selected rich block (as a unit) | 2 px solid `--focus-ring-color` (`#6eace2`) outline, 2 px offset |
| Text selection | `--select-text-bg-color`, text `--select-text-font-color` (auto = unchanged) |
| Search hits | background `--search-hit-bg-color` (default `rgba(255, 220, 0, .5)`); current: `--search-select-*` |
| Spelling error | wavy underline `#e5484d` |
| Hovered sidebar row | `--item-hover-bg-color` |
| Popovers (link hover, footnote, emoji list, language box list) | background `--color-popover-bg-color` (`#fafafa` light), 1 px `rgba(0,0,0,.15)` border, radius 4 px, shadow `0 2px 8px rgba(0,0,0,.15)`, 13 px text |
| Table toolbar | 28 px tall row of 24 px icon buttons, background `--bg-color`, 1 px `--table-border-color` border, radius 3 px, sitting 4 px above the table |
| Language box (code block) | 12 px text input, 120 px wide, bottom-right inside the block, transparent background, muted text until focused |
| Notice bar (recovered drafts, encoding warnings, other one-line notices) | full width at the top of the editor area, 13 px text; the message is left-aligned, the action buttons sit together at the right edge in their given order, 8 px apart, followed by the close button last; nothing is centered |
| Animations | none, except 150 ms fades for popovers, the sidebar sliding 200 ms, and typewriter-mode scrolling 100 ms |

## 22.6 Preferences panel

Wireframe `wireframes/preferences.svg`. Header 56 px with "Preferences" (18 px) left and
× right separated by a 1 px vertical rule; white (`--bg-color`) header over a slightly
darker body (`#f7f7f7` light themes). Left column: search field (200 × 26 px), section
list below at 14 px, row pitch 34 px, active section filled `#999999` with white text,
radius 2 px. Right column 600 px max: section title 26 px, groups with bold 14 px headers
and muted 12 px hints, controls 14 px, 8 px vertical rhythm.
