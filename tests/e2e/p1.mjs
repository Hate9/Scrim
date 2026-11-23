// P1 acceptance tests (spec 20, "P1 Core editing" and the round-trip tests that need
// the live editor). Each test starts the app on a fixture or an untitled document.
import { ALT, BACKSPACE, CTRL, END, ENTER, HOME, LEFT, RIGHT, SHIFT, TAB } from "./webdriver.mjs";
import { docs, ed, editorValue, fixture, join, readFileSync, sleep, spawnSync, test, typeText, waitFor, writeFileSync } from "./harness.mjs";

const ROOT_DIR = new URL("../..", import.meta.url).pathname;

const md = editorValue;
const expectMd = async (s, want, what = "markdown") => {
  try {
    await waitFor(async () => (await md(s)) === want, what, 3000);
  } catch {
    throw new Error(`${what}: got ${JSON.stringify(await md(s))}, want ${JSON.stringify(want)}`);
  }
};
const ready = (s) => waitFor(() => s.exec("return !!(window.__scrim && !document.body.classList.contains('scrim-loading') && window.__scrim.editor.view.hasFocus())"), "editor focused");
/** Cursor offset inside its textblock. */
const cursor = (s) => ed(s, "return view.state.selection.$head.parentOffset");
const press = (s, ...keys) => s.chord(...keys);
const html = (s, sel) => s.exec(`return document.querySelector(${JSON.stringify(sel)})?.outerHTML ?? null`);
/** Is the given element visible (rendered with a box)? */
/** Text of an element without widgets such as the heading level hint. */
const ownText = (s, sel) =>
  s.exec(`const el = document.querySelector(${JSON.stringify(sel)}); return el ? [...el.childNodes].filter(n => !(n.classList && n.classList.contains('md-heading-hint'))).map(n => n.textContent).join('') : null`);
const visible = (s, js) => s.exec(`const el = ${js}; return !!el && el.getClientRects().length > 0`);

test("E-1 typing #␣Title makes an h1", async (s) => {
  await ready(s);
  await typeText(s, "# Title");
  await waitFor(async () => (await ownText(s, "#write h1")) === "Title", "h1");
  await expectMd(s, "# Title\n");
});

test("E-2 strong collapses outside and reveals inside", async (s) => {
  await ready(s);
  await typeText(s, "a **bold** b");
  await expectMd(s, "a **bold** b\n");
  await waitFor(() => s.exec("return document.querySelector('#write strong')?.textContent === 'bold'"), "strong");
  // Cursor is outside (after " b"): markers hidden.
  const markersVisible = () =>
    s.exec("return [...document.querySelectorAll('#write .md-inline-strong.md-meta, #write .md-inline-strong .md-meta')].some(e => e.getBoundingClientRect().width > 0)");
  if (await markersVisible()) throw new Error("markers visible while collapsed");
  for (let i = 0; i < 4; i++) await press(s, LEFT);
  await waitFor(markersVisible, "markers visible when inside");
  const color = await s.exec("const m = document.querySelector('#write .md-meta'); return getComputedStyle(m).color");
  const meta = await s.exec("const p = document.createElement('span'); p.style.color = 'var(--md-char-color)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c");
  if (color !== meta) throw new Error(`marker color ${color}, meta ${meta}`);
});

test("E-3/E-16 click on collapsed strong lands on the clicked boundary", async (s) => {
  await ready(s);
  await ed(s, "view.focus()");
  // Coordinates of the boundary just left of "b" and between "o" and "l".
  const point = (offset) =>
    s.exec(
      `const t = document.querySelector('#write strong .md-plain').firstChild; const r = document.createRange(); r.setStart(t, ${offset}); r.setEnd(t, ${offset}); const b = r.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top + b.height / 2)]`,
    );
  const click = async ([x, y]) => {
    await s.cmd("POST", "/actions", {
      actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
        { type: "pointerMove", x, y, origin: "viewport" }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }] }],
    });
  };
  const [x2, y2] = await point(2);
  await click([x2 + 1, y2]);
  await waitFor(async () => (await cursor(s)) === 6, "cursor between o and l (offset 6 in 'a **bold** b')");
  await press(s, END);
  const [x0, y0] = await point(0);
  await click([x0 + 1, y0]);
  await waitFor(async () => (await cursor(s)) === 4, "cursor just after the opening ** (E-16)");
  await typeText(s, "x");
  await expectMd(s, "a **xbold** b\n");
}, () => fixture("e3.md", "a **bold** b\n"));

test("E-4 list typing, empty item leaves the list", async (s) => {
  await ready(s);
  await typeText(s, "- a");
  await press(s, ENTER);
  await typeText(s, "b");
  await press(s, ENTER);
  await press(s, ENTER);
  await waitFor(async () => (await ed(s, "return view.state.selection.$head.parent.type.name + ':' + view.state.selection.$head.depth")) === "paragraph:1", "cursor in top-level paragraph");
  await expectMd(s, "- a\n- b\n");
});

test("E-5 Tab nests a list item, Shift+Tab lifts it back", async (s, file, original) => {
  await ready(s);
  await press(s, CTRL, END);
  await press(s, TAB);
  await expectMd(s, "- a\n  - b\n", "after Tab");
  await press(s, SHIFT, TAB);
  await expectMd(s, original, "after Shift+Tab");
}, () => [fixture("e5.md", "- a\n- b\n"), "- a\n- b\n"]);

test("E-6 Backspace at the start of a heading makes a paragraph", async (s) => {
  await ready(s);
  await press(s, CTRL, HOME);
  await press(s, BACKSPACE);
  await waitFor(() => s.exec("return !document.querySelector('#write h2') && document.querySelector('#write p')?.textContent === 'Title'"), "paragraph");
  await expectMd(s, "Title\n");
}, () => fixture("e6.md", "## Title\n"));

test("E-7 Mod+B toggles strong on a selection", async (s) => {
  await ready(s);
  await press(s, CTRL, HOME);
  for (let i = 0; i < 4; i++) await press(s, SHIFT, RIGHT);
  await press(s, CTRL, "b");
  await expectMd(s, "**word** x\n", "wrapped");
  await press(s, CTRL, "b");
  await expectMd(s, "word x\n", "unwrapped");
}, () => fixture("e7.md", "word x\n"));

test("E-8 undo an input rule restores the typed trigger", async (s) => {
  await ready(s);
  await typeText(s, "# ");
  await waitFor(() => s.exec("return !!document.querySelector('#write h1')"), "empty heading");
  await press(s, CTRL, "z");
  await waitFor(() => s.exec("return !document.querySelector('#write h1') && document.querySelector('#write p').textContent === '# '"), "paragraph '# '");
  await press(s, CTRL, "z");
  await waitFor(() => s.exec("return document.querySelector('#write p').textContent === ''"), "empty paragraph");
});

test("E-10 Shift+Enter writes a newline inside the paragraph", async (s) => {
  await ready(s);
  await typeText(s, "one");
  await press(s, SHIFT, ENTER);
  await typeText(s, "two");
  await waitFor(() => s.exec("return document.querySelectorAll('#write p').length === 1 && !!document.querySelector('#write p br')"), "line break shown");
  await expectMd(s, "one\ntwo\n");
});

test("E-11 auto-pair brackets and quotes", async (s) => {
  await ready(s);
  await typeText(s, "(");
  await expectMd(s, "()\n", "pair");
  if ((await cursor(s)) !== 1) throw new Error("cursor not inside the pair");
  await typeText(s, ")");
  await expectMd(s, "()\n", "typed over");
  if ((await cursor(s)) !== 2) throw new Error("cursor not after the pair");
  await typeText(s, " x");
  await press(s, SHIFT, LEFT);
  await typeText(s, '"');
  await expectMd(s, '() "x"\n', "wrapped selection");
  const sel = await ed(s, "const {from, to} = view.state.selection; return view.state.doc.textBetween(from, to)");
  if (sel !== "x") throw new Error(`selection is ${JSON.stringify(sel)}`);
});

test("E-15 reveal edges with Left", async (s) => {
  await ready(s);
  await press(s, CTRL, HOME);
  // `a **bold** b`: Right crosses each ** in one step; 8 steps reach p == e (offset 10).
  for (let i = 0; i < 8; i++) await press(s, RIGHT);
  if ((await cursor(s)) !== 10) throw new Error(`cursor ${await cursor(s)}`);
  const expanded = () => s.exec("return !!document.querySelector('#write .md-inline-strong.md-expand')");
  if (await expanded()) throw new Error("expanded at p == e");
  await press(s, LEFT);
  if ((await cursor(s)) !== 8 || !(await expanded())) throw new Error("Left should land before closing ** and expand");
  for (let i = 0; i < 4; i++) await press(s, LEFT);
  if ((await cursor(s)) !== 4) throw new Error(`after Left x4: ${await cursor(s)}`);
  await press(s, LEFT);
  if ((await cursor(s)) !== 2 || (await expanded())) throw new Error("Left should cross the opening run and collapse");
  await typeText(s, "x");
  await expectMd(s, "a x**bold** b\n");
}, () => fixture("e15.md", "a **bold** b\n"));

test("E-17 input rule on a non-empty paragraph", async (s) => {
  await ready(s);
  await press(s, CTRL, HOME);
  await typeText(s, "# ");
  await waitFor(async () => (await ownText(s, "#write h1")) === "Hello", "heading Hello");
  await expectMd(s, "# Hello\n");
}, () => fixture("e17.md", "Hello\n"));

test("7b adjacent runs are separate stops", async (s) => {
  await ready(s);
  await press(s, CTRL, HOME);
  // `**a *b***` from 0, one Right at a time.
  const stops = [await cursor(s)];
  for (let i = 0; i < 7; i++) {
    await press(s, RIGHT);
    stops.push(await cursor(s));
  }
  // 0 →2 (**) →3 (a) →4 (space) →5 (*) →6 (b) →7 (closing *) →9 (closing **)
  if (JSON.stringify(stops) !== JSON.stringify([0, 2, 3, 4, 5, 6, 7, 9])) throw new Error(`stops ${stops}`);
}, () => fixture("adj.md", "**a *b***\n"));

test("Alt+Down moves a list item", async (s) => {
  await ready(s);
  await press(s, CTRL, HOME);
  await press(s, ALT, "");
  await expectMd(s, "- two\n- one\n");
}, () => fixture("move.md", "- one\n- two\n"));

test("R-4 escape on a continuation line, live (and R-9)", async (s) => {
  await ready(s);
  await press(s, CTRL, END);
  await press(s, SHIFT, ENTER);
  await typeText(s, "# b");
  await waitFor(() => s.exec("return document.querySelectorAll('#write p').length === 1 && !document.querySelector('#write h1')"), "still one paragraph");
  await expectMd(s, "a\n\\# b\n", "escaped");
  // R-9: delete the # (two Lefts from the end, then Backspace).
  await press(s, LEFT);
  await press(s, LEFT);
  await press(s, BACKSPACE);
  await expectMd(s, "a\n b\n", "escape removed with the #");
  await typeText(s, "#");
  await expectMd(s, "a\n\\# b\n", "escape back");
}, () => fixture("r4.md", "a\n"));

test("R-4 fence on the only line still triggers on Enter", async (s) => {
  await ready(s);
  await typeText(s, "```js");
  await press(s, ENTER);
  await waitFor(() => s.exec("return !!document.querySelector('#write pre.md-fences')"), "code block");
  await typeText(s, "x");
  await expectMd(s, "```js\nx\n```\n");
});

test("KB-1 (DOM part) copy and paste round-trip Markdown structure", async (s) => {
  await ready(s);
  await press(s, CTRL, "a");
  await press(s, CTRL, "c");
  await press(s, CTRL, END);
  await press(s, ENTER);
  await press(s, CTRL, "v");
  await expectMd(s, "a **bold** b\n\na **bold** b\n");
  await waitFor(() => s.exec("return document.querySelectorAll('#write strong').length === 2"), "two strong elements");
}, () => fixture("kb1.md", "a **bold** b\n"));

test("Mod+Shift+V pastes literally", async (s) => {
  await ready(s);
  await press(s, CTRL, "a");
  await press(s, CTRL, "c");
  await press(s, CTRL, END);
  await press(s, ENTER);
  await press(s, CTRL, SHIFT, "v");
  // The clipboard's text/plain is the Markdown source; pasted literally it shows the
  // asterisks as text.
  await expectMd(s, "a **bold** b\n\na \\*\\*bold\\*\\* b\n");
}, () => fixture("plain.md", "a **bold** b\n"));

test("E-12 Mod+K with a URL on the clipboard", async (s) => {
  await ready(s);
  // xclip forks a daemon that serves the selection; detach it fully.
  spawnSync("sh", ["-c", "printf 'https://a.b' | xclip -selection clipboard -i >/dev/null 2>&1 &"], { env: process.env, stdio: "ignore", timeout: 3000 });
  await sleep(300);
  await press(s, CTRL, HOME);
  for (let i = 0; i < 4; i++) await press(s, SHIFT, RIGHT);
  await press(s, CTRL, "k");
  await expectMd(s, "[site](https://a.b) x\n");
  const c = await cursor(s);
  if (c !== 19) throw new Error(`cursor ${c}, want 19 (after the link)`);
}, () => fixture("e12.md", "site x\n"));

test("E-13 Mod+click on [x](#heading-two) jumps to the heading", async (s) => {
  await ready(s);
  const [x, y] = await s.exec(
    "const a = document.querySelector('#write a'); const r = a.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]",
  );
  await s.cmd("POST", "/actions", {
    actions: [
      { type: "key", id: "kbd", actions: [{ type: "keyDown", value: CTRL }, { type: "pause", duration: 0 }, { type: "pause", duration: 0 }, { type: "pause", duration: 0 }, { type: "keyUp", value: CTRL }] },
      {
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: [{ type: "pause", duration: 0 }, { type: "pointerMove", x, y, origin: "viewport" }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }, { type: "pause", duration: 0 }],
      },
    ],
  });
  await s.cmd("DELETE", "/actions");
  await waitFor(() => ed(s, "return view.state.selection.$head.parent.type.name === 'heading' && view.state.selection.$head.parent.textContent === 'Heading Two'"), "cursor in Heading Two");
  const [top, height] = await s.exec("return [Math.round(document.getElementById('heading-two').getBoundingClientRect().top), innerHeight]");
  if (top < 0 || top > height - 30) throw new Error(`heading not scrolled into view (top ${top} of ${height})`);
}, () => fixture("e13.md", "See [x](#heading-two).\n\n" + "filler paragraph\n\n".repeat(60) + "## Heading Two\n\nend\n"));

test("D-2 emoji autocomplete: :smi lists smile; Enter inserts the shortcode", async (s) => {
  await ready(s);
  await typeText(s, "hi :smi");
  await waitFor(() => s.exec("const p = document.querySelector('.scrim-emoji-popup'); return !!p && !p.hidden && p.children.length > 0"), "popup");
  const items = await s.exec("return [...document.querySelector('.scrim-emoji-popup').children].map((c) => c.textContent)");
  if (!items.some((t) => /:smile:|\bsmile\b/.test(t))) throw new Error(`smile not listed: ${JSON.stringify(items)}`);
  await press(s, ENTER);
  await waitFor(async () => /^hi :smi[a-z_]*:\n$/.test(await md(s)), "shortcode inserted");
  await waitFor(() => s.exec("return !!document.querySelector('#write .md-emoji')"), "emoji rendered");
});

/** The text a reader sees in the first paragraph (hidden source characters left out). */
const shownText = (s) =>
  s.exec("const p = document.querySelector('#write p').cloneNode(true); p.querySelectorAll('.md-smart-src').forEach((e) => e.remove()); return p.textContent");

test("D-1 smart punctuation: curly quotes, en dash, ellipsis; source unchanged", async (s) => {
  await ready(s);
  await s.exec("window.__scrim.setSetting('smartPunctuation', true); return true");
  await waitFor(() => s.exec("return window.__scrim.editor.options.smartPunctuation === true"), "setting applied");
  await typeText(s, '"hi" -- ok...');
  await expectMd(s, '"hi" -- ok...\n');
  await waitFor(async () => (await shownText(s)) === "\u201chi\u201d \u2013 ok\u2026", "typographic display", 4000).catch(async () => {
    throw new Error(`displayed ${JSON.stringify(await shownText(s))}`);
  });
  await s.exec("window.__scrim.setSetting('smartPunctuation', false); return true");
  await waitFor(async () => (await shownText(s)) === '"hi" -- ok...', "plain display after turning it off");
});

test("D-3 inline math: on renders $x^2$, off shows it literally", async (s) => {
  await ready(s);
  await s.exec("window.__scrim.setSetting('inlineMath', true); return true");
  await waitFor(() => s.exec("return window.__scrim.editor.options.inlineMath === true"), "setting applied");
  await waitFor(() => s.exec("return !!document.querySelector('#write .md-inline-math .katex, #write .md-inline-math math')"), "math rendered");
  await s.exec("window.__scrim.setSetting('inlineMath', false); return true");
  await waitFor(() => s.exec("return !document.querySelector('#write .md-inline-math') && document.querySelector('#write p').textContent.includes('$x^2$')"), "literal text");
}, () => fixture("d3.md", "Area $x^2$ here.\n"));

test("02 subscript, superscript, highlight render when switched on", async (s) => {
  await ready(s);
  await s.exec("window.__scrim.setSetting('subscript', true); window.__scrim.setSetting('superscript', true); window.__scrim.setSetting('highlight', true); return true");
  await waitFor(() => s.exec("return !!document.querySelector('#write [md-inline=sub] sub') && !!document.querySelector('#write [md-inline=sup] sup') && !!document.querySelector('#write [md-inline=mark] mark')"), "sub, sup, mark elements");
  await s.exec("window.__scrim.setSetting('highlight', false); return true");
  await waitFor(() => s.exec("return !document.querySelector('#write mark') && !!document.querySelector('#write sub')"), "highlight off");
  await expectMd(s, "H~2~O, x^2^, ==hi==\n");
}, () => fixture("ext02.md", "H~2~O, x^2^, ==hi==\n"));

test("02 strict mode off: #Heading is a heading; typing #T makes one", async (s) => {
  await ready(s);
  await waitFor(() => s.exec("return document.querySelector('#write p')?.textContent.startsWith('#Heading')"), "paragraph while strict");
  await s.exec("window.__scrim.setSetting('strictMode', false); return true");
  await waitFor(() => s.exec("return document.querySelector('#write h1')?.textContent === 'Heading'"), "h1 when lenient");
  if (await s.exec("return window.__scrim.editor.isDirty()")) throw new Error("re-parsing made the document dirty");
  await ed(s, "view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.atEnd(view.state.doc)))");
  await press(s, ENTER);
  await typeText(s, "##Two");
  await waitFor(() => s.exec("return document.querySelector('#write h2')?.textContent === 'Two'"), "typed heading").catch(async (e) => {
    throw new Error(`${e.message}; markdown ${JSON.stringify(await md(s))}, html ${await s.exec("return document.querySelector('#write').innerHTML.slice(-300)")}`);
  });
  await expectMd(s, "#Heading\n\n##Two\n");
  await s.exec("window.__scrim.setSetting('strictMode', null); return true");
  await waitFor(() => s.exec("return !document.querySelector('#write h1') && document.querySelectorAll('#write p').length === 2"), "paragraphs again");
  await expectMd(s, "#Heading\n\n##Two\n");
}, () => fixture("strict.md", "#Heading\n"));

// E-14 needs a mid-range laptop with GPU compositing. Under Xvfb with software
// rendering, WebKit's layout of a 10,000-line document dominates, so the budget is
// reported, and enforced only with SCRIM_PERF_STRICT=1. Lines: SCRIM_E14_LINES.
const E14_LINES = Number(process.env.SCRIM_E14_LINES ?? 10000);
test(`E-14 typing latency on a ${E14_LINES}-line document (p95 < 16 ms)`, async (s) => {
  await waitFor(() => s.exec(`return !!window.__scrim && window.__scrim.editor.view.state.doc.childCount > ${E14_LINES / 10}`), "big doc loaded", 20000);
  await waitFor(() => s.exec("return window.__scrim.inlineKey.getState(window.__scrim.editor.view.state).pending === null"), "all decorations computed", 60000);
  // Comparison (Q-027): SCRIM_E14_WHOLE=1 renders the whole document, as before
  // viewport-only rendering.
  if (process.env.SCRIM_E14_WHOLE) {
    await s.exec("window.__scrim.viewport.config.forceOff = true; window.__scrim.viewport.setMode(false); return true");
    await sleep(3000);
  }
  // Threshold tuning: SCRIM_E14_VIEWPORT=1 renders viewport-only below the threshold too.
  if (process.env.SCRIM_E14_VIEWPORT) {
    await s.exec("window.__scrim.viewport.config.min = 0; window.__scrim.viewport.config.off = 0; window.__scrim.viewport.setMode(true); return true");
    await sleep(3000);
  }
  // Experiments: extra CSS for the run (SCRIM_E14_CSS).
  if (process.env.SCRIM_E14_CSS) await s.exec("const st = document.createElement('style'); st.textContent = " + JSON.stringify(process.env.SCRIM_E14_CSS) + "; document.head.appendChild(st); return true");
  // Cursor into the middle of a paragraph halfway down.
  await ed(s, `const doc = view.state.doc; let target = 0, seen = 0; doc.descendants((n, pos) => { if (target) return false; if (n.type.name === 'paragraph' && ++seen === Math.floor(doc.childCount / 4)) target = pos + 5; return !n.isTextblock; });
    const { TextSelection } = view.state.selection.constructor === undefined ? {} : {}; view.focus();
    view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(doc.resolve(target))).scrollIntoView());`);
  await s.exec("window.__keys = []; window.__upd = window.__scrim.recordUpdates(true); document.addEventListener('keydown', () => window.__keys.push(performance.now()), true);");
  const text = "the quick brown fox jumps over the lazy dog ".repeat(5).slice(0, 200);
  await typeText(s, text);
  await sleep(500);
  const lat = await s.exec(`const k = window.__keys, u = window.__upd; const out = []; let j = 0;
    for (const t of k) { while (j < u.length && u[j] < t) j++; if (j < u.length) out.push(u[j] - t); }
    return out;`);
  if (lat.length < 190) throw new Error(`only ${lat.length} measured keystrokes`);
  lat.sort((a, b) => a - b);
  const p95 = lat[Math.floor(lat.length * 0.95)];
  console.log(`     E-14: ${lat.length} keystrokes, median ${lat[lat.length >> 1].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
  if (p95 >= 16) {
    if (process.env.SCRIM_PERF_STRICT === "1") throw new Error(`p95 ${p95.toFixed(1)} ms`);
    console.log("     E-14: over budget; reported only (set SCRIM_PERF_STRICT=1 to enforce)");
  }
}, () => {
  spawnSync("node", [join(ROOT_DIR, "scripts/make-big-doc.mjs"), join(docs, "big.md"), String(E14_LINES)]);
  return join(docs, "big.md");
});

test("Q-012 links: URL title tooltip, pointer cursor while Mod is held", async (s) => {
  await ready(s);
  const title = await s.exec("return document.querySelector('#write a').title");
  if (title !== "https://example.com/x") throw new Error(`title ${JSON.stringify(title)}`);
  if (await s.exec("return document.querySelector('#write a').hasAttribute('href')")) throw new Error("a has href");
  const cur = () => s.exec("return getComputedStyle(document.querySelector('#write a')).cursor");
  if ((await cur()) === "pointer") throw new Error("pointer without Mod");
  await s.cmd("POST", "/actions", { actions: [{ type: "key", id: "kbd", actions: [{ type: "keyDown", value: CTRL }] }] });
  await waitFor(async () => (await cur()) === "pointer", "pointer cursor while Ctrl is down");
  await s.cmd("POST", "/actions", { actions: [{ type: "key", id: "kbd", actions: [{ type: "keyUp", value: CTRL }] }] });
  await waitFor(async () => (await cur()) !== "pointer", "text cursor after Ctrl is released");
}, () => fixture("q012.md", "A [link](https://example.com/x) here.\n"));
