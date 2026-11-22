// The snippet picker (spec 16, "Picker"): a small floating panel to insert a snippet by
// name. It keeps the editor selection from the moment it opened.

import type { Snippet } from "../editor/snippets";
import { filterSnippets, snippetLabel } from "./local";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export interface PickerHooks {
  snippets(): Snippet[];
  /** Remember the selection (live document or a CodeMirror editor) and return a function
   * that restores it. */
  saveSelection(): () => void;
  insert(s: Snippet): void;
}

export class SnippetPicker {
  private root = el("div", "scrim-snippet-picker");
  private input = el("input", "scrim-snippet-input");
  private list = el("div", "scrim-snippet-list");
  private shown: Snippet[] = [];
  private index = 0;
  private restore: (() => void) | null = null;

  constructor(private hooks: PickerHooks) {
    this.root.hidden = true;
    this.input.type = "text";
    this.input.placeholder = "Insert snippet…";
    this.input.spellcheck = false;
    this.root.append(this.input, this.list);
    document.body.appendChild(this.root);
    this.input.addEventListener("input", () => {
      this.index = 0;
      this.render();
    });
    // The field owns its keys (01, "Keyboard routing").
    this.input.addEventListener("keydown", (e) => {
      const down = e.key === "ArrowDown" || (e.ctrlKey && (e.key === "n" || e.key === "N"));
      const up = e.key === "ArrowUp" || (e.ctrlKey && (e.key === "p" || e.key === "P"));
      if (down || up) {
        e.preventDefault();
        e.stopPropagation();
        if (this.shown.length) this.index = (this.index + (down ? 1 : -1) + this.shown.length) % this.shown.length;
        this.render();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const s = this.shown[this.index];
        if (s) this.choose(s);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      }
    });
    this.input.addEventListener("blur", () => setTimeout(() => this.isOpen && !this.root.contains(document.activeElement) && this.close(false), 0));
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open() {
    if (this.isOpen) return;
    this.restore = this.hooks.saveSelection();
    this.input.value = "";
    this.index = 0;
    this.root.hidden = false;
    this.render();
    this.input.focus();
  }

  /** Escape restores the selection the picker opened with. */
  close(restoreSelection: boolean) {
    if (!this.isOpen) return;
    this.root.hidden = true;
    if (restoreSelection) this.restore?.();
    this.restore = null;
  }

  private choose(s: Snippet) {
    const restore = this.restore;
    this.root.hidden = true;
    this.restore = null;
    restore?.();
    this.hooks.insert(s);
  }

  private render() {
    const all = this.hooks.snippets();
    this.shown = filterSnippets(all.map((s) => ({ ...s, name: snippetLabel(s), orig: s })), this.input.value).map((x) => x.orig);
    this.list.textContent = "";
    if (!all.length) {
      this.list.appendChild(el("div", "scrim-snippet-empty", "No snippets yet. Add some in Preferences → Customize"));
      return;
    }
    if (!this.shown.length) {
      this.list.appendChild(el("div", "scrim-snippet-empty", "No match"));
      return;
    }
    this.shown.forEach((s, i) => {
      const row = el("div", `scrim-snippet-row${i === this.index ? " active" : ""}`);
      row.append(el("span", "scrim-snippet-name", snippetLabel(s)), el("span", "scrim-snippet-body", s.body.replace(/\n/g, " ⏎ ")));
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.choose(s);
      });
      this.list.appendChild(row);
    });
    this.list.children[this.index]?.scrollIntoView({ block: "nearest" });
  }
}
