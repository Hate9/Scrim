// End-to-end test harness: starts tauri-driver, runs registered tests, one app per test.
//
// Needs: a built app (`npx tauri build --debug --no-bundle`), `tauri-driver` and
// `WebKitWebDriver` on PATH, an X display, and a D-Bus session bus. `scripts/e2e.sh`
// provides the display and bus.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Session } from "./webdriver.mjs";

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

/** The document as Markdown (from P1 on: the editor's serializer). */
const editorValue = (s) => s.exec("return window.__scrim.editor.markdown()");

/** Type text with real key events (one keyDown/keyUp per character). */
async function typeText(s, text) {
  const actions = [];
  for (const ch of text) actions.push({ type: "keyDown", value: ch }, { type: "keyUp", value: ch });
  await s.cmd("POST", "/actions", { actions: [{ type: "key", id: "kbd", actions }] });
  await s.cmd("DELETE", "/actions");
}

/** Run a script against the editor: `ed` is the Editor, `view` its EditorView. */
const ed = (s, body, args = []) =>
  s.exec(`const ed = window.__scrim.editor; const view = ed.view; ${body}`, args);

export const tests = [];
export const test = (name, fn, prepare = () => null) => tests.push({ name, fn, prepare });
export { typeText, ed, APP, docs, fixture, waitFor, nativeTitles, editorValue, sleep, spawnSync, readFileSync, readdirSync, join };

// ---------------------------------------------------------------------------------

export async function main(filter) {
  if (!existsSync(APP)) throw new Error(`app not built: ${APP}`);
  const driver = spawn("tauri-driver", ["--port", String(PORT)], { stdio: ["ignore", "inherit", "inherit"] });
  let failed = 0;
  try {
    await waitFor(() => fetch(`${BASE}/status`).then((r) => r.ok), "tauri-driver");
    for (const t of tests.filter((t) => !filter || filter.test(t.name))) {
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


