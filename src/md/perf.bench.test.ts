import { readFileSync } from "node:fs";
import { it } from "vitest";
import { analyzeInline } from "./inline";
import { parseMarkdown } from "./parse";
import { parseMdast } from "./mdast";
it.skipIf(!process.env.BIG)("perf (set BIG=file.md)", () => {
  const src = readFileSync(process.env.BIG!, "utf8");
  let t = performance.now();
  parseMdast(src);
  console.log({ mdastMs: Math.round(performance.now() - t) });
  t = performance.now();
  parseMdast(src);
  console.log({ mdastWarmMs: Math.round(performance.now() - t) });
  t = performance.now();
  const { doc } = parseMarkdown(src);
  const parse = performance.now() - t;
  t = performance.now();
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") {
      analyzeInline(node.textBetween(0, node.content.size, undefined, "\n"));
      n++;
      return false;
    }
    return true;
  });
  console.log({ parseMs: Math.round(parse), inlineMs: Math.round(performance.now() - t), blocks: n });
});
