// The native menu bar (spec 12), built per window with Tauri's menu API.
//
// Every item runs a command through the dispatcher (01, "Keyboard routing" rule 1), so a
// key and a click behave the same. Items carry their English label, which is also the
// key for `shortcuts` overrides in config.jsonc.
//
// Native accelerators (QA-LOG Q-017): GTK runs a menu accelerator before the webview
// sees the key, whatever has focus. So only focus-independent commands (file, window,
// view, app: dispatcher scope "global") get one, on both platforms; every document
// command is label-only and arrives as a DOM keydown, which runs it only when the live
// document has focus and otherwise leaves the key to CodeMirror or the text field.
// The split is by the command's kind, so `shortcuts` overrides follow it too.

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

/** Clipboard and undo keys stay with the webview (01, rule 2) even if a user binds them
 * to a global command. */
const WEBVIEW_KEYS = new Set(["Ctrl+C", "Ctrl+X", "Ctrl+V", "Ctrl+Shift+V", "Ctrl+A", "Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z"]);

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

/** Tauri (muda) accelerator text for a global command's key (Q-017). */
export function nativeAccelerator(key: string, global: boolean): string | undefined {
  if (!key || !global || WEBVIEW_KEYS.has(key)) return undefined;
  return key.replace(/^Ctrl\b/, "CmdOrCtrl").replace(/\bEsc$/, "Escape");
}

export class AppMenu {
  private checks: { item: CheckMenuItem; node: MenuNode }[] = [];
  private building: Promise<void> | null = null;
  private again = false;

  constructor(private tree: () => MenuNode[], private dispatcher: Dispatcher) {}

  /** The menu as it would be built now (tests read labels and enabled states). */
  nodes(): MenuNode[] {
    return this.tree();
  }

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
      const accelerator = nativeAccelerator(key, !!n.id && this.dispatcher.byId.get(n.id)?.scope === "global");
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
