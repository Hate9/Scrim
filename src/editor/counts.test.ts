import { describe, expect, it } from "vitest";
import { countWords } from "./counts";

describe("word count (14)", () => {
  it("W-12: Hello, wörld! 你好 = 4 words", () => {
    expect(countWords("Hello, wörld! 你好")).toBe(4);
  });
  it("apostrophes, hyphens, emoji", () => {
    expect(countWords("it's a well-known fact 😀")).toBe(4);
    expect(countWords("한국어 テスト")).toBe(6);
    expect(countWords("--- !!!")).toBe(0);
  });
});
