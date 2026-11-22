// Applies Scrim's patches to installed dependencies (run by `npm install` / `npm ci`).
//
// micromark-util-edit-map 1.0.0: `consume` copies the whole event list out and back in on
// every call, which makes Markdown parsing quadratic in the number of list and quote
// exits (a 1 MB document took about 10 s). The patch removes the copy of the prefix
// before the first edit, which stays in place; the resulting list is the same. Both the
// production build (`index.js`) and the development build (`dev/index.js`, which Vite
// and Vitest load) are patched. A file that does not contain the exact upstream code is
// left alone with a warning.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARK = "// Scrim: prefix stays in place";
for (const file of ["index.js", "dev/index.js"]) {
  const path = join(root, "node_modules/micromark-util-edit-map", file);
  if (!existsSync(path)) continue;
  const src = readFileSync(path, "utf8");
  if (src.includes(MARK)) continue;
  // The upstream lines (with or without semicolons): `vecs.push(events.slice())` and
  // `events.length = 0` right before `let slice = vecs.pop()`.
  const re = /vecs\.push\(events\.slice\(\)\);?\s*events\.length = 0;?(\s*let slice = vecs\.pop\(\))/;
  if (!re.test(src)) {
    console.warn(`micromark-util-edit-map/${file} changed upstream; not patched (see scripts/patch-deps.mjs)`);
    continue;
  }
  writeFileSync(path, src.replace(re, `${MARK} (scripts/patch-deps.mjs)$1`));
  console.log(`patched micromark-util-edit-map/${file} (linear-time consume)`);
}
