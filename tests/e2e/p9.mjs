// Viewport-only rendering of large documents (QA-LOG Q-027): what must not change.
import { CTRL, ENTER } from "./webdriver.mjs";
import { docs, ed, existsSync, join, readFileSync, saveAsFile, sleep, spawnSync, test, typeText, waitFor, writeFileSync } from "./harness.mjs";
import { mkdirSync } from "node:fs";

const js = (s, body) => s.exec(body);
const ready = (s) => waitFor(() => js(s, "return !!(window.__scrim && window.__scrim.editor.view.state.doc && window.__scrim.themes.loaded && window.__scrim.openMs() != null)"), "editor and theme", 60000);
const settled = (s) =>
  waitFor(() => js(s, "const st = window.__scrim.inlineKey.getState(window.__scrim.editor.view.state); return st.pending === null && !st.touched.length"), "inline structure done", 120000);
/** Frames until nothing moves: the window follows the viewport in animation frames. */
const frames = (s, n = 6) => js(s, `return new Promise((r) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : r(true)); requestAnimationFrame(f); })`);

/** A long document: `n` sections, each a heading, two paragraphs, a list, a quote. */
function longDoc(name, n) {
  let md = "# Long document\n\n";
  for (let i = 1; i <= n; i++) {
    md += `## Section ${i}\n\nParagraph one of section ${i} with **bold** words and enough text to wrap onto a second line in a normal window width, more or less.\n\nParagraph two of section ${i}.\n\n- item ${i}a\n- item ${i}b\n\n> quote ${i}\n\n`;
  }
  md += "The very last paragraph, marker-zebra.\n";
  const p = join(docs, name);
  writeFileSync(p, md);
  return p;
}

const rendered = (s) => js(s, "return window.__scrim.viewport.rendered()");
const isOn = (s) => js(s, "return !!window.__scrim.viewport.state()?.on");

test("VR-1 small documents render whole; large ones only near the viewport", async (s) => {
  await ready(s);
  await settled(s);
  if (!(await isOn(s))) throw new Error("viewport-only rendering is off for a 3,000-block document");
  const [r, total] = await js(s, "return [window.__scrim.viewport.rendered(), window.__scrim.editor.view.state.doc.childCount]");
  if (r > 400) throw new Error(`${r} of ${total} blocks rendered`);
  // The model is complete: counts and the outline see everything.
  await waitFor(() => js(s, "return /[1-9]\\d* Words/.test(document.querySelector('footer').textContent)"), "word count");
  const [words, outline] = await js(s, "return [document.querySelector('footer').textContent, window.__scrim.sidebar.headings().length]");
  if (outline !== 601) throw new Error(`outline has ${outline} headings`);
  if (!/2[0-9]{4} Words/.test(words)) throw new Error(`word count ${words}`);
}, () => longDoc("vr1.md", 600));

test("VR-2 a theme's counters and sibling selectors render as with the whole document", async (s) => {
  mkdirSync(join(process.env.SCRIM_CONFIG_DIR, "themes"), { recursive: true });
  await ready(s);
  await js(s, "window.__scrim.setSetting('theme', 'vr-counters'); return true");
  await waitFor(() => js(s, "return window.__scrim.themes.current === 'vr-counters'"), "theme");
  await settled(s);
  const shoot = async (label) => {
    // Section 300's heading at the top of the window, as an outline click puts it.
    await ed(s, "const h = window.__scrim.sidebar.headings().find((x) => x.id === 'section-300'); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(h.pos + 1)))); view.nodeDOM(h.pos).scrollIntoView({ block: 'start' });");
    await frames(s, 10);
    await ed(s, "const h = window.__scrim.sidebar.headings().find((x) => x.id === 'section-300'); view.nodeDOM(h.pos).scrollIntoView({ block: 'start' });");
    await js(s, "window.__scrim.editor.view.dom.blur(); getSelection().removeAllRanges(); return true"); // no caret
    await frames(s, 10);
    const file = join(process.env.SCRIM_CONFIG_DIR, `vr2-${label}.png`);
    writeFileSync(file, Buffer.from(await s.cmd("GET", "/screenshot"), "base64"));
    // The document area: the scrollbar's thumb reflects estimated heights below.
    const width = await js(s, "return Math.floor(document.querySelector('content').clientWidth) - 14"); // overlay scrollbar
    spawnSync("convert", [file, "-crop", `${width}x600+0+0`, "+repage", file]);
    return file;
  };
  const counterText = () => js(s, "const h = [...document.querySelectorAll('#write h2')].find((e) => e.id === 'section-300'); return getComputedStyle(h, '::before').content");
  const a = await shoot("viewport");
  const ca = await counterText();
  if (!(await isOn(s))) throw new Error("not in viewport mode");
  await js(s, "window.__scrim.viewport.config.forceOff = true; window.__scrim.viewport.setMode(false); return true");
  await waitFor(() => js(s, "return !document.querySelector('#write > .md-virtual')"), "whole document rendered", 60000);
  const b = await shoot("whole");
  const cb = await counterText();
  if (ca !== cb) throw new Error(`counter content ${ca} vs ${cb}`);
  // Glyph antialiasing of list bullets may differ by a few levels; text, counters,
  // colours and borders must be identical.
  const diff = spawnSync("compare", ["-metric", "AE", "-fuzz", "25%", a, b, "null:"], { encoding: "utf8" }).stderr.trim();
  if (diff !== "0") throw new Error(`screenshots differ in ${diff} pixels (${a}, ${b})`);
}, () => {
  const themes = join(process.env.SCRIM_CONFIG_DIR, "themes");
  mkdirSync(themes, { recursive: true });
  writeFileSync(
    join(themes, "vr-counters.css"),
    `#write { counter-reset: h2; }
#write h2 { counter-increment: h2; }
#write h2::before { content: counter(h2) ". "; color: #a33; }
#write h2 + p { color: #2a5; }
#write p:first-child { font-weight: bold; }
#write blockquote + h2 { border-top: 2px solid #88c; }
`,
  );
  return longDoc("vr2.md", 600);
});

test("VR-3 jump to a heading far away lands exactly at the top; content stays put as heights get measured", async (s) => {
  await ready(s);
  await settled(s);
  const top = () => js(s, "const h = document.getElementById('section-450'); return h ? Math.round(h.getBoundingClientRect().top - document.querySelector('content').getBoundingClientRect().top) : null");
  await ed(s, "const h = window.__scrim.sidebar.headings().find((x) => x.id === 'section-450'); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(h.pos + 1)))); view.nodeDOM(h.pos).scrollIntoView({ block: 'start' });");
  await frames(s, 3);
  const t0 = await top();
  if (t0 === null || Math.abs(t0) > 2) throw new Error(`heading at ${t0}px from the top`);
  // Scrolling up past unmeasured blocks: the content at the top must not jump.
  const content = "document.querySelector('content')";
  await js(s, `${content}.scrollTop -= 4000; return true`);
  await frames(s, 2);
  const anchor = await js(s, "const box = document.querySelector('content').getBoundingClientRect(); const el = [...document.querySelectorAll('#write > :not(.md-virtual)')].find((e) => e.getBoundingClientRect().bottom > box.top + 20); el.dataset.vr = '1'; return Math.round(el.getBoundingClientRect().top)");
  await frames(s, 12);
  await sleep(500);
  const after = await js(s, "const el = document.querySelector('[data-vr=\"1\"]') ?? null; return el ? Math.round(el.getBoundingClientRect().top) : null");
  if (after !== null && Math.abs(after - anchor) > 1) throw new Error(`content at the top moved ${after - anchor}px`);
}, () => longDoc("vr3.md", 600));

test("VR-4 find reaches a match far below; select all and cut take the whole document", async (s) => {
  await ready(s);
  await settled(s);
  await ed(s, "view.focus()");
  await s.chord(CTRL, "f");
  await waitFor(() => js(s, "return document.activeElement?.classList.contains('scrim-find-input')"), "find field");
  await typeText(s, "marker-zebra");
  await waitFor(() => js(s, "return document.querySelector('.scrim-find-counter').textContent.endsWith('1')"), "1 match");
  await s.chord(ENTER);
  await waitFor(() => js(s, "const v = window.__scrim.editor.view; const sel = v.state.selection; return v.state.doc.textBetween(sel.from, sel.to) === 'marker-zebra'"), "match selected");
  await frames(s, 4);
  // (Focus is in the find field: the editor's coordinates, not the DOM selection.)
  const visible = await js(s, "const v = window.__scrim.editor.view; const r = v.coordsAtPos(v.state.selection.from); const box = document.querySelector('content').getBoundingClientRect(); return r.top >= box.top && r.bottom <= box.bottom");
  if (!visible) throw new Error("the match is not on screen: " + (await js(s, "const v = window.__scrim.editor.view; const sel = getSelection(); const r = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null; const box = document.querySelector('content').getBoundingClientRect(); const c = v.coordsAtPos(v.state.selection.from); const dom = v.domAtPos(v.state.selection.from).node; return JSON.stringify({ rect: r && [r.top, r.bottom], coords: [c.top, c.bottom], box: [box.top, box.bottom], scroll: document.querySelector('content').scrollTop, focused: v.hasFocus(), virt: !!(dom.closest && dom.closest('.md-virtual')) || !!(dom.parentElement && dom.parentElement.closest('.md-virtual')) })")));
  // Select all, cut: everything goes (one undo step brings it back).
  await js(s, "document.querySelector('.scrim-find-close')?.click(); window.__scrim.editor.view.focus(); return true");
  const before = await js(s, "return window.__scrim.editor.markdown().length");
  await s.chord(CTRL, "a");
  await s.chord(CTRL, "a");
  await s.chord(CTRL, "x");
  await waitFor(() => js(s, "return window.__scrim.editor.markdown().length < 5"), "document cut");
  await s.chord(CTRL, "z");
  await waitFor(async () => (await js(s, "return window.__scrim.editor.markdown().length")) === before, "undo restores it");
}, () => longDoc("vr4.md", 600));

test("VR-5 HTML export of a large document has every block", async (s) => {
  await ready(s);
  await settled(s);
  const out = join(docs, "vr5.html");
  writeFileSync(saveAsFile, out);
  await js(s, "window.__scrim.command('file.exportHtml'); return true");
  await waitFor(() => existsSync(out), "exported", 120000);
  const html = readFileSync(out, "utf8");
  for (const want of ["Section 1<", "Section 300<", "marker-zebra"]) if (!html.includes(want)) throw new Error(`export lacks ${want}`);
  if (html.includes("md-virtual")) throw new Error("export contains placeholders");
  // Back to viewport-only rendering afterwards.
  await waitFor(() => isOn(s), "viewport mode again");
  if ((await rendered(s)) > 400) throw new Error("still rendering the whole document");
}, () => longDoc("vr5.md", 600));

test("VR-6 typewriter mode and typing at the edge of the rendered range", async (s) => {
  await ready(s);
  await settled(s);
  await js(s, "window.__scrim.setSetting('typewriterMode', true); return true");
  // The last rendered block: put the cursor there and type, then keep typing new lines.
  await ed(s, "const st = window.__scrim.viewport.state(); const doc = view.state.doc; const pos = Math.max(1, st.to - 3); view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(doc.resolve(pos))).scrollIntoView());");
  await frames(s, 4);
  await typeText(s, " edge");
  for (let i = 0; i < 25; i++) {
    await s.chord(ENTER);
    await typeText(s, `line ${i}`);
  }
  await frames(s, 4);
  const ok = await js(s, "const t = window.__scrim.editor.markdown(); return t.includes(' edge') && t.includes('line 24')");
  if (!ok) throw new Error("typed text missing");
  const caret = await js(s, "const r = getSelection().getRangeAt(0).getBoundingClientRect(); const box = document.querySelector('content').getBoundingClientRect(); return Math.round(r.top - box.top - box.height / 2)");
  if (Math.abs(caret) > 60) throw new Error(`typewriter mode: caret ${caret}px from the middle`);
}, () => longDoc("vr6.md", 600));
