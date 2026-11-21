// Opening links from the document (spec 03, 3.9). Mod+click (or a plain click with
// "Open links with single click") opens the link under the pointer.

import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { flatten } from "../md/inline";
import { elementsOf, isProse, type EditorOptions } from "./context";
import { inlineKey } from "./decorations";
import { headingKey } from "./headings";

export interface LinkHooks {
  /** Open a non-anchor link; `newWindow` for Mod+Shift+click on Markdown files. */
  openLink(href: string, newWindow: boolean): void;
}

/** The link URL at document position `pos`, if any. */
export function linkAt(view: EditorView, pos: number, opts: EditorOptions): string | null {
  const $p = view.state.doc.resolve(pos);
  if (!isProse($p.parent)) return null;
  const defs = inlineKey.getState(view.state)?.defs;
  if (!defs) return null;
  const off = $p.parentOffset;
  const hits = flatten(elementsOf($p.parent, defs, opts)).filter(
    (e) => (e.kind === "link" || e.kind === "autolink" || (e.kind === "html" && e.nodeName === "a")) && e.from <= off && off <= e.to,
  );
  const e = hits.pop();
  return e?.attrs?.href ?? null;
}

/** Scroll to the heading with `id` and put the cursor there. True if found. */
export function jumpToAnchor(view: EditorView, id: string): boolean {
  const list = headingKey.getState(view.state)?.list ?? [];
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    /* keep */
  }
  const h = list.find((x) => x.id === decoded || x.id === decoded.toLowerCase());
  if (!h) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, h.pos + 1)));
  const dom = view.nodeDOM(h.pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start" });
  view.focus();
  return true;
}

/**
 * Pointer cursor over links while Mod is held, or always with "Open links with single
 * click" (QA-LOG Q-012): the body gets `scrim-mod-held` / `scrim-links-single-click`.
 */
function trackModifier(opts: EditorOptions) {
  const set = (on: boolean) => document.body.classList.toggle("scrim-mod-held", on);
  window.addEventListener("keydown", (e) => set(e.ctrlKey || e.metaKey), true);
  window.addEventListener("keyup", (e) => set(e.ctrlKey || e.metaKey), true);
  window.addEventListener("mousemove", (e) => set(e.ctrlKey || e.metaKey), { capture: true, passive: true });
  window.addEventListener("blur", () => set(false));
  return () => document.body.classList.toggle("scrim-links-single-click", !!opts.openLinksSingleClick);
}

export function createLinkPlugin(opts: EditorOptions & { openLinksSingleClick?: boolean }, hooks: LinkHooks): Plugin {
  const syncSetting = trackModifier(opts);
  return new Plugin({
    view: () => ({ update: syncSetting }),
    props: {
      handleClick(view, pos, event) {
        const mod = event.ctrlKey || event.metaKey;
        if (!mod && !opts.openLinksSingleClick) return false;
        const href = linkAt(view, pos, opts);
        if (!href) return false;
        if (href.startsWith("#")) jumpToAnchor(view, href.slice(1));
        else hooks.openLink(href, event.shiftKey);
        return true;
      },
    },
  });
}
