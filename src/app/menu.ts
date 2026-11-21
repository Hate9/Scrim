// The native menu bar (spec 12), built per window with Tauri's menu API.
//
// Every item runs a command through the dispatcher (01, "Keyboard routing" rule 1), so a
// key and a click behave the same. Items carry their English label, which is also the
// key for `shortcuts` overrides in config.jsonc.
//
// Native accelerators: on Linux, GTK runs menu accelerators before the webview sees the
// key. Clipboard and undo keys never get one (rule 2), and neither do keys that text
// fields and CodeMirror need themselves (SPEC-QUESTION Q-017): those items show their key in
// the label only, and the key reaches the dispatcher as a DOM keydown.

import { Menu, MenuItem, Submenu, CheckMenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Dispatcher } from "../editor/keys";
import { normalizeAccelerator } from "../editor/keys";

export interface MenuNode {
  label: string;
  /** command id; absent for submenus and separators */
  id?: string;
  /** for dynamic items (recent files, themes) that are not dispatcher commands */
  run?: () => void;
  /** shown as the shortcut when the command's key is handled natively by the webview */
  display?: string;
  /** checkbox state (toggles, radio-like lists) */
  checked?: () => boolean;
  children?: MenuNode[] | (() => MenuNode[]);
  sep?: true;
  enabled?: () => boolean;
  visible?: () => boolean;
}

export const SEP: MenuNode = { label: "", sep: true };

// SPEC-QUESTION Q-017
/** Keys that never become native accelerators (rule 2 and Q-017). */
const WEBVIEW_KEYS = new Set([
  "Ctrl+C", "Ctrl+X", "Ctrl+V", "Ctrl+Shift+V", "Ctrl+A", "Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z",
  "Ctrl+Home", "Ctrl+End", "Ctrl+L", "Ctrl+D", "Ctrl+[", "Ctrl+]", "Ctrl+I", "Ctrl+Shift+K",
  "Alt+Up", "Alt+Down", "Ctrl+/", "Ctrl+Shift+D", "Ctrl+E",
]);

/** Label → lookup key for `shortcuts` (case-insensitive; "…" and "." ignored, 12). */
export function labelKey(label: string): string {
  return label.replace(/&/g, "").replace(/[….]/g, "").trim().toLowerCase();
}

/** Every command item with its label, depth-first (static children only). */
export function commandItems(tree: MenuNode[]): MenuNode[] {
  const out: MenuNode[] = [];
  const walk = (nodes: MenuNode[]) => {
    for (const n of nodes) {
      if (n.id) out.push(n);
      if (Array.isArray(n.children)) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * Turn config.jsonc `shortcuts` into id → key overrides. Unknown labels and unreadable
 * accelerators are reported in `problems`; `global:` entries are returned separately.
 */
export function shortcutOverrides(tree: MenuNode[], shortcuts: Record<string, unknown>) {
  const byLabel = new Map<string, string>();
  for (const n of commandItems(tree)) if (n.id && !byLabel.has(labelKey(n.label))) byLabel.set(labelKey(n.label), n.id);
  const overrides = new Map<string, string>();
  const global = new Map<string, string>();
  const problems: string[] = [];
  for (const [label, value] of Object.entries(shortcuts ?? {})) {
    const id = byLabel.get(labelKey(label));
    if (!id) {
      problems.push(`no menu item "${label}"`);
      continue;
    }
    if (typeof value !== "string") {
      problems.push(`"${label}": the shortcut must be a string`);
      continue;
    }
    let text = value.trim();
    if (/^global:/i.test(text)) {
      text = text.replace(/^global:/i, "");
      const key = normalizeAccelerator(text);
      if (key) global.set(id, key);
      else problems.push(`"${label}": cannot read "${value}"`);
      continue;
    }
    if (text === "") {
      overrides.set(id, "");
      continue;
    }
    const key = normalizeAccelerator(text);
    if (key) overrides.set(id, key);
    else problems.push(`"${label}": cannot read "${value}"`);
  }
  return { overrides, global, problems };
}

/** Tauri (muda) accelerator text for a dispatcher key. */
function nativeAccelerator(key: string): string | undefined {
  if (!key || WEBVIEW_KEYS.has(key)) return undefined;
  return key.replace(/^Ctrl\b/, "CmdOrCtrl").replace(/\bEsc$/, "Escape");
}

export class AppMenu {
  private checks: { item: CheckMenuItem; node: MenuNode }[] = [];
  private building: Promise<void> | null = null;
  private again = false;

  constructor(private tree: () => MenuNode[], private dispatcher: Dispatcher) {}

  /** (Re)build the whole menu: after shortcut, theme list, or recent file changes. */
  rebuild(): Promise<void> {
    if (this.building) {
      this.again = true;
      return this.building;
    }
    this.building = this.build().finally(() => {
      this.building = null;
      if (this.again) {
        this.again = false;
        void this.rebuild();
      }
    });
    return this.building;
  }

  private async build() {
    const checks: { item: CheckMenuItem; node: MenuNode }[] = [];
    const make = async (n: MenuNode): Promise<MenuItem | Submenu | CheckMenuItem | PredefinedMenuItem | null> => {
      if (n.visible && !n.visible()) return null;
      if (n.sep) return PredefinedMenuItem.new({ item: "Separator" });
      if (n.children) {
        const kids = typeof n.children === "function" ? n.children() : n.children;
        const items = (await Promise.all(kids.map(make))).filter((x): x is NonNullable<typeof x> => x !== null);
        return Submenu.new({ text: n.label, items, enabled: n.enabled ? n.enabled() : true });
      }
      const key = n.id ? this.dispatcher.keyOf(n.id) : "";
      const accelerator = nativeAccelerator(key);
      const shown = !accelerator && (key || n.display) ? `${n.label}\t${key || n.display}` : n.label;
      const action = () => {
        if (n.run) n.run();
        else if (n.id) this.dispatcher.runId(n.id, "native");
        void this.refreshChecks();
      };
      const enabled = n.enabled ? n.enabled() : true;
      if (n.checked) {
        const item = await CheckMenuItem.new({ text: shown, accelerator, checked: n.checked(), enabled, action });
        checks.push({ item, node: n });
        return item;
      }
      return MenuItem.new({ text: shown, accelerator, enabled, action });
    };
    const top = (await Promise.all(this.tree().map(make))).filter((x): x is NonNullable<typeof x> => x !== null);
    const menu = await Menu.new({ items: top });
    await menu.setAsWindowMenu(getCurrentWindow());
    this.checks = checks;
  }

  /** Update checkmarks (toggles change without a rebuild). */
  async refreshChecks() {
    await Promise.all(this.checks.map(({ item, node }) => item.setChecked(node.checked!()).catch(() => {})));
  }
}
