// Line-ending bookkeeping for the P0 plain-text editor.
//
// The editing surface (a <textarea>) only knows "\n". The file may use "\n", "\r\n",
// "\r", or a mix. To keep the file byte-identical where the user did not edit (spec 01,
// "Persistence": lines the user did not touch keep their original endings), the original
// lines and terminators are kept, and on save the edited text is mapped back: lines in
// the unchanged prefix and suffix keep their terminators, edited/new lines get the
// document's line ending.

export type Terminator = "" | "\n" | "\r\n" | "\r";

export interface Line {
  text: string;
  term: Terminator;
}

/** Split raw text into lines; the last line has an empty terminator. */
export function splitLines(raw: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 10 /* \n */) {
      lines.push({ text: raw.slice(start, i), term: "\n" });
      start = i + 1;
    } else if (c === 13 /* \r */) {
      if (raw.charCodeAt(i + 1) === 10) {
        lines.push({ text: raw.slice(start, i), term: "\r\n" });
        i++;
      } else {
        lines.push({ text: raw.slice(start, i), term: "\r" });
      }
      start = i + 1;
    }
  }
  lines.push({ text: raw.slice(start), term: "" });
  return lines;
}

export function joinLines(lines: Line[]): string {
  let out = "";
  for (const l of lines) out += l.text + l.term;
  return out;
}

/** Text as shown in the editor: every terminator becomes "\n". */
export function displayText(lines: Line[]): string {
  return lines.map((l) => l.text).join("\n");
}

/**
 * Rebuild raw text from edited display text. `original` is the line list the display
 * text was derived from; `newline` is the terminator for edited and inserted lines.
 */
export function rebuild(original: Line[], edited: string, newline: Exclude<Terminator, "">): string {
  const lines = edited.split("\n");
  const n = lines.length;
  const m = original.length;
  let prefix = 0;
  while (prefix < n && prefix < m && lines[prefix] === original[prefix].text) prefix++;
  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    lines[n - 1 - suffix] === original[m - 1 - suffix].text
  ) {
    suffix++;
  }
  let out = "";
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    let term: Terminator;
    if (last) term = "";
    else if (i < prefix) term = original[i].term || newline;
    else if (i >= n - suffix) term = original[i - n + m].term || newline;
    else term = newline;
    out += lines[i] + term;
  }
  return out;
}
