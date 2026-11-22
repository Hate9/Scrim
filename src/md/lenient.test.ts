import { afterEach, describe, expect, it } from "vitest";
import { dialect, parseMdast } from "./mdast";
import { parseMarkdown } from "./parse";
import { serialize } from "./serialize";

const types = (md: string) => parseMdast(md).children.map((c) => (c.type === "heading" ? `h${c.depth}` : c.type === "list" ? `list${c.start ?? ""}` : c.type));

describe("strict mode (02)", () => {
  afterEach(() => (dialect.strict = true));
  it("on: CommonMark", () => {
    expect(types("#Heading\n")).toEqual(["paragraph"]);
    expect(types("text\n2. two\n")).toEqual(["paragraph"]);
    expect(types("text\n1. one\n")).toEqual(["paragraph", "list1"]);
  });
  it("off: #Heading is a heading", () => {
    dialect.strict = false;
    expect(types("#Heading\n")).toEqual(["h1"]);
    expect(types("###Three ##\n")).toEqual(["h3"]);
    expect(types("# Normal\n")).toEqual(["h1"]);
    expect(types("#1 not a letter\n")).toEqual(["paragraph"]);
    expect(types("#######Seven\n")).toEqual(["paragraph"]);
    expect(types("para\n#Interrupts\n")).toEqual(["paragraph", "h1"]);
    const h = parseMdast("##Title here\n").children[0] as { children: { value: string }[] };
    expect(h.children.map((c) => c.value).join("")).toBe("Title here");
  });
  it("off: an ordered list from any number interrupts a paragraph", () => {
    dialect.strict = false;
    expect(types("text\n2. two\n3. three\n")).toEqual(["paragraph", "list2"]);
    expect(types("text\n2.\n")).toEqual(["paragraph"]); // empty items still cannot interrupt
    expect(types("text\n- item\n")).toEqual(["paragraph", "list"]);
  });
  it("off: round trip", () => {
    dialect.strict = false;
    for (const md of ["#Heading\n\nbody\n", "text\n2. two\n3. three\n", "##A ##\n"]) expect(serialize(parseMarkdown(md).doc)).toBe(md);
    expect(parseMarkdown("#Heading\n").doc.firstChild!.type.name).toBe("heading");
  });
});
