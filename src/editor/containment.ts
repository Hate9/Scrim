// CSS containment of top-level blocks with measured heights (QA-LOG Q-011, Q-026).
//
// With `content-visibility: auto`, WebKit skips layout and painting of blocks that are
// off screen, so a keystroke lays out only what is visible. A skipped block takes the
// height given by `contain-intrinsic-size`; a constant (the earlier 1.6em attempt) was
// wrong for most blocks and made scrolling and selection re-measure constantly. Here each
// block gets its real height, read from one full layout: measuring turns containment off
// (the class on the editor root), reads every top-level block's content height in one
// pass, and stores it as a node decoration (`contain-intrinsic-size: auto <h>px`), which
// ProseMirror keeps through edits and redraws. `auto` makes WebKit prefer the size it
// remembers from the block's last real layout. Blocks created later have no measured
// height until the next measurement and use the stylesheet's fallback; they are on screen
// when created, so WebKit remembers their real size anyway.
//
// Measurements are redone when the layout width or the look changes: theme, font size,
// fonts finishing loading, window resizes (debounced), and after load once the inline
// structure is complete. Containment is only applied to documents large enough to need
// it.
//
// Off by default (`experimentalContainment` in config.jsonc turns it on): in WebKitGTK
// 2.52, `contain: layout` or `contain: paint` on each of 10,000 sibling blocks (both
// implied by `content-visibility`) made typing about 7 times slower, measured heights or
// not (DESIGN.md, P8 performance).

import type { Node } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

/** Below this many top-level blocks, layout is cheap and containment is not applied. */
export const CONTAIN_MIN_BLOCKS = 400;
const CLASS = "md-contained";

interface ContainState {
  set: DecorationSet;
}

export const containKey = new PluginKey<ContainState>("scrim-contain");
const SET_META = "scrim-contain-set";

export function createContainmentPlugin(): Plugin<ContainState> {
  return new Plugin<ContainState>({
    key: containKey,
    state: {
      init: () => ({ set: DecorationSet.empty }),
      apply(tr, value) {
        const next = tr.getMeta(SET_META) as DecorationSet | undefined;
        if (next) return { set: next };
        return tr.docChanged ? { set: value.set.map(tr.mapping, tr.doc) } : value;
      },
    },
    props: {
      decorations: (state: EditorState) => containKey.getState(state)?.set,
    },
  });
}

/** Vertical padding and border of an element (cached per tag and class). */
function boxExtra(el: HTMLElement, cache: Map<string, number>): number {
  const k = `${el.tagName}.${el.className}`;
  let v = cache.get(k);
  if (v === undefined) {
    const cs = getComputedStyle(el);
    v = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"].reduce((sum, p) => sum + (parseFloat(cs[p as keyof CSSStyleDeclaration] as string) || 0), 0);
    cache.set(k, v);
  }
  return v;
}

/**
 * Measure every top-level block with containment off and store the heights. Returns the
 * time it took (ms), or null when the document is too small to contain.
 */
export function measureBlocks(view: EditorView): number | null {
  const t0 = performance.now();
  const doc = view.state.doc;
  const root = view.dom as HTMLElement;
  if (doc.childCount < CONTAIN_MIN_BLOCKS) {
    root.classList.remove(CLASS);
    if (containKey.getState(view.state)?.set !== DecorationSet.empty) view.dispatch(view.state.tr.setMeta(SET_META, DecorationSet.empty).setMeta("addToHistory", false));
    return null;
  }
  // Class changes on the editor root are not content changes for ProseMirror.
  const observer = (view as unknown as { domObserver?: { stop(): void; start(): void } }).domObserver;
  observer?.stop();
  root.classList.remove(CLASS);
  observer?.start();
  // One layout of the whole document, then reads only.
  const cache = new Map<string, number>();
  const decos: Decoration[] = [];
  let pos = 0;
  doc.forEach((node: Node) => {
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (dom && dom.nodeType === 1) {
      const h = Math.max(0, Math.round(dom.getBoundingClientRect().height - boxExtra(dom, cache)));
      decos.push(Decoration.node(pos, pos + node.nodeSize, { style: `contain-intrinsic-size: auto ${h}px` }));
    }
    pos += node.nodeSize;
  });
  view.dispatch(view.state.tr.setMeta(SET_META, DecorationSet.create(doc, decos)).setMeta("addToHistory", false));
  observer?.stop();
  root.classList.add(CLASS);
  observer?.start();
  return performance.now() - t0;
}

/** Keep the measurements current: call `schedule()` whenever the look may have changed. */
export class Containment {
  private timer = 0;
  lastMs: number | null = null;

  constructor(
    private view: () => EditorView,
    private ready: () => boolean,
    /** `experimentalContainment` in config.jsonc (off by default: see DESIGN.md, P8). */
    private enabled: () => boolean,
  ) {
    window.addEventListener("resize", () => this.schedule(400));
    document.fonts?.addEventListener?.("loadingdone", () => this.schedule(100));
  }

  schedule(delay = 0) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.run(), delay);
  }

  private disabled = false;

  /** Turn containment off for good (performance comparisons in tests). */
  disable() {
    this.disabled = true;
    window.clearTimeout(this.timer);
    const view = this.view();
    (view.dom as HTMLElement).classList.remove(CLASS);
  }

  private run() {
    const view = this.view();
    if (view.isDestroyed || this.disabled) return;
    if (!this.enabled()) {
      if (this.active() || containKey.getState(view.state)?.set !== DecorationSet.empty) {
        (view.dom as HTMLElement).classList.remove(CLASS);
        view.dispatch(view.state.tr.setMeta(SET_META, DecorationSet.empty).setMeta("addToHistory", false));
      }
      return;
    }
    // After load the inline structure is completed in idle chunks; measure once it is.
    if (!this.ready()) {
      this.schedule(200);
      return;
    }
    // Between frames, so the measurement sees the current styles.
    requestAnimationFrame(() => {
      this.lastMs = measureBlocks(view);
    });
  }

  /** Whether containment is in effect (tests). */
  active(): boolean {
    return (this.view().dom as HTMLElement).classList.contains(CLASS);
  }
}
