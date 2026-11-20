# 17. Custom HTML tags

Users may register their own element names (for example `<bottom>`, `<callout>`) so that
they render as real elements in the editor and in exports, and can be styled with user
CSS.

## Registration

- `local.json` → `customHTMLTags.inline` and `customHTMLTags.block`: arrays of names.
- Valid name: `^[a-z][a-z0-9-]*$` (case-insensitive input, stored lowercase), and **not**
  the name of any element in the HTML, SVG, or MathML standards (check against the
  element index of the HTML Living Standard plus `svg`, `math`, and obsolete elements
  such as `frame`, `frameset`, `applet`, `marquee`, `blink`). This keeps users from
  "registering" `script`, `iframe`, `style`, `object`, `embed`, `link`, `meta`, `base`,
  `form`, etc. past the sanitizer. Invalid entries are ignored (the Customize pane flags
  them with the reason: "not a tag name" or "standard HTML element").
- Registered tags never bypass attribute sanitizing: event handlers and `javascript:`
  URLs are stripped from them like from any element.
- Changes apply live to all open windows: the open documents are re-rendered (cursor and
  scroll kept; no change to the source, not an undo step).

## Inline tags

- Behave exactly like recognized inline HTML (`05-inline.md` 5.1): an open tag and its
  matching close tag in one textblock form an element whose content is Markdown inline
  content. Markers (the tags) show when expanded.
- Unregistered unknown tags render as literal text (this is how users notice they forgot
  to register a tag).

## Block tags

- A line that starts with an opening tag of a registered block name starts an **HTML
  block** (like CommonMark HTML block type 6), ending at the next blank line.
- Rendered via the HTML block preview (`04-blocks.md` 4.10). Content is HTML; Markdown
  inside it is **not** parsed (CommonMark behavior). The Customize pane explains this.

## Sanitizer and export

- Registered names are added to the sanitizer allowlist for inline HTML, HTML blocks,
  and exports.
- Exported HTML/PDF contain the elements as written (`<bottom>…</bottom>`), so user CSS
  in `base.user.css` (which export includes) styles them.
- Unknown elements default to `display: inline` in browsers; users set `display: block`
  in CSS when they want block layout for an inline tag.

## Helping the user

- In the Customize pane's snippet editor, when a snippet body contains a tag name
  (`<name` …) that is neither a standard HTML element nor registered, show a warning
  under the body: "`<name>` isn't a registered custom tag, so it will show as text."
  with buttons **Add as inline** and **Add as block**, which register it immediately.
