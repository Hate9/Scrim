// R-1 parse/serialize form (spec 20): every corpus file and spec example, parsed into the
// document model and serialized without edits, is byte-identical.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse";
import { serialize } from "./serialize";

const dir = join(__dirname, "../../tests/corpus");
const files = readdirSync(dir).filter((n) => n.endsWith(".md") && !n.startsWith("utf16"));
const { examples } = JSON.parse(readFileSync(join(dir, "spec-examples.json"), "utf8")) as {
  examples: { source: string; number: number; markdown: string }[];
};

describe("R-1 parse/serialize round trip", () => {
  it.each(files)("%s", (name) => {
    const src = readFileSync(join(dir, name)).toString("latin1");
    const { doc } = parseMarkdown(src);
    expect(serialize(doc)).toBe(src);
  });

  it("all spec examples, LF and CRLF, mostly structured", () => {
    let fallbacks = 0;
    let blocks = 0;
    for (const ex of examples) {
      for (const src of [ex.markdown, ex.markdown.replace(/\n/g, "\r\n")]) {
        const { doc, fallbacks: f } = parseMarkdown(src);
        expect(serialize(doc), `${ex.source} #${ex.number}`).toBe(src);
        fallbacks += f;
        blocks += doc.childCount;
      }
    }
    console.log(`spec examples: ${fallbacks} raw fallbacks over ${blocks} top-level blocks`);
    expect(fallbacks / blocks).toBeLessThan(0.1);
  });
});
