// Preferences → Customize (spec 18): Snippets & Tags, base.user.css, config.jsonc.
//
// The pane keeps one DOM tree for the window's lifetime, so switching tabs, sections, or
// closing Preferences keeps unsaved text (no prompt).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState as CMState, type Extension } from "@codemirror/state";
import { EditorView as CMView, keymap, lineNumbers } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { keyIdentity, normalizeAccelerator } from "../editor/keys";
import { loadLanguage, scrimHighlighter } from "../editor/codeview";
import { parseTagList, tagProblem, customTags, STANDARD_ELEMENTS } from "../md/customtags";
import type { Snippet } from "../editor/snippets";
import { DEFAULT_PICKER_KEY, type LocalData, type LocalStore } from "./local";

export interface CustomizeHooks {
  local: LocalStore;
  /** menu items with a key: "Format → Strong" and its accelerator */
  menuShortcuts(): { path: string; key: string }[];
  /** suspend every app shortcut while a shortcut field captures keys */
  capturing(on: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** A key event as `Ctrl+Alt+Shift+Super+Key` (18), or a verdict for bare keys. */
export function capturedShortcut(e: Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">): string | "clear" | "cancel" | null {
  if (["Control", "Alt", "Shift", "Meta", "AltGraph", "OS", "Super"].includes(e.key)) return null;
  const mods = e.ctrlKey || e.altKey || e.metaKey;
  if (!mods && !e.shiftKey) {
    if (e.key === "Backspace" || e.key === "Delete") return "clear";
    if (e.key === "Escape") return "cancel";
  }
  const k = keyIdentity({ key: e.key, code: e.code, shiftKey: false, altKey: false, ctrlKey: false });
  if (!k) return null;
  if (!mods && !/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) return null;
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super", k].filter(Boolean).join("+");
}

/** Same accelerator, modifier aliases and order ignored. */
export function sameShortcut(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normalizeAccelerator(a);
  return !!na && na === normalizeAccelerator(b);
}

/** Tags a snippet body uses that are neither standard nor registered (17, "Helping"). */
export function unknownTags(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/<([A-Za-z][A-Za-z0-9-]*)/g)) {
    const n = m[1].toLowerCase();
    if (STANDARD_ELEMENTS.has(n) || customTags.inline.has(n) || customTags.block.has(n) || tagProblem(n) === "not a tag name") continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

type TabId = "snippets" | "css" | "config";

class FileTab {
  root = el("div", "scrim-cz-file");
  private pathEl = el("div", "scrim-cz-path");
  private host = el("div", "scrim-cz-editor");
  private errorEl = el("div", "scrim-cz-error");
  private banner = el("div", "scrim-cz-banner");
  view: CMView | null = null;
  saved = "";
  dirty = false;
  onDirty: () => void = () => {};

  constructor(
    private load: () => Promise<{ path: string; text: string }>,
    private save: (text: string) => Promise<string | null>,
    private lang: string,
    private status: (s: string, error?: boolean) => void,
  ) {
    const bar = el("div", "scrim-cz-buttons");
    const saveBtn = el("button", "scrim-preferences-button", "Save");
    saveBtn.type = "button";
    saveBtn.addEventListener("click", () => void this.doSave());
    const revert = el("button", "scrim-preferences-button", "Revert");
    revert.type = "button";
    revert.addEventListener("click", () => this.setText(this.saved, false));
    bar.append(saveBtn, revert);
    this.banner.hidden = true;
    this.errorEl.hidden = true;
    this.root.append(this.pathEl, this.banner, this.host, this.errorEl, bar);
  }

  async init() {
    const f = await this.load();
    this.pathEl.textContent = f.path;
    this.saved = f.text;
    const lang = await loadLanguage(this.lang).catch(() => null);
    const exts: Extension[] = [
      lineNumbers(),
      history(),
      keymap.of([
        { key: "Mod-s", run: () => (void this.doSave(), true) },
        { key: "Tab", run: (v) => (v.dispatch(v.state.replaceSelection("  ")), true) },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      syntaxHighlighting(scrimHighlighter),
      CMView.lineWrapping,
      CMView.updateListener.of((u) => {
        if (!u.docChanged) return;
        const d = u.state.doc.toString() !== this.saved;
        if (d !== this.dirty) {
          this.dirty = d;
          this.onDirty();
        }
      }),
    ];
    if (lang) exts.push(lang);
    this.view = new CMView({ state: CMState.create({ doc: f.text, extensions: exts }), parent: this.host });
  }

  text(): string {
    return this.view?.state.doc.toString() ?? this.saved;
  }

  setText(text: string, asSaved: boolean) {
    if (!this.view) return;
    if (asSaved) this.saved = text;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
    this.dirty = text !== this.saved;
    this.banner.hidden = true;
    this.errorEl.hidden = true;
    this.onDirty();
  }

  /** The file changed on disk (18): reload silently, or ask when there are edits. */
  async changedOnDisk() {
    const f = await this.load();
    if (f.text === this.saved) return;
    if (!this.dirty) {
      this.setText(f.text, true);
      return;
    }
    this.banner.textContent = "Changed on disk: ";
    const reload = el("button", "scrim-preferences-button", "Reload");
    reload.type = "button";
    reload.addEventListener("click", () => this.setText(f.text, true));
    const keep = el("button", "scrim-preferences-button", "Keep mine");
    keep.type = "button";
    keep.addEventListener("click", () => (this.banner.hidden = true));
    this.banner.append(reload, " ", keep);
    this.banner.hidden = false;
  }

  async doSave() {
    const text = this.text();
    this.status("Saving…");
    const err = await this.save(text);
    if (err) {
      this.errorEl.textContent = err;
      this.errorEl.hidden = false;
      return;
    }
    this.errorEl.hidden = true;
    this.saved = text;
    this.dirty = false;
    this.onDirty();
  }
}

export class CustomizePane {
  root = el("div", "scrim-customize");
  private tabs = el("div", "scrim-cz-tabs");
  private statusEl = el("span", "scrim-cz-status");
  private body = el("div", "scrim-cz-body");
  private tab: TabId = "snippets";
  private snippetsTab = el("div", "scrim-cz-snippets");
  private css: FileTab;
  private config: FileTab;
  private initialized = false;
  /** the Snippets & Tags data being edited (saved 400 ms after the last change) */
  private data: LocalData | null = null;
  private saveTimer = 0;
  private pendingSave = false;
  private snippetsDrawn = false;

  constructor(private hooks: CustomizeHooks) {
    this.css = new FileTab(
      () => invoke("user_css_get"),
      async (text) => {
        await invoke("user_css_save", { text });
        this.status("Saved");
        return null;
      },
      "css",
      (s, e) => this.status(s, e),
    );
    this.config = new FileTab(
      () => invoke("config_text"),
      async (text) => {
        const before = this.config.saved;
        try {
          await invoke("config_save", { text });
        } catch (e) {
          this.status("Not saved: invalid config", true);
          return String(e);
        }
        this.status(restartNeeded(before, text) ? "Saved. Some options apply after restart" : "Saved");
        return null;
      },
      "json",
      (s, e) => this.status(s, e),
    );
    this.css.onDirty = () => this.renderTabs();
    this.config.onDirty = () => this.renderTabs();
    this.root.append(this.tabs, this.body);
    hooks.local.onChange.push(() => {
      // An external edit (or another window): take it unless this pane has edits pending.
      if (!this.pendingSave) {
        this.data = null;
        this.snippetsDrawn = false;
        if (this.tab === "snippets" && this.root.isConnected && !this.root.contains(document.activeElement)) this.renderSnippets();
      }
    });
    void listen("scrim://themes-changed", () => void this.css.changedOnDisk());
    void listen("scrim://config-changed", () => void this.config.changedOnDisk());
  }

  /** Show a tab (config.jsonc for "Open Advanced Settings"). */
  async show(tab?: TabId) {
    if (!this.initialized) {
      this.initialized = true;
      await Promise.all([this.css.init(), this.config.init()]);
    }
    if (tab) this.tab = tab;
    this.renderTabs();
    // Drawn once and kept (focus and caret survive Preferences re-rendering); redrawn when
    // the data changes underneath. Only swapped in when another tab is showing: taking out
    // and putting back the same tab drops the focus of a field in it without a blur event
    // (WebKit), which lost a shortcut field's focus (K-5).
    if (this.tab === "snippets" && !this.snippetsDrawn) this.renderSnippets();
    const f = this.tab === "css" ? this.css : this.tab === "config" ? this.config : null;
    const want = f ? f.root : this.snippetsTab;
    if (this.body.childNodes.length !== 1 || this.body.firstChild !== want) {
      const a = document.activeElement;
      this.body.replaceChildren(want);
      if (a instanceof HTMLElement && a !== document.body && want.contains(a)) a.focus();
    }
    f?.view?.requestMeasure();
  }

  private status(text: string, error = false) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("error", error);
  }

  private renderTabs() {
    this.tabs.textContent = "";
    const dirtySnippets = this.pendingSave;
    const entries: [TabId, string, boolean][] = [
      ["snippets", "Snippets & Tags", dirtySnippets],
      ["css", "base.user.css", this.css.dirty],
      ["config", "config.jsonc", this.config.dirty],
    ];
    for (const [id, label, dirty] of entries) {
      const b = el("button", `scrim-cz-tab${id === this.tab ? " active" : ""}`, dirty ? `${label} •` : label);
      b.type = "button";
      b.addEventListener("click", () => void this.show(id));
      this.tabs.appendChild(b);
    }
    this.tabs.appendChild(this.statusEl);
  }

  // ---- Tab 1 ---------------------------------------------------------------------------

  private edit(): LocalData {
    if (!this.data) this.data = structuredClone(this.hooks.local.data);
    return this.data;
  }

  private changed() {
    this.pendingSave = true;
    this.renderTabs();
    this.status("Saving…");
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), 400);
  }

  private async flush() {
    if (!this.data) return;
    try {
      await this.hooks.local.save(this.data);
      this.pendingSave = false;
      this.status("Saved");
    } catch (e) {
      this.status(String(e), true);
    }
    this.renderTabs();
  }

  /** Every other user of an accelerator (18, "Conflicts"). */
  private usersOf(key: string, self: string): string[] {
    if (!key) return [];
    const d = this.edit();
    const out: string[] = [];
    for (const m of this.hooks.menuShortcuts()) if (sameShortcut(m.key, key)) out.push(m.path);
    d.snippets.forEach((s, i) => {
      if (`snippet:${i}` !== self && sameShortcut(s.key, key)) out.push(`Snippet "${s.name || s.body.slice(0, 20)}"`);
    });
    if (self !== "picker" && sameShortcut(d.pickerKey, key)) out.push("Snippet picker");
    return out;
  }

  private shortcutField(value: string, self: string, onSet: (key: string) => void): HTMLInputElement {
    const f = el("input", "scrim-shortcut-field");
    f.type = "text";
    f.readOnly = true;
    f.value = value;
    f.placeholder = "Click, then press keys";
    f.addEventListener("focus", () => {
      f.placeholder = "Press a shortcut…";
      this.hooks.capturing(true);
    });
    f.addEventListener("blur", () => {
      f.placeholder = "Click, then press keys";
      this.hooks.capturing(false);
    });
    f.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const got = capturedShortcut(e);
      if (got === null) return;
      if (got === "cancel") {
        f.value = value;
        f.blur();
        return;
      }
      const key = got === "clear" ? "" : got;
      f.value = key;
      onSet(key);
      f.blur();
    });
    void self;
    return f;
  }

  private renderSnippets() {
    const d = this.edit();
    const t = this.snippetsTab;
    this.snippetsDrawn = true;
    t.textContent = "";

    // Snippets
    const g = el("div", "scrim-preferences-group");
    const head = el("div", "scrim-preferences-group-title", "Snippets");
    head.appendChild(el("span", "scrim-preferences-hint", " ($0 = cursor, or where selected text goes. $$ = literal $.)"));
    g.appendChild(head);
    if (!d.snippets.length) g.appendChild(el("div", "scrim-cz-muted", "No snippets yet."));
    d.snippets.forEach((s, i) => g.appendChild(this.card(s, i)));
    const add = el("button", "scrim-preferences-button", "Add Snippet");
    add.type = "button";
    add.addEventListener("click", () => {
      d.snippets.push({ name: "", key: "", body: "" });
      this.changed();
      this.renderSnippets();
      (t.querySelectorAll<HTMLInputElement>(".scrim-cz-name")[d.snippets.length - 1])?.focus();
    });
    g.appendChild(add);
    t.appendChild(g);

    // Picker shortcut
    const p = el("div", "scrim-preferences-group");
    const ph = el("div", "scrim-preferences-group-title", "Snippet Picker Shortcut");
    ph.appendChild(el("span", "scrim-preferences-hint", " (filter snippets by name)"));
    const pickerWarn = el("div", "scrim-cz-warn");
    const showPickerWarn = () => {
      const u = this.usersOf(d.pickerKey, "picker");
      pickerWarn.textContent = u.length ? `Also used by: ${u.join(", ")}` : "";
      pickerWarn.hidden = !u.length;
    };
    const pf = this.shortcutField(d.pickerKey || DEFAULT_PICKER_KEY, "picker", (k) => {
      d.pickerKey = k;
      this.changed();
      showPickerWarn();
    });
    showPickerWarn();
    p.append(ph, pf, pickerWarn);
    t.appendChild(p);

    // Custom HTML tags
    const c = el("div", "scrim-preferences-group");
    const chead = el("div", "scrim-preferences-group-title", "Custom HTML Tags");
    chead.appendChild(el("span", "scrim-preferences-hint", " (Rendered as real elements. Style them in base.user.css.)"));
    c.appendChild(chead);
    for (const kind of ["inline", "block"] as const) {
      const row = el("label", "scrim-cz-tagrow", kind === "inline" ? "Inline " : "Block ");
      const f = el("input", `scrim-cz-tags scrim-cz-tags-${kind}`);
      f.type = "text";
      f.spellcheck = false;
      f.value = d.customHTMLTags[kind].join(", ");
      const ignored = el("div", "scrim-cz-warn");
      const showIgnored = () => {
        const r = parseTagList(f.value);
        ignored.textContent = r.ignored.map((x) => `Ignored (${x.why}): ${x.name}`).join(" · ");
        ignored.hidden = !r.ignored.length;
        return r;
      };
      showIgnored();
      f.addEventListener("input", () => {
        d.customHTMLTags[kind] = showIgnored().names;
        this.changed();
      });
      row.appendChild(f);
      c.append(row, ignored);
    }
    c.appendChild(el("div", "scrim-cz-muted", "Inline tags work like <span> inside paragraphs. A line starting with a block tag becomes an HTML block (no Markdown inside)."));
    t.appendChild(c);
  }

  private card(s: Snippet, i: number): HTMLElement {
    const d = this.edit();
    const card = el("div", "scrim-cz-card");
    const row = el("div", "scrim-cz-row");
    const name = el("input", "scrim-cz-name");
    name.type = "text";
    name.placeholder = "Name";
    name.value = s.name;
    name.addEventListener("input", () => {
      s.name = name.value;
      this.changed();
    });
    const warn = el("div", "scrim-cz-warn");
    const body = el("textarea", "scrim-cz-bodyfield");
    const showWarnings = () => {
      warn.textContent = "";
      const users = this.usersOf(s.key, `snippet:${i}`);
      if (users.length) warn.appendChild(el("div", "", `Also used by: ${users.join(", ")}`));
      for (const tag of unknownTags(s.body)) {
        const line = el("div", "", `<${tag}> isn't a registered custom tag, so it will show as text. `);
        for (const kind of ["inline", "block"] as const) {
          const b = el("button", "scrim-preferences-button", kind === "inline" ? "Add as inline" : "Add as block");
          b.type = "button";
          b.addEventListener("click", () => {
            if (!d.customHTMLTags[kind].includes(tag)) d.customHTMLTags[kind].push(tag);
            // Registered at once (17), so the warning goes away.
            customTags[kind].add(tag);
            this.changed();
            this.renderSnippets();
          });
          line.append(b, " ");
        }
        warn.appendChild(line);
      }
      warn.hidden = !warn.childNodes.length;
    };
    const key = this.shortcutField(s.key, `snippet:${i}`, (k) => {
      s.key = k;
      this.changed();
      showWarnings();
    });
    const del = el("button", "scrim-cz-delete", "✕");
    del.type = "button";
    del.title = "Delete snippet";
    del.addEventListener("click", () => {
      d.snippets.splice(i, 1);
      this.changed();
      this.renderSnippets();
    });
    row.append(name, key, del);
    body.spellcheck = false;
    body.placeholder = "<bottom>$0</bottom>";
    body.value = s.body;
    const fit = () => (body.rows = Math.min(8, Math.max(2, body.value.split("\n").length)));
    fit();
    body.addEventListener("input", () => {
      s.body = body.value;
      fit();
      showWarnings();
      this.changed();
    });
    showWarnings();
    card.append(row, warn, body);
    return card;
  }
}

/** config.jsonc keys that only apply at startup. */
const RESTART_KEYS = ["webviewFlags", "defaultFonts"];

function restartNeeded(before: string, after: string): boolean {
  // Comments are allowed, so compare each key's line of raw text.
  const grab = (t: string, k: string) => new RegExp(`"${k}"\\s*:\\s*([^\\n]*)`).exec(t)?.[1] ?? "";
  return RESTART_KEYS.some((k) => grab(before, k) !== grab(after, k));
}
