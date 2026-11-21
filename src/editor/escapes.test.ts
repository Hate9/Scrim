// R-4 and R-9 at the model level (the live typing versions run end to end).
import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../md/parse";
import { schema } from "../md/schema";
import { serialize } from "../md/serialize";
import { createEscapePlugin, escapeFor, offendingLine } from "./escapes";
import { createNormalizePlugin } from "./normalize";

const opts = { inlineMath: false };

function stateOf(md: string) {
  const { doc } = parseMarkdown(md);
  return EditorState.create({ doc, plugins: [createEscapePlugin(opts), createNormalizePlugin()] });
}

/** Type `text` character by character at the end of the document. */
function type(state: EditorState, text: string): EditorState {
  for (const ch of text) {
    const end = TextSelection.atEnd(state.doc);
    let tr = state.tr.setSelection(end);
    if (ch === "\n") tr = tr.replaceSelectionWith(schema.nodes.line_break.create(), false);
    else tr = tr.insertText(ch);
    state = state.apply(tr);
  }
  return state;
}

function backspaceAtEnd(state: EditorState, n = 1): EditorState {
  for (let i = 0; i < n; i++) {
    const end = TextSelection.atEnd(state.doc).from;
    state = state.apply(state.tr.delete(end - 1, end));
  }
  return state;
}

describe("offendingLine", () => {
  it("finds continuation triggers and ignores harmless lines", () => {
    expect(offendingLine(["a", "# b"], opts)).toBe(1);
    expect(offendingLine(["a", "2. b"], opts)).toBe(-1); // only 1. interrupts a paragraph
    expect(offendingLine(["a", "1. b"], opts)).toBe(1);
    expect(offendingLine(["a", "***bold***"], opts)).toBe(-1);
    expect(offendingLine(["[x]: https://a.b"], opts)).toBe(0);
    expect(offendingLine(["    code"], opts)).toBe(0);
  });
  it("escape forms", () => {
    expect(escapeFor("1. x", false)).toEqual({ insertAt: 1 });
    expect(escapeFor("  # x", false)).toEqual({ insertAt: 2 });
    expect(escapeFor("  x", true)).toEqual({ deleteLeading: 2 });
  });
});

describe("R-4 block-trigger escapes", () => {
  const cases: [string, string][] = [
    ["# b", "a\n\\# b\n"],
    ["- x", "a\n\\- x\n"],
    ["+ x", "a\n\\+ x\n"],
    ["* x", "a\n\\* x\n"],
    ["> x", "a\n\\> x\n"],
    ["1. x", "a\n1\\. x\n"],
    ["---", "a\n\\---\n"],
    ["***", "a\n\\***\n"],
    ["===", "a\n\\===\n"],
    ["```js", "a\n\\```js\n"],
    ["~~~", "a\n\\~~~\n"],
    ["$$", "a\n\\$$\n"],
    ["<div>", "a\n\\<div>\n"],
  ];
  it.each(cases)("a⇧⏎%s", (line, want) => {
    let s = stateOf("a\n");
    s = type(s, "\n" + line);
    expect(serialize(s.doc)).toBe(want);
    // Reopening the file gives the same single paragraph.
    const re = parseMarkdown(serialize(s.doc)).doc;
    expect(re.childCount).toBe(1);
    expect(re.firstChild!.type.name).toBe("paragraph");
  });

  it("***bold*** on a continuation line gets no escape", () => {
    const s = type(stateOf("a\n"), "\n***bold***");
    expect(serialize(s.doc)).toBe("a\n***bold***\n");
  });

  it("first-line definition is escaped; leading spaces removed", () => {
    expect(serialize(type(stateOf(""), "[x]: https://a.b").doc)).toBe("\\[x]: https://a.b");
    let s = stateOf("x\n");
    s = s.apply(s.tr.insertText("    ", 1));
    expect(serialize(s.doc)).toBe("x\n");
  });
});

describe("R-9 automatic escapes are temporary", () => {
  it("deleting the # deletes the escape; typing it again restores it", () => {
    let s = type(stateOf("a\n"), "\n# b");
    expect(serialize(s.doc)).toBe("a\n\\# b\n");
    // Delete the "#": it sits before " b".
    const text = s.doc.textBetween(0, s.doc.content.size, undefined, "\n");
    const hash = text.indexOf("#");
    const pos = hash + 1; // one paragraph: positions are offsets + 1
    s = s.apply(s.tr.delete(pos, pos + 1));
    expect(serialize(s.doc)).toBe("a\n b\n");
    s = s.apply(s.tr.insertText("#", pos - 1));
    expect(serialize(s.doc)).toBe("a\n\\# b\n");
  });

  it("a backslash the user typed stays", () => {
    let s = type(stateOf("a\n"), "\n\\# b");
    expect(serialize(s.doc)).toBe("a\n\\# b\n");
    const text = s.doc.textBetween(0, s.doc.content.size, undefined, "\n");
    const pos = text.indexOf("#") + 1;
    s = s.apply(s.tr.delete(pos, pos + 1));
    expect(serialize(s.doc)).toBe("a\n\\ b\n");
  });

  it("*** typed then continued: escape disappears", () => {
    let s = type(stateOf("a\n"), "\n***");
    expect(serialize(s.doc)).toBe("a\n\\***\n");
    s = type(s, "b");
    expect(serialize(s.doc)).toBe("a\n***b\n");
    s = backspaceAtEnd(s);
    expect(serialize(s.doc)).toBe("a\n\\***\n");
  });
});

describe("deferral for input-rule triggers", () => {
  it("does not escape '#' or '-' typed alone at the start (space rules need them)", () => {
    expect(serialize(type(stateOf(""), "#").doc)).toBe("#");
    expect(serialize(type(stateOf(""), "-").doc)).toBe("-");
  });
  it("escapes once the cursor leaves", () => {
    let s = stateOf("a\n\nafter\n");
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 2)).insertText("-")); // "a" → "-", cursor after it
    expect(serialize(s.doc)).toBe("-\n\nafter\n");
    s = s.apply(s.tr.setSelection(TextSelection.atEnd(s.doc)));
    expect(serialize(s.doc)).toBe("\\-\n\nafter\n");
  });
});
