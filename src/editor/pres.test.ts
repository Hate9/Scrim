import { describe, expect, it } from "vitest";
import { analyzeInline } from "../md/inline";
import { presSegments, type PresSegment } from "./pres";

/** Render segments as nested HTML-like text, merging shared wrappers like ProseMirror. */
function render(src: string, footnotes: string[] = []): string {
  const segs = presSegments(analyzeInline(src, { definitions: { links: new Map(), footnotes: new Set(footnotes) } }), src);
  let out = "";
  let open: PresSegment["marks"] = [];
  const tag = (m: PresSegment["marks"][number]) => {
    const attrs = Object.entries(m.attrs).filter(([k]) => k !== "data-el" && k !== "title").map(([k, v]) => ` ${k}="${v}"`).join("");
    return `<${m.tag}${m.cls ? ` class="${m.cls.split(" ").filter((c) => !c.startsWith("md-inline")).join(" ")}"` : ""}${attrs}>`;
  };
  for (const sg of segs) {
    let common = 0;
    while (common < open.length && common < sg.marks.length && JSON.stringify(open[common]) === JSON.stringify(sg.marks[common])) common++;
    for (let k = open.length - 1; k >= common; k--) out += `</${open[k].tag}>`;
    for (let k = common; k < sg.marks.length; k++) out += tag(sg.marks[k]);
    out += src.slice(sg.from, sg.to);
    open = sg.marks;
  }
  for (let k = open.length - 1; k >= 0; k--) out += `</${open[k].tag}>`;
  return out;
}

describe("presentation structure (spec 10.3, QA-LOG Q-018)", () => {
  it("plain runs and emphasis-like pairs", () => {
    expect(render("a **b** c")).toBe(
      '<span class="md-plain" md-inline="plain">a </span><span class="md-pair-s" md-inline="strong"><span class="md-meta md-before">**</span><strong><span class="md-plain" md-inline="plain">b</span></strong><span class="md-meta md-after">**</span></span><span class="md-plain" md-inline="plain"> c</span>',
    );
  });

  it("nested pairs keep one wrapper each", () => {
    expect(render("*a **b***")).toBe(
      '<span class="md-pair-s" md-inline="em"><span class="md-meta md-before">*</span><em><span class="md-plain" md-inline="plain">a </span><span class="md-pair-s" md-inline="strong"><span class="md-meta md-before">**</span><strong><span class="md-plain" md-inline="plain">b</span></strong><span class="md-meta md-after">**</span></span></em><span class="md-meta md-after">*</span></span>',
    );
  });

  it("code holds raw text directly", () => {
    expect(render("`x`")).toBe('<span class="md-pair-s" md-inline="code"><span class="md-meta md-before">`</span><code>x</code><span class="md-meta md-after">`</span></span>');
  });

  it("links: markers, a > md-plain, URL and title", () => {
    const html = render('[t](http://x "T")');
    expect(html).toContain('<span class="md-link" md-inline="link"><span class="md-meta md-before">[</span><a data-href="http://x"><span class="md-plain" md-inline="plain">t</span></a><span class="md-meta md-before">](</span><span class="md-content md-url md-hide">http://x</span>');
    expect(html).toContain('<span class="md-content md-link-title md-hide">T</span>');
    expect(html.endsWith('<span class="md-meta md-after">)</span></span>')).toBe(true);
  });

  it("footnote refs are sup.md-footnote with data-ref", () => {
    expect(render("x[^1]", ["1"])).toContain('<sup class="md-footnote" md-inline="footnote" data-ref="1">');
  });

  it("segments cover the whole source", () => {
    const src = "a *b* [c](d) `e` ~~f~~ <u>g</u> h";
    const segs = presSegments(analyzeInline(src), src);
    let at = 0;
    for (const s of segs) {
      expect(s.from).toBe(at);
      at = s.to;
    }
    expect(at).toBe(src.length);
  });
});
