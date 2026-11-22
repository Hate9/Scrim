import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../md/parse";
import { defaultOptions } from "./context";
import { createInlinePlugin } from "./decorations";
import { blockWords, checkable } from "./spell";

function words(md: string): string[] {
  const { doc } = parseMarkdown(md);
  let st = EditorState.create({ doc, plugins: [createInlinePlugin({ ...defaultOptions }, { setImageSource: () => {}, renderMath: () => {} })] });
  st = st.apply(st.tr.setMeta("x", 1)); // presentation marks
  const out: string[] = [];
  st.doc.descendants((n, pos) => {
    if (n.isTextblock) {
      if (!n.type.spec.code) out.push(...blockWords(n, pos).map((w) => w.word));
      return false;
    }
    return true;
  });
  return out;
}

describe("what spell check reads (13)", () => {
  it("rendered prose only", () => {
    expect(words("Teh **quick** [link text](https://exampel.com) `codde` :smile: <span title=\"attrr\">inner</span>\n")).toEqual(["Teh", "quick", "link", "text", "inner"]);
  });
  it("skips digits, short acronyms, URLs as text, code blocks, front matter", () => {
    expect(words("---\ntitel: x\n---\n\nabc123 NASA UNESCOS it's www.exampel.com\n\n```\nwrod\n```\n")).toEqual(["UNESCOS", "it's"]);
  });
  it("checkable", () => {
    expect(checkable("NATO")).toBe(false);
    expect(checkable("Word")).toBe(true);
    expect(checkable("x2")).toBe(false);
  });
});
