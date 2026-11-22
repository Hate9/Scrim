// Keyboard routing (spec 01, "Keyboard routing"): one dispatcher owns all commands.
//
// Keys arrive as DOM keydown (capture phase) and, from P4 on, as native accelerator
// events forwarded from the menu; both are normalized to the same accelerator string and
// run at most once per keypress. Clipboard and undo keys are never handled here: the
// webview fires the DOM events and ProseMirror handles them (rule 2).

const US_PUNCT: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  IntlBackslash: "\\",
};

const NAMED: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  " ": "Space",
  Spacebar: "Space",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
};

/** Rule 5: the key part of an accelerator for a keydown event, or null for modifiers. */
export function keyIdentity(e: Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "altKey" | "ctrlKey">): string | null {
  const { key, code } = e;
  if (["Control", "Shift", "Alt", "Meta", "AltGraph", "OS", "Dead", "Process", "Unidentified"].includes(key)) {
    if (key !== "Dead" && key !== "Unidentified" && key !== "Process") return null;
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  if (NAMED[key]) return NAMED[key];
  const letter = /^Key([A-Z])$/.exec(code);
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toUpperCase();
  if (letter && (key.length !== 1 || !/[\x21-\x7e]/.test(key))) return letter[1]; // non-Latin layout
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (!e.shiftKey && key.length === 1 && /[0-9!-\/:-@\[-`{-~]/.test(key) && !e.altKey) return key;
  if (digit) return digit[1];
  if (US_PUNCT[code]) return US_PUNCT[code];
  if (letter) return letter[1];
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Normalized accelerator, e.g. `Ctrl+Shift+K`. Mod is Ctrl on Linux and Windows. */
export function accelerator(e: KeyboardEvent): string | null {
  const k = keyIdentity(e);
  if (!k) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(k);
  return parts.join("+");
}

/** Keys that stay with the webview / ProseMirror (rule 2). */
const NATIVE = new Set(["Ctrl+C", "Ctrl+X", "Ctrl+V", "Ctrl+Shift+V", "Ctrl+A", "Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z"]);

/** "document": live document focused; "editing": the live document or a CodeMirror editor
 * of it (code blocks, source mode), for snippets (16); "global": file/window/view. */
export type Scope = "document" | "editing" | "global";
export type Source = "dom" | "native";

export interface CommandDef {
  id: string;
  key: string;
  /** "document": only with focus in the document; "global": file/window/view commands */
  scope: Scope;
  run(): boolean | void | Promise<unknown>;
}

const KEY_ALIASES: Record<string, string> = {
  ESCAPE: "Esc", ESC: "Esc", RETURN: "Enter", ENTER: "Enter", TAB: "Tab", SPACE: "Space",
  BACKSPACE: "Backspace", DELETE: "Delete", DEL: "Delete", HOME: "Home", END: "End",
  PAGEUP: "PageUp", PAGEDOWN: "PageDown", INSERT: "Insert", UP: "Up", DOWN: "Down",
  LEFT: "Left", RIGHT: "Right", ARROWUP: "Up", ARROWDOWN: "Down", ARROWLEFT: "Left",
  ARROWRIGHT: "Right", PLUS: "=", EQUAL: "=", MINUS: "-", BACKQUOTE: "`", COMMA: ",",
  PERIOD: ".", SLASH: "/", BACKSLASH: "\\", SEMICOLON: ";", QUOTE: "'", BRACKETLEFT: "[",
  BRACKETRIGHT: "]",
};

/**
 * Normalize a user-written accelerator ("ctrl+shift+b", "CmdOrCtrl+B", "Mod+Alt+Up") to
 * the dispatcher's form (`Ctrl+Alt+Shift+Key`), or null when it cannot be read.
 */
export function normalizeAccelerator(text: string): string | null {
  const parts = text.trim().split(/\s*\+\s*(?=.)/);
  if (!parts.length || !parts[0]) return null;
  let ctrl = false, alt = false, shift = false;
  let key: string | null = null;
  for (const raw of parts) {
    const p = raw.toUpperCase();
    if (["CTRL", "CONTROL", "MOD", "CMD", "CMDORCTRL", "COMMANDORCONTROL", "COMMAND", "META", "SUPER"].includes(p)) ctrl = true;
    else if (p === "ALT" || p === "OPTION") alt = true;
    else if (p === "SHIFT") shift = true;
    else if (key !== null) return null;
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(p)) key = p;
    else if (KEY_ALIASES[p]) key = KEY_ALIASES[p];
    else if (/^(KEY)?[A-Z]$/.test(p)) key = p.slice(-1);
    else if (/^(DIGIT)?[0-9]$/.test(p)) key = p.slice(-1);
    else if (raw.length === 1 && /[\x21-\x7e]/.test(raw)) key = raw;
    else return null;
  }
  if (key === null) return null;
  return [ctrl && "Ctrl", alt && "Alt", shift && "Shift", key].filter(Boolean).join("+");
}

export class Dispatcher {
  private byKey = new Map<string, CommandDef>();
  readonly byId = new Map<string, CommandDef>();
  private last: { acc: string; time: number; source: Source } | null = null;

  /** Default keys, so overrides can be undone when config.jsonc changes again. */
  private defaults = new Map<string, string>();

  /** Commands added at run time (snippets, 16); their keys win over built-in ones. */
  private extras: CommandDef[] = [];
  /** While a shortcut field captures keys (18), no command runs. */
  suspended = false;

  constructor(
    commands: CommandDef[],
    private isDocumentFocused: () => boolean,
    private isEditingFocused: () => boolean = isDocumentFocused,
  ) {
    for (const c of commands) {
      this.byId.set(c.id, c);
      this.defaults.set(c.id, c.key);
      if (c.key) this.byKey.set(c.key, c);
    }
  }

  /** The current key of a command ("" when unbound). */
  keyOf(id: string): string {
    return this.byId.get(id)?.key ?? "";
  }

  /** Apply `shortcuts` overrides (id → normalized key, "" unbinds) on top of the
   * defaults (12). A key taken by an override is removed from its default owner. */
  rebind(overrides: Map<string, string>) {
    this.byKey.clear();
    for (const [id, c] of this.byId) c.key = overrides.has(id) ? overrides.get(id)! : this.defaults.get(id)!;
    const taken = new Set([...overrides.values()].filter(Boolean));
    for (const [id, c] of this.byId) {
      if (!c.key) continue;
      if (taken.has(c.key) && !overrides.has(id)) {
        c.key = "";
        continue;
      }
      this.byKey.set(c.key, c);
    }
  }

  /** Replace the run-time commands (snippets). A key they use is theirs (16: "the snippet
   * wins"). */
  setExtras(commands: CommandDef[]) {
    for (const c of this.extras) {
      this.byId.delete(c.id);
      this.defaults.delete(c.id);
      if (this.byKey.get(c.key) === c) this.byKey.delete(c.key);
    }
    this.extras = commands;
    for (const c of commands) {
      this.byId.set(c.id, c);
      this.defaults.set(c.id, c.key);
    }
    // Rebuild the key table: built-ins first, extras over them.
    const builtIns = [...this.byId.values()].filter((c) => !commands.includes(c));
    this.byKey.clear();
    for (const c of builtIns) if (c.key) this.byKey.set(c.key, c);
    for (const c of commands) if (c.key) this.byKey.set(c.key, c);
  }

  private allowed(cmd: CommandDef): boolean {
    if (cmd.scope === "document") return this.isDocumentFocused();
    if (cmd.scope === "editing") return this.isEditingFocused();
    return true;
  }

  /** Run a command by id (menu clicks). Same scope rule as keys; false if it did not run. */
  runId(id: string, source: Source = "native"): boolean {
    const cmd = this.byId.get(id);
    if (!cmd) return false;
    if (cmd.key) {
      const now = performance.now();
      if (this.last && this.last.acc === cmd.key && this.last.source !== source && now - this.last.time < 100) {
        this.last = null;
        return true;
      }
      this.last = { acc: cmd.key, time: now, source };
    }
    if (!this.allowed(cmd)) return false;
    void cmd.run();
    return true;
  }

  /**
   * Handle one accelerator; true when a command ran (or was a duplicate). One physical
   * keypress can arrive both as a DOM keydown and as a native accelerator event; the
   * second arrival from the other source within 100 ms is dropped (rule 1).
   */
  dispatch(acc: string, source: Source = "dom"): boolean {
    if (this.suspended || NATIVE.has(acc)) return false;
    const cmd = this.byKey.get(acc);
    if (!cmd) return false;
    const now = performance.now();
    if (this.last && this.last.acc === acc && this.last.source !== source && now - this.last.time < 100) {
      this.last = null;
      return true;
    }
    this.last = { acc, time: now, source };
    if (!this.allowed(cmd)) return false;
    void cmd.run();
    return true;
  }

  attach(target: Window) {
    target.addEventListener(
      "keydown",
      (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        // Browser shortcuts that must never reach the webview (rule 4).
        if (e.key === "F5" || (e.ctrlKey && !e.shiftKey && (e.key === "r" || e.key === "R"))) {
          e.preventDefault();
          return;
        }
        const acc = accelerator(e);
        if (!acc) return;
        if (this.dispatch(acc)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
  }
}
