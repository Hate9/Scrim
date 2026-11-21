// Attribute sanitizer for inline HTML rendered as real elements (spec 05, 5.1; 04, 4.10).

const ALLOWED = new Set([
  "style", "class", "title", "href", "src", "alt", "width", "height", "lang", "dir",
  "datetime", "cite", "value", "max", "min", "low", "high", "optimum", "color", "face",
  "size", "colspan", "rowspan", "align", "name",
]);
const URL_ATTRS = new Set(["href", "src", "cite"]);

export function sanitizeAttrs(attrs: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!attrs) return out;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "id") {
      out.id = `user-${v}`;
      continue;
    }
    if (!ALLOWED.has(k)) continue;
    if (URL_ATTRS.has(k) && /^\s*(javascript|vbscript|data:text\/html)/i.test(v)) continue;
    out[k] = v;
  }
  return out;
}
