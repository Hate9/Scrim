import { describe, expect, it } from "vitest";
import { displayText, joinLines, rebuild, splitLines } from "./lines";

const samples = [
  "",
  "a",
  "a\n",
  "a\r\nb\r\n",
  "a\rb\r",
  "mixed\r\nlines\nand\rcr\r\n\r\n",
  "\n\n\n",
  "no final newline\r\nhere",
  "\r\n",
];

describe("lines", () => {
  it("splits and joins losslessly", () => {
    for (const s of samples) expect(joinLines(splitLines(s))).toBe(s);
  });

  it("rebuild of unedited text is identity", () => {
    for (const s of samples) {
      const lines = splitLines(s);
      expect(rebuild(lines, displayText(lines), "\n")).toBe(s);
      expect(rebuild(lines, displayText(lines), "\r\n")).toBe(s);
    }
  });

  it("keeps endings of untouched lines in a mixed file", () => {
    const s = "one\r\ntwo\nthree\rfour\r\n";
    const lines = splitLines(s);
    expect(rebuild(lines, "one\ntwo\nTHREE\nfour\n", "\r\n")).toBe("one\r\ntwo\nTHREE\r\nfour\r\n");
  });

  it("inserted lines get the document ending", () => {
    const lines = splitLines("a\r\nb\r\n");
    expect(rebuild(lines, "a\nnew\nb\n", "\r\n")).toBe("a\r\nnew\r\nb\r\n");
  });

  it("appending after a file without final newline", () => {
    const lines = splitLines("a\r\nb");
    expect(rebuild(lines, "a\nb\nc", "\r\n")).toBe("a\r\nb\r\nc");
  });

  it("removing the final newline", () => {
    const lines = splitLines("a\nb\n");
    expect(rebuild(lines, "a\nb", "\n")).toBe("a\nb");
  });

  it("deleting a line keeps neighbours", () => {
    const lines = splitLines("a\rb\nc\r\n");
    expect(rebuild(lines, "a\nc\n", "\n")).toBe("a\rc\r\n");
  });
});
