import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../md/parse";
import { serialize } from "../md/serialize";
import { defaultOptions } from "./context";
import { createInlinePlugin } from "./decorations";
import { isImageParagraphSource, zoomImage } from "./images";

const opts = { ...defaultOptions };

function at(md: string, offset: number) {
  const { doc } = parseMarkdown(md);
  const s = EditorState.create({ doc, plugins: [createInlinePlugin(opts, { setImageSource: () => {}, renderMath: () => {} })] });
  return s.apply(s.tr.setSelection(TextSelection.create(doc, 1 + offset)));
}

describe("D-5 image zoom", () => {
  it("zoom 50% writes <img … style=zoom>, Original size goes back", () => {
    let s = at("x ![a b](pics/a.png) y\n", 4);
    zoomImage(50, opts)(s, (tr) => (s = s.apply(tr)));
    expect(serialize(s.doc)).toBe('x <img src="pics/a.png" alt="a b" style="zoom: 50%"> y\n');
    zoomImage(null, opts)(s, (tr) => (s = s.apply(tr)));
    expect(serialize(s.doc)).toBe("x ![a b](pics/a.png) y\n");
  });
  it("image paragraphs", () => {
    expect(isImageParagraphSource("![](a.png)")).toBe(true);
    expect(isImageParagraphSource('<img src="a.png" style="zoom: 50%">')).toBe(true);
    expect(isImageParagraphSource("text ![](a.png)")).toBe(false);
  });
});
