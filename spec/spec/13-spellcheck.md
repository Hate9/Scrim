# 13. Spell check (system dictionaries)

The editor bundles **no dictionaries** and downloads none. It uses what the operating
system already has.

## Providers

Implement a Rust trait `SpellProvider { languages(), check(lang, words) -> misspelled
ranges, suggest(lang, word) -> Vec<String>, add_to_personal(word) }` with:

- **Linux**: Hunspell-format dictionaries found in the standard system locations
  (`/usr/share/hunspell`, `/usr/share/myspell`, `/usr/share/myspell/dicts`,
  `~/.local/share/hunspell`, plus `$DICPATH`). Pairs of `<lang>.dic` + `<lang>.aff`.
  Recommended library: a pure-Rust Hunspell-compatible checker (e.g. `spellbook`), or
  FFI to the system `libhunspell`/`libenchant-2` if present. If no dictionaries exist,
  spell check shows as unavailable with the hint "Install hunspell dictionaries for your
  language with your package manager (for example `hunspell-en_us`)".
- **Windows**: the Windows Spell Checking API (`ISpellCheckerFactory`,
  `ISpellChecker`), which uses the languages installed in Windows settings.

Do **not** rely on the webview's built-in spellcheck: it is inconsistent between
WebKitGTK and WebView2, and its context menu cannot be merged with ours. Set
`spellcheck="false"` on the editor and draw our own marks.

## Behavior

- Language: "Auto" (default) picks the dictionary matching the UI/system locale, then
  falls back to the first English dictionary, then the first available. The user can
  pick from the available languages in Preferences → Editor or Edit → Spell Check ▸.
  Per-document override: front matter `lang: de-DE` (also used as the HTML `lang`).
- What is checked: rendered text of paragraphs, headings, list items, quotes, table
  cells, footnote definitions. Not checked: code (inline and blocks), math, URLs, link
  destinations, HTML tags and attributes, front matter, emoji shortcodes, words with
  digits, ALL-CAPS words of ≤ 5 letters (acronyms), and words in the personal
  dictionary.
- Marks: red wavy underline (`text-decoration: underline wavy`, color from
  `--spell-error-color`, default `#e5484d`) via decorations; never changes the DOM text.
- Checking is incremental: only changed blocks are re-checked, in a Rust worker, 300 ms
  after typing stops; the word being typed is never marked until the cursor leaves it.
- Context menu on a marked word: up to 6 suggestions (click replaces the word, one undo
  step), "Add to Dictionary", "Ignore" (session only, this document).
- Personal dictionary: `<config>/dictionary.txt`, one word per line, shared by all
  languages. Edit → Spell Check ▸ Open Personal Dictionary opens it in the system text
  editor (detached, never blocking).
- Status bar shows the active language code (e.g. `EN-US`); clicking it opens a language
  menu. When unavailable, it shows a warning icon with the hint as tooltip.
- Toggle: Edit → Spell Check ▸ Check Spelling (default on).
