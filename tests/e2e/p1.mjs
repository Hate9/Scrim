// P1 acceptance tests (spec 20, "P1 Core editing" and the round-trip tests that need
// the live editor). Each test starts the app on a fixture or an untitled document.
import { ALT, BACKSPACE, CTRL, END, ENTER, HOME, LEFT, RIGHT, SHIFT, TAB } from "./webdriver.mjs";
import { ed, editorValue, fixture, sleep, spawnSync, test, typeText, waitFor } from "./harness.mjs";

const md = editorValue;
const expectMd = async (s, want, what = "markdown") => {
  try {
    await waitFor(async () => (await md(s)) === want, what, 3000);
  } catch {
    throw new Error(`${what}: got ${JSON.stringify(await md(s))}, want ${JSON.stringify(want)}`);
  }
};
const ready = (s) => waitFor(() => s.exec("return !!(window.__scrim && window.__scrim.editor.view.hasFocus())"), "editor focused");
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
      `const t = document.querySelector('#write strong').firstChild; const r = document.createRange(); r.setStart(t, ${offset}); r.setEnd(t, ${offset}); const b = r.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top + b.height / 2)]`,
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
  await waitFor(() => s.exec("return !!document.querySelector('#write pre.md-raw-code')"), "code block");
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
