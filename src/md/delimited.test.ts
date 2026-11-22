import { describe, expect, it } from "vitest";
import { analyzeInline, flatten } from "./inline";

const on = { subscript: true, superscript: true, highlight: true };
const kinds = (src: string, opts = on) => flatten(analyzeInline(src, opts)).map((e) => [e.kind, src.slice(e.from, e.to)]);

describe("subscript, superscript, highlight (02)", () => {
  it("off by default: literal", () => {
    expect(kinds("H~2~O x^2^ ==hi==", {} as typeof on)).toEqual([]);
  });
  it("on", () => {
    expect(kinds("H~2~O x^2^ ==hi there==")).toEqual([
      ["sub", "~2~"],
      ["sup", "^2^"],
      ["highlight", "==hi there=="],
    ]);
  });
  it("no unescaped spaces inside sub/sup", () => {
    expect(kinds("a~b c~ d")).toEqual([]);
    expect(kinds("a^b\\ c^")).toEqual([["sup", "^b\\ c^"], ["escape", "\\ "]]);
  });
  it("~~ stays strikethrough; === is not a marker", () => {
    expect(kinds("~~gone~~ a===b===")).toEqual([["strike", "~~gone~~"]]);
  });
  it("nesting both ways", () => {
    expect(kinds("==**a** x^2^==")).toEqual([
      ["highlight", "==**a** x^2^=="],
      ["strong", "**a**"],
      ["sup", "^2^"],
    ]);
    expect(kinds("**==a==**")).toEqual([
      ["strong", "**==a==**"],
      ["highlight", "==a=="],
    ]);
  });
  it("whitespace after the opener or before the closer: no element", () => {
    expect(kinds("== a == b")).toEqual([]);
  });
  it("code spans hide markers", () => {
    expect(kinds("`==a==`")).toEqual([["code", "`==a==`"]]);
  });
});
