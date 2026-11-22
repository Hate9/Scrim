import { afterEach, describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { parseMarkdown } from "./parse";
import { serialize } from "./serialize";
import { setWritingStyle } from "./style";
import { setHeading, toggleBulletList, toggleFormat } from "../editor/commands";
import { defaultOptions } from "../editor/context";

const run = (md: string, cmd: (s: EditorState, d: (tr: import("prosemirror-state").Transaction) => void) => boolean, at = 1, to = at) => {
  let state = EditorState.create({ doc: parseMarkdown(md).doc });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at, to)));
  cmd(state, (tr) => (state = state.apply(tr)));
  return serialize(state.doc);
};

describe("writing style (02)", () => {
  afterEach(() => setWritingStyle({}));
  it("defaults", () => {
    expect(run("word\n", toggleFormat("strong", defaultOptions), 1, 5)).toBe("**word**\n");
    expect(run("item\n", toggleBulletList)).toBe("- item\n");
    expect(run("Title\n", setHeading(1))).toBe("# Title\n");
  });
  it("preferences", () => {
    setWritingStyle({ bulletChar: "*", emphasisChar: "_", strongChar: "__", headingStyle: "setext" });
    expect(run("word\n", toggleFormat("strong", defaultOptions), 1, 5)).toBe("__word__\n");
    expect(run("word\n", toggleFormat("em", defaultOptions), 1, 5)).toBe("_word_\n");
    expect(run("item\n", toggleBulletList)).toBe("* item\n");
    expect(run("Title\n", setHeading(1))).toBe("Title\n===\n");
    expect(run("Title\n", setHeading(2))).toBe("Title\n---\n");
    expect(run("Title\n", setHeading(3))).toBe("### Title\n");
  });
  it("existing source keeps its markers", () => {
    setWritingStyle({ headingStyle: "setext", bulletChar: "+" });
    expect(serialize(parseMarkdown("# A\n\n- b\n").doc)).toBe("# A\n\n- b\n");
  });
});
