import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../md/parse";
import { serialize } from "../md/serialize";
import { enter } from "./commands";
import { defaultOptions } from "./context";
import { cellEnter, deleteRow, moveColumn, moveRow, nextCell, setAlign } from "./tables";

class T {
  state: EditorState;
  constructor(md: string) {
    this.state = EditorState.create({ doc: parseMarkdown(md).doc });
  }
  at(text: string): this {
    let at = -1;
    this.state.doc.descendants((n, p) => {
      if (at < 0 && n.isText && n.text!.includes(text)) at = p + n.text!.indexOf(text);
      return at < 0;
    });
    this.state = this.state.apply(this.state.tr.setSelection(TextSelection.create(this.state.doc, at)));
    return this;
  }
  run(c: Command): this {
    c(this.state, (tr) => (this.state = this.state.apply(tr)));
    return this;
  }
  type(t: string): this {
    this.state = this.state.apply(this.state.tr.insertText(t));
    return this;
  }
  get md() {
    return serialize(this.state.doc);
  }
}

describe("tables", () => {
  it("B-4: |a|b|⏎ creates a padded table; Tab cycles; Enter in the last row adds a row", () => {
    const t = new T("|a|b|\n");
    t.state = t.state.apply(t.state.tr.setSelection(TextSelection.atEnd(t.state.doc)));
    t.run(enter(defaultOptions)).type("1").run(nextCell(1)).type("2");
    expect(t.md).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n");
    t.run(nextCell(1)).type("3").run(cellEnter).type("5");
    expect(t.md).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| 3   |     |\n| 5   |     |\n");
  });
  const src = "| h1 | h2 |\n|----|----|\n| a  | b  |\n| c  | d  |\n";
  it("Alt+Down moves a row; header stays", () => {
    expect(new T(src).at("a").run(moveRow(1)).md).toBe("| h1 | h2 |\n|----|----|\n| c  | d  |\n| a  | b  |\n");
    expect(new T(src).at("h1").run(moveRow(1)).md).toBe(src);
  });
  it("Alt+Right moves a column", () => {
    expect(new T(src).at("a").run(moveColumn(1)).md).toBe("| h2  | h1  |\n| --- | --- |\n| b   | a   |\n| d   | c   |\n");
  });
  it("B-5: align center on column 2", () => {
    expect(new T(src).at("b").run(setAlign("center")).md).toBe("| h1  | h2  |\n| --- | :-: |\n| a   |  b  |\n| c   |  d  |\n");
  });
  it("Mod+Shift+Backspace deletes the row", () => {
    expect(new T(src).at("c").run(deleteRow(() => true)).md).toBe("| h1 | h2 |\n|----|----|\n| a  | b  |\n");
  });
});
