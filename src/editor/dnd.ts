// Dragging selected text (spec 06, 6.3; QA-LOG Q-014): pointer events on all platforms,
// not HTML5 drag and drop, so it works alongside the native file-drop handler.
//
// A drag starts after pressing inside a non-empty text selection and moving more than
// 4 px. A drop line follows the pointer; Escape cancels; dropping inside the dragged
// range does nothing; Mod held at the drop copies instead of moving. One undo step.

import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

const THRESHOLD = 4;

let indicator: HTMLDivElement | null = null;

/** Show the drop line at document position `pos` (also used for file drags). */
export function showDropLine(view: EditorView, pos: number) {
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "scrim-drop-line";
    document.body.appendChild(indicator);
  }
  const c = view.coordsAtPos(pos);
  indicator.style.left = `${c.left - 1}px`;
  indicator.style.top = `${c.top}px`;
  indicator.style.height = `${Math.max(12, c.bottom - c.top)}px`;
  indicator.hidden = false;
}

export function hideDropLine() {
  if (indicator) indicator.hidden = true;
}

/** Text position under the pointer, or null outside text. */
export function textPosAt(view: EditorView, x: number, y: number): number | null {
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return null;
  const $p = view.state.doc.resolve(hit.pos);
  if (!$p.parent.isTextblock || $p.parent.type.spec.code) return null;
  return hit.pos;
}

export function createTextDragPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        // No HTML5 drag of text (Q-014).
        dragstart(_view, e) {
          if ((e.target as HTMLElement).closest?.(".cm-editor")) return false;
          e.preventDefault();
          return true;
        },
        mousedown(view, e) {
          if (e.button !== 0 || e.shiftKey || e.detail > 1) return false;
          const sel = view.state.selection;
          if (!(sel instanceof TextSelection) || sel.empty) return false;
          if ((e.target as HTMLElement).closest?.(".cm-editor, .md-widget, input")) return false;
          const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (!at || at.pos < sel.from || at.pos >= sel.to) return false;
          e.preventDefault();
          startDrag(view, e, sel.from, sel.to);
          return true;
        },
      },
    },
  });
}

function startDrag(view: EditorView, down: MouseEvent, from: number, to: number) {
  let dragging = false;
  let target: number | null = null;
  const finish = () => {
    window.removeEventListener("mousemove", move, true);
    window.removeEventListener("mouseup", up, true);
    window.removeEventListener("keydown", key, true);
    document.body.classList.remove("scrim-dragging-text");
    hideDropLine();
  };
  const move = (e: MouseEvent) => {
    if (!dragging && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) <= THRESHOLD) return;
    dragging = true;
    document.body.classList.add("scrim-dragging-text");
    target = textPosAt(view, e.clientX, e.clientY);
    if (target === null) hideDropLine();
    else showDropLine(view, target);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish();
    }
  };
  const up = (e: MouseEvent) => {
    finish();
    if (!dragging) {
      // A plain click inside the selection: put the cursor there.
      const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (at) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
      view.focus();
      return;
    }
    if (target === null || (target >= from && target <= to)) return;
    const copy = e.ctrlKey || e.metaKey;
    const slice = view.state.doc.slice(from, to);
    const tr = view.state.tr;
    let insertAt = target;
    if (!copy) {
      tr.delete(from, to);
      insertAt = tr.mapping.map(target);
    }
    tr.replace(insertAt, insertAt, slice);
    const end = tr.mapping.map(insertAt, 1);
    const start = end - (to - from);
    tr.setSelection(TextSelection.create(tr.doc, Math.max(0, start), end));
    view.dispatch(tr.scrollIntoView().setMeta("uiEvent", copy ? "drop-copy" : "drop-move"));
    view.focus();
  };
  window.addEventListener("mousemove", move, true);
  window.addEventListener("mouseup", up, true);
  window.addEventListener("keydown", key, true);
}
