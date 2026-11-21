// HTML block preview (spec 04, 4.10): sanitized, with <style> scoped to #write.

import DOMPurify from "dompurify";

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
  allowIframes: boolean;
  setImageSource(img: HTMLImageElement, src: string): void;
}

export function renderHtmlBlock(html: string, el: HTMLElement, opts: HtmlRenderOptions) {
  // A lone comment shows as a faint placeholder so it can be found and edited.
  if (/^\s*<!--[\s\S]*-->\s*$/.test(html)) {
    el.innerHTML = '<div class="md-comment">HTML comment</div>';
    return;
  }
  const forbid = opts.allowIframes ? FORBID : [...FORBID, "iframe"];
  const frag = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: forbid,
    ADD_TAGS: ["style", ...(opts.allowIframes ? ["iframe"] : [])],
    FORCE_BODY: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  }) as DocumentFragment;
  frag.querySelectorAll("style").forEach((s) => (s.textContent = scopeCss(s.textContent ?? "")));
  frag.querySelectorAll("iframe").forEach((f) => f.setAttribute("sandbox", ""));
  frag.querySelectorAll("[id]").forEach((n) => (n.id = `user-${n.id}`));
  frag.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (src) opts.setImageSource(img as HTMLImageElement, src);
  });
  el.textContent = "";
  el.appendChild(frag);
}
