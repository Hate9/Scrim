// Writing style (spec 02, "Writing Markdown"; Preferences → Markdown → Writing Style):
// the Markdown Scrim writes for new or converted elements. Existing source keeps its own
// markers. Set from the preferences by the app.

export interface WritingStyle {
  bullet: "-" | "*" | "+";
  em: "*" | "_";
  strong: "**" | "__";
  heading: "atx" | "setext";
}

export const writingStyle: WritingStyle = { bullet: "-", em: "*", strong: "**", heading: "atx" };

/** Apply preference values, ignoring unknown ones. Returns whether anything changed. */
export function setWritingStyle(v: { bulletChar?: unknown; emphasisChar?: unknown; strongChar?: unknown; headingStyle?: unknown }): boolean {
  const next: WritingStyle = {
    bullet: v.bulletChar === "*" || v.bulletChar === "+" ? v.bulletChar : "-",
    em: v.emphasisChar === "_" ? "_" : "*",
    strong: v.strongChar === "__" ? "__" : "**",
    heading: v.headingStyle === "setext" ? "setext" : "atx",
  };
  const changed = JSON.stringify(next) !== JSON.stringify(writingStyle);
  Object.assign(writingStyle, next);
  return changed;
}

/** Default indent for code blocks and source mode (spec 11, Editor; default 4 spaces). */
export const codeIndent = { unit: "    " };

export function setCodeIndent(v: unknown) {
  codeIndent.unit = v === "tab" ? "\t" : v === "2" ? "  " : v === "8" ? "        " : "    ";
}
