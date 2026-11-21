// P4 acceptance tests (spec 20, "P4 Look and settings").
import { CTRL, SHIFT } from "./webdriver.mjs";
import { Session } from "./webdriver.mjs";
import { APP, docs, ed, editorValue, existsSync, fixture, join, readFileSync, readdirSync, sleep, spawnSync, test, typeText, waitFor, writeFileSync } from "./harness.mjs";

const ready = (s) => waitFor(() => s.exec("return !!(window.__scrim && window.__scrim.editor.view.state.doc && window.__scrim.themes.current)"), "editor and theme");
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
  await waitFor(() => js(s, "return window.__scrim.themes.current === 'compat-test'"), "theme applied");
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
