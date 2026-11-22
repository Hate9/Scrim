# Questions for the spec team

Relay protocol (set by the project owner, 2026-11-22):

1. Each question is its own file here, `Q-NNN.md`, pushed to `main`. `NNN` is the next
   number after the highest one in `spec/QA-LOG.md` and in this folder. A file has a
   title, the date, and the question, written like a QA-LOG entry (with the interim
   behavior the implementation uses until the answer arrives, marked in code as
   `// SPEC-QUESTION Q-NNN`).
2. T-1 screenshot candidates go to new `goldens/<date>-<tag>` branches (the goldens
   workflow commits them there).
3. A question is answered once a `## Q-NNN:` entry appears in `spec/QA-LOG.md` on
   `main` (subtree pull). The answer is then copied into the repository's `QA-LOG.md`
   and applied, and the question file stays here as the record of what was asked.
