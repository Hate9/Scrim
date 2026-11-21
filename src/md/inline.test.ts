import { describe, expect, it } from "vitest";
import { analyzeInline, flatten, type InlineElement } from "./inline";

const brief = (els: InlineElement[]) =>
  flatten(els).map((e) => `${e.kind}[${e.from},${e.to}) c[${e.contentFrom},${e.contentTo}) runs=${e.runs.map((r) => r.join("-")).join(",")}`);

describe("analyzeInline", () => {
  it("strong and nested em", () => {
    const src = "a **bold *it* x** b";
    expect(brief(analyzeInline(src))).toEqual([
      "strong[2,17) c[4,15) runs=2-4,15-17",
      "em[9,13) c[10,12) runs=9-10,12-13",
    ]);
  });

  it("adjacent runs ***", () => {
    const els = flatten(analyzeInline("**a *b***"));
    expect(els.map((e) => e.kind)).toEqual(["strong", "em"]);
    expect(els[0].runs).toEqual([[0, 2], [7, 9]]);
    expect(els[1].runs).toEqual([[4, 5], [6, 7]]);
  });

  it("code spans", () => {
    expect(brief(analyzeInline("x ``a`b`` y"))).toEqual(["code[2,9) c[4,7) runs=2-4,7-9"]);
  });

  it("links with title", () => {
    const [l] = analyzeInline('see [t *x*](http://a.b "T") end');
    expect(l.kind).toBe("link");
    expect(l.attrs).toEqual({ href: "http://a.b", title: "T" });
    expect(l.runs).toEqual([[4, 5], [10, 12], [23, 24], [25, 26], [26, 27]]);
    expect(l.contentFrom).toBe(5);
    expect(l.contentTo).toBe(10);
    expect(l.children[0].kind).toBe("em");
  });

  it("reference links resolve against definitions", () => {
    const defs = { links: new Map([["REF", { url: "/u", title: null }]]), footnotes: new Set<string>() };
    const [l] = analyzeInline("[text][ref] and", { definitions: defs });
    expect(l.kind).toBe("link");
    expect(l.attrs?.href).toBe("/u");
    expect(l.runs).toEqual([[0, 1], [5, 7], [10, 11]]);
    expect(analyzeInline("[text][nope]")).toEqual([]);
  });

  it("autolinks", () => {
    expect(brief(analyzeInline("<https://a.b> www.example.com"))).toEqual([
      "autolink[0,13) c[1,12) runs=0-1,12-13",
      "autolink[14,29) c[14,29) runs=",
    ]);
  });

  it("images", () => {
    const [img] = analyzeInline("![alt *x*](a.png)");
    expect(img.kind).toBe("image");
    expect(img.replace).toEqual({ type: "image", src: "a.png", alt: "alt x", title: undefined });
    expect(img.runs).toEqual([[0, 2], [9, 11], [16, 17]]);
  });

  it("escapes, entities, emoji", () => {
    expect(brief(analyzeInline("\\*a\\* &amp; &#x2014; :smile: :nope: &bogus;"))).toEqual([
      "escape[0,2) c[1,2) runs=0-1",
      "escape[3,5) c[4,5) runs=3-4",
      "entity[6,11) c[7,10) runs=6-7,10-11",
      "entity[12,20) c[13,19) runs=12-13,19-20",
      "emoji[21,28) c[22,27) runs=21-22,27-28",
    ]);
  });

  it("hard breaks", () => {
    expect(brief(analyzeInline("a  \nb\\\nc"))).toEqual(["break[1,3) c[3,3) runs=1-3", "break[5,6) c[6,6) runs=5-6"]);
  });

  it("inline html pairs, lone and unknown tags, comments", () => {
    const els = flatten(analyzeInline('x <span style="color:red">r **b**</span> <kbd>y <foo>z</foo> <!-- c -->'));
    expect(els.map((e) => `${e.kind}:${e.nodeName ?? ""}`)).toEqual([
      "html:span",
      "strong:strong",
      "rawhtml:",
      "rawhtml:",
      "rawhtml:",
      "comment:",
    ]);
    expect(els[0].attrs).toEqual({ style: "color:red" });
    expect(els[0].runs).toEqual([[2, 7], [25, 26], [33, 40]]);
  });

  it("strikethrough and footnotes", () => {
    const defs = { links: new Map(), footnotes: new Set(["1"]) };
    expect(brief(analyzeInline("~~s~~ x[^1]", { definitions: defs }))).toEqual([
      "strike[0,5) c[2,3) runs=0-2,3-5",
      "footnote[7,11) c[9,10) runs=7-9,10-11",
    ]);
  });

  it("inline math only when enabled", () => {
    expect(analyzeInline("$x^2$")).toEqual([]);
    expect(brief(analyzeInline("a $x^2$ b", { inlineMath: true }))).toEqual(["math[2,7) c[3,6) runs=2-3,6-7"]);
  });
});
