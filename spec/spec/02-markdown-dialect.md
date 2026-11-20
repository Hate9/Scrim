# 02. Markdown dialect

The editor reads and writes **CommonMark 0.31 + GitHub Flavored Markdown**, plus the
extensions below. Where this file and CommonMark/GFM disagree, this file wins.

## Always on

| Construct | Syntax | Notes |
|---|---|---|
| CommonMark blocks and inlines | all | Including setext headings, indented code, HTML blocks, link reference definitions, entity references, backslash escapes, autolinks `<https://…>` |
| GFM tables | pipe tables | Alignment row `:---`, `:---:`, `---:` |
| GFM strikethrough | `~~text~~` | Single `~text~` is subscript when that extension is on, otherwise literal |
| GFM task list items | `- [ ]` / `- [x]` | `[X]` also counts as checked; written back as it was read |
| GFM extended autolinks | `www.example.com`, `https://…` in text | Rendered as links; no source change |
| Footnotes | `text[^id]` and `[^id]: definition` | Definition may span indented continuation lines |
| YAML front matter | `---` on line 1 … `---` or `...` | Only at the very start of the file |
| Fenced math block | line `$$`, content, line `$$` | `$$x$$` on one line inside text is NOT a block: with inline math on it renders `x` as display-style math inline; with inline math off it is literal text |
| Table of contents | a paragraph that is exactly `[toc]` (case-insensitive) | Renders a live TOC of headings |
| Emoji shortcodes | `:smile:` | Rendered as the Unicode emoji; source unchanged. Uses the GitHub gemoji shortcode list (open data) |
| Heading IDs | automatic | GitHub-style slug from heading text; used by TOC, outline, and `#anchor` links. Duplicate slugs get `-1`, `-2` suffixes |

## Toggleable (Preferences → Markdown)

| Construct | Syntax | Default |
|---|---|---|
| Inline math | `$…$` (opening `$` not followed by a space, closing `$` not preceded by a space and not followed by a digit) | **Off** |
| Subscript | `~text~` (no spaces inside unless escaped) | Off |
| Superscript | `^text^` (no spaces inside unless escaped) | Off |
| Highlight | `==text==` | Off |
| Diagrams | fenced code with language `mermaid` | On (rendering is deferred past v1, see `21-non-goals-and-risks.md`; until then they render as ordinary code blocks) |
| Strict mode | CommonMark-strict parsing: ATX headings need a space after `#`, list items need correct indentation | On |
| Smart punctuation | Display-only typographic quotes/dashes (`03-editing-model.md`) | Off |

When strict mode is **off**, these lenient forms are also accepted: a line starting with
1–6 `#` directly followed by a letter (`#Heading`) is a heading, and an ordered list starting with a number other than 1 may interrupt a paragraph (CommonMark
forbids that). Everything else follows CommonMark in both modes.

## Line breaks

- Inside a paragraph, a single newline in the source is a **soft break**. The setting
  "Preserve single line breaks" (Preferences → Markdown, default **on**) controls how
  soft breaks display: on = shown as line breaks in the editor and exported HTML
  (`<br>`); off = shown as a space (CommonMark default).
- A hard break (two trailing spaces or a trailing backslash before the newline) always
  displays as a line break. When the user inserts a line break with Shift+Enter, the
  editor writes a plain newline (soft break), unless "Preserve single line breaks" is
  off, in which case it writes a trailing backslash hard break. (Rationale: with the
  setting on, plain newlines already display as breaks and keep files clean.)

## Writing Markdown (new or re-serialized blocks)

When the editor creates Markdown (new blocks, converted blocks, pasted rich text), it
uses these defaults, each overridable in Preferences → Markdown → "Writing style":

| Element | Default output |
|---|---|
| Heading | ATX: `# Title` (no closing `#`s) |
| Bold | `**text**` |
| Italic | `*text*` |
| Bullet list | `-` then one space |
| Ordered list | `1.` numbering incremented (`1. 2. 3.`) |
| Task item | `- [ ] ` |
| Code fence | three backticks; four if content contains a line starting with three backticks |
| Thematic break | `---` |
| Table | padded columns aligned with spaces, alignment row with colons as needed |
| Nested list indent | content-aligned (2 spaces under `- `, 3 under `1. `) |
| Blank lines | one blank line between blocks; none between tight list items |
| Escapes | escape only characters that would otherwise change meaning |

## Things the editor never does

- It never rewrites a block just because it was viewed or the cursor passed through it.
- It never normalizes line endings, trailing whitespace, or Unicode (NFC/NFD) of untouched
  text.
- It never adds or removes the final newline of a file unless the user edits the last
  block and the file had one (then it keeps one).
