// Renders Scrim's icon source (assets/icon.svg, the woven-hash mark from the owner's
// drawing) to assets/icon-source.png at 1024 px, with the Chromium Playwright provides.
// Then make every size with: npx tauri icon assets/icon-source.png -o <dir>
// and keep the files already in src-tauri/icons (32x32, 64x64, 128x128, 128x128@2x,
// icon.png, icon.ico, icon.icns).
//
// Usage: node scripts/render-icon.mjs   (needs `playwright` resolvable, e.g. NODE_PATH)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(import.meta.url)("playwright");
const svg = readFileSync(join(root, "assets/icon.svg"), "utf8").replace("<svg ", '<svg style="display:block;width:1024px;height:1024px" ');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.screenshot({ path: join(root, "assets/icon-source.png"), omitBackground: true });
await browser.close();
console.log("wrote assets/icon-source.png");
