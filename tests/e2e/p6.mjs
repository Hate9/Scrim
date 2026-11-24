// P6 acceptance tests (spec 20, "P6 Language").
import { CTRL } from "./webdriver.mjs";
import { editorValue, existsSync, fixture, join, sleep, test, waitFor, writeFileSync } from "./harness.mjs";
import { readFileSync, rmSync } from "node:fs";

const js = (s, body) => s.exec(body);
const ready = (s) => waitFor(() => s.exec("return !!(window.__scrim && window.__scrim.editor.view.state.doc && window.__scrim.themes.loaded && window.__scrim.openMs() != null)"), "editor");
const marked = (s) => js(s, "return [...document.querySelectorAll('#write .md-spell-error')].map((e) => e.textContent)");
const hasDictionary = existsSync("/usr/share/hunspell/en_US.dic");

/** Right-click the first marked element whose text is `word`. */
async function rightClickWord(s, word) {
  const [x, y] = await js(s, `const e = [...document.querySelectorAll('#write .md-spell-error')].find((e) => e.textContent === ${JSON.stringify(word)}); const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]`);
  await s.cmd("POST", "/actions", {
    actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", x, y }, { type: "pointerDown", button: 2 }, { type: "pointerUp", button: 2 }] }],
  });
  await s.cmd("DELETE", "/actions");
}
const menuItems = (s) => js(s, "return [...document.querySelectorAll('.scrim-context-item')].map((e) => e.textContent)");

test("L-1 \"teh\" is underlined; the context menu offers \"the\"; choosing it is one undo step", async (s) => {
  if (!hasDictionary) throw new Error("hunspell-en-us is not installed");
  await ready(s);
  await waitFor(async () => (await marked(s)).includes("teh"), "teh underlined", 8000);
  if ((await marked(s)).includes("cat")) throw new Error("correct words are marked");
  const decoration = await js(s, "const e = document.querySelector('#write .md-spell-error'); const c = getComputedStyle(e); return c.textDecorationStyle + ' ' + c.textDecorationLine");
  if (!/wavy/.test(decoration) || !/underline/.test(decoration)) throw new Error(`not a wavy underline: ${decoration}`);
  await rightClickWord(s, "teh");
  await waitFor(async () => (await menuItems(s)).includes("the"), "suggestion \"the\"");
  const items = await menuItems(s);
  if (!items.includes("Add to Dictionary") || !items.includes("Ignore")) throw new Error(`menu: ${items}`);
  await js(s, "[...document.querySelectorAll('.scrim-context-item')].find((e) => e.textContent === 'the').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true");
  await waitFor(async () => (await editorValue(s)) === "the cat sat\n", "replaced");
  await waitFor(async () => !(await marked(s)).length, "no marks left", 8000);
  await s.chord(CTRL, "z");
  await waitFor(async () => (await editorValue(s)) === "teh cat sat\n", "one undo step restores it");
}, () => fixture("l1.md", "teh cat sat\n"));

test("L-2 code, URLs, and front matter are never underlined", async (s) => {
  if (!hasDictionary) throw new Error("hunspell-en-us is not installed");
  await ready(s);
  await waitFor(async () => (await marked(s)).includes("wrongg"), "a real misspelling is marked", 8000);
  const m = await marked(s);
  const leaked = m.filter((w) => w !== "wrongg");
  if (leaked.length) throw new Error(`marked outside prose: ${leaked}`);
}, () => fixture("l2.md", "---\ntitel: frontmattr wrds\n---\n\nwrongg `codde wrds` and <https://exampel.com/pathh> and www.exampel.org and [link](https://destinationn.com/pathh).\n\n```\nblokk of codde\n```\n\n$$\n\\fracc\n$$\n"));

test("L-3 no dictionaries → status bar warning with the install hint, no errors", async (s) => {
  const flag = join(process.env.SCRIM_CONFIG_DIR, "test-no-dictionaries");
  try {
    await ready(s);
    await waitFor(() => js(s, "const b = document.querySelector('.scrim-footer-lang'); return !!b && !b.hidden && b.textContent === '⚠'"), "warning in the status bar");
    const title = await js(s, "return document.querySelector('.scrim-footer-lang').title");
    if (!/hunspell/.test(title)) throw new Error(`hint: ${title}`);
    await sleep(800);
    if ((await marked(s)).length) throw new Error("marks without a dictionary");
    const log = readFileSync(join(process.env.SCRIM_CONFIG_DIR, "app.log"), "utf8");
    if (/ERROR[^\n]*spell/i.test(log)) throw new Error("errors in the log");
  } finally {
    rmSync(flag, { force: true });
  }
}, () => {
  // Debug builds: this file hides every dictionary (Rust `spell_info`).
  writeFileSync(join(process.env.SCRIM_CONFIG_DIR, "test-no-dictionaries"), "");
  return fixture("l3.md", "teh cat\n");
});
