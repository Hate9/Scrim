// Forced-layout profile for E-14 (QA-LOG Q-026): types 44 characters into a 10,000-line
// document with every geometry read wrapped, then prints the reads grouped by call stack
// with their total time, and the time of each view update. Stacks are readable with an
// unminified frontend:
//   npx tauri build --debug --no-bundle --config '{"build":{"beforeBuildCommand":"npx vite build --minify false"}}'
//   SCRIM_SKIP_BUILD=1 xvfb-run -a dbus-run-session -- node tests/e2e/tools/profile-layout.mjs
import { test, waitFor, sleep, main, ed, typeText, join, docs, spawnSync } from "../harness.mjs";
const bigDoc = () => { const p = join(docs, "probe10k.md"); spawnSync("node", [new URL("../../../scripts/make-big-doc.mjs", import.meta.url).pathname, p, "10000"]); return p; };
test("probe", async (s) => {
  await waitFor(() => s.exec("return !!window.__scrim && window.__scrim.editor.view.state.doc.childCount > 1000"), "big doc", 30000);
  await waitFor(() => s.exec("return window.__scrim.inlineKey.getState(window.__scrim.editor.view.state).pending === null"), "decorations", 60000);
  await sleep(2000);
  await ed(s, `const doc = view.state.doc; let target = 0, seen = 0; doc.descendants((n, pos) => { if (target) return false; if (n.type.name === 'paragraph' && ++seen === Math.floor(doc.childCount / 4)) target = pos + 5; return !n.isTextblock; });
    view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(doc.resolve(target))).scrollIntoView());`);
  await sleep(1000);
  await s.exec(`
    const counts = new Map(); window.__geo = counts; window.__geoOn = true;
    const note = (what, ms) => { if (!window.__geoOn) return; const st = (new Error().stack || '').split('\\n').slice(1, 6).map((l) => l.replace(/@.*\\/assets\\//, '@').replace(/:\\d+$/, '')).join(' < '); const k = what + ' :: ' + st; const c = counts.get(k) || [0, 0, 0]; c[0]++; c[1] += ms; if (ms > 1) c[2]++; counts.set(k, c); };
    const wrapM = (proto, name, label) => { const f = proto[name]; proto[name] = function (...a) { const t = performance.now(); const r = f.apply(this, a); note(label, performance.now() - t); return r; }; };
    const wrapG = (proto, name, label) => { const d = Object.getOwnPropertyDescriptor(proto, name); if (!d || !d.get) return; Object.defineProperty(proto, name, { ...d, get() { const t = performance.now(); const r = d.get.call(this); note(label, performance.now() - t); return r; } }); };
    wrapM(Element.prototype, 'getBoundingClientRect', 'el.getBCR'); wrapM(Element.prototype, 'getClientRects', 'el.getClientRects');
    wrapM(Range.prototype, 'getBoundingClientRect', 'range.getBCR'); wrapM(Range.prototype, 'getClientRects', 'range.getClientRects');
    for (const n of ['offsetTop','offsetLeft','offsetWidth','offsetHeight','offsetParent']) wrapG(HTMLElement.prototype, n, n);
    for (const n of ['clientWidth','clientHeight','scrollTop','scrollHeight','scrollWidth','clientTop','clientLeft']) wrapG(Element.prototype, n, n);
    wrapM(window, 'getComputedStyle', 'getComputedStyle');
    wrapM(document, 'elementFromPoint', 'elementFromPoint'); if (document.caretRangeFromPoint) wrapM(document, 'caretRangeFromPoint', 'caretRangeFromPoint');
    wrapM(Element.prototype, 'scrollIntoView', 'scrollIntoView');
    const v = window.__scrim.editor.view; const us = v.updateState.bind(v); window.__upd = []; v.updateState = (st) => { const t = performance.now(); us(st); if (window.__geoOn) window.__upd.push([performance.now() - t, st.tr ? 0 : 0]); };
    return true;`);
  await typeText(s, "the quick brown fox jumps over the lazy dog ");
  await sleep(1500);
  const out = await s.exec("window.__geoOn = false; return [...window.__geo.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 12)");
  for (const [k, [n, ms, slow]] of out) console.log(String(n).padStart(5), String(Math.round(ms)).padStart(6) + "ms", String(slow).padStart(4) + " slow", k.slice(0, 150));
  const upd = await s.exec("return window.__upd.map((u) => u[0])");
  console.log("updateState calls:", upd.length, "total ms", Math.round(upd.reduce((a, b) => a + b, 0)), "max", Math.round(Math.max(...upd)));
}, bigDoc);
main();
