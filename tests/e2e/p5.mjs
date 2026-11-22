// P5 acceptance tests (spec 20, "P5 Output").
import { CTRL, SHIFT } from "./webdriver.mjs";
import { docs, ed, existsSync, fixture, join, readFileSync, sleep, spawnSync, test, waitFor, work, writeFileSync, saveAsFile } from "./harness.mjs";
import { dirname } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";

// Debug builds: File → Import reads its file from here instead of a native dialog.
const openFile = join(work, "open.txt");
writeFileSync(openFile, "");
process.env.SCRIM_TEST_OPEN = openFile;

const js = (s, body) => s.exec(body);
const press = (s, ...keys) => s.chord(...keys);
const ready = (s) => waitFor(() => s.exec("return !!(window.__scrim && window.__scrim.editor.view.state.doc && window.__scrim.themes.loaded)"), "editor and theme");
const themesDir = () => join(process.env.SCRIM_CONFIG_DIR, "themes");
const out = (name) => {
  const d = join(work, "exports");
  mkdirSync(d, { recursive: true });
  return join(d, name);
};
const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
/** Run an export command with the save dialog answered by `path`; wait for the file. */
async function exportTo(s, command, path, timeout = 60000) {
  rmSync(path, { force: true });
  writeFileSync(saveAsFile, path);
  await js(s, `window.__scrim.command(${JSON.stringify(command)}); return true`);
  await waitFor(() => existsSync(path) && statSync(path).size > 0, `${command} → ${path}`, timeout);
  await sleep(300);
}
const featureDoc = () => {
  const f = fixture("feature.md", readFileSync(join(process.cwd(), "tests/fixtures/feature.md"), "utf8"));
  writeFileSync(join(dirname(f), "feature-image.png"), readFileSync(join(process.cwd(), "tests/fixtures/feature-image.png")));
  return f;
};
const setSetting = (s, key, value) => js(s, `return window.__scrim.setSetting(${JSON.stringify(key)}, ${JSON.stringify(value)}).then(() => true)`);
test("X-1 HTML export: collapsed, themed, code tokens; matches the editor within 2%", async (s, file) => {
  writeFileSync(join(themesDir(), "base.user.css"), "/* x1-base-user-marker */\n");
  await ready(s);
  await sleep(800);
  const html = out("feature.html");
  await exportTo(s, "file.exportHtml", html);
  const text = readFileSync(html, "utf8");
  const body = text.slice(text.indexOf("<body"));
  for (const bad of ["md-meta", "md-expand", "md-focus", "contenteditable", "ProseMirror"]) if (body.includes(bad)) throw new Error(`exported body contains ${bad}`);
  if (!/<body class="[^"]*\bscrim-export\b/.test(text)) throw new Error("no body.scrim-export");
  if (!text.includes("x1-base-user-marker")) throw new Error("base.user.css not included");
  if (!text.includes("/* paper.css */")) throw new Error("theme CSS not included");
  if (!/class="[^"]*\bcm-s-inner\b/.test(text) || !/<span class="cm-keyword">function<\/span>/.test(text)) throw new Error("code blocks lack .cm-s-inner or cm-* tokens");
  if (!text.includes('<section class="footnotes">')) throw new Error("no footnotes section");
  if (text.includes("title: Feature document")) throw new Error("front matter in the export");
  if (!text.includes("<title>Feature document</title>")) throw new Error("title is not the front matter title");

  // Screenshot comparison (QA-LOG Q-025): the editor with every block collapsed
  // and the blocks an export leaves out hidden, against the export page in an iframe of
  // this webview at the same width.
  await js(s, `const v = window.__scrim.editor.view; v.dom.blur(); document.getElementById('notice').hidden = true;
    v.dom.querySelectorAll('.md-expand, .md-focus, .md-focus-container').forEach((e) => e.classList.remove('md-expand', 'md-focus', 'md-focus-container'));
    const st = document.createElement('style'); st.id = 'x1'; st.textContent = '#write > pre.md-meta-block, #write .md-def-link, #write .md-htmlblock:has(.md-comment) { display: none !important; } * { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; } * { caret-color: transparent !important; }';
    document.head.appendChild(st); document.querySelector('content').scrollTop = 0; return true`);
  await sleep(600);
  const rect = await js(s, "const r = document.querySelector('content').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]");
  const editorPng = join(work, "x1-editor.png");
  writeFileSync(editorPng, Buffer.from(await s.cmd("GET", "/screenshot"), "base64"));
  await js(s, `const f = document.createElement('iframe'); f.id = 'x1-frame';
    const r = document.querySelector('content').getBoundingClientRect();
    Object.assign(f.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', border: '0', zIndex: 99999, background: 'white' });
    f.srcdoc = ${JSON.stringify(text)}; document.body.appendChild(f); return true`);
  await waitFor(() => js(s, "const d = document.getElementById('x1-frame').contentDocument; return !!d && d.readyState === 'complete' && !!d.querySelector('#write')"), "export page in the frame");
  await js(s, "const d = document.getElementById('x1-frame').contentDocument; const st = d.createElement('style'); st.textContent = '::-webkit-scrollbar { display: none !important; }'; d.head.appendChild(st); return d.fonts.ready.then(() => true)");
  await sleep(800);
  const exportPng = join(work, "x1-export.png");
  writeFileSync(exportPng, Buffer.from(await s.cmd("GET", "/screenshot"), "base64"));
  const crop = `${rect[2]}x${rect[3]}+${rect[0]}+${rect[1]}`;
  const r = spawnSync("compare", ["-metric", "AE", "-fuzz", "8%", `${editorPng}[${crop}]`, `${exportPng}[${crop}]`, join(work, "x1-diff.png")], { encoding: "utf8" });
  const differing = Number(r.stderr.trim().split(/\s/)[0]);
  const share = differing / (rect[2] * rect[3]);
  if (!Number.isFinite(share) || share > 0.02) throw new Error(`${(share * 100).toFixed(2)}% of pixels differ (${r.stderr.trim()}); see ${join(work, "x1-diff.png")}`);
  writeFileSync(join(themesDir(), "base.user.css"), "");
  void file;
}, featureDoc);

test("X-2 PDF: selectable text, page size and margins, short code blocks not split", async (s) => {
  if (!has("pdftotext")) throw new Error("pdftotext (poppler-utils) is not installed");
  await ready(s);
  const pdf = out("x2.pdf");
  await exportTo(s, "file.exportPdf", pdf, 90000);
  const info = spawnSync("pdfinfo", [pdf], { encoding: "utf8" }).stdout;
  if (!/Page size:\s+595(\.\d+)? x 841\.\d+|Page size:\s+595(\.\d+)? x 842/.test(info)) throw new Error(`not A4: ${info}`);
  const pages = Number(/Pages:\s+(\d+)/.exec(info)[1]);
  if (pages < 2) throw new Error(`expected several pages, got ${pages}`);
  const text = spawnSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" }).stdout;
  if (!text.includes("Paragraph 1 of the X-2 document")) throw new Error("text is not selectable");
  // Margins (18/16 mm = 51/45 pt): no content word starts outside them.
  const bbox = spawnSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8" }).stdout;
  const words = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], w: m[5] }));
  const content = words.filter((w) => !/^\d+$/.test(w.w)); // the page number is in the footer margin
  const minX = Math.min(...content.map((w) => w.x0));
  const minY = Math.min(...content.map((w) => w.y0));
  const maxX = Math.max(...content.map((w) => w.x1));
  if (minX < 45 || maxX > 595 - 45 || minY < 50) throw new Error(`content outside the margins: x ${minX}..${maxX}, y from ${minY}`);
  // The 12-line code block is on one page.
  const perPage = text.split("\f");
  const holding = perPage.map((p, i) => (p.includes("codeline01") || p.includes("codeline12") ? i : -1)).filter((i) => i >= 0);
  if (new Set(holding).size !== 1 || !perPage[holding[0]].includes("codeline01") || !perPage[holding[0]].includes("codeline12")) throw new Error(`code block split across pages ${holding}`);
}, () => {
  const paras = Array.from({ length: 26 }, (_, i) => `Paragraph ${i + 1} of the X-2 document, long enough to take a line or two of the page width when printed.`).join("\n\n");
  const code = Array.from({ length: 12 }, (_, i) => `codeline${String(i + 1).padStart(2, "0")} = ${i}`).join("\n");
  return fixture("x2.md", `# X-2\n\n${paras}\n\n\`\`\`\n${code}\n\`\`\`\n\nEnd.\n`);
});

test("X-3 pandoc: docx with headings, lists, tables, images, math; disabled with the hint without pandoc", async (s) => {
  await ready(s);
  if (!has("pandoc")) throw new Error("pandoc is not installed");
  await waitFor(() => js(s, "const f = window.__scrim.appMenu.nodes()[0].children.find((n) => n.label === 'Export'); return f.children().find((n) => n.label === 'Word (.docx)').enabled()"), "pandoc detected");
  await setSetting(s, "inlineMath", true);
  await sleep(300);
  const docx = out("feature.docx");
  await exportTo(s, "file.export.docx", docx, 120000);
  const unzip = spawnSync("unzip", ["-p", docx, "word/document.xml"], { encoding: "utf8", maxBuffer: 64 << 20 });
  const xml = unzip.stdout;
  for (const [what, re] of [["heading", /w:pStyle w:val="Heading1"/], ["list", /<w:numPr>/], ["table", /<w:tbl>/], ["image", /<w:drawing>/], ["math", /<m:oMath/]]) {
    if (!re.test(xml)) throw new Error(`docx has no ${what}`);
  }
  if (has("soffice")) {
    const dir = mkdtempSync(join(work, "lo-"));
    const r = spawnSync("soffice", ["--headless", `-env:UserInstallation=file://${dir}/profile`, "--convert-to", "html", "--outdir", dir, docx], { encoding: "utf8", timeout: 180000 });
    const html = join(dir, "feature.html");
    if (!existsSync(html)) throw new Error(`LibreOffice could not open the docx: ${r.stderr || r.stdout}`);
    const h = readFileSync(html, "utf8");
    for (const [what, re] of [["heading", /<h1/i], ["list", /<li/i], ["table", /<table/i], ["image", /<img/i]]) if (!re.test(h)) throw new Error(`LibreOffice shows no ${what}`);
  }
  // Without pandoc: listed, disabled, with the hint.
  await setSetting(s, "pandocPath", "/nonexistent/pandoc");
  await waitFor(() => js(s, "const f = window.__scrim.appMenu.nodes()[0].children.find((n) => n.label === 'Export'); const k = f.children(); return !k.find((n) => n.label === 'Word (.docx)').enabled() && k.some((n) => n.label === 'Requires pandoc') && k.some((n) => n.label === 'How to install pandoc…')"), "pandoc items disabled with the hint");
}, featureDoc);

test("X-4 import a docx → new untitled document, images extracted", async (s) => {
  if (!has("pandoc")) throw new Error("pandoc is not installed");
  await ready(s);
  const src = join(docs, "x4src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "pic.png"), readFileSync(join(process.cwd(), "tests/fixtures/feature-image.png")));
  writeFileSync(join(src, "in.md"), "# Imported\n\nSome **text**.\n\n![a picture](pic.png)\n");
  const docx = join(work, "x4.docx");
  const r = spawnSync("pandoc", ["in.md", "-o", docx], { cwd: src, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  const before = await s.cmd("GET", "/window/handles");
  writeFileSync(openFile, docx);
  const err = await js(s, "return window.__TAURI_INTERNALS__.invoke('import_file', { pandocPath: null }).then((r) => window.__TAURI_INTERNALS__.invoke('open_untitled_text', { text: r.text }).then(() => 'ok'), (e) => 'ERR ' + e)");
  if (err !== "ok") throw new Error(err);
  await waitFor(async () => (await s.cmd("GET", "/window/handles")).length > before.length, "a new window", 30000);
  const handle = (await s.cmd("GET", "/window/handles")).find((h) => !before.includes(h));
  await s.switchTo(handle);
  await ready(s);
  const md = await js(s, "return window.__scrim.editor.markdown()");
  if (!md.includes("# Imported") || !md.includes("**text**")) throw new Error(`imported text: ${md}`);
  // Markdown image, or an <img> when pandoc keeps the image's size.
  const img = /!\[[^\]]*\]\(([^)\s]+)/.exec(md) ?? /<img src="([^"]+)"/.exec(md);
  if (!img) throw new Error(`no image in ${md}`);
  const path = decodeURIComponent(img[1]);
  if (!path.includes(join(process.env.SCRIM_CONFIG_DIR, "tmp-images")) || !existsSync(path)) throw new Error(`image not extracted for an untitled document: ${path}`);
  if (!(await js(s, "return document.title.includes('•') && !window.__scrim.editor.options.docDir"))) throw new Error("not a new unsaved untitled document");
}, () => fixture("x4.md", "start\n"));

test("X-5 PDF header and footer: {{title}} 日本語 ✓ and {{page}} / {{pages}} on 3 pages", async (s) => {
  if (!has("pdftotext")) throw new Error("pdftotext (poppler-utils) is not installed");
  await ready(s);
  await setSetting(s, "exportPdfHeaderCenter", "{{title}}");
  await setSetting(s, "exportPdfFooterCenter", "{{page}} / {{pages}}");
  await sleep(500);
  const pdf = out("x5.pdf");
  await exportTo(s, "file.exportPdf", pdf, 120000);
  // pdftotext guesses word spaces from glyph positions (it reads "1 / 3" as "1/3"):
  // compare without whitespace.
  const pages = spawnSync("pdftotext", [pdf, "-"], { encoding: "utf8" }).stdout.split("\f").filter((p) => p.trim()).map((p) => p.replace(/\s+/g, ""));
  if (pages.length !== 3) throw new Error(`${pages.length} pages`);
  pages.forEach((p, i) => {
    if (!p.includes(`${i + 1}/3`)) throw new Error(`page ${i + 1} has no "${i + 1} / 3"`);
    if (!p.includes("日本語✓")) throw new Error(`page ${i + 1} has no title header (page text starts ${JSON.stringify(p.slice(0, 40))}; fonts: ${spawnSync("pdffonts", [pdf], { encoding: "utf8" }).stdout.split("\n").slice(2).map((l) => l.split(/\s+/)[0]).join(" ")})`);
  });
}, () => {
  // About three A4 pages of text.
  const paras = Array.from({ length: 28 }, (_, i) => `Line ${i + 1} of a document that fills about three pages when it is printed on A4 paper with the default margins.`).join("\n\n");
  return fixture("x5.md", `---\ntitle: 日本語 ✓\n---\n\n${paras}\n`);
});

test("X-6 Export with Previous (Mod+Shift+E) rewrites the same file", async (s) => {
  await ready(s);
  const html = out("x6.html");
  await exportTo(s, "file.exportHtml", html);
  if (!readFileSync(html, "utf8").includes("first version")) throw new Error("first export");
  await ed(s, "view.dispatch(view.state.tr.insertText(' second version', view.state.doc.content.size - 1))");
  writeFileSync(saveAsFile, ""); // no dialog this time
  await press(s, CTRL, SHIFT, "e");
  await waitFor(() => readFileSync(html, "utf8").includes("second version"), "rewritten", 20000);
}, () => fixture("x6.md", "first version\n"));

test("X-7 custom export command with spaces and a quote in the document path", async (s, file) => {
  await ready(s);
  await setSetting(s, "exportCustomCommands", [{ name: "Copy Source", ext: "txt", command: "cp {{input}} {{output}}" }]);
  await sleep(500);
  await waitFor(() => js(s, "const f = window.__scrim.appMenu.nodes()[0].children.find((n) => n.label === 'Export'); return f.children().some((n) => n.label === 'Copy Source')"), "command in the Export menu");
  const target = out("it's a copy.txt");
  rmSync(target, { force: true });
  writeFileSync(saveAsFile, target);
  await js(s, "window.__scrim.exporter.run({ kind: 'custom', name: 'Copy Source' }); return true");
  await waitFor(() => existsSync(target), "copied", 20000);
  if (readFileSync(target, "utf8") !== readFileSync(file, "utf8")) throw new Error("copy differs");
}, () => fixture("my doc's file.md", "custom export source\n"));

test("X-8 front matter cannot inject head content or run commands", async (s) => {
  await ready(s);
  const marker = join(work, "x8-ran");
  rmSync(marker, { force: true });
  const html = out("x8.html");
  await exportTo(s, "file.exportHtml", html);
  const text = readFileSync(html, "utf8");
  if (/<script/i.test(text)) throw new Error("script in the export");
  if (await js(s, "const f = window.__scrim.appMenu.nodes()[0].children.find((n) => n.label === 'Export'); return f.children().some((n) => n.label === 'Evil')")) throw new Error("front matter command listed");
  const ran = await js(s, "return window.__scrim.exporter.run({ kind: 'custom', name: 'Evil' })");
  await sleep(500);
  if (ran || existsSync(marker)) throw new Error("front matter command ran");
}, () => {
  const marker = join(work, "x8-ran");
  return fixture("x8.md", `---\nexport:\n  html:\n    head: "<script>alert(1)</script>"\n    bodyEnd: "<script>alert(2)</script>"\n  commands:\n    - { name: Evil, ext: txt, command: "touch ${marker}" }\nexportCustomCommands:\n  - { name: Evil, ext: txt, command: "touch ${marker}" }\n---\n\nbody\n`);
});
