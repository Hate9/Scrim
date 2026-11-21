// Emoji autocomplete (spec 05, 5.2): typing ":" plus two or more letters opens a list
// of matching shortcodes. Up/Down select, Enter or Tab insert, Escape closes.

import { gemoji } from "gemoji";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { isProse } from "./context";

interface Match {
  name: string;
  emoji: string;
}

const ALL: Match[] = gemoji.flatMap((g) => g.names.map((name) => ({ name, emoji: g.emoji })));

export function emojiMatches(query: string, limit = 8): Match[] {
  const q = query.toLowerCase();
  const prefix = ALL.filter((m) => m.name.startsWith(q));
  const sub = ALL.filter((m) => !m.name.startsWith(q) && m.name.includes(q));
  return [...prefix, ...sub].slice(0, limit);
}

interface Query {
  from: number;
  to: number;
  text: string;
}

function queryAt(state: EditorState): Query | null {
  const { $head, empty } = state.selection;
  if (!empty || !isProse($head.parent)) return null;
  const before = $head.parent.textBetween(Math.max(0, $head.parentOffset - 40), $head.parentOffset, undefined, "\n");
  const m = /(?:^|[\s(])(:([a-z0-9_+-]{2,}))$/i.exec(before);
  if (!m) return null;
  return { from: $head.pos - m[1].length, to: $head.pos, text: m[2] };
}

export const emojiKey = new PluginKey("scrim-emoji");

class EmojiPopup {
  dom: HTMLDivElement;
  matches: Match[] = [];
  index = 0;
  query: Query | null = null;
  dismissedAt: number | null = null;

  constructor(private view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "scrim-emoji-popup";
    this.dom.hidden = true;
    document.body.appendChild(this.dom);
    this.dom.addEventListener("mousedown", (e) => {
      const row = (e.target as HTMLElement).closest("[data-i]") as HTMLElement | null;
      if (row) {
        e.preventDefault();
        this.index = Number(row.dataset.i);
        this.insert();
      }
    });
  }

  get open() {
    return !this.dom.hidden;
  }

  update(view: EditorView) {
    this.view = view;
    const q = queryAt(view.state);
    if (!q || (this.dismissedAt !== null && this.dismissedAt === q.from)) {
      this.close();
      return;
    }
    this.dismissedAt = null;
    const matches = emojiMatches(q.text);
    if (!matches.length) {
      this.close();
      return;
    }
    if (!this.query || this.query.text !== q.text) this.index = 0;
    this.query = q;
    this.matches = matches;
    this.render();
    const c = view.coordsAtPos(q.from);
    this.dom.style.left = `${c.left}px`;
    this.dom.style.top = `${c.bottom + 4}px`;
    this.dom.hidden = false;
  }

  render() {
    this.dom.textContent = "";
    this.matches.forEach((m, i) => {
      const row = document.createElement("div");
      row.className = "scrim-emoji-item" + (i === this.index ? " active" : "");
      row.dataset.i = String(i);
      row.textContent = `${m.emoji}  :${m.name}:`;
      this.dom.appendChild(row);
    });
  }

  move(d: number) {
    this.index = (this.index + d + this.matches.length) % this.matches.length;
    this.render();
  }

  insert() {
    const q = this.query;
    const m = this.matches[this.index];
    if (!q || !m) return;
    const tr = this.view.state.tr.insertText(`:${m.name}:`, q.from, q.to);
    this.close();
    this.view.dispatch(tr);
    this.view.focus();
  }

  dismiss() {
    this.dismissedAt = this.query?.from ?? null;
    this.close();
  }

  close() {
    this.dom.hidden = true;
    this.query = null;
  }

  destroy() {
    this.dom.remove();
  }
}

export function createEmojiPlugin(enabled: () => boolean): Plugin {
  let popup: EmojiPopup | null = null;
  return new Plugin({
    key: emojiKey,
    view(view) {
      popup = new EmojiPopup(view);
      return {
        update: (v) => (enabled() ? popup!.update(v) : popup!.close()),
        destroy: () => popup?.destroy(),
      };
    },
    props: {
      handleKeyDown(_view, event) {
        if (!popup?.open) return false;
        switch (event.key) {
          case "ArrowDown":
            popup.move(1);
            return true;
          case "ArrowUp":
            popup.move(-1);
            return true;
          case "Enter":
          case "Tab":
            popup.insert();
            return true;
          case "Escape":
            popup.dismiss();
            return true;
        }
        return false;
      },
    },
  });
}
