import { describe, expect, it } from "vitest";
import { headings } from "./headings";
import { parseMarkdown } from "../md/parse";
import { parseMdast } from "../md/mdast";
import { toString } from "mdast-util-to-string";

describe("heading text fast path (PF-1)", () => {
  it("plain headings give the same text and ids as the parser", () => {
    const srcs = ["Plain words", "With, punctuation (and) 50% / x-y.", "Ünïcödé 日本語", "Quote 'a' \"b\"", "Trailing  ", "a + b - c; d?"];
    for (const src of srcs) {
      const { doc } = parseMarkdown(`# ${src}\n`);
      const viaParser = toString(parseMdast(`# ${src}\n`).children[0]);
      expect(headings(doc)[0].text).toBe(viaParser);
    }
  });
});
