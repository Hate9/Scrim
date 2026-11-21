// Structural edits serialize minimally (spec 01, round-trip model items 2-5).
import { history } from "prosemirror-history";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../md/parse";
import { serialize } from "../md/serialize";
import { backspace, enter, setHeading, shiftTab, tab, toggleQuote } from "./commands";
import { defaultOptions } from "./context";
import { createInlinePlugin } from "./decorations";
import { createEscapePlugin } from "./escapes";
import { createNormalizePlugin } from "./normalize";

const opts = { ...defaultOptions };
const hooks = { setImageSource: () => {}, renderMath: () => {} };

class Doc {
  state: EditorState;
  constructor(md: string) {
    const { doc } = parseMarkdown(md);
    this.state = EditorState.create({
      doc,
      plugins: [history(), createInlinePlugin(opts, hooks), createNormalizePlugin(), createEscapePlugin(opts)],
    });
  }
  /** Put the cursor right after the first occurrence of `marker` in the text (| = before). */
  at(marker: string, before = false): this {
    let found = -1;
    this.state.doc.descendants((n, pos) => {
      if (found < 0 && n.isText) {
        const i = n.text!.indexOf(marker);
        if (i >= 0) found = pos + i + (before ? 0 : marker.length);
      }
      return found < 0;
    });
    if (found < 0) throw new Error(`no ${marker}`);
    this.state = this.state.apply(this.state.tr.setSelection(TextSelection.create(this.state.doc, found)));
    return this;
  }
  run(cmd: Command): this {
    if (!cmd(this.state, (tr) => (this.state = this.state.apply(tr)))) throw new Error("command did not apply");
    return this;
  }
  type(text: string): this {
    this.state = this.state.apply(this.state.tr.insertText(text));
    return this;
  }
  get md() {
    return serialize(this.state.doc);
  }
}

describe("Enter", () => {
  it("new paragraph between others: canonical separator only for the new block", () => {
    const d = new Doc("one\n\n\n\ntwo\n").at("one").run(enter(opts)).type("new");
    expect(d.md).toBe("one\n\nnew\n\n\n\ntwo\n");
  });
  it("split a tight list item", () => {
    expect(new Doc("* one two\n* three\n").at("one").run(enter(opts)).md).toBe("* one\n*  two\n* three\n");
  });
  it("sequential ordered list renumbers following items", () => {
    expect(new Doc("1. a\n2. b\n3. c\n").at("a").run(enter(opts)).type("x").md).toBe("1. a\n2. x\n3. b\n4. c\n");
  });
  it("all-same ordered list keeps the same number", () => {
    expect(new Doc("1) a\n1) b\n").at("b").run(enter(opts)).type("x").md).toBe("1) a\n1) b\n1) x\n");
  });
  it("irregular list: new item is previous + 1, nothing else changes", () => {
    expect(new Doc("1. a\n5. b\n").at("a").run(enter(opts)).type("x").md).toBe("1. a\n2. x\n5. b\n");
  });
  it("loose list keeps blank lines between items", () => {
    expect(new Doc("- a\n\n- b\n").at("b").run(enter(opts)).type("c").md).toBe("- a\n\n- b\n\n- c\n");
  });
  it("in a quote: new paragraph inside, empty last paragraph leaves", () => {
    const d = new Doc("> a\n").at("a").run(enter(opts)).type("b");
    expect(d.md).toBe("> a\n>\n> b\n");
    d.run(enter(opts)).run(enter(opts)).type("out");
    expect(d.md).toBe("> a\n>\n> b\n\nout\n");
  });
  it("lists inside quotes keep the quote prefix", () => {
    expect(new Doc("> - a\n> - b\n").at("b").run(enter(opts)).type("c").md).toBe("> - a\n> - b\n> - c\n");
  });
  it("end of heading: new paragraph", () => {
    // "text" followed the heading with no blank line; after the new paragraph it needs
    // one, or it would become a lazy continuation of "p".
    expect(new Doc("# T\ntext\n").at("T").run(enter(opts)).type("p").md).toBe("# T\n\np\n\ntext\n");
  });
});

describe("Tab / Shift+Tab / Backspace", () => {
  it("nest and lift are byte-exact round trips", () => {
    const src = "1. a\n2. b\n3. c\n";
    const d = new Doc(src).at("b").run(tab);
    expect(d.md).toBe("1. a\n   1. b\n2. c\n");
    d.run(shiftTab);
    expect(d.md).toBe(src);
  });
  it("Q-009: Backspace at the start of a middle item splits the list around a paragraph", () => {
    expect(new Doc("1. a\n2. b\n3. c\n4. d\n").at("b", true).run(backspace(opts)).md).toBe("1. a\n\nb\n\n3. c\n4. d\n");
    expect(new Doc("* a\n* b\n* c\n").at("b", true).run(backspace(opts)).md).toBe("* a\n\nb\n\n* c\n");
    // Irregular numbering: both halves keep their numbers.
    expect(new Doc("1. a\n7. b\n9. c\n").at("b", true).run(backspace(opts)).md).toBe("1. a\n\nb\n\n9. c\n");
    // All-same numbering keeps its style in the second half.
    expect(new Doc("1) a\n1) b\n1) c\n").at("b", true).run(backspace(opts)).md).toBe("1) a\n\nb\n\n1) c\n");
  });
  it("Q-009: nested item outdents one level", () => {
    expect(new Doc("- a\n  - b\n  - c\n").at("c", true).run(backspace(opts)).md).toBe("- a\n  - b\n- c\n");
  });
  it("Backspace at the start of an item lifts it to a paragraph", () => {
    expect(new Doc("- a\n").at("a", true).run(backspace(opts)).md).toBe("a\n");
  });
});

describe("block type changes", () => {
  it("heading levels keep surrounding bytes", () => {
    expect(new Doc("x\n\n\n## T ##\n").at("T").run(setHeading(1)).md).toBe("x\n\n\n# T ##\n");
    expect(new Doc("T\n===\n").at("T").run(setHeading(2)).md).toBe("T\n---\n");
    expect(new Doc("T\n===\n").at("T").run(setHeading(3)).md).toBe("### T\n");
    expect(new Doc("a\n\n# T\n\nb\n").at("T").run(setHeading(0)).md).toBe("a\n\nT\n\nb\n");
  });
  it("paragraph to heading and quote", () => {
    expect(new Doc("a\n\nb\n").at("b").run(setHeading(2)).md).toBe("a\n\n## b\n");
    expect(new Doc("a\n\nb\n").at("b").run(toggleQuote).md).toBe("a\n\n> b\n");
  });
});
