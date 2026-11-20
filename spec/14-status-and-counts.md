# 14. Status bar and counts

## Status bar

A 30 px bar at the bottom of the editor area (not under the sidebar), top border
1 px `#ddd`-ish (theme `--window-border`), font 12 px, wireframe
`wireframes/window.svg`.

- Left: sidebar toggle button (shows `<` when sidebar open, a circle outline when closed),
  then source mode toggle button (`</>`).
- Right: spell check language (13), then the word count.
- Hidden via View → Show Status Bar.

## Word count

- Default display: `N Words`. Clicking it opens a small popover listing: words,
  characters (with spaces), characters (no spaces), lines, paragraphs, reading time
  (words / 250 wpm, shown as `~N min`), and the same for the selection when there is
  one. A radio choice in the popover selects which value the status bar shows.
- With a selection, the status bar shows `selected / total` for the chosen value.
- Counting rules:
  - Count rendered text: markers, URLs of links, image sources, HTML tags, front
    matter, and footnote definition labels are excluded. Code blocks and math are
    excluded from words but included in characters (setting "Count code in words",
    default off).
  - A word is a maximal run of letters, digits, apostrophes, and hyphens between other
    characters (Unicode-aware). Each CJK ideograph, kana, and Hangul syllable counts as
    one word. Emoji count as one character, zero words.
  - Lines = source lines. Paragraphs = non-empty text blocks.
- Counts update within 300 ms of typing stopping, computed off the main thread for
  documents over 2,000 lines.
