// R-1 file-layer form for the frontend half: for every corpus file, the editor's
// line-ending bookkeeping reproduces the exact text when nothing was edited.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { displayText, rebuild, splitLines } from "./lines";

const dir = join(__dirname, "../../tests/corpus");

// Read as latin1: a byte-to-code-unit bijection that leaves CR and LF where they are for
// every ASCII-compatible encoding. UTF-16 files are covered by the Rust tests.
const files = readdirSync(dir).filter((n) => n.endsWith(".md") && !n.startsWith("utf16"));

describe("R-1 corpus (frontend line bookkeeping)", () => {
  it.each(files)("%s", (name) => {
    const raw = readFileSync(join(dir, name)).toString("latin1");
    const lines = splitLines(raw);
    expect(rebuild(lines, displayText(lines), "\n")).toBe(raw);
    expect(rebuild(lines, displayText(lines), "\r\n")).toBe(raw);
  });

  it("spec examples, LF and CRLF", () => {
    const { examples } = JSON.parse(readFileSync(join(dir, "spec-examples.json"), "utf8"));
    for (const ex of examples as { markdown: string }[]) {
      for (const raw of [ex.markdown, ex.markdown.replace(/\n/g, "\r\n")]) {
        const lines = splitLines(raw);
        expect(rebuild(lines, displayText(lines), "\n")).toBe(raw);
      }
    }
  });
});
