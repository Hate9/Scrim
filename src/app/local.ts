// local.json (specs 16, 17): snippets, custom HTML tags, the picker shortcut. Rust reads
// and writes the file; every change (here, in another window, or an external edit)
// arrives as `scrim://local-changed`.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Snippet } from "../editor/snippets";

export interface LocalData {
  snippets: Snippet[];
  customHTMLTags: { inline: string[]; block: string[] };
  pickerKey: string;
  [key: string]: unknown;
}

export const DEFAULT_PICKER_KEY = "Ctrl+Alt+Space";

function normalize(v: unknown): LocalData {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const snippets = Array.isArray(o.snippets)
    ? o.snippets.filter((s) => s && typeof s === "object").map((s) => ({ name: String(s.name ?? ""), key: String(s.key ?? ""), body: String(s.body ?? "") }))
    : [];
  const tags = (o.customHTMLTags && typeof o.customHTMLTags === "object" ? o.customHTMLTags : {}) as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((n): n is string => typeof n === "string") : []);
  return {
    ...o,
    snippets,
    customHTMLTags: { inline: list(tags.inline), block: list(tags.block) },
    pickerKey: typeof o.pickerKey === "string" ? o.pickerKey : DEFAULT_PICKER_KEY,
  };
}

export class LocalStore {
  data: LocalData = normalize({});
  error: string | null = null;
  onChange: ((d: LocalData) => void)[] = [];

  constructor() {
    void listen("scrim://local-changed", () => void this.load());
  }

  async load() {
    const r = await invoke<{ local: unknown; error: string | null }>("local_get").catch((e) => ({ local: {}, error: String(e) }));
    this.data = normalize(r.local);
    this.error = r.error;
    for (const f of this.onChange) f(this.data);
  }

  async save(next: LocalData) {
    this.data = normalize(next);
    await invoke("local_set", { local: this.data });
  }
}

/** Label of a snippet in menus and the picker (16, "Data"). */
export function snippetLabel(s: Snippet): string {
  return s.name.trim() || s.body.replace(/\s+/g, " ").slice(0, 40) || "(empty snippet)";
}

/**
 * Picker filter (16, "Picker"): prefix matches first (shorter names first), then
 * substring matches (earlier position first), then subsequence matches; case-insensitive.
 * An empty query keeps the list order.
 */
export function filterSnippets<T extends { name: string }>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const scored: { s: T; group: number; key: number; i: number }[] = [];
  list.forEach((s, i) => {
    const n = s.name.toLowerCase();
    if (n.startsWith(q)) scored.push({ s, group: 0, key: n.length, i });
    else if (n.includes(q)) scored.push({ s, group: 1, key: n.indexOf(q), i });
    else {
      let at = 0;
      for (const ch of n) if (ch === q[at]) at++;
      if (at === q.length) scored.push({ s, group: 2, key: 0, i });
    }
  });
  scored.sort((a, b) => a.group - b.group || a.key - b.key || a.i - b.i);
  return scored.map((x) => x.s);
}
