import { describe, expect, it } from "vitest";
import { replaceToc, tocMarkdown } from "./pandoc";
import { frontMatter, settingsFrom, withOverrides } from "./document";

describe("pandoc pre-processing (9.4)", () => {
  it("builds a nested list of heading links", () => {
    const toc = tocMarkdown([
      { level: 1, text: "A", id: "a" },
      { level: 2, text: "B [x]", id: "b-x" },
      { level: 3, text: "C", id: "c" },
      { level: 2, text: "D", id: "d" },
      { level: 1, text: "E", id: "e" },
    ]);
    expect(toc).toBe("- [A](#a)\n  - [B \\[x\\]](#b-x)\n    - [C](#c)\n  - [D](#d)\n- [E](#e)");
  });

  it("replaces [toc] paragraphs only, not in code or front matter", () => {
    const md = "---\ntitle: x\n---\n\n[TOC]\n\n```\n[toc]\n```\n\ntext [toc]\n\n[toc]\n";
    expect(replaceToc(md, "LIST")).toBe("---\ntitle: x\n---\n\nLIST\n\n```\n[toc]\n```\n\ntext [toc]\n\nLIST\n");
  });
});

describe("per-document overrides (9.6, X-8)", () => {
  const base = settingsFrom(<T,>(_k: string, d: T) => d);

  it("applies page and formatting keys", () => {
    const fm = frontMatter('---\nexport: { pdf: { pageSize: Letter, header: "{{title}}", marginTop: 25, orientation: landscape }, html: { embedImages: true, theme: night } }\n---\n');
    const s = withOverrides(base, fm);
    expect(s.pdf.pageSize).toBe("Letter");
    expect(s.pdf.header).toEqual({ left: "", center: "{{title}}", right: "" });
    expect(s.pdf.marginTop).toBe(25);
    expect(s.pdf.orientation).toBe("landscape");
    expect(s.html.embedImages).toBe(true);
    expect(s.html.theme).toBe("night");
  });

  it("never takes head, body content, commands, or the pandoc path from a document", () => {
    const fm = frontMatter('---\nexport:\n  html:\n    head: "<script>alert(1)</script>"\n    bodyEnd: "<script>x</script>"\n  commands: [{ name: x, command: "rm -rf /" }]\n  pandocPath: /tmp/evil\n---\n');
    const s = withOverrides(base, fm);
    expect(s.html.head).toBe("");
    expect(s.html.bodyEnd).toBe("");
    expect(JSON.stringify(s)).not.toContain("script");
    expect(JSON.stringify(s)).not.toContain("evil");
  });

  it("defaults (9.3)", () => {
    expect(base.pdf.pageSize).toBe("A4");
    expect([base.pdf.marginTop, base.pdf.marginBottom, base.pdf.marginLeft, base.pdf.marginRight]).toEqual([18, 18, 16, 16]);
    expect(base.pdf.footer.center).toBe("{{page}}");
    expect(base.pdf.header).toEqual({ left: "", center: "", right: "" });
  });
});
