import { describe, expect, it } from "vitest";
import { countWords } from "./counts";

describe("word count (14)", () => {
  it("W-12: Hello, wörld! 你好 = 4 words", () => {
    expect(countWords("Hello, wörld! 你好")).toBe(4);
  });
  it("apostrophes, hyphens, emoji", () => {
    expect(countWords("it's a well-known fact 😀")).toBe(4);
    expect(countWords("한국어 テスト")).toBe(6);
    expect(countWords("--- !!!")).toBe(0);
  });
});

import { count, countableText, countDocument } from "./counts";
describe("countDocument (Q-027 follow-up cache)", () => {
  it("equals the uncached count, before and after an edit", async () => {
    const { parseMarkdown } = await import("../md/parse");
    const { documentDefinitions, defaultOptions } = await import("./context");
    const src = "# Title\n\nSome *words* here, [a link](u) and `code`.\n\n```\ncode block words\n```\n\n- item one\n- item two\n";
    const { doc } = parseMarkdown(src);
    const defs = documentDefinitions(doc);
    for (const code of [false, true]) expect(countDocument(doc, defs, defaultOptions, 9, code)).toEqual(count(countableText(doc, defs, defaultOptions), 9, code));
    const { doc: doc2 } = parseMarkdown(src.replace("Some", "Some more"));
    expect(countDocument(doc2, defs, defaultOptions, 9)).toEqual(count(countableText(doc2, defs, defaultOptions), 9));
  });
});

describe("countSource (Q-027 follow-up cache)", () => {
  it("equals count() of the whole text, also in slices", async () => {
    const { countSource } = await import("./counts");
    const { Text } = await import("@codemirror/state");
    const src = "# Title\n\nSome *words*, here.\n\n\n\n- a\n- b c\n\n```\ncode\n```\n";
    const want = (t: string) => count([{ text: t, code: false }], t.split("\n").length);
    expect(countSource(Text.of(src.split("\n")), 1000)).toEqual(want(src));
    const t = src + "more words\n\nand more";
    const doc = Text.of(t.split("\n"));
    let r = null;
    for (let i = 0; i < 50 && !r; i++) r = countSource(doc, -1);
    expect(r).toEqual(want(t));
  });
});
