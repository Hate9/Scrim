// Theme loading (spec 10): app base CSS → theme → base.user.css → <theme>.user.css.
//
// Theme files are served by the `scrim-file` handler, which applies the compatibility
// selector rewrite (10.3), so relative url() and @import resolve against the theme's own
// URL. Changing the theme swaps <link> elements: the page is not reloaded, so the cursor
// and scroll stay where they are.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ipc, type ThemeInfo } from "../ipc";

export const DEFAULT_THEME = "paper";
export const DEFAULT_DARK_THEME = "night";

type Setting = <T>(key: string, fallback: T) => T;

const SLOTS = ["scrim-theme-css", "scrim-base-user-css", "scrim-theme-user-css"] as const;

export class ThemeLoader {
  dir = "";
  themes: ThemeInfo[] = [];
  /** The theme actually applied (after dark-mode selection and fallback). */
  current = "";
  private version = 0;
  private dark = window.matchMedia("(prefers-color-scheme: dark)");
  private applied: string[] = [];
  onApplied: (() => void)[] = [];

  constructor(private setting: Setting) {
    this.dark.addEventListener("change", () => void this.apply());
    void getCurrentWindow().onThemeChanged(() => void this.apply());
    // The theme folder is watched in Rust: any change re-applies (10.1, T-2).
    void listen("scrim://themes-changed", async () => {
      await this.refreshList();
      this.version++;
      await this.apply(true);
    });
  }

  async refreshList() {
    const info = await ipc.themesList();
    this.dir = info.dir;
    this.themes = info.themes;
  }

  /** The theme the settings ask for right now (10.4). */
  wanted(): string {
    const separate = this.setting("useSeparateDarkTheme", false);
    const id = separate && this.dark.matches ? this.setting("darkTheme", DEFAULT_DARK_THEME) : this.setting("theme", DEFAULT_THEME);
    return this.themes.some((t) => t.id === id) ? id : this.themes.some((t) => t.id === DEFAULT_THEME) ? DEFAULT_THEME : (this.themes[0]?.id ?? "");
  }

  private url(file: string): string {
    return `${themeFileUrl(this.dir, file)}?v=${this.version}`;
  }

  /** Apply the wanted theme; `force` reloads the files even if the theme is unchanged. */
  async apply(force = false) {
    if (!this.dir) await this.refreshList();
    const id = this.wanted();
    const hrefs = id ? [this.url(`${id}.css`), this.url("base.user.css"), this.url(`${id}.user.css`)] : ["", this.url("base.user.css"), ""];
    if (!force && id === this.current && hrefs.join() === this.applied.join()) return;
    this.current = id;
    this.applied = hrefs;
    await Promise.all(SLOTS.map((slot, i) => swapLink(slot, hrefs[i])));
    this.afterLoad();
  }

  /** Body classes and title bar after the CSS is in (10.3 `dark`, 10.4). */
  private afterLoad() {
    const scheme = getComputedStyle(document.documentElement).getPropertyValue("--color-scheme").trim();
    const isDark = scheme === "dark";
    document.body.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    // Native title bars follow light/dark only. When the theme follows the system
    // (separate dark theme on), the system already picked; asking would pin it.
    if (!this.setting("useSeparateDarkTheme", false)) void getCurrentWindow().setTheme(isDark ? "dark" : null).catch(() => {});
    for (const f of this.onApplied) f();
  }
}

/** Replace the <link> in `slot` with one for `href`; resolves once it loaded or failed
 * (a missing user CSS file is normal). The old sheet stays until the new one is in, so
 * nothing flashes. */
function swapLink(slot: string, href: string): Promise<void> {
  const old = document.getElementById(slot) as HTMLLinkElement | null;
  if (old && old.getAttribute("href") === href) return Promise.resolve();
  if (!href) {
    old?.remove();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    const done = () => {
      // Keep slot order: theme, base.user, theme.user (after the app's base CSS).
      old?.remove();
      link.id = slot;
      resolve();
    };
    link.addEventListener("load", done);
    link.addEventListener("error", () => {
      link.remove();
      old?.remove();
      resolve();
    });
    const prev = SLOTS.slice(0, SLOTS.indexOf(slot as (typeof SLOTS)[number])).map((s) => document.getElementById(s)).filter(Boolean).pop();
    const after = old ?? prev;
    if (after) after.after(link);
    else document.head.appendChild(link);
  });
}

/** A `scrim-file` URL with real path segments (not one percent-encoded segment as
 * `convertFileSrc` builds), so relative `url()` and `@import` in a theme resolve against
 * the theme file's folder (spec 01). */
export function themeFileUrl(dir: string, file: string): string {
  const windows = /^[a-zA-Z]:[\\/]/.test(dir) || dir.startsWith("\\\\");
  const segs = `${dir.replace(/\\/g, "/").replace(/\/+$/, "")}/${file}`.split("/").map(encodeURIComponent);
  const path = segs.join("/").replace(/^\//, "");
  return windows ? `http://scrim-file.localhost/${path}` : `scrim-file://localhost/${path}`;
}
