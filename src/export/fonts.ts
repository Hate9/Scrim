// Bundled theme fonts in exports (spec 22; 9.1): the faces of each bundled family the
// page's CSS names, embedded as data URLs, so an exported HTML file or PDF looks like the
// editor without the fonts installed. Same files as src/fonts/fonts.css.

const files = import.meta.glob("/src/fonts/*.ttf", { query: "?url", import: "default" }) as Record<string, () => Promise<string>>;

const FACES: { family: string; file: string; style: string; weight: number }[] = [
  { family: "PT Serif", file: "PT_Serif-Web-Regular.ttf", style: "normal", weight: 400 },
  { family: "PT Serif", file: "PT_Serif-Web-Italic.ttf", style: "italic", weight: 400 },
  { family: "PT Serif", file: "PT_Serif-Web-Bold.ttf", style: "normal", weight: 700 },
  { family: "PT Serif", file: "PT_Serif-Web-BoldItalic.ttf", style: "italic", weight: 700 },
  { family: "Open Sans", file: "OpenSans-Regular.ttf", style: "normal", weight: 400 },
  { family: "Open Sans", file: "OpenSans-Italic.ttf", style: "italic", weight: 400 },
  { family: "Open Sans", file: "OpenSans-Bold.ttf", style: "normal", weight: 700 },
  { family: "Open Sans", file: "OpenSans-BoldItalic.ttf", style: "italic", weight: 700 },
];

/** Bundled families the CSS text names (quoted or not). */
export function bundledFamiliesIn(css: string): string[] {
  return [...new Set(FACES.map((f) => f.family))].filter((fam) => new RegExp(`["']?${fam}["']?\\s*[,;}]`, "i").test(css));
}

const cache = new Map<string, Promise<string | null>>();

function dataUrl(file: string): Promise<string | null> {
  let p = cache.get(file);
  if (!p) {
    p = (async () => {
      const load = files[`/src/fonts/${file}`];
      if (!load) return null;
      try {
        const blob = await (await fetch(await load())).blob();
        return await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).replace(/^data:[^;,]*/, "data:font/ttf"));
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(blob);
        });
      } catch {
        return null; // that face falls back to the next font in the stack
      }
    })();
    cache.set(file, p);
  }
  return p;
}

/** @font-face rules, with embedded data, for the bundled families `css` uses. */
export async function bundledFontsCss(css: string): Promise<string> {
  const families = bundledFamiliesIn(css);
  const rules = await Promise.all(
    FACES.filter((f) => families.includes(f.family)).map(async (f) => {
      const url = await dataUrl(f.file);
      return url ? `@font-face { font-family: "${f.family}"; font-style: ${f.style}; font-weight: ${f.weight}; src: url(${url}) format("truetype"); }` : "";
    }),
  );
  return rules.filter(Boolean).join("\n");
}
