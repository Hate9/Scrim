import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { parseMdast } from "../md/mdast";
import { parseMarkdown } from "../md/parse";
import { literalLine, selectionMarkdown } from "./clipboard";
import { defaultOptions } from "./context";
import { createInlinePlugin } from "./decorations";

const opts = { ...defaultOptions };

function select(md: string, from: string, to: string) {
  const { doc } = parseMarkdown(md);
  const state = EditorState.create({ doc, plugins: [createInlinePlugin(opts, { setImageSource: () => {}, renderMath: () => {} })] });
  const find = (needle: string, end: boolean) => {
    let at = -1;
    doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text!.includes(needle)) at = pos + n.text!.indexOf(needle) + (end ? needle.length : 0);
      return at < 0;
    });
    return at;
  };
  return state.apply(state.tr.setSelection(TextSelection.create(doc, find(from, false), find(to, true))));
}

describe("copy: Markdown source of the selection (6.1)", () => {
  it("partial element keeps its markers", () => {
    const s = select("a **bold** b\n", "ol", "ol");
    expect(selectionMarkdown(s, opts)).toBe("**ol**");
  });
  it("inside one block: inline source only", () => {
    const s = select("- item *x* y\n", "item", "y");
    expect(selectionMarkdown(s, opts)).toBe("item *x* y");
  });
  it("several blocks: block syntax and prefixes", () => {
    const s = select("- one end of one\n- two\n- start of three more\n", "end of one", "start of three");
    expect(selectionMarkdown(s, opts)).toBe("- end of one\n- two\n- start of three");
  });
  it("across a quote and a paragraph", () => {
    const s = select("> quoted *x*\n\nafter text\n", "quoted", "after");
    expect(selectionMarkdown(s, opts)).toBe("> quoted *x*\n\nafter");
  });
});

describe("paste as plain text: literal insertion (6.2)", () => {
  const cases = [
    "*not em* and _not em_",
    "# not a heading",
    "1. not a list",
    "> not a quote",
    "[x](y) and ![i](j)",
    ":smile: &amp; <b>x</b>",
    "back\\slash `code` ~~s~~ | pipe $x$",
    "plain text, with commas. And periods!",
    "- dash",
  ];
  it.each(cases)("%s", (text) => {
    const md = literalLine(text, opts);
    const root = parseMdast(md, { frontMatter: false });
    const p = root.children[0];
    expect(p.type).toBe("paragraph");
    if (p.type !== "paragraph") return;
    expect(p.children.map((c) => (c as { value: string }).value).join("")).toBe(text);
    expect(p.children.every((c) => c.type === "text")).toBe(true);
  });
  it("leaves plain prose unescaped", () => {
    expect(literalLine("plain text, with commas. And periods!", opts)).toBe("plain text, with commas. And periods!");
  });
});
