// HTML block preview (spec 04, 4.10): sanitized, with <style> scoped to #write.

import DOMPurify from "dompurify";
import { allCustomTags } from "../md/customtags";

const FORBID = ["script", "object", "embed", "base", "meta", "link", "form"];

/** Prefix every selector of a stylesheet with `#write ` so documents cannot restyle the
 * app chrome. */
export function scopeCss(css: string): string {
  let sheet: CSSStyleSheet;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  } catch {
    return "";
  }
  const scopeRules = (rules: CSSRuleList): string => {
    let out = "";
    for (const rule of [...rules]) {
      if (rule instanceof CSSStyleRule) {
        const sel = rule.selectorText
          .split(",")
          .map((s) => {
            const t = s.trim();
            if (/^(html|body|:root)\b/.test(t)) return `#write${t.replace(/^(html|body|:root)/, "")}`;
            return `#write ${t}`;
          })
          .join(", ");
        out += `${sel} { ${rule.style.cssText} }\n`;
      } else if (rule instanceof CSSMediaRule) {
        out += `@media ${rule.conditionText} {\n${scopeRules(rule.cssRules)}}\n`;
      } else if (rule instanceof CSSKeyframesRule || rule instanceof CSSFontFaceRule) {
        out += rule.cssText + "\n";
      }
    }
    return out;
  };
  return scopeRules(sheet.cssRules);
}

export interface HtmlRenderOptions {
  setImageSource(img: HTMLImageElement, src: string): void;
  /** URL of the `scrim-embed` wrapper for an iframe source (spec 19, Q-015). */
  embedUrl(src: string): string;
}

const IFRAME_KEEP = new Set(["width", "height", "title", "style"]);

export function renderHtmlBlock(html: string, el: HTMLElement, opts: HtmlRenderOptions) {
  // A lone comment shows as a faint placeholder so it can be found and edited.
  if (/^\s*<!--[\s\S]*-->\s*$/.test(html)) {
    el.innerHTML = '<div class="md-comment">HTML comment</div>';
    return;
  }
  const frag = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: FORBID,
    // Registered custom tags render as elements (17); attributes are sanitized as usual.
    ADD_TAGS: ["style", "iframe", ...allCustomTags()],
    FORCE_BODY: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  }) as DocumentFragment;
  frag.querySelectorAll("style").forEach((s) => (s.textContent = scopeCss(s.textContent ?? "")));
  // Iframes go through the scrim-embed wrapper, which applies "Allow iframes" (Q-015).
  frag.querySelectorAll("iframe").forEach((f) => {
    const src = f.getAttribute("src") ?? "";
    for (const a of [...f.attributes]) if (!IFRAME_KEEP.has(a.name)) f.removeAttribute(a.name);
    f.setAttribute("src", opts.embedUrl(src));
    f.classList.add("md-iframe");
  });
  frag.querySelectorAll("[id]").forEach((n) => (n.id = `user-${n.id}`));
  frag.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (src) opts.setImageSource(img as HTMLImageElement, src);
  });
  el.textContent = "";
  el.appendChild(frag);
}
