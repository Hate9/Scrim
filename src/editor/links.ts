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
 * Link URL tooltip after 500 ms of hovering (3.9). Drawn in the page rather than with
 * the `title` attribute: the webview's native tooltip is a separate window that can
 * sit under the pointer and swallow the click.
 */
class LinkTooltip {
  private dom: HTMLDivElement | null = null;
  private timer = 0;

  schedule(a: HTMLElement) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.show(a), 500);
  }

  private show(a: HTMLElement) {
    if (!a.isConnected) return;
    if (!this.dom) {
      this.dom = document.createElement("div");
      this.dom.className = "scrim-link-tooltip";
      document.body.appendChild(this.dom);
    }
    this.dom.textContent = a.dataset.href ?? "";
    const r = a.getBoundingClientRect();
    this.dom.style.left = `${r.left}px`;
    this.dom.style.top = `${r.bottom + 4}px`;
    this.dom.hidden = false;
  }

  hide() {
    clearTimeout(this.timer);
    if (this.dom) this.dom.hidden = true;
  }
}

const tooltip = new LinkTooltip();

export function createLinkPlugin(opts: EditorOptions & { openLinksSingleClick?: boolean }, hooks: LinkHooks): Plugin {
  return new Plugin({
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
      handleDOMEvents: {
        mouseover(_view, event) {
          const a = (event.target as HTMLElement).closest?.("a[data-href]");
          if (a instanceof HTMLElement) tooltip.schedule(a);
          return false;
        },
        mouseout(_view, event) {
          const a = (event.target as HTMLElement).closest?.("a[data-href]");
          const to = (event as MouseEvent).relatedTarget as HTMLElement | null;
          if (a && !(to && a.contains(to))) tooltip.hide();
          return false;
        },
        mousedown() {
          tooltip.hide();
          return false;
        },
      },
    },
  });
}
