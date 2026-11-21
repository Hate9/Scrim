#!/usr/bin/env node
// Download the owner-supplied fixture themes for T-1 (CLEAN-ROOM.md rule 7) into
// tests/fixtures/themes/ (git-ignored), from the pinned list in
// spec/fixtures/themes.lock.json, verifying every file's SHA-256.
//
// The files are test inputs only: this script never prints their contents, and nobody
// working on Scrim's own themes reads them.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(join(root, "spec/fixtures/themes.lock.json"), "utf8"));
const out = join(root, "tests/fixtures/themes");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

let fetched = 0;
let kept = 0;
let failed = 0;
for (const repo of lock.themes) {
  for (const f of repo.files) {
    const dest = join(out, f.dest);
    if (!dest.startsWith(out + "/")) throw new Error(`bad dest ${f.dest}`);
    if (existsSync(dest) && sha(readFileSync(dest)) === f.sha256) {
      kept++;
      continue;
    }
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = sha(buf);
      if (got !== f.sha256) throw new Error(`SHA-256 mismatch (got ${got})`);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      fetched++;
    } catch (e) {
      failed++;
      console.error(`${f.dest}: ${e.message}`);
    }
  }
}
const themes = lock.themes.flatMap((r) => r.themes);
console.log(`fixture themes: ${fetched} downloaded, ${kept} already present, ${failed} failed; themes: ${themes.join(", ")}`);
process.exit(failed ? 1 : 0);
