import { describe, expect, it } from "vitest";
import { smartReplacements, smartText } from "./smart";

describe("smart punctuation (03, D-1)", () => {
  it("quotes, dashes, ellipsis", () => {
    expect(smartText(`"Hi," she said -- it's 'fine'... a---b`)).toBe("“Hi,” she said – it’s ‘fine’… a—b");
  });
  it("longer runs stay as typed", () => {
    expect(smartText("a----b ....")).toBe("a----b ....");
  });
  it("markup characters are transparent before a quote", () => {
    expect(smartText(`**"bold"**`)).toBe("**“bold”**");
    expect(smartText(`"`, "x")).toBe("”");
  });
  it("only inside plain ranges", () => {
    const text = 'a "b" `"c"`';
    const plain = (_a: number, b: number) => b <= 6;
    expect(smartReplacements(text, plain).map((r) => r.from)).toEqual([2, 4]);
  });
});
