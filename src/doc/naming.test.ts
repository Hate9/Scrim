import { describe, expect, it } from "vitest";
import { suggestedFileName } from "./naming";

describe("suggestedFileName", () => {
  it("uses the first heading", () => {
    expect(suggestedFileName("intro\n\n## Trip: Oslo/Bergen ##\n# Later")).toBe("Trip OsloBergen.md");
    expect(suggestedFileName("# **Notes** on `x`\r\n")).toBe("Notes on x.md");
    expect(suggestedFileName("#  Café   plans")).toBe("Café plans.md");
  });
  it("falls back to Untitled", () => {
    expect(suggestedFileName("")).toBe("Untitled.md");
    expect(suggestedFileName("#nospace\n    # indented code")).toBe("Untitled.md");
    expect(suggestedFileName("# ???")).toBe("Untitled.md");
  });
});
