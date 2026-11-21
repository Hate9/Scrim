// P2 block model: edits inside rich blocks re-emit only what changed (R-7 and friends).
import type { Node } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse";
import { serialize } from "./serialize";

function edit(md: string, find: string, replace: string, pretty = true): string {
  const { doc } = parseMarkdown(md);
  let at = -1;
  doc.descendants((n: Node, pos: number) => {
    if (at < 0 && n.isText && n.text!.includes(find)) at = pos + n.text!.indexOf(find);
    return at < 0;
  });
  if (at < 0) throw new Error(`no ${find}`);
  const tr = EditorState.create({ doc }).tr.insertText(replace, at, at + find.length);
  return serialize(tr.doc, { prettyTables: pretty });
}

describe("types", () => {
  it("parses rich blocks into their own nodes", () => {
    const { doc } = parseMarkdown("---\nt: 1\n---\n\n```js\nx\n```\n\n$$\na\n$$\n\n<div>\nhi\n</div>\n\n| a |\n|---|\n| 1 |\n\n[toc]\n\nx[^1]\n\n[^1]: note\n\n- [ ] t\n");
    const types: string[] = [];
    doc.forEach((n) => types.push(n.type.name));
    expect(types).toEqual(["front_matter", "code_block", "math_block", "html_block", "table", "toc", "paragraph", "footnote_def", "bullet_list"]);
    expect(doc.lastChild!.firstChild!.attrs.task).toBe(" ");
  });
});

describe("R-7 table re-serialization", () => {
  const src = "before\n\n|a|b|\n|:-|-:|\n|1|22|\n|333|4|\n\nafter\n";
  it("pretty-printing on: the whole table is re-padded, nothing outside changes", () => {
    expect(edit(src, "22", "x")).toBe("before\n\n| a   |   b |\n| :-- | --: |\n| 1   |   x |\n| 333 |   4 |\n\nafter\n");
  });
  it("pretty-printing off: only the edited row changes", () => {
    expect(edit(src, "22", "x", false)).toBe("before\n\n|a|b|\n|:-|-:|\n| 1 | x |\n|333|4|\n\nafter\n");
  });
  it("unchanged table is byte-identical, including missing and extra cells", () => {
    const t = "| a | b |\n| --- | --- |\n| only |\n| 1 | 2 | 3 |\n";
    expect(serialize(parseMarkdown(t).doc)).toBe(t);
  });
});

describe("fenced blocks", () => {
  it("editing code keeps fences and container prefixes", () => {
    expect(edit("> ```js\n> let x\n> ```\n", "let", "const")).toBe("> ```js\n> const x\n> ```\n");
    expect(edit("~~~~ py\nx = 1\n~~~~\n", "x", "y")).toBe("~~~~ py\ny = 1\n~~~~\n");
  });
  it("unclosed fence stays unclosed", () => {
    expect(edit("```\nopen\n", "open", "still")).toBe("```\nstill\n");
  });
  it("indented code", () => {
    expect(edit("para\n\n    code\n    more\n", "more", "less")).toBe("para\n\n    code\n    less\n");
  });
  it("math and front matter", () => {
    expect(edit("$$\nE=mc^2\n$$\n", "mc", "MC")).toBe("$$\nE=MC^2\n$$\n");
    expect(edit("---\ntitle: X\n...\n\ntext\n", "X", "Y")).toBe("---\ntitle: Y\n...\n\ntext\n");
  });
});

describe("containers", () => {
  it("footnote definitions with continuation", () => {
    expect(edit("x[^1]\n\n[^1]: note\n    more\n", "more", "less")).toBe("x[^1]\n\n[^1]: note\n    less\n");
  });
  it("task items keep their marker", () => {
    expect(edit("- [x] done\n- [ ] todo\n", "todo", "next")).toBe("- [x] done\n- [ ] next\n");
  });
});

import { posToSource, serializeWithMap, sourceToPos } from "./serialize";

describe("source map", () => {
  it("maps source offsets to document positions and back", () => {
    const src = "# Title\n\n> quote **bold**\n\n```js\nlet x\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const { doc } = parseMarkdown(src);
    const { text, map } = serializeWithMap(doc);
    expect(text).toBe(src);
    for (const word of ["Title", "quote", "bold", "let x", "2"]) {
      const off = src.indexOf(word);
      const pos = sourceToPos(map, off)!;
      expect(doc.textBetween(pos, pos + word.length)).toBe(word);
      expect(posToSource(map, pos)).toBe(off);
    }
  });
});
