// KaTeX rendering, loaded lazily (inline math is off by default).
import katex from "katex";
import "katex/dist/katex.min.css";

export function renderMath(tex: string, el: HTMLElement, display = false) {
  try {
    katex.render(tex, el, { throwOnError: true, displayMode: display, output: "htmlAndMathml", trust: false });
    el.classList.remove("md-math-error");
    el.removeAttribute("title");
  } catch (e) {
    el.textContent = tex;
    el.classList.add("md-math-error");
    el.title = e instanceof Error ? e.message : String(e);
  }
}
