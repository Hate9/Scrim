// Default file name for saving an untitled document (spec 07, 7.2): the first heading's
// text, slugified to safe characters, or `Untitled.md`.

const ATX = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

export function firstHeading(text: string): string | null {
  for (const line of text.split(/\r\n|\r|\n/)) {
    const m = ATX.exec(line);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

export function safeFileStem(title: string): string {
  return title
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|#`*_~\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
}

export function suggestedFileName(text: string): string {
  const h = firstHeading(text);
  const stem = h ? safeFileStem(h) : "";
  return `${stem || "Untitled"}.md`;
}
