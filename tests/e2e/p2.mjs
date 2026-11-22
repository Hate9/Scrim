// P2 acceptance tests (spec 20, "P2 Rich blocks" and the clipboard coverage tests).
import { CTRL, DOWN, END, ENTER, HOME, SHIFT, TAB, UP } from "./webdriver.mjs";
import { docs, ed, editorValue, fixture, join, readdirSync, readFileSync, sleep, spawnSync, test, typeText, waitFor } from "./harness.mjs";

const md = editorValue;
const expectMd = async (s, want, what = "markdown") => {
  try {
    await waitFor(async () => (await md(s)) === want, what, 4000);
  } catch {
    throw new Error(`${what}: got ${JSON.stringify(await md(s))}, want ${JSON.stringify(want)}`);
  }
};
const ready = (s) => waitFor(() => s.exec("return !!(window.__scrim && !document.body.classList.contains('scrim-loading') && window.__scrim.editor.view.state.doc)"), "editor");
const press = (s, ...keys) => s.chord(...keys);
const js = (s, body) => s.exec(body);
const clickAt = (s, [x, y]) =>
  s.cmd("POST", "/actions", {
    actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", x, y, origin: "viewport" }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }] }],
  });
const center = (s, sel) =>
  s.exec(`const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]`);
/** Put the ProseMirror cursor right after the first occurrence of `text`. */
const cursorAfter = (s, text) =>
  ed(s, `let at = -1; view.state.doc.descendants((n, p) => { if (at < 0 && n.isText && n.text.includes(${JSON.stringify(text)})) at = p + n.text.indexOf(${JSON.stringify(text)}) + ${text.length}; return at < 0; });
    view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(at))));`);
/** Set the X clipboard (xclip forks a daemon serving it; fully detached). */
const setClipboard = (type, file) =>
  spawnSync("sh", ["-c", `xclip -selection clipboard -t ${type} -i ${JSON.stringify(file)} >/dev/null 2>&1 &`], { stdio: "ignore", timeout: 3000 });

test("B-1 ```js⏎ makes a highlighted code block with the cursor inside", async (s) => {
  await ready(s);
  await ed(s, "view.focus()");
  await typeText(s, "```js");
  await press(s, ENTER);
  await waitFor(() => js(s, "return document.querySelector('#write pre.md-fences')?.getAttribute('lang') === 'js'"), "code block lang js");
  await waitFor(() => js(s, "return !!document.activeElement?.closest('.cm-content')"), "cursor in the code");
  await typeText(s, "const x = 1");
  await waitFor(() => js(s, "return document.querySelector('#write .cm-keyword')?.textContent === 'const'"), "cm-keyword on const");
  await expectMd(s, "```js\nconst x = 1\n```\n");
});

test("B-2 arrows leave and enter code blocks", async (s) => {
  await ready(s);
  await cursorAfter(s, "b"); // last code line
  await waitFor(() => js(s, "return !!document.activeElement?.closest('.cm-content')"), "in code");
  await press(s, DOWN);
  await waitFor(() => ed(s, "return view.hasFocus() && view.state.selection.$head.parent.textContent === 'para'"), "in the paragraph below");
  await press(s, UP);
  await waitFor(() => js(s, "return !!document.activeElement?.closest('.cm-content')"), "back in code");
  await typeText(s, "!");
  await expectMd(s, "```\na\nb!\n```\n\npara\n");
}, () => fixture("b2.md", "```\na\nb\n```\n\npara\n"));

test("B-3 math block: rendered outside, source editor on click", async (s) => {
  await ready(s);
  await ed(s, "view.focus()");
  await typeText(s, "$$");
  await press(s, ENTER);
  await typeText(s, "E=mc^2");
  await press(s, DOWN); // leaves the block; a paragraph is created after it
  await waitFor(() => js(s, "return !!document.querySelector('#write .md-math-block .math-display .katex')"), "rendered formula");
  await waitFor(() => js(s, "return !document.querySelector('#write .md-math-block.md-editing')"), "editor closed");
  await clickAt(s, await center(s, "#write .math-display"));
  await waitFor(() => js(s, "return !!document.querySelector('#write .md-math-block.md-editing .md-math-source .cm-content')"), "source editor shown");
  await expectMd(s, "$$\nE=mc^2\n$$\n");
});

test("B-4/B-5 table from |a|b|⏎, toolbar alignment", async (s) => {
  await ready(s);
  await ed(s, "view.focus()");
  await typeText(s, "|a|b|");
  await press(s, ENTER);
  await waitFor(() => js(s, "return document.querySelectorAll('#write figure.md-table-fig thead th').length === 2"), "2-column table");
  await typeText(s, "1");
  await press(s, TAB);
  await typeText(s, "2");
  await waitFor(() => js(s, "const t = document.querySelector('.md-table-toolbar'); return !!t && !t.hidden"), "toolbar shown");
  await clickAt(s, await center(s, ".md-table-toolbar .md-table-align-center"));
  await expectMd(s, "| a   |  b  |\n| --- | :-: |\n| 1   |  2  |\n");
});

test("B-6 paste a PNG into a saved document → ./assets", async (s, file) => {
  await ready(s);
  const png = join(process.cwd(), "src-tauri/icons/32x32.png");
  setClipboard("image/png", png);
  await sleep(300);
  await press(s, CTRL, END);
  await press(s, CTRL, "v");
  await waitFor(async () => /^text!\[\]\(assets\/image-\d{17}\.png\)\n$/.test(await md(s)), "image source", 6000);
  const name = /assets\/(image-\d{17}\.png)/.exec(await md(s))[1];
  if (!readdirSync(join(docs, "assets")).includes(name)) throw new Error("file not in assets/");
  await waitFor(() => js(s, "return (document.querySelector('#write .md-image img')?.naturalWidth ?? 0) > 0"), "image visible");
  void file;
}, () => fixture("b6.md", "text\n"));

test("B-6b a loaded image keeps its markers collapsed (wrapper mark survives the load)", async (s) => {
  await ready(s);
  await press(s, CTRL, END);
  await waitFor(() => js(s, "return [...document.querySelectorAll('#write .md-image img')].every((i) => i.complete && i.naturalWidth > 0)"), "images loaded");
  await sleep(400);
  // Collapsed markers take no space (font-size 0, 03 3.2), which only works inside the
  // element's wrapper.
  const loose = await js(s, "return [...document.querySelectorAll('#write > p > .md-meta, #write > p > .md-hide')].length");
  if (loose) throw new Error(`${loose} image marker(s) outside their wrapper`);
  const sizes = await js(s, "return [...document.querySelectorAll('#write .md-image > .md-meta, #write .md-image > .md-plain')].map((e) => getComputedStyle(e).fontSize)");
  if (!sizes.length || sizes.some((f) => f !== "0px")) throw new Error(`markers shown: ${sizes}`);
}, () => {
  const f = fixture("b6b.md", "![alt](pic.png)\n\na ![x](pic.png) b\n\nend\n");
  spawnSync("cp", [join(process.cwd(), "src-tauri/icons/32x32.png"), join(docs, "pic.png")]);
  return f;
});

test("B-7 task checkbox toggles without moving the cursor; undo reverts", async (s) => {
  await ready(s);
  await cursorAfter(s, "two");
  const before = await ed(s, "return view.state.selection.head");
  await clickAt(s, await center(s, "#write li .md-task-checkbox"));
  await expectMd(s, "- [x] one\n- [ ] two\n", "checked");
  if ((await ed(s, "return view.state.selection.head")) !== before) throw new Error("cursor moved");
  await press(s, CTRL, "z");
  await expectMd(s, "- [ ] one\n- [ ] two\n", "undone");
}, () => fixture("b7.md", "- [ ] one\n- [ ] two\n"));

test("B-8 [toc]⏎ lists headings and follows edits", async (s) => {
  await ready(s);
  await cursorAfter(s, "Intro");
  await press(s, ENTER);
  await typeText(s, "[toc]");
  await press(s, ENTER);
  const entries = () => js(s, "return [...document.querySelectorAll('#write .md-toc a.md-toc-inner')].map(a => a.textContent).join('|')");
  await waitFor(async () => (await entries()) === "One|Two|Three", "three entries");
  await cursorAfter(s, "Two");
  await typeText(s, "!");
  const t0 = Date.now();
  await waitFor(async () => (await entries()) === "One|Two!|Three", "updated entry");
  if (Date.now() - t0 > 300 + 200) throw new Error(`TOC update took ${Date.now() - t0} ms`);
}, () => fixture("b8.md", "Intro\n\n# One\n\n## Two\n\n## Three\n"));

test("B-9 hovering a footnote reference shows the definition", async (s) => {
  await ready(s);
  const [x, y] = await center(s, "#write .md-inline-footnote");
  await s.cmd("POST", "/actions", { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", x, y, origin: "viewport" }] }] });
  await waitFor(() => js(s, "const p = document.querySelector('.md-footnote-popover'); return !!p && !p.hidden && p.textContent.includes('The definition')"), "popover");
}, () => fixture("b9.md", "Text[^1] here.\n\n[^1]: The definition text.\n"));

test("B-10 HTML block renders, shows source on click, never runs scripts", async (s) => {
  await ready(s);
  await waitFor(() => js(s, "const d = document.querySelector('#write .md-htmlblock-container div'); return !!d && getComputedStyle(d).color === 'rgb(255, 0, 0)'"), "red hi");
  if (await js(s, "return window.__pwned === 1")) throw new Error("script ran");
  await clickAt(s, await center(s, "#write .md-htmlblock-container"));
  await waitFor(() => js(s, "return !!document.querySelector('#write .md-htmlblock.md-editing .cm-content')"), "source editor");
}, () => fixture("b10.md", '<div style="color:red">hi</div>\n<script>window.__pwned = 1</script>\n\nafter\n'));

test("B-11 front matter title → window title", async (s) => {
  await ready(s);
  await waitFor(async () => (await s.title()) === "X - Scrim", "title X - Scrim (QA-LOG Q-013 interim)");
}, () => fixture("b11.md", "---\ntitle: X\n---\n\nbody\n"));

test("C-3 paste HTML from a browser page", async (s) => {
  await ready(s);
  const html = join(docs, "c3.html");
  spawnSync("sh", ["-c", `printf '%s' '<h2>Head</h2><p>A <b>bold</b> word and <a href="https://a.b/">link</a>.</p><table><tr><th>x</th><th>y</th></tr><tr><td>1</td><td>2</td></tr></table>' > ${JSON.stringify(html)}`]);
  setClipboard("text/html", html);
  await sleep(300);
  await ed(s, "view.focus()");
  await press(s, CTRL, "v");
  await waitFor(async () => {
    const m = await md(s);
    return m.includes("## Head") && m.includes("**bold**") && m.includes("[link](https://a.b/)") && /\| x +\| y +\|/.test(m);
  }, "heading, bold, link, table");
});

test("C-4 TSV grid pasted outside a table creates a table", async (s) => {
  await ready(s);
  const tsv = join(docs, "c4.tsv");
  spawnSync("sh", ["-c", `printf 'a\\tb\\tc\\n1\\t2\\t3\\n' > ${JSON.stringify(tsv)}`]);
  setClipboard("text/plain", tsv);
  await sleep(300);
  await ed(s, "view.focus()");
  await press(s, CTRL, "v");
  await waitFor(() => js(s, "return document.querySelectorAll('#write table th').length === 3 && document.querySelectorAll('#write table td').length === 3"), "3×2 table");
});

test("D-4 insert footnote", async (s) => {
  await ready(s);
  await cursorAfter(s, "Text");
  await js(s, "window.__scrim.command('format.footnote')");
  await typeText(s, "note");
  await expectMd(s, "Text[^1] here.\n\n[^1]: note\n");
  await press(s, ""); // Escape: back to the reference
  await waitFor(() => ed(s, "return view.state.selection.$head.parent.textContent.startsWith('Text')"), "back at the reference");
}, () => fixture("d4.md", "Text here.\n"));

test("C-6 drag a selected word to another paragraph (pointer drag, one undo step)", async (s) => {
  await ready(s);
  // Select "beta" in the first paragraph.
  await ed(s, `let at = -1; view.state.doc.descendants((n, p) => { if (at < 0 && n.isText && n.text.includes('beta')) at = p + n.text.indexOf('beta'); return at < 0; });
    view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, at, at + 4)));`);
  const [x0, y0] = await ed(s, "const c = view.coordsAtPos(view.state.selection.from + 1); return [Math.round(c.left + 2), Math.round((c.top + c.bottom) / 2)]");
  const [x1, y1] = await ed(s, `let at = -1; view.state.doc.descendants((n, p) => { if (at < 0 && n.isText && n.text.includes('second')) at = p + n.text.indexOf('second') + 6; return at < 0; });
    const c = view.coordsAtPos(at); return [Math.round(c.left), Math.round((c.top + c.bottom) / 2)]`);
  await s.cmd("POST", "/actions", {
    actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", x: x0, y: y0, origin: "viewport" }, { type: "pointerDown", button: 0 },
      { type: "pointerMove", x: x0 + 10, y: y0, origin: "viewport", duration: 50 },
      { type: "pointerMove", x: x1, y: y1, origin: "viewport", duration: 100 },
      { type: "pointerUp", button: 0 }] }],
  });
  await expectMd(s, "alpha  gamma\n\nsecondbeta\n", "moved");
  await press(s, CTRL, "z");
  await expectMd(s, "alpha beta gamma\n\nsecond\n", "one undo restores");
}, () => fixture("c6.md", "alpha beta gamma\n\nsecond\n"));

test("Q-015 iframes go through scrim-embed; the setting re-renders immediately", async (s) => {
  await ready(s);
  const src = () => js(s, "return document.querySelector('#write .md-htmlblock-container iframe')?.getAttribute('src') ?? null");
  await waitFor(async () => (await src())?.startsWith("scrim-embed://localhost/?src=https%3A%2F%2F127.0.0.1%3A9%2F"), "wrapper URL");
  await js(s, "document.querySelector('#write .md-htmlblock-container iframe').__old = true");
  await js(s, "window.__scrim.setSetting('allowIframes', true)");
  await waitFor(() => js(s, "const f = document.querySelector('#write .md-htmlblock-container iframe'); return !!f && !f.__old"), "re-rendered after the change");
  await js(s, "window.__scrim.setSetting('allowIframes', null)");
}, () => fixture("q015.md", '<iframe src="https://127.0.0.1:9/" width="300" height="80" onload="x()"></iframe>\n\nafter\n'));
