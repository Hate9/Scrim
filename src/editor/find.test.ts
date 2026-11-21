import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../md/parse";
import { serialize } from "../md/serialize";
import { defaultOptions } from "./context";
import { createInlinePlugin } from "./decorations";
import { expandReplacement, findMatches, replaceMatch, type FindQuery } from "./find";

const opts = { ...defaultOptions };
const q = (text: string, extra: Partial<FindQuery> = {}): FindQuery => ({ text, caseSensitive: false, wholeWord: false, regex: false, source: false, ...extra });

function state(md: string) {
  return EditorState.create({ doc: parseMarkdown(md).doc, plugins: [createInlinePlugin(opts, { setImageSource: () => {}, renderMath: () => {} })] });
}

function replaceAll(md: string, find: string, rep: string, extra: Partial<FindQuery> = {}) {
  const s = state(md);
  const query = q(find, extra);
  const tr = s.tr;
  for (const m of findMatches(s, query, opts).reverse()) replaceMatch(tr, s, m, expandReplacement(rep, m, query.regex), query, opts);
  return serialize(tr.doc);
}

describe("find (08)", () => {
  it("matches rendered text across markers (W-8)", () => {
    expect(findMatches(state("**bo**ld and [link](http://x) &amp; \\*\n"), q("bold"), opts)).toHaveLength(1);
    expect(findMatches(state("[link](http://x)\n"), q("http"), opts)).toHaveLength(0);
    expect(findMatches(state("[link](http://x)\n"), q("http", { source: true }), opts)).toHaveLength(1);
    expect(findMatches(state("a &amp; b\n"), q("&"), opts)).toHaveLength(1);
    expect(findMatches(state(":smile:\n"), q("smile"), opts)).toHaveLength(0);
  });
  it("typographic equivalence and whole word", () => {
    expect(findMatches(state("\u201cquoted\u201d and it\u2019s\n"), q('"quoted"'), opts)).toHaveLength(1);
    expect(findMatches(state("it\u2019s\n"), q("it's"), opts)).toHaveLength(1);
    expect(findMatches(state("cat catalog\n"), q("cat", { wholeWord: true }), opts)).toHaveLength(1);
  });
  it("replace semantics (8, Replace)", () => {
    expect(replaceAll("**bold**\n", "bold", "x")).toBe("**x**\n");
    expect(replaceAll("bo**ld**\n", "bold", "xy")).toBe("xy\n");
    expect(replaceAll("a **bold** b\n", "a bold", "z")).toBe("z b\n");
    expect(replaceAll("**bo**ld\n", "bold", "BOLD")).toBe("**BOLD**\n");
    expect(replaceAll("x\n", "x", "*y*")).toBe("\\*y\\*\n");
    expect(replaceAll("a1 b2\n", "([a-z])(\\d)", "$2$1", { regex: true })).toBe("1a 2b\n");
  });
});
