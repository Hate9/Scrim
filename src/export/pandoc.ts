// What Scrim hands pandoc (spec 09, 9.4): the document's Markdown, with the constructs
// pandoc does not understand pre-processed. `[toc]` becomes a nested list of links to the
// headings; custom and inline HTML stay raw HTML (pandoc's gfm reader keeps it).

import type { Node } from "prosemirror-model";
import { headings, type HeadingInfo } from "../editor/headings";

/** A Markdown list of heading links, nested by level. */
export function tocMarkdown(list: Pick<HeadingInfo, "level" | "text" | "id">[]): string {
  if (!list.length) return "";
  const min = Math.min(...list.map((h) => h.level));
  const lines: string[] = [];
  const stack: number[] = [];
  for (const h of list) {
    while (stack.length && stack[stack.length - 1] >= h.level) stack.pop();
    // Indent by nesting depth (not by raw level, so skipped levels do not over-indent).
    const depth = stack.length && h.level > min ? stack.length : 0;
    const text = h.text.replace(/([\\[\]])/g, "\\$1");
    lines.push(`${"  ".repeat(depth)}- [${text}](#${h.id})`);
    stack.push(h.level);
  }
  return lines.join("\n");
}

/** Replace every `[toc]` paragraph (outside code) with the generated list. */
export function replaceToc(markdown: string, toc: string): string {
  const lines = markdown.split(/(?<=\n)/);
  let fence: string | null = null;
  let frontMatter = lines[0]?.replace(/\r?\n$/, "") === "---";
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\r?\n$/, "");
    if (frontMatter) {
      out.push(raw);
      if (i > 0 && (line === "---" || line === "...")) frontMatter = false;
      continue;
    }
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
      out.push(raw);
      continue;
    }
    if (f) {
      fence = f[1];
      out.push(raw);
      continue;
    }
    const prevBlank = i === 0 || !lines[i - 1].trim();
    const nextBlank = i + 1 >= lines.length || !lines[i + 1].trim();
    if (/^ {0,3}\[toc\]\s*$/i.test(line) && prevBlank && nextBlank) {
      out.push(toc + (raw.endsWith("\n") ? "\n" : ""));
      continue;
    }
    out.push(raw);
  }
  return out.join("");
}

export function pandocInput(doc: Node, markdown: string): string {
  return replaceToc(markdown, tocMarkdown(headings(doc)));
}
