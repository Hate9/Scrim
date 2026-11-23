# Clean-room protocol

This project re-implements the *behavior* of a well-known proprietary Markdown editor
without copying any of its code, text, artwork, or other protected expression. Two
roles exist and must stay separate:

- **Spec team** ("dirty room"): studied the original program and wrote this spec. They
  answer questions. They never write implementation code.
- **Implementation team** ("clean room"): builds the editor from this spec alone. They
  have never seen the original program's code and must not see it.

## Rules for the implementation team

1. **The spec is the only description of intended behavior.** If the spec does not say
   it, it is either your design choice or a question for the spec team (see below).
2. **Do not obtain, open, decompile, unpack, or read any part of the original program**,
   including its installers, `app.asar` or other archives, bundled JavaScript, CSS, HTML,
   images, fonts, localization files, or documentation that ships inside it.
3. **Do not search for or read the original program's source code**, leaked or
   decompiled, on any site, and do not read repositories that patch or modify it.
4. **Do not copy text from the original program's website or documentation.** You MAY
   read public, general Markdown references (CommonMark spec, GitHub Flavored Markdown
   spec, pandoc manual, KaTeX/MathJax docs, library docs).
5. **Do not use the original program's name, logo, icons, or trademarks** anywhere in
   the product, its UI, docs, package names, or repository. The single exception is the
   selector-rewrite table in the theme loader and its tests (`spec/10-themes.md` 10.3,
   test T-6, QA-LOG Q-000).
   Describe theme compatibility only as "supports themes written for other popular
   live-preview Markdown editors".
   **Exception (owner decision, 2026-11-23):** `README.md` may name the original
   program, Typora, in one short "Background" note, as plain text with no logo, link
   styling, or trademark symbols. The note says three things: Scrim is an independent
   clean-room reimplementation of Typora's editing behavior, it contains no Typora code
   or assets, and it is not affiliated with or endorsed by Typora's developers. Use
   "modeled on" or "inspired by", never "based on", which would suggest derived code.
   The same note may say that themes written for Typora work in Scrim. The spec itself
   (everything under `spec/`, which is the spec team's material, including this file,
   `QA-LOG.md` and `fixtures/`) may also name it. Everywhere else (UI, other docs, package
   metadata, the app name, commit messages, code outside the theme rewrite table) this
   rule applies unchanged.
6. **Third-party open-source libraries are fine** (they are not the original program),
   subject to their licenses. Record every dependency's license in `THIRD_PARTY.md`.
7. **Themes**: the editor's built-in themes are written from scratch from the values in
   `spec/22-visual-design.md`. Never copy theme CSS written for the original program
   (bundled or community) into the repository or into Scrim's own themes. For
   compatibility testing, the **project owner** supplies a set of community themes as
   local, uncommitted test fixtures (`tests/fixtures/themes/`, git-ignored), listed in
   `fixtures/themes.lock.json` (URL pinned to a commit, SHA-256, license; a test helper
   downloads and verifies them, and only the list is committed); you may
   load them in tests but not read them to design Scrim's themes. Expected results for
   those tests are screenshots **of Scrim**, approved by the owner (golden images), never
   screenshots of the original program.
8. **Keep a log.** Note in `PROVENANCE.md` (in the implementation repo) any outside
   source you consulted beyond library documentation, with a link and a one-line reason.

## Question channel

When the spec is ambiguous, contradictory, or silent on something that matters:

1. Write the question in `QA-LOG.md` in the implementation repo under a new `Q-NNN`
   heading. Describe what you need to decide and the options you see. Do not guess
   about the original program's behavior from memory or from the web.
2. The project owner relays the question to the spec team.
3. The spec team answers in this repository's `QA-LOG.md` with the same number. Answers
   are behavioral (what the user sees and does), never code.
4. Answers are binding spec addenda. Copy them into the implementation repo's log.

Until an answer arrives, pick the most conservative reasonable behavior, mark the code
with `// SPEC-QUESTION Q-NNN`, and continue.

## Rules for the spec team

1. Describe behavior: inputs, outputs, visible states, timings, file formats.
2. Never paste or paraphrase the original's code, identifiers private to its code, or
   its documentation text. Do not include screenshots of it.
3. Interoperability contracts (file formats, the theme DOM contract in
   `spec/10-themes.md`, default keyboard shortcuts) may be described exactly, because
   they are what users' existing files, themes, and muscle memory depend on.
4. Visual design is described as measured values (sizes, colors, spacing) and
   original wireframes, not copied assets.

## Provenance of this spec

- Written by the spec team from observation of the original program's behavior and
  appearance (running it, measuring computed styles) and general knowledge of Markdown
  editors.
- Contains no code from the original program.
- Reviewed for copied expression before handoff (see `REVIEW.md` once present).
