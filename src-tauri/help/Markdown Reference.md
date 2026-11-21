# Markdown Reference

Scrim reads and writes CommonMark with the GitHub extensions, plus the extras below.

## Inline

| You type | You get |
|---|---|
| `**strong**` or `__strong__` | **strong** |
| `*emphasis*` or `_emphasis_` | *emphasis* |
| `` `code` `` | `code` |
| `~~strike~~` | ~~strike~~ |
| `[text](https://example.com "title")` | a link |
| `[text][ref]` with `[ref]: https://example.com` | a reference link |
| `<https://example.com>` | an autolink |
| `![alt](image.png)` | an image |
| `<u>underline</u>` | underline |
| `==highlight==` | highlight (Preferences → Markdown) |
| `$x^2$` | inline math (Preferences → Markdown) |
| `H~2~O`, `x^2^` | subscript, superscript (Preferences → Markdown) |
| `:smile:` | an emoji |
| `[^1]` with `[^1]: text` | a footnote |

## Blocks

| You type | You get |
|---|---|
| `# Heading` … `###### Heading` | headings 1–6 |
| `> text` | a quote |
| `- item`, `* item`, `+ item` | a bullet list |
| `1. item` | a numbered list |
| `- [ ] task`, `- [x] done` | a task list |
| ```` ```lang ```` … ```` ``` ```` | a code block |
| `$$` … `$$` | a math block |
| `---` on its own line | a horizontal line |
| `| a | b |` + `| - | - |` | a table |
| `[toc]` | a table of contents |
| `---` at the very top … `---` | YAML front matter |

A line break inside a paragraph stays a line break (Preferences → Markdown →
"Preserve single line breaks"). End a line with two spaces or `\` for a hard break.
