// Background dispatches and the browser's own selection changes (Q-027 follow-up).

import type { EditorView } from "prosemirror-view";

/**
 * Before a background dispatch: let ProseMirror read a DOM selection (or edit) the browser
 * made that it has not seen yet. A dispatch in between writes ProseMirror's older
 * selection back to the DOM, and a Ctrl+Shift+End or Shift+click made just then was lost
 * (Q-026's select-all test, once background work came in many short slices).
 */
export function flushDomFirst(view: EditorView): void {
  if (view.composing) return;
  (view as unknown as { domObserver?: { forceFlush(always?: boolean): void } }).domObserver?.forceFlush(true);
}
