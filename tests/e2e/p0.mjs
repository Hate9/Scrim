import { CTRL, END } from "./webdriver.mjs";
import { typeText, test, fixture, waitFor, nativeTitles, editorValue, sleep, spawnSync, readFileSync, readdirSync, join, docs, APP } from "./harness.mjs";

// P0 acceptance tests (spec 20: S-1, S-3, N-1 support) and save round trips.


test("S-1 launch with a path shows the text and the title", async (s, file) => {
  await waitFor(async () => (await editorValue(s)) === "# Hello\r\nWorld café\r\n", "text");
  await waitFor(async () => (await s.exec("return document.querySelector('#write h1')?.textContent")) === "H1Hello", "rendered h1");
  await waitFor(async () => (await s.title()) === "a.md - Scrim", "document title");
  await waitFor(() => nativeTitles().includes("a.md - Scrim"), "native title");
  return file;
}, () => fixture("a.md", Buffer.from("# Hello\r\nWorld caf\xe9\r\n", "latin1")));

test("edit + Mod+S keeps CRLF and Latin-1 (R-8 file layer)", async (s, file) => {
  await waitFor(async () => (await editorValue(s)).startsWith("# Hello"), "text");
  await waitFor(() => s.exec("return !document.body.classList.contains('scrim-loading') && window.__scrim.editor.view.hasFocus()"), "editor shown and focused");
  await s.chord(CTRL, END);
  await typeText(s, "Plus\u00e8");
  await waitFor(async () => (await s.title()) === "• a.md - Scrim", "dirty title");
  await s.chord(CTRL, "s");
  await waitFor(async () => (await s.title()) === "a.md - Scrim", "clean title after save");
  const bytes = readFileSync(file);
  const want = Buffer.from("# Hello\r\nWorld caf\xe9Plus\xe8\r\n", "latin1");
  if (!bytes.equals(want)) throw new Error(`saved bytes ${JSON.stringify(bytes.toString("latin1"))}`);
  const tmp = readdirSync(docs).filter((n) => n.includes(".scrim-save-"));
  if (tmp.length) throw new Error(`temp files left: ${tmp}`);
}, () => fixture("a.md", Buffer.from("# Hello\r\nWorld caf\xe9\r\n", "latin1")));

test("open then save without editing is byte-identical", async (s, file, original) => {
  await waitFor(async () => (await editorValue(s)).includes("mixed"), "text");
  await s.chord(CTRL, "s");
  await sleep(500);
  if (!readFileSync(file).equals(original)) throw new Error("file changed");
}, () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("mixed\r\nendings\nand\rcr\t \n", "utf8")]);
  return [fixture("mixed.md", bytes), bytes];
});

test("S-3 second instance hands its path to the first and exits", async (s, file) => {
  await waitFor(async () => (await editorValue(s)) === "first\n", "first text");
  // A saved, unmodified document is never replaced by a handed-over path (Q-007).
  const b = fixture("b.md", "second file\n");
  const t0 = Date.now();
  const r = spawnSync(APP, [b], { timeout: 5000 });
  const ms = Date.now() - t0;
  if (r.status !== 0) throw new Error(`second instance exit ${r.status} ${r.signal}`);
  if (ms > 2000) throw new Error(`second instance took ${ms} ms`);
  await waitFor(() => nativeTitles().includes("b.md - Scrim"), "new window for b.md");
  if ((await editorValue(s)) !== "first\n") throw new Error("first document was replaced");
  if (!nativeTitles().includes("first.md - Scrim")) throw new Error(`titles ${nativeTitles()}`);
  // Already open: launching b.md again focuses its window, no new window.
  const before = nativeTitles().length;
  spawnSync(APP, [b], { timeout: 5000 });
  await sleep(700);
  if (nativeTitles().length !== before) throw new Error(`window count changed: ${nativeTitles()}`);
  return file;
}, () => fixture("first.md", "first\n"));

test("Q-007 a fresh untitled window is reused; --new-window is not", async (s) => {
  await waitFor(async () => (await s.title()) === "Untitled - Scrim", "untitled window");
  const d = fixture("d.md", "dee\n");
  spawnSync(APP, ["--new-window", d], { timeout: 5000 });
  await waitFor(() => nativeTitles().includes("d.md - Scrim"), "new window for d.md");
  if ((await s.title()) !== "Untitled - Scrim") throw new Error("fresh window replaced despite --new-window");
  const c = fixture("c.md", "sea\n");
  spawnSync(APP, [c], { timeout: 5000 });
  await waitFor(async () => (await editorValue(s)) === "sea\n", "c.md in the fresh window");
  await waitFor(async () => (await s.title()) === "c.md - Scrim", "title of c.md");
});

test("Q-003 a missing path opens an empty document bound to it", async (s) => {
  await waitFor(async () => (await s.title()) === "new.md - Scrim", "title");
  if ((await editorValue(s)) !== "") throw new Error("not empty");
}, () => join(docs, "new.md"));

test("CSP blocks network fetches from the frontend", async (s) => {
  await waitFor(async () => (await s.title()).endsWith("Scrim"), "loaded");
  const result = await s.cmd("POST", "/execute/async", {
    script: "const done = arguments[0]; fetch('http://127.0.0.1:9/x').then(() => done('allowed'), () => done('blocked'));",
    args: [],
  });
  if (result !== "blocked") throw new Error(`fetch was ${result}`);
  await waitFor(() => readFileSync(join(process.env.SCRIM_CONFIG_DIR, "app.log"), "utf8").includes("blocked by CSP"), "CSP log line");
});

