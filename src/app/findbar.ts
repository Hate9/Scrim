// Find bar (spec 08; wireframe find-bar.svg).

import type { Editor } from "../editor/editor";
import { expandReplacement, findMatches, replaceMatch, revealMatch, setFindResults, type FindQuery, type Match } from "../editor/find";

export interface SourceSearch {
  /** In source mode the bar searches the CodeMirror source editor. */
  active(): boolean;
  find(q: FindQuery): { from: number; to: number; groups: string[] }[];
  select(from: number, to: number): void;
  replace(ranges: { from: number; to: number; text: string }[]): void;
}

export class FindBar {
  root = document.getElementById("scrim-findbar") as HTMLDivElement;
  private find = document.createElement("input");
  private replaceField = document.createElement("input");
  private counter = document.createElement("span");
  private replaceRow = document.createElement("div");
  private matches: Match[] = [];
  private sourceMatches: { from: number; to: number; groups: string[] }[] = [];
  private current = -1;
  private q: FindQuery = { text: "", caseSensitive: false, wholeWord: false, regex: false, source: false };
  private timer = 0;
  private sourceItem!: HTMLElement;

  constructor(private editor: Editor, private source: SourceSearch, private notify: (m: string) => void) {
    const row = document.createElement("div");
    row.className = "scrim-findbar-row";
    const field = document.createElement("div");
    field.className = "scrim-findbar-field";
    this.find.className = "scrim-find-input";
    this.find.placeholder = "Find";
    this.counter.className = "scrim-find-counter";
    field.append(this.find, this.counter);
    row.appendChild(field);
    const toggle = (key: "caseSensitive" | "wholeWord" | "regex", label: string, title: string) => {
      const b = this.button(label, title, () => {
        this.q[key] = !this.q[key];
        b.classList.toggle("active", this.q[key]);
        this.update();
      });
      b.classList.add("scrim-find-toggle");
      row.appendChild(b);
    };
    toggle("caseSensitive", "Aa", "Case sensitive");
    toggle("wholeWord", "ab", "Whole word");
    toggle("regex", ".*", "Regex");
    const more = this.button("⋯", "More", () => {
      menu.hidden = !menu.hidden;
    });
    const menu = document.createElement("div");
    menu.className = "scrim-find-menu";
    menu.hidden = true;
    this.sourceItem = document.createElement("div");
    this.sourceItem.className = "scrim-find-menu-item";
    this.sourceItem.textContent = "Match Markdown source";
    this.sourceItem.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (this.source.active()) return;
      this.q.source = !this.q.source;
      menu.hidden = true;
      this.syncSourceItem();
      this.update();
    });
    menu.appendChild(this.sourceItem);
    more.appendChild(menu);
    row.append(
      more,
      this.button("↑", "Previous (Shift+Enter)", () => this.step(-1)),
      this.button("↓", "Next (Enter)", () => this.step(1)),
      this.button("×", "Close (Escape)", () => this.close()),
    );
    this.replaceRow.className = "scrim-findbar-row";
    this.replaceField.className = "scrim-replace-input";
    this.replaceField.placeholder = "Replace";
    this.replaceRow.append(this.replaceField, this.button("Replace", "Replace", () => this.replaceOne()), this.button("Replace All", "Replace All", () => this.replaceAll()));
    this.root.append(row, this.replaceRow);
    this.find.addEventListener("input", () => {
      this.q.text = this.find.value;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.update(), 100);
    });
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.target === this.replaceField && !e.shiftKey) this.replaceOne();
        else this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "F3") {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      }
    };
    this.find.addEventListener("keydown", keys);
    this.replaceField.addEventListener("keydown", keys);
  }

  private button(label: string, title: string, run: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest(".scrim-find-menu")) return;
      e.preventDefault();
      run();
    });
    return b;
  }

  private syncSourceItem() {
    const forced = this.source.active();
    this.sourceItem.classList.toggle("checked", forced || this.q.source);
    this.sourceItem.classList.toggle("disabled", forced);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  /** Mod+F / Mod+H. A single-line selection pre-fills the field. */
  open(withReplace: boolean) {
    this.root.hidden = false;
    this.replaceRow.hidden = !withReplace;
    document.body.classList.add("scrim-find-open");
    this.syncSourceItem();
    const { state } = this.editor.view;
    const sel = state.selection;
    if (!this.source.active() && !sel.empty && sel.$from.sameParent(sel.$to)) {
      const t = state.doc.textBetween(sel.from, sel.to);
      if (!t.includes("\n")) {
        this.find.value = t;
        this.q.text = t;
      }
    }
    this.find.focus();
    this.find.select();
    this.update();
  }

  close() {
    this.root.hidden = true;
    document.body.classList.remove("scrim-find-open");
    setFindResults(this.editor.view, [], -1);
    const m = this.matches[this.current];
    if (m && !this.source.active()) revealMatch(this.editor.view, m);
    this.editor.view.focus();
  }

  /** Recompute matches (after typing, toggles, or document edits). */
  update() {
    const opts = this.editor.options;
    if (this.source.active()) {
      this.sourceMatches = this.q.text ? this.source.find({ ...this.q, source: true }) : [];
      this.matches = [];
      this.current = this.sourceMatches.length ? 0 : -1;
      this.render();
      return;
    }
    const head = this.editor.view.state.selection.from;
    this.matches = findMatches(this.editor.view.state, this.q, opts);
    this.current = this.matches.findIndex((m) => m.from >= head);
    if (this.current < 0 && this.matches.length) this.current = 0;
    this.render();
  }

  private render() {
    const n = this.source.active() ? this.sourceMatches.length : this.matches.length;
    this.counter.textContent = this.q.text ? (n ? `${this.current + 1} of ${n}` : "No results") : "";
    if (!this.source.active()) setFindResults(this.editor.view, this.matches, this.current);
  }

  /** Next / previous match, wrapping (Enter, F3, Mod+G). */
  step(dir: 1 | -1) {
    const n = this.source.active() ? this.sourceMatches.length : this.matches.length;
    if (!n) return;
    this.current = (this.current + dir + n) % n;
    this.render();
    if (this.source.active()) {
      const m = this.sourceMatches[this.current];
      this.source.select(m.from, m.to);
    } else {
      revealMatch(this.editor.view, this.matches[this.current]);
    }
  }

  /** Mod+G / Mod+Shift+G with the bar closed: the last query. */
  again(dir: 1 | -1) {
    if (!this.q.text) return;
    this.update();
    this.step(dir);
  }

  private replaceOne() {
    if (this.source.active()) {
      const m = this.sourceMatches[this.current];
      if (!m) return;
      this.source.replace([{ from: m.from, to: m.to, text: expandReplacement(this.replaceField.value, { groups: m.groups } as Match, this.q.regex) }]);
      this.update();
      this.step(1);
      return;
    }
    const m = this.matches[this.current];
    if (!m) return;
    const view = this.editor.view;
    const tr = view.state.tr;
    replaceMatch(tr, view.state, m, expandReplacement(this.replaceField.value, m, this.q.regex), this.q, this.editor.options);
    view.dispatch(tr);
    const after = tr.mapping.map(m.from);
    this.update();
    this.current = this.matches.findIndex((x) => x.from >= after);
    if (this.matches.length) {
      if (this.current < 0) this.current = 0;
      this.render();
      revealMatch(view, this.matches[this.current]);
    }
  }

  /** Replace All: one undo step, reports the count (8). */
  private replaceAll() {
    if (this.source.active()) {
      const ranges = this.sourceMatches.map((m) => ({ from: m.from, to: m.to, text: expandReplacement(this.replaceField.value, { groups: m.groups } as Match, this.q.regex) }));
      this.source.replace(ranges);
      this.notify(`Replaced ${ranges.length}`);
      this.update();
      return;
    }
    const view = this.editor.view;
    const tr = view.state.tr;
    const list = [...this.matches].reverse();
    for (const m of list) replaceMatch(tr, view.state, m, expandReplacement(this.replaceField.value, m, this.q.regex), this.q, this.editor.options);
    if (list.length) view.dispatch(tr);
    this.notify(`Replaced ${list.length}`);
    this.update();
  }
}
