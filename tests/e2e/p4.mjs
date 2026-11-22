// P4 acceptance tests (spec 20, "P4 Look and settings").
import { CTRL, SHIFT } from "./webdriver.mjs";
import { Session } from "./webdriver.mjs";
import { APP, docs, ed, editorValue, existsSync, fixture, join, readFileSync, readdirSync, sleep, spawnSync, test, typeText, waitFor, writeFileSync } from "./harness.mjs";

const ready = (s) => waitFor(() => s.exec("return !!(window.__scrim && window.__scrim.editor.view.state.doc && window.__scrim.themes.loaded)"), "editor and theme");
const js = (s, body) => s.exec(body);
const press = (s, ...keys) => s.chord(...keys);
const themesDir = () => join(process.env.SCRIM_CONFIG_DIR, "themes");
const style = (s, sel, props) =>
  js(s, `const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const c = getComputedStyle(e); return Object.fromEntries(${JSON.stringify(props)}.map((p) => [p, c.getPropertyValue(p)]))`);
const expectStyle = async (s, sel, want) => {
  const got = await style(s, sel, Object.keys(want));
  if (!got) throw new Error(`no element ${sel}`);
  const bad = Object.entries(want).filter(([k, v]) => {
    const g = got[k];
    if (typeof v === "number") return Math.abs(parseFloat(g) - v) > 1; // within 1 px
    return g !== v;
  });
  if (bad.length) throw new Error(`${sel}: ${bad.map(([k, v]) => `${k} ${JSON.stringify(got[k])} != ${JSON.stringify(v)}`).join("; ")}`);
};

const FEATURES = `---
title: x
---

# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

Body text with a [link](https://example.invalid), **strong**, *em* and \`code\`.

> A quote

- one
- two

\`\`\`js
const x = 1
\`\`\`

| a | b |
| - | - |
| 1 | 2 |

---

end
`;

test("T-3 built-in paper matches 22.2", async (s) => {
  await ready(s);
  if ((await js(s, "return window.__scrim.themes.current")) !== "paper") throw new Error("default theme is not paper");
  await ed(s, "view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.atEnd(view.state.doc)))");
  await sleep(300);
  const tokens = await js(s, `const c = getComputedStyle(document.documentElement); return ["--bg-color", "--text-color", "--md-char-color", "--meta-content-color", "--primary-color", "--side-bar-bg-color", "--search-select-bg-color", "--rawblock-edit-panel-bd"].map((k) => c.getPropertyValue(k).trim())`);
  const want = ["#f3f2ee", "#1f0909", "#c7c5c5", "#5b808d", "#428bca", "#f3f2ee", "#000000", "#e5e5e5"];
  if (JSON.stringify(tokens) !== JSON.stringify(want)) throw new Error(`tokens ${tokens}`);
  await expectStyle(s, "body", { "background-color": "rgb(243, 242, 238)", color: "rgb(31, 9, 9)", "font-size": 16, "line-height": 24 });
  const family = (await style(s, "body", ["font-family"]))["font-family"];
  if (!family.startsWith('"PT Serif"')) throw new Error(`body font ${family}`);
  await expectStyle(s, "#write", { "max-width": 640, "padding-top": 36, "padding-left": 30, "padding-right": 30, "padding-bottom": 70 });
  await expectStyle(s, "#write h1", { "font-size": 30, "font-weight": "400", "line-height": 39, "margin-top": 60, "margin-bottom": 15, "padding-bottom": 24.4, "border-bottom-width": 1, "border-bottom-color": "rgb(197, 197, 197)" });
  await expectStyle(s, "#write h2", { "font-size": 21, "font-weight": "700", "margin-top": 48, "margin-bottom": 15.75 });
  await expectStyle(s, "#write h3", { "font-size": 21, "font-weight": "400", "margin-top": 48 });
  await expectStyle(s, "#write h4", { "font-size": 18, "font-weight": "700", "line-height": 24, "margin-top": 48, "margin-bottom": 27 });
  await expectStyle(s, "#write h5", { "font-size": 16, "font-weight": "700", "margin-top": 16, "margin-bottom": 24 });
  await expectStyle(s, "#write p", { "margin-top": 16, "margin-bottom": 24 });
  await expectStyle(s, "#write a", { color: "rgb(6, 85, 136)", "text-decoration-line": "none" });
  await expectStyle(s, "#write p code", { "font-size": 14, "background-color": "rgb(218, 218, 218)", "padding-left": 2, "padding-right": 2, "border-top-left-radius": 0 });
  await expectStyle(s, "#write blockquote", { color: "rgb(101, 101, 101)", "font-style": "italic", "margin-left": 32, "padding-left": 16, "border-left-width": 5, "border-left-color": "rgb(186, 186, 186)" });
  await expectStyle(s, "#write ul", { "margin-left": 24, "padding-left": 40, "margin-bottom": 24 });
  await expectStyle(s, "#write pre.md-fences", { "font-size": 14.4, "background-color": "rgb(218, 218, 218)", "margin-left": 28.8, "margin-top": 14.4, "margin-bottom": 43.2, "padding-left": 8.4, "padding-right": 8.4, "border-top-width": 0 });
  await expectStyle(s, "#write table th", { "font-weight": "700", "text-transform": "uppercase", "background-color": "rgb(218, 218, 218)", "padding-left": 6.4, "padding-top": 4 });
  await expectStyle(s, "#write hr", { "border-bottom-width": 1, "border-bottom-color": "rgb(197, 197, 197)", "margin-top": 20 });
  await expectStyle(s, "#write pre.md-meta-block", { "font-size": 12.8, color: "rgb(85, 85, 85)" });
  await expectStyle(s, "footer", { "font-size": 12 });
  // A theme's `content: ' '` pseudo-element on the code block has zero height (Q-021).
  const gap = `const pre = document.querySelector('#write pre.md-fences'); return pre.querySelector('.cm-editor').getBoundingClientRect().top - pre.getBoundingClientRect().top`;
  const plain = await js(s, gap);
  const withPseudo = await js(s, `const st = document.createElement('style'); st.id = 'q021'; st.textContent = '#write .md-fences::before { content: " "; display: block }'; document.head.append(st); ${gap.replace("return ", "const r = ")}; st.remove(); return r`);
  if (Math.abs(withPseudo - plain) > 0.5) throw new Error(`code block pseudo-element takes ${withPseudo - plain}px`);
}, () => fixture("t3.md", FEATURES));

test("T-6 compatibility rewrite: sidebar red; url() and strings untouched", async (s) => {
  writeFileSync(join(themesDir(), "compat-test.css"), `@import "compat-test/extra.css";
#typora-sidebar { background: red; }
.typora-export h1 { color: blue; }
#write::after { content: "#typora-sidebar"; background-image: url("typora-bg.png"); }
`);
  spawnSync("mkdir", ["-p", join(themesDir(), "compat-test")]);
  writeFileSync(join(themesDir(), "compat-test", "extra.css"), ".typora-node #write { letter-spacing: 1px; }\n");
  await ready(s);
  await js(s, "window.__scrim.setSetting('theme', 'compat-test'); return true");
  await waitFor(() => js(s, "return window.__scrim.themes.loaded === 'compat-test'"), "theme applied");
  await js(s, "window.__scrim.sidebar.toggle(true); return true");
  await waitFor(async () => (await style(s, "#scrim-sidebar", ["background-color"]))["background-color"] === "rgb(255, 0, 0)", "sidebar red").catch(async (e) => {
    throw new Error(`${e.message}: ${await js(s, "return [...document.styleSheets].map((x) => (x.href || 'inline') + ' ' + (x.cssRules?.length ?? '?') + ' ' + [...(x.cssRules || [])].slice(0, 3).map((r) => r.cssText.slice(0, 60)).join(' | ')).join('\\n')")} ${await style(s, "#scrim-sidebar", ["background-color"]).then(JSON.stringify)}`);
  });
  await waitFor(async () => (await style(s, "#write", ["letter-spacing"]))["letter-spacing"] === "1px", "relative @import, rewritten too");
  const after = await js(s, "const c = getComputedStyle(document.getElementById('write'), '::after'); return [c.content, c.backgroundImage]");
  if (after[0] !== '"#typora-sidebar"' || !after[1].includes("typora-bg.png")) throw new Error(`string or url() changed: ${after}`);
  // The theme menu name (10.1)
  const name = await js(s, "return window.__scrim.themes.themes.find((t) => t.id === 'compat-test').name");
  if (name !== "Compat Test") throw new Error(`name ${name}`);
  await js(s, "window.__scrim.setSetting('theme', 'paper'); return true");
});

test("T-2 editing base.user.css on disk applies live", async (s) => {
  await ready(s);
  // Idle means idle: serving a theme must not count as a change to the theme folder
  // (reading files produced access events, which re-applied the theme in a loop).
  const themeLoads = () => js(s, "return performance.getEntriesByType('resource').filter((e) => /\\/themes\\//.test(e.name)).length");
  const before = await themeLoads();
  await sleep(2000);
  const after = await themeLoads();
  if (after !== before) throw new Error(`theme files reloaded while idle (${before} -> ${after})`);
  const f = join(themesDir(), "base.user.css");
  writeFileSync(f, "#write { border-top: 3px solid rgb(1, 2, 3); }\n");
  try {
    await waitFor(async () => (await style(s, "#write", ["border-top-color"]))["border-top-color"] === "rgb(1, 2, 3)", "applied", 5000);
    writeFileSync(f, "#write { border-top: 3px solid rgb(4, 5, 6); }\n");
    await waitFor(async () => (await style(s, "#write", ["border-top-color"]))["border-top-color"] === "rgb(4, 5, 6)", "re-applied", 5000);
  } finally {
    writeFileSync(f, "");
  }
});

test("T-7 separate dark theme follows the system live; cursor and scroll unchanged", async (s) => {
  await ready(s);
  await js(s, "window.__scrim.setSetting('useSeparateDarkTheme', true); window.__scrim.setSetting('darkTheme', 'night'); return true");
  await ed(s, "view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(200)))); view.dom.closest('content').scrollTop = 400");
  await sleep(300);
  const before = await ed(s, "return [view.state.selection.head, view.dom.closest('content').scrollTop]");
  // Stand-in for the OS switching to dark: the window's theme drives prefers-color-scheme.
  await js(s, "return window.__TAURI_INTERNALS__.invoke('plugin:window|set_theme', { label: 'doc-1', value: 'dark' }).then(() => true)");
  try {
    await waitFor(() => js(s, "return window.__scrim.themes.current === 'night' && document.body.classList.contains('dark')"), "night applied");
    const after = await ed(s, "return [view.state.selection.head, view.dom.closest('content').scrollTop]");
    if (after[0] !== before[0] || Math.abs(after[1] - before[1]) > 1) throw new Error(`cursor/scroll ${before} -> ${after}`);
    await js(s, "return window.__TAURI_INTERNALS__.invoke('plugin:window|set_theme', { label: 'doc-1', value: 'light' }).then(() => true)");
    await waitFor(() => js(s, "return window.__scrim.themes.current === 'paper'"), "back to paper").catch(async (e) => {
      throw new Error(`${e.message}: dark media ${await js(s, "return matchMedia('(prefers-color-scheme: dark)').matches")}`);
    });
  } finally {
    await js(s, "window.__scrim.setSetting('useSeparateDarkTheme', false); return window.__TAURI_INTERNALS__.invoke('plugin:window|set_theme', { label: 'doc-1', value: null }).then(() => true)");
  }
}, () => fixture("t7.md", Array.from({ length: 120 }, (_, i) => `paragraph ${i}`).join("\n\n") + "\n"));

test("T-8 zoom in three times is 130% and survives a restart", async (s) => {
  await ready(s);
  await ed(s, "view.focus()");
  for (let i = 0; i < 3; i++) {
    await press(s, CTRL, SHIFT, "=");
    await sleep(150);
  }
  await waitFor(() => js(s, "return window.__scrim.zoomLevel() === 1.3"), "130%");
  const ratio = await js(s, "return window.outerWidth / window.innerWidth");
  if (Math.abs(ratio - 1.3) > 0.05) throw new Error(`content not zoomed: ${ratio}`);
  await sleep(500); // the setting write
  spawnSync("pkill", ["-KILL", "-f", `^${APP}`]);
  await waitFor(() => spawnSync("pgrep", ["-f", `^${APP}`]).status !== 0, "app gone");
  await s.delete().catch(() => {});
  const s2 = await Session.create("http://127.0.0.1:4444", APP, []);
  try {
    await ready(s2);
    await waitFor(() => js(s2, "return window.__scrim.zoomLevel() === 1.3 && Math.abs(window.outerWidth / window.innerWidth - 1.3) < 0.05"), "still 130% after restart");
    await press(s2, CTRL, SHIFT, "0");
    await waitFor(() => js(s2, "return window.__scrim.zoomLevel() === 1"), "actual size");
  } finally {
    await s2.delete();
  }
});

test("T-4 preferences search 'pair' shows only the two auto-pair options", async (s) => {
  await ready(s);
  await ed(s, "view.focus()");
  await press(s, CTRL, ",");
  await waitFor(() => js(s, "return !document.getElementById('scrim-preferences').hidden && document.activeElement?.classList.contains('scrim-preferences-search')"), "preferences open");
  await typeText(s, "pair");
  await waitFor(async () => {
    const labels = await js(s, "return [...document.querySelectorAll('.scrim-preferences-control')].map((c) => c.dataset.label)");
    return JSON.stringify(labels) === JSON.stringify(["Auto pair brackets and quotes", "Auto pair Markdown symbols"]);
  }, "two auto-pair controls").catch(async (e) => {
    throw new Error(`${e.message}: ${await js(s, "return [...document.querySelectorAll('.scrim-preferences-control')].map((c) => c.dataset.label).join(' | ')")}`);
  });
  const sections = await js(s, "return [...document.querySelectorAll('.scrim-preferences-section')].map((x) => x.textContent)");
  if (JSON.stringify(sections) !== '["Editor"]') throw new Error(`sections ${sections}`);
  // A change applies immediately (no OK button) and is stored.
  await js(s, "document.querySelector('.scrim-preferences-control[data-label=\"Auto pair Markdown symbols\"] input').click(); return true");
  await waitFor(() => js(s, "return window.__scrim.editor.options.autoPairMarkdown === true"), "applied");
  const stored = JSON.parse(readFileSync(join(process.env.SCRIM_CONFIG_DIR, "settings.json"), "utf8"));
  if (stored.autoPairMarkdown !== true) throw new Error("not stored");
  await js(s, "document.querySelector('.scrim-preferences-control[data-label=\"Auto pair Markdown symbols\"] input').click(); return true");
  await js(s, "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true");
  await waitFor(() => js(s, "return document.getElementById('scrim-preferences').hidden"), "closed with Escape");
});

test("T-5 config.jsonc shortcuts rebind Strong live", async (s) => {
  const cfg = join(process.env.SCRIM_CONFIG_DIR, "config.jsonc");
  await ready(s);
  const original = readFileSync(cfg, "utf8");
  if (!original.includes("// Keyboard shortcuts")) throw new Error("default config.jsonc is not commented");
  const select = () => ed(s, "view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, 1, 5)))");
  try {
    writeFileSync(cfg, original.replace('"shortcuts": {}', '"shortcuts": { "Strong": "Ctrl+Shift+B" }'));
    await waitFor(() => js(s, "return window.__scrim.dispatcher.keyOf('format.strong') === 'Ctrl+Shift+B'"), "rebound", 5000);
    await select();
    await press(s, CTRL, "b");
    await sleep(300);
    if ((await editorValue(s)) !== "word here\n") throw new Error(`Mod+B still bolds: ${JSON.stringify(await editorValue(s))}`);
    await select();
    await press(s, CTRL, SHIFT, "b");
    await waitFor(async () => (await editorValue(s)) === "**word** here\n", "Ctrl+Shift+B bolds");
  } finally {
    writeFileSync(cfg, original);
  }
  await waitFor(() => js(s, "return window.__scrim.dispatcher.keyOf('format.strong') === 'Ctrl+B'"), "default back", 5000);
}, () => fixture("t5.md", "word here\n"));

test("menu: commands run by id; Paragraph inserts; Help opens a local document", async (s) => {
  await ready(s);
  await ed(s, "view.focus(); view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.atEnd(view.state.doc)))");
  await js(s, "window.__scrim.command('para.hr'); return true");
  await js(s, "window.__scrim.command('para.codeFences'); return true");
  await waitFor(() => js(s, "return !!document.activeElement?.closest('.cm-content')"), "cursor in the new code block");
  await typeText(s, "x");
  await waitFor(async () => (await editorValue(s)) === "text\n\n---\n\n```\nx\n```\n", "hr and code fences").catch(async (e) => {
    throw new Error(`${e.message}: ${JSON.stringify(await editorValue(s))}`);
  });
  await js(s, "window.__scrim.command('help.shortcuts'); return true");
  await waitFor(() => existsSync(join(process.env.SCRIM_CONFIG_DIR, "help", "Shortcuts.md")), "help document written");
}, () => fixture("menu.md", "text\n"));

// T-1 uses the owner's fixture themes (CLEAN-ROOM.md rule 7): `node
// scripts/fetch-fixture-themes.mjs` (run first, below) downloads the list in
// spec/fixtures/themes.lock.json into tests/fixtures/themes/ (git-ignored) and verifies
// the hashes. Approved screenshots of Scrim are committed in tests/golden/themes/<theme>.png;
// a theme without one, or whose render changed, gets a candidate in
// tests/golden/themes/candidates/ for the owner to review (committed on a goldens/<date>
// branch), and the test fails until it is approved. Remote loads are blocked
// (SCRIM_TEST_NO_REMOTE). Goldens are meant to come from the CI Linux image (fonts).
const FIXTURES = join(import.meta.dirname, "../fixtures/themes");
const GOLDEN = join(import.meta.dirname, "../golden/themes");
const LOCK = join(import.meta.dirname, "../../spec/fixtures/themes.lock.json");
test("T-1 fixture themes appear in the Themes menu and match approved screenshots", async (s, _file, fetched) => {
  if (!fetched.ok) throw new Error(`fixture themes could not be fetched: ${fetched.message}`);
  const css = JSON.parse(readFileSync(LOCK, "utf8")).themes.flatMap((r) => r.themes);
  const missing = css.filter((f) => !existsSync(join(FIXTURES, f)));
  if (missing.length) throw new Error(`missing fixtures ${missing} (run scripts/fetch-fixture-themes.mjs)`);
  for (const f of readdirSync(FIXTURES)) if (!f.startsWith("golden")) spawnSync("cp", ["-r", join(FIXTURES, f), themesDir()]);
  await ready(s);
  await js(s, "return window.__scrim.themes.refreshList().then(() => true)");
  // Same picture every time: no notices, no caret, no hover.
  const still = () =>
    js(s, `document.getElementById('notice').hidden = true;
      const v = window.__scrim.editor.view;
      v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atEnd(v.state.doc)));
      document.activeElement?.blur?.(); document.querySelector('content').scrollTop = 0;
      if (!document.getElementById('t1-still')) {
        const st = document.createElement('style'); st.id = 't1-still';
        st.textContent = '* { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }';
        document.head.appendChild(st);
      }
      const w = document.getElementById('write'); w.style.display = 'none'; void w.offsetHeight; w.style.display = '';
      return true`);
  const pending = [];
  for (const f of css) {
    const id = f.slice(0, -4);
    await waitFor(() => js(s, `return window.__scrim.themes.themes.some((t) => t.id === ${JSON.stringify(id)})`), `${id} listed`);
    await js(s, `window.__scrim.setSetting('theme', ${JSON.stringify(id)}); return true`);
    await waitFor(() => js(s, `return window.__scrim.themes.loaded === ${JSON.stringify(id)}`), `${id} loaded`);
    // Web fonts from the theme's folder: wait until every face in use has loaded.
    // Faces load lazily on first use, so load every declared face explicitly.
    await waitFor(() => js(s, "return Promise.all([...document.fonts].map((f) => f.load().catch(() => null))).then(() => document.fonts.ready).then(() => document.fonts.status === 'loaded')"), `${id} fonts`, 15000);
    // A face that cannot load (remote ones are blocked) keeps its text invisible for the
    // browser's block period (about 3 s) before the fallback shows: wait that out.
    await sleep(3500);
    // Then shoot until two consecutive screenshots are identical (late font repaints).
    const shot = join(process.env.SCRIM_CONFIG_DIR, `${id}.png`);
    const prev = join(process.env.SCRIM_CONFIG_DIR, `${id}.prev.png`);
    for (let i = 0; i < 12; i++) {
      await still();
      await sleep(700);
      if (existsSync(shot)) spawnSync("mv", [shot, prev]);
      writeFileSync(shot, Buffer.from(await s.cmd("GET", "/screenshot"), "base64"));
      if (i > 0 && spawnSync("compare", ["-metric", "AE", shot, prev, "null:"], { encoding: "utf8" }).stderr.trim() === "0") break;
    }
    const golden = join(GOLDEN, `${id}.png`);
    const candidate = () => {
      spawnSync("mkdir", ["-p", join(GOLDEN, "candidates")]);
      spawnSync("cp", [shot, join(GOLDEN, "candidates", `${id}.png`)]);
      pending.push(id);
    };
    if (!existsSync(golden)) {
      candidate();
      continue;
    }
    const r = spawnSync("compare", ["-metric", "AE", "-fuzz", "2%", shot, golden, "null:"], { encoding: "utf8" });
    const diff = parseFloat(r.stderr);
    const size = spawnSync("identify", ["-format", "%w %h", golden], { encoding: "utf8" }).stdout.split(" ").map(Number);
    const ratio = diff / (size[0] * size[1]);
    if (!(ratio <= 0.01)) {
      console.log(`     ${id}: ${(ratio * 100).toFixed(2)}% of pixels differ from the approved screenshot`);
      candidate();
    }
  }
  // Remote loads are blocked (SCRIM_TEST_NO_REMOTE): nothing was fetched from the web.
  const remote = await js(s, "return performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /^https?:/.test(n) && !/^https?:\\/\\/(tauri|scrim-[a-z]+)\\.localhost/.test(n))");
  if (remote.length) throw new Error(`remote resources were loaded: ${remote.join(", ")}`);
  await js(s, "window.__scrim.setSetting('theme', 'paper'); return true");
  if (pending.length) throw new Error(`no approved screenshot for ${pending.join(", ")}: candidates in tests/golden/themes/candidates/ (commit them on a goldens/<date> branch for review)`);
}, () => {
  // No drafts from earlier tests (their notice would be in the screenshots).
  spawnSync("sh", ["-c", `rm -f ${join(process.env.SCRIM_CONFIG_DIR, "recovery")}/*.md ${join(process.env.SCRIM_CONFIG_DIR, "recovery")}/*.json`]);
  // The helper runs first: downloads anything missing and verifies every SHA-256.
  const r = spawnSync("node", [join(import.meta.dirname, "../../scripts/fetch-fixture-themes.mjs")], { encoding: "utf8", timeout: 300000 });
  return [fixture("t1.md", FEATURES), { ok: r.status === 0, message: (r.stderr || r.stdout || "").trim().split("\n").slice(-3).join("; ") }];
});

test("11 cursor blink preference reaches GTK (Linux)", async (s) => {
  await waitFor(() => s.exec("return !!window.__scrim"), "app");
  const log = () => readFileSync(join(process.env.SCRIM_CONFIG_DIR, "app.log"), "utf8");
  await s.exec("window.__scrim.setSetting('cursorBlink', false); return true");
  const last = () => [...log().matchAll(/cursor blink: (on|off)/g)].pop()?.[1];
  await waitFor(() => last() === "off", "blink off applied");
  await s.exec("window.__scrim.setSetting('cursorBlink', null); return true");
  await waitFor(() => last() === "on", "blink back on");
});

test("11 custom title bar: frameless window, title, menu button, rename by click", async (s) => {
  await waitFor(() => s.exec("return !!window.__scrim && document.body.classList.contains('scrim-frameless')"), "frameless page");
  const title = await s.exec("return document.querySelector('header .scrim-titlebar-title').textContent");
  if (!title.includes("titled.md")) throw new Error(`title bar shows ${JSON.stringify(title)}`);
  const buttons = await s.exec("return [...document.querySelectorAll('header .scrim-titlebar-button')].map((b) => b.getAttribute('aria-label'))");
  if (buttons.join() !== "Menu,Minimize,Maximize,Close") throw new Error(`buttons: ${buttons}`);
  if (!(await s.exec("return document.querySelector('header').hasAttribute('data-tauri-drag-region')"))) throw new Error("header is not a drag region");
  // Clicking the file name starts File → Rename (07).
  await s.exec("window.__scrim.sidebar.toggle(true); return true");
  await waitFor(() => s.exec("return !!document.querySelector('#file-library .file-tree-node.active')"), "current file row");
  // The header spans the window above the sidebar.
  const [hb, sb, detail] = await s.exec("const h = document.querySelector('body > header').getBoundingClientRect(); const sb = document.getElementById('scrim-sidebar').getBoundingClientRect(); return [h.left, sb.top >= h.bottom - 1, JSON.stringify([h, sb])]");
  if (hb !== 0 || !sb) throw new Error(`header does not span the window above the sidebar: ${detail}`);
  await s.exec("document.querySelector('header .scrim-titlebar-title').click(); return true");
  await waitFor(() => s.exec("return document.activeElement?.classList.contains('scrim-inline-rename')"), "rename field");
}, () => {
  writeFileSync(join(process.env.SCRIM_CONFIG_DIR, "settings.json"), JSON.stringify({ windowStyle: "custom" }) + "\n");
  return fixture("titled.md", "# Titled\n");
});
