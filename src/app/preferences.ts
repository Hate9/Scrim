// Preferences (spec 11): an overlay panel over the editor area. Changes apply at once and
// reach every window through settings.json ("scrim://settings-changed").

export type Control =
  | { kind: "toggle"; key: string; label: string; def: boolean; hint?: string }
  | { kind: "select"; key: string; label: string; def: string | number; options: [string | number, string][] | (() => [string | number, string][]); hint?: string }
  | { kind: "text"; key: string; label: string; def: string; placeholder?: string; hint?: string }
  | { kind: "button"; label: string; run: () => void; hint?: string; visible?: () => boolean }
  | { kind: "info"; label: string; text: () => string; hint?: string }
  | { kind: "number"; key: string; label: string; def: number; min?: number; max?: number; step?: number; unit?: string; hint?: string }
  | { kind: "textarea"; key: string; label: string; def: string; placeholder?: string; hint?: string }
  /** custom export commands (09 9.5): name, output extension, command template */
  | { kind: "commands"; key: string; label: string; hint?: string }
  /** a whole pane drawn by its owner (Customize, 18); `label` is for search */
  | { kind: "custom"; label: string; render: () => HTMLElement; hint?: string };

export interface Group {
  title: string;
  hint?: string;
  controls: Control[];
}

export interface Section {
  id: string;
  title: string;
  groups: Group[];
  visible?: () => boolean;
}

export interface PreferencesHooks {
  setting<T>(key: string, fallback: T): T;
  setSetting(key: string, value: unknown): void;
  sections(): Section[];
  closed(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export class Preferences {
  private root: HTMLDivElement;
  private search: HTMLInputElement;
  private list: HTMLDivElement;
  private body: HTMLDivElement;
  private section = "general";

  constructor(private hooks: PreferencesHooks) {
    this.root = el("div", "scrim-preferences");
    this.root.id = "scrim-preferences";
    this.root.hidden = true;
    this.root.tabIndex = -1;
    const header = el("div", "scrim-preferences-header");
    const close = el("button", "scrim-preferences-close", "×");
    close.type = "button";
    close.title = "Close (Escape)";
    close.addEventListener("click", () => this.close());
    header.append(el("div", "scrim-preferences-title", "Preferences"), close);
    const left = el("div", "scrim-preferences-left");
    this.search = el("input", "scrim-preferences-search");
    this.search.type = "search";
    this.search.placeholder = "Search for…";
    this.search.addEventListener("input", () => this.render());
    this.list = el("div", "scrim-preferences-sections");
    left.append(this.search, this.list);
    this.body = el("div", "scrim-preferences-body");
    const main = el("div", "scrim-preferences-main");
    main.append(left, this.body);
    this.root.append(header, main);
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    document.body.appendChild(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(section?: string) {
    if (section) this.section = section;
    this.position();
    this.root.hidden = false;
    this.render();
    this.search.focus();
  }

  close() {
    this.root.hidden = true;
    this.search.value = "";
    this.hooks.closed();
  }

  /** Re-render (another window changed a setting). */
  refresh() {
    if (this.isOpen) this.render();
  }

  /** Cover the editor area, not the sidebar (11). */
  private position() {
    const area = document.querySelector("content")!.getBoundingClientRect();
    const top = document.getElementById("scrim-topbars")!.getBoundingClientRect().top;
    const footer = document.querySelector("footer")!.getBoundingClientRect();
    Object.assign(this.root.style, {
      left: `${area.left}px`,
      top: `${Math.min(top, area.top)}px`,
      width: `${area.width}px`,
      height: `${(footer.height ? footer.bottom : area.bottom) - Math.min(top, area.top)}px`,
    });
  }

  private visibleSections(): Section[] {
    return this.hooks.sections().filter((s) => !s.visible || s.visible());
  }

  private matches(c: Control, q: string): boolean {
    if (!q) return true;
    if (c.kind === "button" && c.visible && !c.visible()) return false;
    return c.label.toLowerCase().includes(q) || (!!c.hint && c.hint.toLowerCase().includes(q));
  }

  private render() {
    const q = this.search.value.trim().toLowerCase();
    const sections = this.visibleSections();
    // Searching: sections with matching controls stay in the list; others go (11).
    const shown = q ? sections.filter((s) => s.groups.some((g) => g.controls.some((c) => this.matches(c, q)))) : sections;
    if (!shown.some((s) => s.id === this.section) && shown.length) this.section = shown[0].id;
    this.list.textContent = "";
    for (const s of shown) {
      const row = el("div", `scrim-preferences-section${s.id === this.section ? " active" : ""}`, s.title);
      row.dataset.section = s.id;
      row.addEventListener("click", () => {
        this.section = s.id;
        this.render();
      });
      this.list.appendChild(row);
    }
    this.body.textContent = "";
    const current = shown.find((s) => s.id === this.section);
    if (!current) {
      this.body.appendChild(el("div", "scrim-preferences-empty", "No settings match."));
      return;
    }
    this.body.appendChild(el("div", "scrim-preferences-section-title", current.title));
    for (const g of current.groups) {
      const controls = g.controls.filter((c) => this.matches(c, q) && !(c.kind === "button" && c.visible && !c.visible()));
      if (!controls.length) continue;
      const group = el("div", "scrim-preferences-group");
      if (g.title) {
        const head = el("div", "scrim-preferences-group-title", g.title);
        if (g.hint) head.appendChild(el("span", "scrim-preferences-hint", ` (${g.hint})`));
        group.appendChild(head);
      }
      for (const c of controls) group.appendChild(this.control(c));
      this.body.appendChild(group);
    }
  }

  private control(c: Control): HTMLElement {
    const row = el("div", "scrim-preferences-control");
    row.dataset.label = c.label;
    const hint = "hint" in c && c.hint ? el("div", "scrim-preferences-hint", c.hint) : null;
    switch (c.kind) {
      case "toggle": {
        const label = el("label");
        const box = el("input");
        box.type = "checkbox";
        box.checked = this.hooks.setting(c.key, c.def);
        box.addEventListener("change", () => this.hooks.setSetting(c.key, box.checked));
        label.append(box, document.createTextNode(` ${c.label}`));
        row.appendChild(label);
        break;
      }
      case "select": {
        const label = el("label", "", `${c.label} `);
        const sel = el("select");
        const opts = typeof c.options === "function" ? c.options() : c.options;
        const cur = this.hooks.setting(c.key, c.def);
        for (const [v, text] of opts) {
          const o = el("option", "", text);
          o.value = String(v);
          o.selected = String(v) === String(cur);
          sel.appendChild(o);
        }
        sel.addEventListener("change", () => {
          const picked = opts.find(([v]) => String(v) === sel.value);
          this.hooks.setSetting(c.key, picked ? picked[0] : sel.value);
        });
        label.appendChild(sel);
        row.appendChild(label);
        break;
      }
      case "text": {
        const label = el("label", "", `${c.label} `);
        const input = el("input");
        input.type = "text";
        input.value = this.hooks.setting(c.key, c.def);
        if (c.placeholder) input.placeholder = c.placeholder;
        input.addEventListener("change", () => this.hooks.setSetting(c.key, input.value));
        label.appendChild(input);
        row.appendChild(label);
        break;
      }
      case "number": {
        const label = el("label", "", `${c.label} `);
        const input = el("input", "scrim-preferences-number");
        input.type = "number";
        if (c.min !== undefined) input.min = String(c.min);
        if (c.max !== undefined) input.max = String(c.max);
        input.step = String(c.step ?? 1);
        input.value = String(this.hooks.setting(c.key, c.def));
        input.addEventListener("change", () => {
          const v = Number(input.value);
          if (input.value.trim() === "" || !Number.isFinite(v)) input.value = String(this.hooks.setting(c.key, c.def));
          else this.hooks.setSetting(c.key, v);
        });
        label.appendChild(input);
        if (c.unit) label.appendChild(document.createTextNode(` ${c.unit}`));
        row.appendChild(label);
        break;
      }
      case "textarea": {
        const label = el("label", "scrim-preferences-block", c.label);
        const input = el("textarea", "scrim-preferences-textarea");
        input.rows = 3;
        input.spellcheck = false;
        input.value = this.hooks.setting(c.key, c.def);
        if (c.placeholder) input.placeholder = c.placeholder;
        input.addEventListener("change", () => this.hooks.setSetting(c.key, input.value));
        label.appendChild(input);
        row.appendChild(label);
        break;
      }
      case "commands": {
        type Cmd = { name: string; ext: string; command: string };
        const read = (): Cmd[] => {
          const v = this.hooks.setting<unknown>(c.key, []);
          return Array.isArray(v) ? v.map((x) => ({ name: String(x?.name ?? ""), ext: String(x?.ext ?? ""), command: String(x?.command ?? "") })) : [];
        };
        const box = el("div", "scrim-preferences-commands");
        const draw = () => {
          box.textContent = "";
          box.appendChild(el("div", "scrim-preferences-group-title", c.label));
          const list = read();
          list.forEach((cmd, i) => {
            const line = el("div", "scrim-preferences-command");
            const field = (k: keyof Cmd, ph: string, cls: string) => {
              const f = el("input", cls);
              f.type = "text";
              f.placeholder = ph;
              f.value = cmd[k];
              f.spellcheck = false;
              f.addEventListener("change", () => {
                const next = read();
                next[i] = { ...next[i], [k]: f.value };
                this.hooks.setSetting(c.key, next);
              });
              return f;
            };
            const remove = el("button", "scrim-preferences-button", "Remove");
            remove.type = "button";
            remove.addEventListener("click", () => {
              this.hooks.setSetting(c.key, read().filter((_, j) => j !== i));
              draw();
            });
            line.append(field("name", "Name", "scrim-cmd-name"), field("ext", "ext", "scrim-cmd-ext"), field("command", "command {{input}} {{output}}", "scrim-cmd-command"), remove);
            box.appendChild(line);
          });
          const add = el("button", "scrim-preferences-button", "Add Command");
          add.type = "button";
          add.addEventListener("click", () => {
            this.hooks.setSetting(c.key, [...read(), { name: "", ext: "", command: "" }]);
            draw();
          });
          box.appendChild(add);
        };
        draw();
        row.appendChild(box);
        break;
      }
      case "custom":
        row.appendChild(c.render());
        break;
      case "button": {
        const b = el("button", "scrim-preferences-button", c.label);
        b.type = "button";
        b.addEventListener("click", () => c.run());
        row.appendChild(b);
        break;
      }
      case "info":
        row.append(el("span", "", `${c.label}: `), el("span", "scrim-preferences-info", c.text()));
        break;
    }
    if (hint) row.appendChild(hint);
    return row;
  }
}
