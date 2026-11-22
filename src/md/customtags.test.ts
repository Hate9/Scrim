import { afterEach, describe, expect, it } from "vitest";
import { parseTagList, setCustomTags, tagProblem } from "./customtags";
import { analyzeInline, flatten } from "./inline";
import { parseMarkdown } from "./parse";

afterEach(() => void setCustomTags([], []));

describe("custom HTML tags (17)", () => {
  it("validates names (K-12)", () => {
    expect(tagProblem("bottom")).toBeNull();
    expect(tagProblem("my-tag2")).toBeNull();
    expect(tagProblem("script")).toBe("standard HTML element");
    expect(tagProblem("iframe")).toBe("standard HTML element");
    expect(tagProblem("marquee")).toBe("standard HTML element");
    expect(tagProblem("circle")).toBe("standard HTML element");
    expect(tagProblem("9bad")).toBe("not a tag name");
    expect(parseTagList("Bottom, 9bad  style callout")).toEqual({ names: ["bottom", "callout"], ignored: [{ name: "9bad", why: "not a tag name" }, { name: "style", why: "standard HTML element" }] });
  });

  it("registered inline tags are elements; unregistered stay literal (K-6)", () => {
    const kinds = () => flatten(analyzeInline("a <bottom>x</bottom> b")).map((e) => `${e.kind}:${e.nodeName ?? ""}`);
    expect(kinds()).toEqual(["rawhtml:", "rawhtml:"]);
    setCustomTags(["bottom"], []);
    expect(kinds()).toEqual(["html:bottom"]);
    setCustomTags(["SCRIPT", "bottom"], []); // invalid names are dropped
    expect(kinds()).toEqual(["html:bottom"]);
  });

  it("registered block tags start an HTML block (K-7)", () => {
    const first = () => parseMarkdown("<callout>hi</callout>\n").doc.firstChild!.type.name;
    expect(first()).toBe("paragraph");
    setCustomTags([], ["callout"]);
    expect(first()).toBe("html_block");
    setCustomTags([], []);
    expect(first()).toBe("paragraph");
  });
});
