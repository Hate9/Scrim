// Q-026: the block tree Rust parses must give the same document model as the frontend's
// own parse, for every corpus file and CommonMark/GFM spec example, with strict mode on
// and off. Needs the helper binary (CI builds it first):
//   cargo build --release -p scrim-core --example block_tree
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Root } from "mdast";
import { parseMarkdown } from "./parse";
import { dialect, parseMdast } from "./mdast";
import { decodeTree, rustTreeApplies } from "./rustblocks";

const BIN = process.env.SCRIM_BLOCK_TREE ?? `target/release/examples/block_tree${process.platform === "win32" ? ".exe" : ""}`;
const HAVE_BIN = existsSync(BIN);

function files(d: string): string[] {
  return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".md") ? [p] : []; });
}
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

function corpus(): string[] {
  const srcs = files("tests/corpus").map((f) => readFileSync(f, "utf8"));
  try {
    for (const e of JSON.parse(readFileSync("tests/corpus/spec-examples.json", "utf8")).examples) srcs.push(e.markdown);
  } catch {
    /* no spec examples */
  }
  return srcs.filter((s): s is string => typeof s === "string").map((s) => s.replace(/^﻿/, ""));
}

// The fields the frontend reads, for a node-by-node comparison of the two trees.
type Tree = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: Tree[]; [k: string]: unknown };
const norm = (n: Tree): unknown => ({
  t: n.type, s: n.position?.start.offset, e: n.position?.end.offset, v: n.value, d: n.depth, o: n.ordered, sp: n.type === "list" ? n.spread : undefined,
  c: n.checked, a: n.align, l: n.label, k: n.children?.map(norm),
});

describe.skipIf(!HAVE_BIN)("Rust block trees give the frontend's documents (Q-026)", () => {
  const docs = corpus();
  // The body runs while tests are collected, even when skipped.
  const trees = !HAVE_BIN ? [] : JSON.parse(execFileSync(BIN, { input: JSON.stringify(docs), maxBuffer: 512 << 20, encoding: "utf8" })) as ((Root & { unsure?: boolean }) | null)[];
  afterEach(() => (dialect.strict = true));

  it("the compact encoding decodes to the same trees (Q-027)", () => {
    const encoded = JSON.parse(execFileSync(BIN, ["--encoded"], { input: JSON.stringify(docs), maxBuffer: 512 << 20, encoding: "utf8" })) as string[];
    const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v);
    const bad: number[] = [];
    encoded.forEach((b64, i) => {
      const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
      const got = decodeTree(bytes.buffer);
      if (JSON.stringify(canon(got)) !== JSON.stringify(canon(trees[i]))) bad.push(i);
    });
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("the block trees are equal node by node (strict mode on)", () => {
    const diffs: string[] = [];
    let unsure = 0;
    docs.forEach((text, i) => {
      const t = trees[i];
      if (!t || t.unsure) return void unsure++;
      const a = JSON.stringify(norm(parseMdast(text, { blockOnly: true, frontMatter: true }) as unknown as Tree));
      const b = JSON.stringify(norm(t as unknown as Tree));
      if (a !== b) diffs.push(JSON.stringify(text.slice(0, 100)));
    });
    expect(unsure).toBeLessThan(10); // documents Rust leaves to the frontend
    expect(diffs.slice(0, 8)).toEqual([]);
  });

  for (const strict of [true, false]) {
    it(`strict mode ${strict ? "on" : "off"}`, () => {
      dialect.strict = strict;
      let compared = 0, routed = 0;
      const diffs: string[] = [];
      docs.forEach((text, i) => {
        if (!trees[i] || trees[i]!.unsure || !rustTreeApplies(text, { strict, customBlockTags: [] })) {
          routed++;
          return;
        }
        compared++;
        const js = strip(parseMarkdown(text).doc.toJSON());
        const rs = strip(parseMarkdown(text, { blockTree: trees[i] ?? undefined }).doc.toJSON());
        if (js !== rs && diffs.length < 8) diffs.push(JSON.stringify(text.slice(0, 160)));
        else if (js !== rs) diffs.push("…");
      });
      expect(compared).toBeGreaterThan(strict ? 690 : 600);
      expect(routed).toBeLessThan(strict ? 10 : 100);
      expect(diffs).toEqual([]);
    });
  }
});
