// Writes a 10,000-line Markdown document for performance tests (spec 20, E-14, PF-1).
// Usage: node scripts/make-big-doc.mjs OUT.md [lines]
import { writeFileSync } from "node:fs";
const n = Number(process.argv[3] ?? 10000);
const parts = [];
let lines = 0;
let i = 0;
while (lines < n) {
  parts.push(`## Section ${i}\n`, "\n");
  parts.push(`Paragraph ${i} with **bold**, *em*, \`code\`, a [link](https://example.com/${i}) and :smile: text.\n`);
  parts.push("A second line of the same paragraph, plain words to fill the width of the column.\n", "\n");
  parts.push(`- item ${i} one\n- item **two**\n  - nested\n`, "\n");
  parts.push(`> quoted *text* ${i}\n`, "\n");
  lines += 12;
  i++;
}
writeFileSync(process.argv[2], parts.join(""));
