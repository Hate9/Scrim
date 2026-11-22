// P7 acceptance tests (spec 20, "P7 Personal features").
import { ALT, CTRL, ENTER } from "./webdriver.mjs";
import { editorValue, existsSync, fixture, join, readFileSync, saveAsFile, sleep, test, typeText, waitFor, work, writeFileSync } from "./harness.mjs";
import { mkdirSync, rmSync, statSync } from "node:fs";

const js = (s, body) => s.exec(body);
const ed = (s, body) => s.exec(`const view = window.__scrim.editor.view; ${body}`);
const ready = (s) => waitFor(() => s.exec("return !!(window.__scrim && window.__scrim.editor.view.state.doc && window.__scrim.themes.loaded && window.__scrim.local)"), "editor");
const localFile = () => join(process.env.SCRIM_CONFIG_DIR, "local.json");
/** Write local.json before the app starts; tests clear it when they end. */
const withLocal = (local, file) => () => {
  writeFileSync(localFile(), JSON.stringify({ snippets: [], customHTMLTags: { inline: [], block: [] }, pickerKey: "Ctrl+Alt+Space", ...local }));
  return file();
};
const clearLocal = () => writeFileSync(localFile(), JSON.stringify({ snippets: [], customHTMLTags: { inline: [], block: [] }, pickerKey: "Ctrl+Alt+Space" }));
const snippetsLoaded = (s, n) => waitFor(() => js(s, `return window.__scrim.local.data.snippets.length === ${n} && window.__scrim.dispatcher.byId.has('snippet.${n - 1}')`), "snippets loaded");
/** Select the text between the first occurrence of `a` (after it) and `b` (before it). */
const selectText = (s, text) =>
  ed(s, `let f = -1; view.state.doc.descendants((n, p) => { if (f < 0 && n.isText) { const i = n.text.indexOf(${JSON.stringify(text)}); if (i >= 0) f = p + i; } return f < 0; });
    view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, f, f + ${text.length}))); return f`);
const cursorAtEnd = (s) => ed(s, "view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(view.state.doc.content.size - 1)))); return true");
const selectedText = (s) => ed(s, "const { from, to } = view.state.selection; return view.state.doc.textBetween(from, to)");
const bottom = { name: "Bottom", key: "", body: "<bottom>$0</bottom>" };

test("K-1 <bottom>$0</bottom> with no selection; typing goes inside", async (s) => {
  try {
    await ready(s);
    await snippetsLoaded(s, 1);
    await cursorAtEnd(s);
    await js(s, "window.__scrim.command('snippet.0'); return true");
    await waitFor(async () => (await editorValue(s)) === "a<bottom></bottom>\n", "inserted");
    await typeText(s, "x");
    await waitFor(async () => (await editorValue(s)) === "a<bottom>x</bottom>\n", "typed inside");
  } finally {
    clearLocal();
  }
}, withLocal({ snippets: [bottom] }, () => fixture("k1.md", "a\n")));

test("K-2 selection goes inside and stays selected; one undo step", async (s) => {
  try {
    await ready(s);
    await snippetsLoaded(s, 1);
    await selectText(s, "hello");
    await js(s, "window.__scrim.command('snippet.0'); return true");
    await waitFor(async () => (await editorValue(s)) === "say <bottom>hello</bottom> now\n", "wrapped");
    if ((await selectedText(s)) !== "hello") throw new Error(`selected: ${await selectedText(s)}`);
    await s.chord(CTRL, "z");
    await waitFor(async () => (await editorValue(s)) === "say hello now\n", "undone in one step");
  } finally {
    clearLocal();
  }
}, withLocal({ snippets: [bottom] }, () => fixture("k2.md", "say hello now\n")));

test("K-3 / K-10 body escapes: $$5 and $0 more; $$0; $$$0", async (s) => {
  try {
    await ready(s);
    await snippetsLoaded(s, 3);
    await cursorAtEnd(s);
    await js(s, "window.__scrim.command('snippet.0'); return true");
    await typeText(s, "X");
    await waitFor(async () => (await editorValue(s)) === "$5 and X more\n", "K-3");
    await cursorAtEnd(s);
    await js(s, "window.__scrim.command('snippet.1'); return true");
    await typeText(s, "Y");
    await waitFor(async () => (await editorValue(s)) === "$5 and X more$0Y\n", "K-10 $$0: literal, cursor after");
    await js(s, "window.__scrim.command('snippet.2'); return true");
    await typeText(s, "Z");
    await waitFor(async () => (await editorValue(s)) === "$5 and X more$0Y$Z\n", "K-10 $$$0: $ then the cursor");
  } finally {
    clearLocal();
  }
}, withLocal({ snippets: [{ name: "a", key: "", body: "$$5 and $0 more" }, { name: "b", key: "", body: "$$0" }, { name: "c", key: "", body: "$$$0" }] }, () => fixture("k3.md", "\n")));

test("K-4 picker: \"rd\" shows only Red span; Enter inserts at the saved selection", async (s) => {
  try {
    await ready(s);
    await snippetsLoaded(s, 3);
    await selectText(s, "word");
    await s.chord(CTRL, ALT, " ");
    await waitFor(() => js(s, "return document.activeElement?.classList.contains('scrim-snippet-input')"), "picker open");
    await typeText(s, "rd");
    const rows = await js(s, "return [...document.querySelectorAll('.scrim-snippet-row .scrim-snippet-name')].map((e) => e.textContent)");
    if (JSON.stringify(rows) !== '["Red span"]') throw new Error(`rows: ${rows}`);
    await s.chord(ENTER);
    await waitFor(async () => (await editorValue(s)) === 'a <span style="color:red">word</span> b\n', "inserted at the saved selection");
  } finally {
    clearLocal();
  }
}, withLocal({ snippets: [bottom, { name: "Red span", key: "", body: '<span style="color:red">$0</span>' }, { name: "Price", key: "", body: "$$$0" }] }, () => fixture("k4.md", "a word b\n")));

test("K-5 / KB-3 shortcut captured in Customize works at once; Ctrl+B shows the conflict", async (s) => {
  try {
    await ready(s);
    await snippetsLoaded(s, 1);
    await js(s, "window.__scrim.preferences.open('customize'); return true");
    await waitFor(() => js(s, "return !!document.querySelector('.scrim-cz-card .scrim-shortcut-field')"), "snippet card");
    await waitFor(() => js(s, "const f = document.querySelector('.scrim-cz-card .scrim-shortcut-field'); f.focus(); return document.activeElement === f"), "shortcut field focused");
    await sleep(300);
    await s.chord(CTRL, "b");
    await waitFor(() => js(s, "return document.querySelector('.scrim-cz-card .scrim-shortcut-field').value === 'Ctrl+B'"), "captured Ctrl+B");
    const warn = await js(s, "return document.querySelector('.scrim-cz-card .scrim-cz-warn').textContent");
    if (!warn.includes("Also used by: Format → Strong")) throw new Error(`warning: ${warn}`);
    if ((await editorValue(s)) !== "text\n") throw new Error("the shortcut ran while being captured");
    await waitFor(() => js(s, "return window.__scrim.dispatcher.keyOf('snippet.0') === 'Ctrl+B'"), "saved and bound");
    await js(s, "window.__scrim.preferences.close(); return true");
    await cursorAtEnd(s);
    await s.chord(CTRL, "b");
    await waitFor(async () => (await editorValue(s)) === "text<bottom></bottom>\n", "the snippet wins over Strong");
  } finally {
    clearLocal();
  }
}, withLocal({ snippets: [bottom] }, () => fixture("k5.md", "text\n")));

test("K-6 inline tag: registered → element styled by base.user.css in editor and export; unregistered → text", async (s) => {
  const css = join(process.env.SCRIM_CONFIG_DIR, "themes", "base.user.css");
  writeFileSync(css, "bottom { color: rgb(0, 128, 0); }\n");
  try {
    await ready(s);
    await waitFor(() => js(s, "const b = document.querySelector('#write bottom'); return !!b && getComputedStyle(b).color === 'rgb(0, 128, 0)'"), "green <bottom> element");
    const out = join(work, "k6.html");
    rmSync(out, { force: true });
    writeFileSync(saveAsFile, out);
    await js(s, "window.__scrim.command('file.exportHtml'); return true");
    await waitFor(() => existsSync(out) && statSync(out).size > 0, "export");
    await sleep(300);
    const html = readFileSync(out, "utf8");
    if (!/<bottom>[\s\S]*x[\s\S]*<\/bottom>/.test(html) || !html.includes("bottom { color: rgb(0, 128, 0); }")) throw new Error("export lacks the element or its CSS");
    await js(s, "const d = window.__scrim.local.data; return window.__scrim.local.save({ ...d, customHTMLTags: { inline: [], block: [] } }).then(() => true)");
    await waitFor(() => js(s, "return !document.querySelector('#write bottom')"), "literal text again");
    if ((await editorValue(s)) !== "a <bottom>x</bottom> b\n") throw new Error("source changed");
  } finally {
    writeFileSync(css, "");
    clearLocal();
  }
}, withLocal({ customHTMLTags: { inline: ["bottom"], block: [] } }, () => fixture("k6.md", "a <bottom>x</bottom> b\n")));

test("K-7 block tag: <callout>hi</callout> becomes an HTML block", async (s) => {
  try {
    await ready(s);
    await waitFor(() => js(s, "return !!document.querySelector('#write .md-htmlblock callout')"), "HTML block with the element");
    if (!(await ed(s, "return view.state.doc.firstChild.type.name === 'html_block'"))) throw new Error("not an html_block");
  } finally {
    clearLocal();
  }
}, withLocal({ customHTMLTags: { inline: [], block: ["callout"] } }, () => fixture("k7.md", "<callout>hi</callout>\n\nafter\n")));

test("K-8 config.jsonc tab refuses invalid JSONC with line and column; file unchanged", async (s) => {
  const cfg = join(process.env.SCRIM_CONFIG_DIR, "config.jsonc");
  const before = readFileSync(cfg, "utf8");
  await ready(s);
  await js(s, "window.__scrim.preferences.open('customize'); return true");
  await waitFor(() => js(s, "return [...document.querySelectorAll('.scrim-cz-tab')].some((t) => t.textContent.startsWith('config.jsonc'))"), "tabs");
  await js(s, "[...document.querySelectorAll('.scrim-cz-tab')].find((t) => t.textContent.startsWith('config.jsonc')).click(); return true");
  await waitFor(() => js(s, "return !!document.querySelector('.scrim-cz-file .cm-editor')"), "editor");
  await js(s, "const v = window.__scrim.cmFind(document.querySelector('.scrim-cz-file .cm-editor')); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '{ broken: [ }' } }); return true");
  await js(s, "[...document.querySelectorAll('.scrim-cz-file .scrim-preferences-button')].find((b) => b.textContent === 'Save').click(); return true");
  await waitFor(() => js(s, "const e = document.querySelector('.scrim-cz-file:not([hidden]) .scrim-cz-error'); return !!e && !e.hidden && /line \\d+ column \\d+/.test(e.textContent)"), "error with line and column");
  const status = await js(s, "return document.querySelector('.scrim-cz-status').textContent");
  if (status !== "Not saved: invalid config") throw new Error(`status: ${status}`);
  if (readFileSync(cfg, "utf8") !== before) throw new Error("file changed");
}, () => fixture("k8.md", "x\n"));

test("K-9 unregistered <yuki> in a body warns; Add as inline registers it", async (s) => {
  try {
    await ready(s);
    await snippetsLoaded(s, 1);
    await js(s, "window.__scrim.preferences.open('customize'); return true");
    await waitFor(() => js(s, "return (document.querySelector('.scrim-cz-card .scrim-cz-warn')?.textContent ?? '').includes('<yuki> isn\\'t a registered custom tag')"), "warning");
    await js(s, "[...document.querySelectorAll('.scrim-cz-card .scrim-preferences-button')].find((b) => b.textContent === 'Add as inline').click(); return true");
    await waitFor(() => js(s, "return !(document.querySelector('.scrim-cz-card .scrim-cz-warn')?.textContent ?? '').includes('yuki')"), "warning gone");
    await waitFor(() => readFileSync(localFile(), "utf8").includes('"yuki"'), "registered in local.json");
  } finally {
    clearLocal();
  }
}, withLocal({ snippets: [{ name: "Yuki", key: "", body: "<yuki>$0</yuki>" }] }, () => fixture("k9.md", "x\n")));

test("K-11 inline snippet over two paragraphs wraps each part", async (s) => {
  try {
    await ready(s);
    await snippetsLoaded(s, 1);
    await ed(s, `let a = -1, b = -1; view.state.doc.descendants((n, p) => { if (n.isText) { const i = n.text.indexOf('two'); if (i >= 0 && a < 0) a = p + i; const j = n.text.indexOf('three'); if (j >= 0) b = p + j + 5; } return true; });
      view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, a, b))); return true`);
    await js(s, "window.__scrim.command('snippet.0'); return true");
    await waitFor(async () => (await editorValue(s)) === "one <bottom>two</bottom>\n\n<bottom>three</bottom> four\n", "each paragraph wrapped");
  } finally {
    clearLocal();
  }
}, withLocal({ snippets: [bottom] }, () => fixture("k11.md", "one two\n\nthree four\n")));

test("K-12 registering script or iframe is refused as a standard HTML element", async (s) => {
  try {
    await ready(s);
    await js(s, "window.__scrim.preferences.open('customize'); return true");
    await waitFor(() => js(s, "return !!document.querySelector('.scrim-cz-tags-inline')"), "tag field");
    await js(s, "const f = document.querySelector('.scrim-cz-tags-inline'); f.value = 'script, iframe, good-tag'; f.dispatchEvent(new Event('input', { bubbles: true })); return true");
    const warn = await js(s, "return document.querySelector('.scrim-cz-tags-inline').closest('.scrim-cz-tagrow').nextElementSibling.textContent");
    if (!warn.includes("Ignored (standard HTML element): script") || !warn.includes("Ignored (standard HTML element): iframe")) throw new Error(`warning: ${warn}`);
    await waitFor(() => readFileSync(localFile(), "utf8").includes('"good-tag"'), "valid name saved");
    if (readFileSync(localFile(), "utf8").includes('"script"')) throw new Error("script registered");
  } finally {
    clearLocal();
  }
}, withLocal({}, () => fixture("k12.md", "x\n")));
void mkdirSync;
