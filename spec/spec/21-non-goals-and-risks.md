# 21. Non-goals, deferred work, risks

## Non-goals (v1)

- macOS builds.
- Split views.
- Collaborative editing, sync, cloud storage integrations.
- Built-in image uploader services (the generic upload command in 6.4 covers it).
- Mobile.
- Replace across files.
- WYSIWYG editing of HTML blocks (they are edited as source).
- Typewriter-style sounds, character-level animations. (Never.)

## Planned for a later version (owner decision, 2026-11-23)

These are out of scope for v1. Don't build them or design around them yet; each gets
its own spec section before work starts. The implementation only needs to avoid choices
that would rule them out.

- Diagram rendering as a live preview under the code block: mermaid, flowchart
  (```` ```flow ````) and sequence diagrams (```` ```sequence ````).
- "Indent first line of paragraphs" preference.
- Save All (File menu).
- Switching between open document windows (Ctrl+Tab style).
- Refresh All Math Expressions and Prettify Source Code commands.
- UI translations beyond English (the Language setting already exists).
- Image export (render the document to PNG).
- Document versions / history browser.
- Tabs within a window.
- Auto-update on Windows.
- Maybe: remapping quotes and dashes to smart punctuation in existing text when a
  document is parsed, not only while typing.
- Maybe: a plugin/extension API.

## Known hard parts (plan time for these)

1. **Cursor mapping with syntax reveal.** Revealing markers shifts text; clicks must be
   mapped using the pre-reveal layout. Build this first in P1 with exhaustive tests.
2. **Round-trip fidelity** with a structured editor. Keep original source slices per
   block and re-serialize only changed blocks (`01-architecture.md`).
3. **IME composition** inside decorated inline content. Decorations that change during
   composition break IMEs in both WebKitGTK and WebView2. Freeze decoration updates
   while `compositionstart`…`compositionend` is active.
4. **WebKitGTK differences.** Test on WebKitGTK early and continuously: selection
   painting, `contenteditable` quirks, clipboard (read `text/html` from the DOM paste
   event; custom MIME types are unreliable, see `06-clipboard-and-dnd.md`), print-to-PDF
   API, IME on Wayland, CSP behavior for custom protocols.
5. **PDF export on Linux.** WebKitGTK print-to-file must be driven from Rust via the
   webview handle. Prototype in P0 to de-risk.
6. **Large documents.** ProseMirror with many decorations on 10k-line documents needs
   viewport-limited decoration computation for spellcheck and search highlights.
7. **Theme compatibility.** Real third-party themes use many selectors. The owner
   provides a local fixture set (CLEAN-ROOM.md rule 7); fix the DOM contract gaps the
   tests reveal, recording each as a QA question.
8. **Keyboard routing.** Native menu accelerators vs focused inputs vs WebView2 browser
   keys (`01-architecture.md`, "Keyboard routing"). Prototype the dispatcher in P1.
9. **PDF headers/footers** need a Rust PDF post-processing step (`09-export-import.md`).
