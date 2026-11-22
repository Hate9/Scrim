import { describe, expect, it } from "vitest";
import { filterSnippets } from "../app/local";
import { applySnippet, listIndent, parseBody } from "./snippets";

describe("snippet bodies (16)", () => {
  it("$0, $$ and later $0s", () => {
    expect(parseBody("<bottom>$0</bottom>")).toEqual({ text: "<bottom></bottom>", cursor: 8 });
    expect(parseBody("$$5 and $0 more")).toEqual({ text: "$5 and  more", cursor: 7 }); // K-3
    expect(parseBody("$$0")).toEqual({ text: "$0", cursor: null }); // K-10
    expect(parseBody("$$$0")).toEqual({ text: "$", cursor: 1 }); // K-10
    expect(parseBody("a$0b$0c")).toEqual({ text: "ab$0c", cursor: 1 });
    expect(parseBody("$$$$\nx\n$$$$")).toEqual({ text: "$$\nx\n$$", cursor: null });
  });

  it("no selection: cursor at $0", () => {
    expect(applySnippet("ab", [[1, 1]], "<b>$0</b>")).toEqual({ text: "a<b></b>b", from: 4, to: 4 }); // K-1
  });

  it("selection goes to $0 and is selected again", () => {
    expect(applySnippet("say hello now", [[4, 9]], "<bottom>$0</bottom>")).toEqual({ text: "say <bottom>hello</bottom> now", from: 12, to: 17 }); // K-2
  });

  it("no $0: the selection is replaced, cursor after", () => {
    expect(applySnippet("xSELy", [[1, 4]], "--")).toEqual({ text: "x--y", from: 3, to: 3 });
    expect(applySnippet("ab", [[1, 1]], "$$0")).toEqual({ text: "a$0b", from: 3, to: 3 });
  });

  it("inline body over several blocks wraps each (K-11)", () => {
    const src = "one two\n\nthree four\n";
    const r = applySnippet(src, [[4, 7], [9, 14]], "<u>$0</u>");
    expect(r.text).toBe("one <u>two</u>\n\n<u>three</u> four\n");
    expect(r.text.slice(r.from, r.to)).toBe("two</u>\n\n<u>three");
  });

  it("multi-line body indented inside a list item", () => {
    expect(listIndent("- item\n", 6)).toBe("  ");
    expect(listIndent("10. x", 5)).toBe("    ");
    expect(applySnippet("- item", [[2, 6]], "<details>\n$0\n</details>", "  ")).toEqual({ text: "- <details>\n  item\n  </details>", from: 14, to: 18 });
  });
});


describe("picker filter (16, K-4)", () => {
  const list = [{ name: "Bottom" }, { name: "Red span" }, { name: "Price" }];
  it("'rd' shows only Red span", () => {
    expect(filterSnippets(list, "rd").map((s) => s.name)).toEqual(["Red span"]);
  });
  it("prefix, then substring, then subsequence", () => {
    const l = [{ name: "xab" }, { name: "abcd" }, { name: "ab" }, { name: "a-b" }];
    expect(filterSnippets(l, "ab").map((s) => s.name)).toEqual(["ab", "abcd", "xab", "a-b"]);
    expect(filterSnippets(l, "").map((s) => s.name)).toEqual(["xab", "abcd", "ab", "a-b"]);
  });
});
