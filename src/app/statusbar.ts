// Status bar and word count (spec 14; wireframe window.svg).

import { inlineKey } from "../editor/decorations";
import type { Editor } from "../editor/editor";
import { count, countableText, countDocument, countSource, warmCounts, type Counts, type SourceText } from "../editor/counts";

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
  /** spell check language (13): its code, or a warning when no dictionary is available */
  private lang = document.createElement("button");
  private langMenu = document.createElement("div");
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
      /** Source mode's text (CodeMirror's document), or null in live preview. */
      sourceDoc(): SourceText | null;
      spell: {
        enabled(): boolean;
        available(): boolean;
        hint(): string;
        language(): string | null;
        languages(): string[];
        choice(): string;
        choose(lang: string): void;
      };
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
    this.lang.className = "footer-item scrim-footer-lang";
    this.lang.addEventListener("click", () => this.toggleLangMenu());
    this.langMenu.className = "scrim-count-popover scrim-lang-popover";
    this.langMenu.hidden = true;
    right.append(this.lang, this.count);
    this.root.append(left, right, this.popover, this.langMenu);
    document.addEventListener("mousedown", (e) => {
      if (!this.langMenu.hidden && !this.langMenu.contains(e.target as Node) && e.target !== this.lang) this.langMenu.hidden = true;
    });
    editor.onUpdate.push(() => this.schedule());
    this.schedule();
    this.syncButtons();
  }

  syncButtons() {
    const side = this.root.querySelector(".scrim-footer-sidebar") as HTMLElement;
    side.textContent = this.hooks.sidebarOpen() ? "<" : "○";
    this.root.hidden = !this.hooks.setting("showStatusBar", true);
  }

  /** The language item: hidden while spell check is off. */
  syncSpell() {
    const sp = this.hooks.spell;
    this.lang.hidden = !sp.enabled();
    if (!sp.available()) {
      this.lang.textContent = "⚠";
      this.lang.title = sp.hint();
    } else {
      this.lang.textContent = (sp.language() ?? "").toUpperCase();
      this.lang.title = "Spell check language";
    }
    if (!this.langMenu.hidden) this.renderLangMenu();
  }

  private toggleLangMenu() {
    if (!this.hooks.spell.available()) return;
    this.langMenu.hidden = !this.langMenu.hidden;
    if (!this.langMenu.hidden) this.renderLangMenu();
  }

  private renderLangMenu() {
    const sp = this.hooks.spell;
    this.langMenu.textContent = "";
    for (const l of ["auto", ...sp.languages()]) {
      const row = document.createElement("label");
      row.className = "scrim-count-row";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "scrim-lang";
      radio.checked = l === sp.choice();
      radio.addEventListener("change", () => {
        sp.choose(l);
        this.langMenu.hidden = true;
      });
      row.append(radio, document.createTextNode(` ${l === "auto" ? "Auto" : l}`));
      this.langMenu.appendChild(row);
    }
  }

  /** Counts update within 300 ms of typing stopping (14). */
  schedule() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.recountIdle(), 250);
  }

  private idle = 0;

  /**
   * Recount in idle time, in slices of at most 8 ms (counts are cached per block, so a
   * slice resumes where the last one stopped). A recount run as a timer could land
   * between a switch to source mode and its first frames, where counting a 10,000-line
   * source in one go added 130 ms to the switch (QA-LOG Q-027 follow-up).
   */
  private recountIdle() {
    if (this.idle) return;
    const w = window as unknown as { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number };
    const ric = w.requestIdleCallback
      ? (cb: (d: { timeRemaining(): number }) => void) => w.requestIdleCallback!.call(window, cb, { timeout: 1000 })
      : (cb: (d: { timeRemaining(): number }) => void) => window.setTimeout(() => cb({ timeRemaining: () => 8 }), 50);
    this.idle = ric((d) => {
      this.idle = 0;
      if (!this.recount(Math.min(8, Math.max(1, d.timeRemaining() - 2)))) this.recountIdle();
    });
  }

  /** Count for at most `budgetMs` (cached blocks are free); true when the counts are shown. */
  private recount(budgetMs: number): boolean {
    const state = this.editor.view.state;
    const defs = inlineKey.getState(state)?.defs;
    if (!defs) return true;
    const codeInWords = this.hooks.setting("countCodeInWords", false);
    const src = this.hooks.sourceDoc();
    if (src !== null) {
      const t = countSource(src, budgetMs);
      if (!t) return false;
      this.total = t;
      this.selected = null;
    } else {
      if (!warmCounts(state.doc, defs, this.editor.options, budgetMs)) return false;
      const lines = this.editor.markdownLines();
      this.total = countDocument(state.doc, defs, this.editor.options, lines, codeInWords);
      const sel = state.selection;
      this.selected = sel.empty ? null : count(countableText(state.doc, defs, this.editor.options, sel.from, sel.to), state.doc.textBetween(sel.from, sel.to, "\n", "\n").split("\n").length, codeInWords);
    }
    this.render();
    return true;
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
