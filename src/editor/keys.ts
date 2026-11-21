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

export type Scope = "document" | "global";
export type Source = "dom" | "native";

export interface CommandDef {
  id: string;
  key: string;
  /** "document": only with focus in the document; "global": file/window/view commands */
  scope: Scope;
  run(): boolean | void | Promise<unknown>;
}

export class Dispatcher {
  private byKey = new Map<string, CommandDef>();
  private last: { acc: string; time: number; source: Source } | null = null;

  constructor(commands: CommandDef[], private isDocumentFocused: () => boolean) {
    for (const c of commands) if (c.key) this.byKey.set(c.key, c);
  }

  /**
   * Handle one accelerator; true when a command ran (or was a duplicate). One physical
   * keypress can arrive both as a DOM keydown and as a native accelerator event; the
   * second arrival from the other source within 100 ms is dropped (rule 1).
   */
  dispatch(acc: string, source: Source = "dom"): boolean {
    if (NATIVE.has(acc)) return false;
    const cmd = this.byKey.get(acc);
    if (!cmd) return false;
    const now = performance.now();
    if (this.last && this.last.acc === acc && this.last.source !== source && now - this.last.time < 100) {
      this.last = null;
      return true;
    }
    this.last = { acc, time: now, source };
    if (cmd.scope === "document" && !this.isDocumentFocused()) return false;
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
