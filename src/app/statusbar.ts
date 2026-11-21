// Status bar and word count (spec 14; wireframe window.svg).

import { inlineKey } from "../editor/decorations";
import type { Editor } from "../editor/editor";
import { count, countableText, type Counts } from "../editor/counts";

type Which = keyof Counts;

const LABELS: Record<Which, (n: number) => string> = {
  words: (n) => `${n} Words`,
  chars: (n) => `${n} Characters`,
  charsNoSpaces: (n) => `${n} Characters (no spaces)`,
  lines: (n) => `${n} Lines`,
  paragraphs: (n) => `${n} Paragraphs`,
  minutes: (n) => `~${n} min`,
};

export class StatusBar {
  root = document.querySelector("footer") as HTMLElement;
  private count = document.createElement("button");
  private popover = document.createElement("div");
  private timer = 0;
  private total: Counts | null = null;
  private selected: Counts | null = null;

  constructor(
    private editor: Editor,
    private hooks: {
      toggleSidebar(): void;
      toggleSource(): void;
      sidebarOpen(): boolean;
      setting<T>(key: string, fallback: T): T;
      setSetting(key: string, value: unknown): void;
      sourceText(): string | null;
    },
  ) {
    const left = document.createElement("div");
    left.className = "footer-left";
    const side = document.createElement("button");
    side.className = "footer-item scrim-footer-sidebar";
    side.title = "Toggle sidebar (Ctrl+Shift+L)";
    side.addEventListener("click", () => hooks.toggleSidebar());
    const src = document.createElement("button");
    src.className = "footer-item scrim-footer-source";
    src.textContent = "</>";
    src.title = "Source code mode (Ctrl+/)";
    src.addEventListener("click", () => hooks.toggleSource());
    left.append(side, src);
    const right = document.createElement("div");
    right.className = "footer-right";
    this.count.id = "footer-word-count";
    this.count.className = "footer-item";
    this.count.addEventListener("click", () => this.togglePopover());
    this.popover.className = "scrim-count-popover";
    this.popover.hidden = true;
    right.appendChild(this.count);
    this.root.append(left, right, this.popover);
    editor.onUpdate.push(() => this.schedule());
    this.schedule();
    this.syncButtons();
  }

  syncButtons() {
    const side = this.root.querySelector(".scrim-footer-sidebar") as HTMLElement;
    side.textContent = this.hooks.sidebarOpen() ? "<" : "○";
    this.root.hidden = !this.hooks.setting("showStatusBar", true);
  }

  /** Counts update within 300 ms of typing stopping (14). */
  schedule() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.recount(), 250);
  }

  private recount() {
    const state = this.editor.view.state;
    const defs = inlineKey.getState(state)?.defs;
    if (!defs) return;
    const codeInWords = this.hooks.setting("countCodeInWords", false);
    const src = this.hooks.sourceText();
    if (src !== null) {
      this.total = count([{ text: src, code: false }], src.split(/\r\n?|\n/).length, codeInWords);
      this.selected = null;
    } else {
      const lines = this.editor.markdownLines();
      this.total = count(countableText(state.doc, defs, this.editor.options), lines, codeInWords);
      const sel = state.selection;
      this.selected = sel.empty ? null : count(countableText(state.doc, defs, this.editor.options, sel.from, sel.to), state.doc.textBetween(sel.from, sel.to, "\n", "\n").split("\n").length, codeInWords);
    }
    this.render();
  }

  private render() {
    if (!this.total) return;
    const which = this.hooks.setting<Which>("statusCount", "words");
    const t = this.total[which];
    this.count.textContent = this.selected ? `${this.selected[which]} / ${LABELS[which](t)}` : LABELS[which](t);
    if (!this.popover.hidden) this.renderPopover();
  }

  private togglePopover() {
    this.popover.hidden = !this.popover.hidden;
    if (!this.popover.hidden) this.renderPopover();
  }

  private renderPopover() {
    const which = this.hooks.setting<Which>("statusCount", "words");
    this.popover.textContent = "";
    for (const k of Object.keys(LABELS) as Which[]) {
      const row = document.createElement("label");
      row.className = "scrim-count-row";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "scrim-count";
      radio.checked = k === which;
      radio.addEventListener("change", () => {
        this.hooks.setSetting("statusCount", k);
        setTimeout(() => this.render(), 50);
      });
      const v = this.total ? this.total[k] : 0;
      const s = this.selected ? `${this.selected[k]} / ` : "";
      row.append(radio, document.createTextNode(` ${s}${LABELS[k](v)}`));
      this.popover.appendChild(row);
    }
  }
}
