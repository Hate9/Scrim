# 05. Inline elements

Each row: source syntax, rendered element (theme contract), and reveal behavior per
`03-editing-model.md` 3.2. Markers are wrapped in `span.md-meta` (hidden when the element
is collapsed). Every inline element has a wrapper `span` with class `md-inline-<kind>`
around markers + content, which receives `md-expand` while expanded.

| Kind | Source | Rendered | Notes |
|---|---|---|---|
| strong | `**x**`, `__x__` | `strong` | |
| em | `*x*`, `_x_` | `em` | Intraword `_` does not start emphasis (CommonMark) |
| strike | `~~x~~` | `del` | |
| highlight | `==x==` | `mark` | Only when extension enabled |
| sub | `~x~` | `sub` | Only when extension enabled |
| sup | `^x^` | `sup` | Only when extension enabled |
| underline | `<u>x</u>` | `u` | Is inline HTML; listed because Mod+U creates it |
| code | `` `x` `` | `code` | Content is literal; no nested formatting; markers are the backtick runs |
| link | `[t](url "title")`, `[t][ref]`, `[t]`, `<https://…>` | `a` with `href` | Collapsed shows only `t`. Reference links resolve against definitions anywhere in the document |
| autolink | `https://x`, `www.x` | `a` | No markers to hide; always looks like a link |
| image | `![alt](src "title")` | `img` (+ `span.md-image` wrapper) | Collapsed shows only the image |
| inline math | `$x$` | KaTeX output in `span.md-inline-math` | Only when extension enabled |
| inline HTML | `<span …>x</span>` and other tags | the real element, sanitized | Tags shown as markers when expanded. Unknown/unregistered tags (`17-custom-tags.md`) render as literal text |
| HTML entity | `&amp;`, `&#x2014;` | the character | Expanded shows the entity source |
| escape | `\*` | `*` | Expanded shows the backslash |
| emoji | `:smile:` | `span.md-emoji` containing the character | Unknown shortcodes stay as text. Typing `:` + 2 letters opens emoji autocomplete (5.2) |
| footnote ref | `[^1]` | `sup.md-footnote` | |
| hard break | trailing `␣␣` or `\` | `br` | Expanded shows a faint `↵` marker for two-space breaks |
| comment | `<!-- x -->` inline | hidden; shows as faint text when expanded | |

## 5.1 Inline HTML rendering rules

- Recognized: these inline tags (current phrasing elements plus a few legacy ones that
  old documents use) (`span`, `b`,
  `i`, `u`, `s`, `small`, `big`, `kbd`, `abbr`, `cite`, `q`, `dfn`, `time`, `var`, `samp`,
  `sub`, `sup`, `mark`, `ruby`/`rt`/`rp`, `ins`, `del`, `font`, `a`, `img`, `br`, `wbr`,
  `svg`, `button`, `progress`, `meter`, `data`, `acronym`, `tt`, `strike`, `bdi`, `bdo`)
  and every inline custom tag (`17-custom-tags.md`).
- A recognized open tag and its matching close tag in the same textblock form one
  element; the content between them is parsed as Markdown inline content and rendered
  inside the element.
- A lone recognized tag (no match) renders as literal text in meta style.
- Self-closing / void tags (`<br>`, `<img …>`, `<wbr>`) render directly.
- Attributes pass through the sanitizer (`04-blocks.md` 4.10 rules). `style` attributes
  are allowed. `class` attributes are allowed. `id` attributes are prefixed with
  `user-` to avoid collisions with app chrome.
- An element whose rendered content is empty (for example `<span></span>`) stays visible
  as its source text in meta style so the user can find and edit it.

## 5.2 Emoji autocomplete

Typing `:` followed by two or more letters opens a small popup under the cursor listing
matching shortcodes with their emoji (prefix matches first, then substring). Up/Down
selects, Enter or Tab inserts the shortcode (completed with the closing `:`), Escape
closes. Setting: Preferences → Editor → "Emoji autocomplete", default on.

## 5.3 Inline content in special places

- Table cells: all inline elements allowed. Hard breaks are written as `<br>`.
- Headings: all inline elements allowed.
- Link text may contain other inline elements except links.
