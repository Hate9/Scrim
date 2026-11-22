import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { it, expect } from "vitest";
import { parseMarkdown, safeParagraphText } from "./parse";
import { parseMdast } from "./mdast";

function files(d: string): string[] {
  return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".md") ? [p] : []; });
}
// Block ids come from a global counter: shift them so the smallest is 0.
const strip = (j: unknown) => {
  const t = JSON.stringify(j);
  const ids = [...t.matchAll(/"uid":(\d+)/g)].map((m) => +m[1]);
  const base = ids.length ? Math.min(...ids) : 0;
  const f = (n: string) => String(+n - base);
  return t
    .replace(/"(uid|prev|item|lastUid)":(\d+)/g, (_m, k, n) => `"${k}":${f(n)}`)
    .replace(/"sig":"([^"]*)"/g, (_m, sg) => `"sig":"${sg.replace(/:(\d+)/g, (_x: string, n: string) => ":" + f(n))}"`)
    .replace(/"items":\[([\d,]*)\]/g, (_m, l) => `"items":[${l ? l.split(",").map(f).join(",") : ""}]`);
};
// Block structure does not depend on inline parsing (CommonMark): the fast block-only
// parse must give exactly the documents the full parse gives, for every corpus file and
// every CommonMark/GFM spec example.
it("block-only parse gives the same documents", () => {
  let n = 0, diff = 0;
  const examples: string[] = [];
  const srcs: string[] = files("tests/corpus").map((f) => readFileSync(f, "utf8"));
  try { const ex = JSON.parse(readFileSync("tests/corpus/spec-examples.json", "utf8")); for (const e of ex.examples) srcs.push(e.markdown); } catch {}
  for (const src of srcs) {
    if (typeof src !== "string") continue;
    // The files are decoded text (Rust strips a BOM before the editor sees it).
    const text = src.replace(/^\uFEFF/, "");
    const a = strip(parseMarkdown(text).doc.toJSON());
    const b = strip(parseMarkdown(text, { blockOnly: false }).doc.toJSON());
    n++;
    if (a !== b) { diff++; if (examples.length < 5) examples.push(src.slice(0, 120)); }
  }
  if (diff) console.log(JSON.stringify({ n, diff, examples }));
  expect(diff).toBe(0);
});

it("safe paragraph text really is one paragraph with the same text", () => {
  const samples = ["plain words", "two\nlines", "1. no", "10) no", "- no", "# no", "> no", "[a]: b", "___", "a | b", "  indented", "(fine) 'too'", "x\n===", "x\n---", "12 apples", "é accent"];
  for (const t of samples) {
    if (!safeParagraphText(t)) continue;
    const r = parseMdast(t, { blockOnly: true, frontMatter: false });
    expect(r.children.length).toBe(1);
    expect(r.children[0].type).toBe("paragraph");
    expect((r.children[0] as { children: { value: string }[] }).children.map((c) => c.value).join("")).toBe(t);
  }
  expect(safeParagraphText("x\n===")).toBe(false);
  expect(safeParagraphText("1. no")).toBe(false);
});
