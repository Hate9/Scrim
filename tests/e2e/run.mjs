// P0 end-to-end acceptance tests (spec 20: S-1, S-3, plus save round trips).
//
// Needs: a built app (`npx tauri build --debug --no-bundle`), `tauri-driver` and
// `WebKitWebDriver` on PATH, an X display, and a D-Bus session bus. `scripts/e2e.sh`
// provides the display and bus.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CTRL, END, Session } from "./webdriver.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const APP = process.env.SCRIM_APP ?? join(ROOT, "target/debug/scrim");
const PORT = 4444;
const BASE = `http://127.0.0.1:${PORT}`;

const work = mkdtempSync(join(tmpdir(), "scrim-e2e-"));
process.env.SCRIM_CONFIG_DIR = join(work, "config");
const docs = join(work, "docs");
spawnSync("mkdir", ["-p", docs, process.env.SCRIM_CONFIG_DIR]);

function fixture(name, bytes) {
  const p = join(docs, name);
  writeFileSync(p, bytes);
  return p;
}

async function waitFor(fn, what, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what} (last: ${last})`);
}

function appRunning() {
  return spawnSync("pgrep", ["-f", `^${APP}`]).status === 0;
}

/** Native window titles from the X server. */
function nativeTitles() {
  const out = spawnSync("xwininfo", ["-root", "-tree"], { encoding: "utf8", env: { ...process.env, LC_ALL: "C.UTF-8" } }).stdout ?? "";
  return [...out.matchAll(/0x[0-9a-f]+ "([^"]*)": \("scrim"/g)].map((m) => m[1]);
}

const editorValue = (s) => s.exec("return document.getElementById('editor').value");

const tests = [];
const test = (name, fn, prepare = () => null) => tests.push({ name, fn, prepare });

test("S-1 launch with a path shows the text and the title", async (s, file) => {
  await waitFor(async () => (await editorValue(s)) === "# Hello\nWorld café\n", "text");
  await waitFor(async () => (await s.title()) === "a.md - Scrim", "document title");
  await waitFor(() => nativeTitles().includes("a.md - Scrim"), "native title");
  return file;
}, () => fixture("a.md", Buffer.from("# Hello\r\nWorld caf\xe9\r\n", "latin1")));

test("edit + Mod+S keeps CRLF and Latin-1 (R-8 file layer)", async (s, file) => {
  await waitFor(async () => (await editorValue(s)).startsWith("# Hello"), "text");
  const ed = await s.find("#editor");
  await s.exec("const e=document.getElementById('editor'); e.focus(); e.setSelectionRange(e.value.length, e.value.length);");
  await s.sendKeys(ed, "Plusè");
  await waitFor(async () => (await s.title()) === "• a.md - Scrim", "dirty title");
  await s.chord(CTRL, "s");
  await waitFor(async () => (await s.title()) === "a.md - Scrim", "clean title after save");
  const bytes = readFileSync(file);
  const want = Buffer.from("# Hello\r\nWorld caf\xe9\r\nPlus\xe8", "latin1");
  if (!bytes.equals(want)) throw new Error(`saved bytes ${JSON.stringify(bytes.toString("latin1"))}`);
  const tmp = readdirSync(docs).filter((n) => n.includes(".scrim-save-"));
  if (tmp.length) throw new Error(`temp files left: ${tmp}`);
}, () => fixture("a.md", Buffer.from("# Hello\r\nWorld caf\xe9\r\n", "latin1")));

test("open then save without editing is byte-identical", async (s, file, original) => {
  await waitFor(async () => (await editorValue(s)).includes("mixed"), "text");
  await s.chord(CTRL, "s");
  await sleep(500);
  if (!readFileSync(file).equals(original)) throw new Error("file changed");
}, () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("mixed\r\nendings\nand\rcr\t \n", "utf8")]);
  return [fixture("mixed.md", bytes), bytes];
});

test("S-3 second instance hands its path to the first and exits", async (s, file) => {
  await waitFor(async () => (await editorValue(s)) === "first\n", "first text");
  // Unmodified document: the second file replaces it in the same window (spec 07, 7.1).
  const b = fixture("b.md", "second file\n");
  const t0 = Date.now();
  const r = spawnSync(APP, [b], { timeout: 5000 });
  const ms = Date.now() - t0;
  if (r.status !== 0) throw new Error(`second instance exit ${r.status} ${r.signal}`);
  if (ms > 2000) throw new Error(`second instance took ${ms} ms`);
  await waitFor(async () => (await editorValue(s)) === "second file\n", "forwarded file in first instance");
  await waitFor(async () => (await s.title()) === "b.md - Scrim", "title of forwarded file");
  // Dirty document: a third file opens in a new window.
  await s.sendKeys(await s.find("#editor"), END + "x");
  await waitFor(async () => (await s.title()) === "• b.md - Scrim", "dirty");
  const c = fixture("c.md", "third\n");
  const r2 = spawnSync(APP, [c], { timeout: 5000 });
  if (r2.status !== 0) throw new Error(`third instance exit ${r2.status}`);
  await waitFor(() => nativeTitles().includes("c.md - Scrim"), "new window for c.md");
  if (!nativeTitles().includes("• b.md - Scrim")) throw new Error(`titles ${nativeTitles()}`);
  // Already open: launching b.md again focuses its window, no new window.
  const before = nativeTitles().length;
  spawnSync(APP, [b], { timeout: 5000 });
  await sleep(700);
  if (nativeTitles().length !== before) throw new Error(`window count changed: ${nativeTitles()}`);
  return file;
}, () => fixture("first.md", "first\n"));

test("CSP blocks network fetches from the frontend", async (s) => {
  await waitFor(async () => (await s.title()).endsWith("Scrim"), "loaded");
  const result = await s.cmd("POST", "/execute/async", {
    script: "const done = arguments[0]; fetch('http://127.0.0.1:9/x').then(() => done('allowed'), () => done('blocked'));",
    args: [],
  });
  if (result !== "blocked") throw new Error(`fetch was ${result}`);
  await waitFor(() => readFileSync(join(process.env.SCRIM_CONFIG_DIR, "app.log"), "utf8").includes("blocked by CSP"), "CSP log line");
});

// ---------------------------------------------------------------------------------

async function main() {
  if (!existsSync(APP)) throw new Error(`app not built: ${APP}`);
  const driver = spawn("tauri-driver", ["--port", String(PORT)], { stdio: ["ignore", "inherit", "inherit"] });
  let failed = 0;
  try {
    await waitFor(() => fetch(`${BASE}/status`).then((r) => r.ok), "tauri-driver");
    for (const t of tests) {
      await waitFor(() => !appRunning(), "previous app instance to exit", 15000);
      const prepared = t.prepare();
      const [file, extra] = Array.isArray(prepared) ? prepared : [prepared];
      let s;
      try {
        s = await Session.create(BASE, APP, file ? [file] : []);
        await t.fn(s, file, extra);
        console.log(`ok   ${t.name}`);
      } catch (e) {
        failed++;
        console.log(`FAIL ${t.name}\n     ${e.message}`);
      } finally {
        if (s) await s.delete();
        spawnSync("pkill", ["-f", `^${APP}`]);
      }
    }
  } finally {
    driver.kill();
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed (logs in ${process.env.SCRIM_CONFIG_DIR})`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
