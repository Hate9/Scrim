// R-2, R-5, R-6 at the model level: an edit inside one paragraph or heading changes
// exactly the edited characters in the serialized file.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse";
import { serialize } from "./serialize";

const dir = join(__dirname, "../../tests/corpus");

/** Replace the first word (letters only) found in a paragraph or heading. */
function replaceAWord(src: string): { before: string; after: string; word: string } | null {
  const { doc } = parseMarkdown(src);
  let found: { from: number; to: number; word: string } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isText && node.text) {
      const parent = doc.resolve(pos).parent;
      if (parent.type.name !== "paragraph" && parent.type.name !== "heading") return false;
      const m = /\b[A-Za-z]{3,}\b/.exec(node.text);
      if (m) found = { from: pos + m.index, to: pos + m.index + m[0].length, word: m[0] };
    }
    return !found;
  });
  if (!found) return null;
  const f = found as { from: number; to: number; word: string };
  const state = EditorState.create({ doc });
  const tr = state.tr.insertText("ZZZ", f.from, f.to);
  return { before: serialize(doc), after: serialize(tr.doc), word: f.word };
}

describe("R-2 a word replaced in a paragraph or heading changes only that word", () => {
  const files = readdirSync(dir).filter((n) => n.endsWith(".md") && !n.startsWith("utf16"));
  it.each(files)("%s", (name) => {
    const src = readFileSync(join(dir, name)).toString("latin1");
    const r = replaceAWord(src);
    if (!r) return;
    expect(r.before).toBe(src);
    const i = src.indexOf(r.word);
    // The serialized result must equal the source with that one occurrence replaced.
    const candidates = [];
    for (let at = src.indexOf(r.word); at >= 0; at = src.indexOf(r.word, at + 1)) {
      candidates.push(src.slice(0, at) + "ZZZ" + src.slice(at + r.word.length));
    }
    expect(i).toBeGreaterThanOrEqual(0);
    expect(candidates).toContain(r.after);
  });
});

function editFirst(src: string, word: string, replacement: string): string {
  const { doc } = parseMarkdown(src);
  let at = -1;
  doc.descendants((node, pos) => {
    if (at < 0 && node.isText) {
      const i = node.text!.indexOf(word);
      if (i >= 0) at = pos + i;
    }
    return at < 0;
  });
  if (at < 0) throw new Error(`no ${word}`);
  const tr = EditorState.create({ doc }).tr.insertText(replacement, at, at + word.length);
  return serialize(tr.doc);
}

describe("R-5 separators survive edits", () => {
  it("three blank lines and whitespace-only lines", () => {
    const src = "first para\n\n \n\t\n\nsecond para\nline two\n";
    expect(editFirst(src, "second", "2nd")).toBe(src.replace("second", "2nd"));
  });
});

describe("R-6 container prefixes survive edits", () => {
  it("lazy continuation in a quote", () => {
    const src = "> quote line one\nlazy continuation\n> last line\n";
    expect(editFirst(src, "last", "final")).toBe(src.replace("last", "final"));
  });
  it("tab continuation in a list item", () => {
    const src = "- item one\n\tcontinued with tab\n- item two\n";
    expect(editFirst(src, "two", "2")).toBe(src.replace("two", "2"));
  });
  it("mixed quote prefix styles", () => {
    const src = ">no space\n>  two spaces\n> > nested\n";
    expect(editFirst(src, "nested", "deep")).toBe(src.replace("nested", "deep"));
  });
});
