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
  const openMs = await js(s, "return window.__scrim.openMs()");
  // The open by stage (Q-027): Rust read and block tree, IPC (reply minus Rust), frontend
  // parse, state, view build, refocus, JS until the first frame, first frame (layout and
  // paint), and when the theme fonts finished loading (from the page's start).
  await sleep(4000); // fonts, if any are still loading
  const stages = ["rust-read", "rust-blocks", "ipc", "parse", "make-state", "update-view", "refocus", "first-marks", "serialize", "until-frame", "first-frame", "fonts-loaded"];
  const m = await js(s, "return Object.fromEntries(performance.getEntriesByType('measure').filter((m) => m.name.startsWith('scrim-')).map((m) => [m.name.slice(6), Math.round(m.duration)]))");
  console.log("     stages: " + stages.map((k) => `${k} ${m[k] ?? "-"}`).join(", "));
  // After the breakdown: with SCRIM_PERF_STRICT=1 the budget check throws.
  budget("open 1 MB", openMs, 2000);
  const size = await js(s, "return window.__scrim.editor.markdown().length");
  if (size < 1_000_000) throw new Error(`document is ${size} bytes`);
}, () => bigDoc("pf1-1mb.md", 47000));

test("PF-1 toggle source mode on 10,000 lines (< 300 ms)", async (s) => {
  await waitFor(() => js(s, "return window.__scrim?.openMs?.() != null"), "document open", 60000);
  // The after-load work (presentation marks in chunks, spell check) must be done: two idle
  // frames take only a few milliseconds then.
  await waitFor(() => js(s, "const st = window.__scrim.inlineKey.getState(window.__scrim.editor.view.state); return st.pending === null && !st.touched.length"), "inline structure done", 120000);
  await waitFor(() => js(s, "const t = performance.now(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t < 200))))"), "idle frames", 120000);
  // Whether the idle-time preload (Q-027) ran before the first switch, and how long it took.
  const pre = await js(s, "const m = performance.getEntriesByName('scrim-src-preload', 'measure').pop(); return m ? Math.round(m.duration) : null");
  console.log(`     source mode preload: ${pre === null ? "did not run" : `${pre} ms`}`);
  // Each switch by stage: entering = prep (escapes, serialize with the position map, top
  // block), cm-create, show (unhide, body class, focus), scroll; then the rest of the
  // toggle's JavaScript, and the two frames until it is drawn.
  const timeToggle = async (label) => {
    if (process.env.PF_TRACE) await js(s, "window.__tr = window.__scrim.traceOn(true); return true");
    const r = await js(s, `const t = performance.now(); return Promise.resolve(window.__scrim.sourceMode.toggle()).then(() => { const j = performance.now();
      return new Promise((res) => requestAnimationFrame(() => { const f1 = performance.now(); requestAnimationFrame(() => { const f2 = performance.now();
        const last = (n) => { const m = performance.getEntriesByName('scrim-' + n, 'measure').filter((e) => e.startTime >= t).pop(); return m ? Math.round(m.duration) : null; };
        res({ total: f2 - t, js: Math.round(j - t), frame1: Math.round(f1 - j), frame2: Math.round(f2 - f1), stages: Object.fromEntries(['src-enter-prep', 'src-cm-create', 'src-show', 'src-scroll'].map((n) => [n.slice(4), last(n)]).filter(([, v]) => v !== null)) }); }); })); })`);
    console.log(`     ${label} stages: ${Object.entries(r.stages).map(([k, v]) => `${k} ${v}`).join(", ")}${Object.keys(r.stages).length ? ", " : ""}js total ${r.js}, frame 1 ${r.frame1}, frame 2 ${r.frame2}`);
    if (process.env.PF_TRACE) console.log("     trace: " + JSON.stringify(await js(s, "const tr = window.__tr; window.__scrim.traceOn(false); const t0 = tr[0]?.t ?? 0; return tr.filter((e) => e.ms >= 2).map((e) => `+${Math.round(e.t - t0)} ${e.what} ${Math.round(e.ms)}`)"), null, 1));
    return r.total;
  };
  // The first switch after opening also pays one-time work (code loading, first
  // serialization); later ones are what the budget is about. Both are reported.
  { const ms = await timeToggle("first enter source mode"); budget("first enter source mode (10,000 lines)", ms, 300); }
  await sleep(500);
  { const ms = await timeToggle("first leave source mode"); budget("first leave source mode (10,000 lines)", ms, 300); }
  await sleep(500);
  { const ms = await timeToggle("enter source mode"); budget("enter source mode (10,000 lines)", ms, 300); }
  await sleep(500);
  { const ms = await timeToggle("leave source mode"); budget("leave source mode (10,000 lines)", ms, 300); }
}, () => bigDoc("pf1-10k.md", 10000));

test("PF-1 sidebar with 5,000 files (< 1 s)", async (s) => {
  await waitFor(() => js(s, "return window.__scrim?.openMs?.() != null"), "document open");
  await sleep(1500); // let the document's own after-load work finish
  if (process.env.PF_CSS) await js(s, "const st = document.createElement('style'); st.textContent = " + JSON.stringify(process.env.PF_CSS) + "; document.head.appendChild(st); return true");
  // Until the visible rows are in the DOM and drawn (two frames); a big tree is virtual.
  if (process.env.PF_TRACE) await js(s, "window.__tr = window.__scrim.traceOn(true); return true");
  const ms = await js(s, `const t = performance.now(); window.__scrim.sidebar.showFiles(false);
    return new Promise((r) => { const tick = () => document.querySelectorAll('#file-library .file-tree-node').length >= 20 ? requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now() - t))) : setTimeout(tick, 20); tick(); })`);
  if (process.env.PF_TRACE) console.log("     trace: " + JSON.stringify(await js(s, "const tr = window.__tr; window.__scrim.traceOn(false); const t0 = tr[0]?.t ?? 0; return tr.filter((e) => e.ms >= 1).map((e) => `+${Math.round(e.t - t0)} ${e.what} ${Math.round(e.ms)}`)"), null, 1));
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

// Q-026: a selection from the top of a 10,000-line document to the bottom copies all of it,
// (with viewport-only rendering, Q-027, most of it is not in the DOM).
test("Q-026 select a 10,000-line document top to bottom and copy", async (s) => {
  const { CTRL, SHIFT, HOME, END } = await import("./webdriver.mjs");
  await waitFor(() => js(s, "return window.__scrim?.openMs?.() != null"), "document open", 60000);
  await waitFor(() => js(s, "const st = window.__scrim.inlineKey.getState(window.__scrim.editor.view.state); return st.pending === null && !st.touched.length"), "inline structure done", 120000);
  {
    await js(s, "window.__scrim.editor.view.focus(); return true");
    await s.chord(CTRL, HOME);
    await s.chord(CTRL, SHIFT, END);
    await waitFor(() => js(s, "const v = window.__scrim.editor.view; const sel = v.state.selection; const d = v.state.doc; return d.textBetween(sel.from, sel.to) === d.textBetween(0, d.content.size)"), "whole document selected").catch(async (e) => {
      throw new Error(`${e.message}: ${await js(s, "const v = window.__scrim.editor.view; const sel = v.state.selection; return JSON.stringify([sel.from, sel.to, v.state.doc.content.size, sel.constructor.name])")}`);
    });
    spawnSync("sh", ["-c", "printf '' | xclip -selection clipboard -i"], { timeout: 3000 });
    await s.chord(CTRL, "c");
    const want = await js(s, "return window.__scrim.editor.markdown()");
    let got = "";
    await waitFor(() => {
      got = spawnSync("xclip", ["-selection", "clipboard", "-o"], { encoding: "utf8", timeout: 5000, maxBuffer: 64 << 20 }).stdout ?? "";
      return got.length > want.length / 2;
    }, "clipboard filled", 15000);
    if (got.replace(/\n+$/, "") !== want.replace(/\n+$/, "")) throw new Error(`copied ${got.length} characters, document has ${want.length}`);
  }
}, () => bigDoc("q026-copy.md", 10000));
