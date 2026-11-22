// P8 performance budgets (spec 20, PF-1). Under Xvfb with software rendering the numbers
// are reported only; SCRIM_PERF_STRICT=1 enforces them (run on a real laptop, as E-14,
// QA-LOG Q-011).
import { docs, fixture, join, sleep, spawnSync, test, waitFor, writeFileSync } from "./harness.mjs";
import { mkdirSync } from "node:fs";

const js = (s, body) => s.exec(body);
const strict = !!process.env.SCRIM_PERF_STRICT;
const budget = (what, ms, limit) => {
  console.log(`     PF-1 ${what}: ${Math.round(ms)} ms (budget ${limit} ms)`);
  if (ms > limit) {
    if (strict) throw new Error(`${what} took ${Math.round(ms)} ms (budget ${limit} ms)`);
    console.log("     PF-1: over budget; reported only (set SCRIM_PERF_STRICT=1 to enforce)");
  }
};
const bigDoc = (name, lines) => {
  const p = join(docs, name);
  spawnSync("node", [join(process.cwd(), "scripts/make-big-doc.mjs"), p, String(lines)]);
  return p;
};

test("PF-1 open a 1 MB file (< 2 s)", async (s) => {
  await waitFor(() => js(s, "return window.__scrim?.openMs?.() != null"), "document open", 60000);
  budget("open 1 MB", await js(s, "return window.__scrim.openMs()"), 2000);
  console.log("     " + (await js(s, "return performance.getEntriesByType('measure').filter((m) => m.name.startsWith('scrim-')).map((m) => m.name.slice(6) + ' ' + Math.round(m.duration)).join(', ')")));
  const size = await js(s, "return window.__scrim.editor.markdown().length");
  if (size < 1_000_000) throw new Error(`document is ${size} bytes`);
}, () => bigDoc("pf1-1mb.md", 47000));

test("PF-1 toggle source mode on 10,000 lines (< 300 ms)", async (s) => {
  await waitFor(() => js(s, "return window.__scrim?.openMs?.() != null"), "document open", 60000);
  // The after-load work (presentation marks in chunks, spell check) must be done: two idle
  // frames take only a few milliseconds then.
  await waitFor(() => js(s, "const st = window.__scrim.inlineKey.getState(window.__scrim.editor.view.state); return st.pending === null && !st.touched.length"), "inline structure done", 120000);
  await waitFor(() => js(s, "const t = performance.now(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t < 200))))"), "idle frames", 120000);
  const timeToggle = () =>
    js(s, "const t = performance.now(); window.__scrim.sourceMode.toggle(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t))))");
  // The first switch after opening also pays one-time work (code loading, first
  // serialization); later ones are what the budget is about. Both are reported.
  budget("first enter source mode (10,000 lines)", await timeToggle(), 300);
  await sleep(500);
  budget("first leave source mode (10,000 lines)", await timeToggle(), 300);
  await sleep(500);
  budget("enter source mode (10,000 lines)", await timeToggle(), 300);
  await sleep(500);
  budget("leave source mode (10,000 lines)", await timeToggle(), 300);
}, () => bigDoc("pf1-10k.md", 10000));

test("PF-1 sidebar with 5,000 files (< 1 s)", async (s) => {
  await waitFor(() => js(s, "return window.__scrim?.openMs?.() != null"), "document open");
  await sleep(1500); // let the document's own after-load work finish
  if (process.env.PF_CSS) await js(s, "const st = document.createElement('style'); st.textContent = " + JSON.stringify(process.env.PF_CSS) + "; document.head.appendChild(st); return true");
  // Until the visible rows are in the DOM and drawn (two frames); a big tree is virtual.
  const ms = await js(s, `const t = performance.now(); window.__scrim.sidebar.showFiles(false);
    return new Promise((r) => { const tick = () => document.querySelectorAll('#file-library .file-tree-node').length >= 20 ? requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t))) : setTimeout(tick, 20); tick(); })`);
  budget("sidebar 5,000 files", ms, 1000);
  // The virtual tree draws rows as they scroll into view.
  await js(s, "const l = document.getElementById('file-library'); l.scrollTop = l.scrollHeight; return true");
  await waitFor(() => js(s, "return !!document.querySelector('#file-library [data-path$=\"note-4999.md\"]')"), "last row drawn after scrolling");
}, () => {
  const dir = join(docs, "pf1-many");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 5000; i++) writeFileSync(join(dir, `note-${String(i).padStart(4, "0")}.md`), `# Note ${i}\n`);
  return fixture("pf1-many/index.md", "# Index\n");
});
