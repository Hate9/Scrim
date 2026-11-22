// The unified custom title bar (spec 11, Appearance → Window style; 10.3 `header`).
// The window has no native decorations: this header is the drag region and holds the
// menu button (the native menu as a popup), the document title (click: File → Rename,
// 07), and minimize / maximize / close. Its colors come from the theme (10.4).

import { getCurrentWindow } from "@tauri-apps/api/window";

/** Whether this window was created without a native title bar. */
export const frameless = new URLSearchParams(location.search).has("frameless");

export interface TitleBarHooks {
  openMenu(x: number, y: number): void;
  /** File → Rename, when the document has a file. */
  rename(): void;
  canRename(): boolean;
}

function button(cls: string, label: string, glyph: string, run: (e: MouseEvent) => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `scrim-titlebar-button ${cls}`;
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.textContent = glyph;
  b.tabIndex = -1;
  b.addEventListener("mousedown", (e) => e.stopPropagation()); // not a window drag
  b.addEventListener("click", run);
  return b;
}

export function setupTitleBar(header: HTMLElement, hooks: TitleBarHooks) {
  document.body.classList.add("scrim-frameless");
  header.classList.add("scrim-titlebar");
  header.setAttribute("data-tauri-drag-region", "");
  const win = getCurrentWindow();
  const menu = button("scrim-titlebar-menu", "Menu", "☰", (e) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hooks.openMenu(r.left, r.bottom);
  });
  const title = document.createElement("span");
  title.className = "scrim-titlebar-title";
  title.addEventListener("click", () => {
    if (hooks.canRename()) hooks.rename();
  });
  const sync = () => {
    title.textContent = document.title;
    title.classList.toggle("scrim-titlebar-renamable", hooks.canRename());
    title.title = hooks.canRename() ? "Rename" : "";
  };
  new MutationObserver(sync).observe(document.querySelector("title") ?? document.head, { childList: true, characterData: true, subtree: true });
  sync();
  const controls = document.createElement("span");
  controls.className = "scrim-titlebar-controls";
  controls.append(
    button("scrim-titlebar-min", "Minimize", "–", () => void win.minimize()),
    button("scrim-titlebar-max", "Maximize", "□", () => void win.toggleMaximize()),
    button("scrim-titlebar-close", "Close", "✕", () => void win.close()),
  );
  header.replaceChildren(menu, title, controls);
  header.addEventListener("dblclick", (e) => {
    if (e.target === header) void win.toggleMaximize();
  });
}
