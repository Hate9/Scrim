// P3 acceptance tests (spec 20, "P3 Workspace", plus E-18, E-19, D-6, D-7).
import { CTRL, END, ENTER, ESCAPE, F2, F3, F5, F8, F9, SHIFT } from "./webdriver.mjs";
import { Session } from "./webdriver.mjs";
import {
  APP, docs, ed, editorValue, existsSync, fixture, join, readFileSync, saveAsFile, sleep, spawnSync, test, typeText, waitFor, work, writeFileSync,
} from "./harness.mjs";

const md = editorValue;
const ready = (s) => waitFor(() => s.exec("return !!(window.__scrim && !document.body.classList.contains('scrim-loading') && window.__scrim.editor.view.state.doc)"), "editor");
const js = (s, body) => s.exec(body);
const press = (s, ...keys) => s.chord(...keys);
const expectMd = async (s, want, what = "markdown") => {
  try {
    await waitFor(async () => (await md(s)) === want, what, 4000);
  } catch {
    throw new Error(`${what}: got ${JSON.stringify(await md(s))}, want ${JSON.stringify(want)}`);
  }
};
const click = (s, sel) => js(s, `const e = document.querySelector(${JSON.stringify(sel)}); e.dispatchEvent(new MouseEvent("mousedown", {bubbles: true})); e.click(); return true`);
/** A real pointer click on the first `sel` element whose text includes `text`. */
const clickText = async (s, sel, text) => {
  const at = await js(s, `const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)}));
    if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return [Math.round(r.left + Math.min(r.width / 2, 60)), Math.round(r.top + r.height / 2)]`);
  if (!at) return false;
  await s.cmd("POST", "/actions", {
    actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", x: at[0], y: at[1], origin: "viewport" }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }] }],
  });
  return true;
};
const cursorAfter = async (s, text) => {
  await waitFor(() => md(s).then((m) => m.includes(text)), `document with ${JSON.stringify(text)}`);
  return cursorAfter0(s, text);
};
const cursorAfter0 = (s, text) =>
  ed(s, `let at = -1; view.state.doc.descendants((n, p) => { if (at < 0 && n.isText && n.text.includes(${JSON.stringify(text)})) at = p + n.text.indexOf(${JSON.stringify(text)}) + ${text.length}; return at < 0; });
    view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(at))));`);
const cursorText = (s) => ed(s, "const $h = view.state.selection.$head; return $h.parent.textContent.slice(0, $h.parentOffset)");
const docPath = (s) => s.exec("return window.__TAURI_INTERNALS__.invoke('doc_init').then((d) => d.path)");
const mkFolder = (name, files) => {
  const root = join(docs, name);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    spawnSync("mkdir", ["-p", p.slice(0, p.lastIndexOf("/"))]);
    writeFileSync(p, text);
  }
  return root;
};

test("W-1 open folder with 3 nested .md files: tree shows them; clicking opens", async (s) => {
  await ready(s);
  await waitFor(() => js(s, "return !document.getElementById('scrim-sidebar').hidden"), "sidebar shown");
  await waitFor(() => js(s, "return [...document.querySelectorAll('#file-library .file-tree-node')].some((r) => r.textContent.includes('sub'))"), "folder row");
  await clickText(s, "#file-library .file-tree-node", "sub");
  await waitFor(() => clickText(s, "#file-library .file-tree-node", "deep"), "expand sub");
  await waitFor(() => js(s, "return [...document.querySelectorAll('#file-library .file-tree-node')].some((r) => r.textContent.includes('nested.md'))"), "nested.md row");
  const names = await js(s, "return [...document.querySelectorAll('#file-library .file-tree-node')].map((r) => r.textContent)");
  for (const n of ["a.md", "b.md", "nested.md"]) if (!names.some((x) => x.includes(n))) throw new Error(`tree lacks ${n}: ${names}`);
  if (names.some((x) => x.includes("skip.png"))) throw new Error("non-Markdown file shown");
  await clickText(s, "#file-library .file-tree-node", "nested.md");
  await waitFor(async () => (await md(s)) === "# Nested\n", "nested.md opened");
  await waitFor(() => js(s, "return document.querySelector('#file-library .file-tree-node.active')?.textContent.includes('nested.md')"), "active row");
}, () => mkFolder("w1", { "a.md": "a\n", "sub/b.md": "b\n", "sub/deep/nested.md": "# Nested\n", "skip.png": "x" }));

test("W-2 F2 renames the open file on disk; the document follows", async (s, file) => {
  await ready(s);
  await js(s, "window.__scrim.sidebar.toggle(true); return true");
  await waitFor(() => js(s, "return !!document.querySelector('#file-library .file-tree-node.active')"), "current file row");
  await press(s, F2);
  await waitFor(() => js(s, "return document.activeElement?.classList.contains('scrim-inline-rename')"), "rename field");
  await js(s, "const i = document.activeElement; i.value = 'renamed.md'; return true");
  await press(s, ENTER);
  const target = join(docs, "w2", "renamed.md");
  await waitFor(() => existsSync(target) && !existsSync(file), "renamed on disk");
  await waitFor(async () => (await s.title()).startsWith("renamed.md"), "title follows").catch(async (e) => {
    const log = readFileSync(join(process.env.SCRIM_CONFIG_DIR, "app.log"), "utf8").trim().split("\n").slice(-6).join(" | ");
    throw new Error(`${e.message}: title ${JSON.stringify(await s.title())}, notice ${JSON.stringify(await js(s, "return document.getElementById('notice').hidden ? null : document.getElementById('notice-text').textContent"))}; log: ${log}`);
  });
  await ed(s, "view.focus()");
  await press(s, CTRL, END);
  await typeText(s, "!");
  await press(s, CTRL, "s");
  await waitFor(() => readFileSync(target, "utf8") === "hello!\n", "saves to the new path");
}, () => (mkFolder("w2", { "old.md": "hello\n" }), join(docs, "w2", "old.md")));

test("W-3 external edit to a clean file reloads within 1 s, cursor kept", async (s, file) => {
  await ready(s);
  await cursorAfter(s, "second l");
  await sleep(300);
  const t0 = Date.now();
  writeFileSync(file, "first line\n\nsecond line\n\nadded below\n");
  await waitFor(async () => (await md(s)) === "first line\n\nsecond line\n\nadded below\n", "reloaded", 3000);
  const dt = Date.now() - t0;
  if (dt > 1000) throw new Error(`reload took ${dt} ms`);
  const before = await cursorText(s);
  if (before !== "second l") throw new Error(`cursor moved: before it "${before}"`);
  if (await js(s, "return document.title.includes('•')")) throw new Error("dirty after silent reload");
  await press(s, CTRL, "z");
  await expectMd(s, "first line\n\nsecond line\n", "reload is undoable");
}, () => fixture("w3.md", "first line\n\nsecond line\n"));

test("W-4 external edit while dirty shows Reload / Keep mine", async (s, file) => {
  await ready(s);
  await cursorAfter(s, "mine");
  await typeText(s, "!");
  await sleep(200);
  writeFileSync(file, "theirs\n");
  await waitFor(() => js(s, "return !document.getElementById('notice').hidden && document.getElementById('notice-text').textContent.includes('changed on disk')"), "bar");
  const buttons = await js(s, "return [...document.querySelectorAll('#notice-buttons button')].map((b) => b.textContent)");
  if (JSON.stringify(buttons) !== '["Reload","Keep mine"]') throw new Error(`buttons ${buttons}`);
  await expectMd(s, "mine!\n", "local edits kept until a choice");
  await clickText(s, "#notice-buttons button", "Reload");
  await expectMd(s, "theirs\n", "reloaded");
  await press(s, CTRL, "z");
  await expectMd(s, "mine!\n", "reload undoable");
}, () => fixture("w4.md", "mine\n"));

test("W-5 a killed app's dirty untitled draft is offered at the next launch", async (s) => {
  await ready(s);
  // Drafts left by earlier tests' dirty windows would be offered too.
  spawnSync("sh", ["-c", `rm -rf ${join(process.env.SCRIM_CONFIG_DIR, "recovery")}/*.md ${join(process.env.SCRIM_CONFIG_DIR, "recovery")}/*.json`]);
  await ed(s, "view.focus()");
  await typeText(s, "draft text survives");
  await waitFor(async () => (await md(s)) === "draft text survives\n", "typed");
  await js(s, "window.__scrim.writeDraft(); return true"); // what the 30 s timer and blur do
  const rec = join(process.env.SCRIM_CONFIG_DIR, "recovery");
  await waitFor(() => spawnSync("sh", ["-c", `ls ${rec}/*.md`]).status === 0, "draft written");
  spawnSync("pkill", ["-KILL", "-f", `^${APP}`]);
  await waitFor(() => spawnSync("pgrep", ["-f", `^${APP}`]).status !== 0, "app gone");
  await s.delete().catch(() => {});
  const s2 = await Session.create("http://127.0.0.1:4444", APP, []);
  try {
    await ready(s2);
    await waitFor(() => js(s2, "return document.getElementById('notice-text').textContent.startsWith('Recovered 1 unsaved document')"), "recovery offered");
    await clickText(s2, "#notice-buttons button", "Show");
    await waitFor(() => js(s2, "return !!document.querySelector('.scrim-recovery-row')"), "list");
    await clickText(s2, ".scrim-recovery-row button", "Compare");
    await waitFor(() => js(s2, "return document.querySelector('.scrim-recovery-compare pre')?.textContent === 'draft text survives\\n'"), "draft text intact");
  } finally {
    await s2.delete();
    spawnSync("sh", ["-c", `rm -rf ${rec}`]);
  }
});

test("W-6 Mod+P 'nest' ranks nested.md first; Enter opens it", async (s) => {
  await ready(s);
  // Recent files from earlier tests (another nested.md) would rightly rank first.
  await js(s, "return window.__TAURI_INTERNALS__.invoke('recent_clear').then(() => true)");
  await waitFor(() => js(s, "return window.__scrim.sidebar.folder !== null"), "folder");
  await ed(s, "view.focus()");
  await press(s, CTRL, "p");
  await waitFor(() => js(s, "return document.activeElement?.classList.contains('scrim-quick-open-input')"), "quick open");
  const pos = await js(s, "const r = document.querySelector('.scrim-quick-open').getBoundingClientRect(); const c = document.querySelector('content').getBoundingClientRect(); return [r.left + r.width / 2 - (c.left + c.width / 2), r.width]");
  if (Math.abs(pos[0]) > 1 || pos[1] !== 420) throw new Error(`quick open geometry ${pos}`);
  await typeText(s, "nest");
  await waitFor(() => js(s, "return document.querySelector('.scrim-quick-open-item.active .scrim-quick-open-name')?.textContent === 'nested.md'"), "nested.md first");
  await press(s, ENTER);
  await waitFor(async () => (await md(s)) === "nested\n", "opened");
  await waitFor(() => js(s, "return document.querySelector('.scrim-quick-open').hidden"), "closed");
}, () => mkFolder("w6", { "notes.md": "n\n", "zzz/nested.md": "nested\n", "honest.md": "h\n" }));

test("W-7 search in a 10,000-file folder: first result < 500 ms; click selects the match", async (s) => {
  await ready(s);
  await waitFor(() => js(s, "return window.__scrim.sidebar.folder !== null"), "folder");
  await ed(s, "view.focus()");
  await press(s, CTRL, SHIFT, "f");
  await waitFor(() => js(s, "return document.activeElement?.classList.contains('scrim-search-input')"), "search field");
  await typeText(s, "needle");
  await press(s, ENTER);
  await waitFor(() => js(s, "return !!document.querySelector('.scrim-search-line')"), "results", 20000);
  const first = await js(s, "return window.__scrim.sidebar.firstResultMs");
  console.log(`     first result after ${first} ms`);
  if (!(first < 500) && !process.env.SCRIM_UNDER_TRACE) throw new Error(`first result after ${first} ms`);
  // Click once the search has finished: rows can move while results still stream in.
  await waitFor(() => js(s, "return !/Searching/.test(document.querySelector('.scrim-search-status').textContent)"), "search done", 30000);
  await clickText(s, ".scrim-search-line", "needle");
  await waitFor(() => ed(s, "const { from, to } = view.state.selection; return view.state.doc.textBetween(from, to) === 'needle'"), "match selected").catch(async (e) => {
    const st = await ed(s, "const { from, to } = view.state.selection; return JSON.stringify({ title: document.title, sel: [from, to, view.state.doc.textBetween(from, to)], doc: ed.markdown().slice(0, 60) })");
    throw new Error(`${e.message}: ${st}`);
  });
  if (!(await md(s)).includes("hay needle hay")) throw new Error("wrong file opened");
}, () => {
  const root = join(docs, "w7");
  spawnSync("python3", ["-c", `
import os
root = ${JSON.stringify(root)}
for d in range(100):
    os.makedirs(f"{root}/d{d:03}", exist_ok=True)
    for f in range(100):
        with open(f"{root}/d{d:03}/f{f:03}.md", "w") as fh:
            fh.write("# File\\n\\nplain words only\\n" if (d, f) != (57, 42) else "# Target\\n\\nhay needle hay\\n")
`]);
  return root;
});

test("W-8 find 'bold' matches **bo**ld; Replace All in **bold** gives **x**", async (s) => {
  await ready(s);
  await ed(s, "view.focus()");
  await press(s, CTRL, "f");
  await waitFor(() => js(s, "return document.activeElement?.classList.contains('scrim-find-input')"), "find field");
  await typeText(s, "bold");
  await waitFor(() => js(s, "return document.querySelector('.scrim-find-counter').textContent.endsWith('2')"), "2 matches").catch(async (e) => {
    throw new Error(`${e.message}: counter ${await js(s, "return document.querySelector('.scrim-find-counter').textContent + '|' + document.querySelector('.scrim-find-input').value")}; log ${readFileSync(join(process.env.SCRIM_CONFIG_DIR, "app.log"), "utf8").split("\n").filter((l) => l.includes("ERROR")).slice(-2)}`);
  });
  await waitFor(() => js(s, "return document.querySelectorAll('#write .md-search-hit, #write .md-search-select').length >= 2"), "hits highlighted");
  await press(s, ESCAPE);
  await ed(s, "view.focus()");
  await press(s, CTRL, "h");
  await waitFor(() => js(s, "return !document.querySelector('.scrim-replace-input').closest('[hidden]')"), "replace row");
  await js(s, "const r = document.querySelector('.scrim-replace-input'); r.value = 'x'; r.dispatchEvent(new Event('input', {bubbles: true})); return true");
  await clickText(s, "#scrim-findbar button", "Replace All");
  await waitFor(() => js(s, "return document.getElementById('notice-text').textContent === 'Replaced 2'"), "Replaced 2").catch(async (e) => {
    throw new Error(`${e.message}; notice ${await js(s, "return document.getElementById('notice-text').textContent + '|' + document.querySelector('.scrim-find-counter').textContent")}`);
  });
  await expectMd(s, "**x**\n\nx\n");
}, () => fixture("w8.md", "**bo**ld\n\nbold\n"));

test("W-9 outline click jumps; dragging a heading moves its section", async (s) => {
  await ready(s);
  await js(s, "window.__scrim.sidebar.toggle(true); window.__scrim.sidebar.show('outline'); return true");
  await waitFor(() => js(s, "return document.querySelectorAll('#outline-content .outline-item').length === 3"), "3 headings");
  if (!(await js(s, "return !!document.querySelector('#outline-content .outline-h2 .outline-item')"))) throw new Error("no .outline-h2 wrapper");
  await clickText(s, "#outline-content .outline-item", "Gamma");
  await waitFor(() => ed(s, "return view.state.selection.$head.parent.textContent === 'Gamma'"), "jumped to Gamma");
  await waitFor(() => js(s, "return document.querySelector('.outline-item-active')?.textContent.includes('Gamma')"), "active heading");
  // Drag "Gamma" above "Beta" (the sidebar's drop uses the same path as pointer drags).
  await js(s, "const list = window.__scrim.sidebar.headings(); window.__scrim.sidebar.moveSection(2, 1, list); return true");
  await expectMd(s, "# Alpha\n\na\n\n## Gamma\n\ng\n\n## Beta\n\nb\n");
  await press(s, CTRL, "z");
  await expectMd(s, "# Alpha\n\na\n\n## Beta\n\nb\n\n## Gamma\n\ng\n", "one undo step");
}, () => fixture("w9.md", "# Alpha\n\na\n\n## Beta\n\nb\n\n## Gamma\n\ng\n"));

test("W-10 source mode keeps the cursor character and the top line", async (s) => {
  await ready(s);
  await cursorAfter(s, "line 120 mid");
  await ed(s, "view.dom.closest('content').scrollTop = 1500");
  await sleep(200);
  const topBefore = await js(s, "const c = document.querySelector('content'); const v = window.__scrim.editor.view; const p = v.posAtCoords({ left: v.dom.getBoundingClientRect().left + 40, top: c.getBoundingClientRect().top + 8 }); return v.state.doc.resolve(Math.min(p.pos + 1, v.state.doc.content.size)).parent.textContent");
  await press(s, CTRL, "/");
  await waitFor(() => js(s, "return document.body.classList.contains('md-source-mode') && !!document.querySelector('#scrim-source .cm-editor')"), "source mode");
  await sleep(300);
  const src = await js(s, "const cm = window.__scrim.sourceMode.cm; const h = cm.state.selection.main.head; return cm.state.doc.sliceString(h - 12, h)");
  if (src !== "line 120 mid") throw new Error(`cursor in source after "${src}"`);
  const topSrc = await js(s, "const cm = window.__scrim.sourceMode.cm; const c = document.querySelector('content').getBoundingClientRect(); const b = cm.lineBlockAtHeight(c.top + 12 - cm.documentTop); return cm.state.doc.lineAt(b.from).text");
  if (topSrc !== topBefore) throw new Error(`top line ${JSON.stringify(topSrc)} != ${JSON.stringify(topBefore)}`);
  await press(s, CTRL, "/");
  await waitFor(() => js(s, "return !document.body.classList.contains('md-source-mode')"), "live mode");
  if ((await cursorText(s)) !== "line 120 mid") throw new Error(`cursor after return: "${await cursorText(s)}"`);
}, () => fixture("w10.md", Array.from({ length: 300 }, (_, i) => (i === 120 ? "line 120 middle" : `line ${i}`)).join("\n\n") + "\n"));

test("W-11 focus mode dims all but the current block; typewriter centers the cursor line", async (s) => {
  await ready(s);
  await cursorAfter(s, "para 40");
  await press(s, F8);
  await waitFor(() => js(s, "return document.body.classList.contains('on-focus-mode') && document.querySelectorAll('#write .md-focus').length === 1"), "focus mode");
  const colors = await js(s, `const ps = [...document.querySelectorAll('#write > p')]; const f = ps.find((p) => p.classList.contains('md-focus'));
    const o = ps.find((p) => !p.classList.contains('md-focus')); return [f.textContent, getComputedStyle(f).color, getComputedStyle(o).color, getComputedStyle(document.documentElement).getPropertyValue('--blur-text-color')]`);
  if (colors[0] !== "para 40" || colors[1] === colors[2]) throw new Error(`focus colors ${colors}`);
  await press(s, F8);
  await press(s, F9);
  await waitFor(() => js(s, "return document.body.classList.contains('scrim-typewriter-mode')"), "typewriter");
  await typeText(s, "x");
  await sleep(600);
  const off = await ed(s, "const c = view.coordsAtPos(view.state.selection.head); const r = view.dom.closest('content').getBoundingClientRect(); return (c.top + c.bottom) / 2 - (r.top + r.height / 2)");
  await press(s, F9); // the modes are preferences now (11): leave them off for later tests
  if (Math.abs(off) > 20) throw new Error(`cursor line ${off}px from center`);
}, () => fixture("w11.md", Array.from({ length: 80 }, (_, i) => `para ${i}`).join("\n\n") + "\n"));

test("W-12 word count of 'Hello, wörld! 你好' is 4 words", async (s) => {
  await ready(s);
  await waitFor(() => js(s, "return document.getElementById('footer-word-count')?.textContent === '4 Words'"), "4 Words", 3000);
}, () => fixture("w12.md", "Hello, wörld! 你好\n"));

test("E-18 find field owns Mod+Z; Mod+B does nothing; F5 / Ctrl+R do not reload", async (s) => {
  await ready(s);
  await js(s, "window.__marker = 1; return true");
  await ed(s, "view.focus()");
  await press(s, CTRL, "f");
  await waitFor(() => js(s, "return document.activeElement?.classList.contains('scrim-find-input')"), "find field");
  await typeText(s, "abc");
  await press(s, CTRL, "z");
  await waitFor(() => js(s, "return document.querySelector('.scrim-find-input').value !== 'abc'"), "find field undo");
  await press(s, CTRL, "b");
  await press(s, F5);
  await press(s, CTRL, "r");
  await sleep(500);
  await expectMd(s, "keep me\n", "document untouched");
  if ((await js(s, "return window.__marker")) !== 1) throw new Error("page reloaded");
}, () => fixture("e18.md", "keep me\n"));

test("E-19 undo across source mode", async (s) => {
  await ready(s);
  await cursorAfter(s, "base");
  await typeText(s, "x");
  await expectMd(s, "basex\n");
  await press(s, CTRL, "/");
  await waitFor(() => js(s, "return window.__scrim.sourceMode.hasFocus()"), "source focus");
  await press(s, CTRL, END);
  await js(s, "const cm = window.__scrim.sourceMode.cm; cm.dispatch({ selection: { anchor: 5 } }); return true");
  await typeText(s, "yz");
  await press(s, CTRL, "/");
  await waitFor(() => js(s, "return !document.body.classList.contains('md-source-mode')"), "live");
  await expectMd(s, "basexyz\n");
  await ed(s, "view.focus()");
  await press(s, CTRL, "z");
  await expectMd(s, "basex\n", "first undo removes yz");
  await press(s, CTRL, "z");
  await expectMd(s, "base\n", "second undo removes x");
}, () => fixture("e19.md", "base\n"));

test("D-6 autosave writes a saved document 1 s after the last edit", async (s, file) => {
  await ready(s);
  await js(s, "window.__scrim.setSetting('autoSave', true); return true");
  await sleep(300);
  await cursorAfter(s, "auto");
  await typeText(s, "saved");
  await sleep(1500);
  const disk = readFileSync(file, "utf8");
  await js(s, "window.__scrim.setSetting('autoSave', false); return true");
  if (disk !== "autosaved\n") throw new Error(`on disk: ${JSON.stringify(disk)}`);
}, () => fixture("d6.md", "auto\n"));

test("D-7 Save As to another folder offers image choices; Update rewrites the paths", async (s) => {
  await ready(s);
  await js(s, "window.__scrim.testHooks.askImagePaths = () => { window.__asked = true; return Promise.resolve('update'); }; return true");
  const target = join(docs, "d7", "out", "deeper", "copy.md");
  spawnSync("mkdir", ["-p", join(docs, "d7", "out", "deeper")]);
  writeFileSync(saveAsFile, target);
  await ed(s, "view.focus()");
  await press(s, CTRL, SHIFT, "s");
  await waitFor(() => existsSync(target) && readFileSync(target, "utf8").includes("../../img/pic.png"), "saved with updated paths");
  if (!(await js(s, "return window.__asked === true"))) throw new Error("prompt not shown");
  const text = readFileSync(target, "utf8");
  if (text !== "![a](../../img/pic.png)\n\n![b](https://example.invalid/x.png)\n") throw new Error(`saved: ${JSON.stringify(text)}`);
  await waitFor(async () => (await s.title()).startsWith("copy.md"), "title");
}, () => {
  const root = mkFolder("d7", { "doc.md": "![a](img/pic.png)\n\n![b](https://example.invalid/x.png)\n", "img/pic.png": "png" });
  return join(root, "doc.md");
});

test("Q-016 the implicit folder follows the document and is not a recent folder", async (s) => {
  await ready(s);
  await js(s, "window.__scrim.sidebar.toggle(true); return true");
  await waitFor(() => js(s, "return !!document.querySelector('.scrim-sidebar-empty')"), "untitled: No folder open");
  await ed(s, "view.focus()");
  await typeText(s, "hello");
  const target = join(docs, "q016", "saved.md");
  spawnSync("mkdir", ["-p", join(docs, "q016")]);
  writeFileSync(join(docs, "q016", "other.md"), "other\n");
  writeFileSync(saveAsFile, target);
  await press(s, CTRL, "s");
  await waitFor(() => existsSync(target), "saved");
  await waitFor(() => js(s, `return window.__scrim.sidebar.folder === ${JSON.stringify(join(docs, "q016"))}`), "save sets the implicit folder");
  await waitFor(() => js(s, "return [...document.querySelectorAll('#file-library .file-tree-node')].some((r) => r.textContent.includes('other.md'))"), "tree lists the folder");
  writeFileSync(join(docs, "q016", "new-on-disk.md"), "n\n");
  await waitFor(() => js(s, "return [...document.querySelectorAll('#file-library .file-tree-node')].some((r) => r.textContent.includes('new-on-disk.md'))"), "watched live");
  const recent = await js(s, "return window.__TAURI_INTERNALS__.invoke('recent_get')");
  if (recent.folders.some((f) => f.includes("q016"))) throw new Error(`implicit folder in recent folders: ${recent.folders}`);
});
