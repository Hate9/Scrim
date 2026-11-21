// Quick open (spec 07, 7.5; wireframe quick-open.svg): files of the open folder, recent
// files, and recent folders, fuzzy matched.

import { ipc } from "../ipc";

interface Item {
  path: string;
  name: string;
  dir: string;
  recent: boolean;
  folder: boolean;
}

function basename(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}
function dirname(p: string) {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : "";
}

/** Fuzzy score (lower is better), or null. Name matches rank above path matches. */
export function quickScore(query: string, item: { name: string; path: string; recent: boolean }): number | null {
  const q = query.toLowerCase();
  const sub = (s: string): number | null => {
    s = s.toLowerCase();
    const i = s.indexOf(q);
    if (i >= 0) return i;
    let j = 0;
    let gaps = 0;
    let last = -1;
    for (let k = 0; k < s.length && j < q.length; k++) {
      if (s[k] === q[j]) {
        if (last >= 0) gaps += k - last - 1;
        last = k;
        j++;
      }
    }
    return j === q.length ? 100 + gaps : null;
  };
  const n = sub(item.name);
  const p = n === null ? sub(item.path) : null;
  if (n === null && p === null) return null;
  return (n !== null ? n : 1000 + p!) - (item.recent ? 50 : 0);
}

/** Middle-ellipsize a directory for display. */
function ellipsize(s: string, max = 48) {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + "…" + s.slice(s.length - half);
}

export class QuickOpen {
  root: HTMLDivElement;
  private input = document.createElement("input");
  private list = document.createElement("div");
  private items: Item[] = [];
  private shown: Item[] = [];
  private index = 0;

  constructor(
    private folder: () => string | null,
    private open: (path: string, newWindow: boolean, folder: boolean) => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "scrim-quick-open";
    this.root.hidden = true;
    this.input.className = "scrim-quick-open-input";
    this.input.placeholder = "Open file…";
    this.list.className = "scrim-quick-open-list";
    this.root.append(this.input, this.list);
    document.body.appendChild(this.root);
    this.input.addEventListener("input", () => this.filter());
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) this.move(1, e);
      else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) this.move(-1, e);
      else if (e.key === "Enter") {
        e.preventDefault();
        this.choose(this.shown[this.index], e.ctrlKey || e.metaKey);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener("blur", () => setTimeout(() => this.close(), 150));
  }

  get isOpen() {
    return !this.root.hidden;
  }

  async show() {
    // Centered in the editor area, 4 px below its top edge (22.1).
    const area = document.querySelector("content")!.getBoundingClientRect();
    const top = document.getElementById("scrim-topbars")!.getBoundingClientRect().top;
    this.root.style.left = `${area.left + area.width / 2}px`;
    this.root.style.top = `${Math.min(top, area.top) + 4}px`;
    this.root.hidden = false;
    this.input.value = "";
    this.input.focus();
    const recent = await ipc.recent();
    const items: Item[] = [];
    const seen = new Set<string>();
    for (const f of recent.files) {
      seen.add(f);
      items.push({ path: f, name: basename(f), dir: dirname(f), recent: true, folder: false });
    }
    for (const f of recent.folders) items.push({ path: f, name: basename(f), dir: dirname(f), recent: true, folder: true });
    const folder = this.folder();
    this.items = items;
    this.filter();
    if (folder) {
      const files = await ipc.walk(folder, { filter: "markdown" }, 20000, false);
      for (const f of files) if (!seen.has(f.path)) items.push({ path: f.path, name: f.name, dir: dirname(f.path), recent: false, folder: false });
      this.filter();
    }
  }

  close() {
    this.root.hidden = true;
  }

  private filter() {
    const q = this.input.value.trim();
    if (!q) this.shown = this.items.filter((i) => i.recent && !i.folder).slice(0, 20);
    else {
      const scored: [number, Item][] = [];
      for (const it of this.items) {
        const s = quickScore(q, it);
        if (s !== null) scored.push([s, it]);
      }
      scored.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length);
      this.shown = scored.slice(0, 50).map((s) => s[1]);
    }
    this.index = 0;
    this.render();
  }

  private render() {
    this.list.textContent = "";
    this.shown.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = `scrim-quick-open-item${i === this.index ? " active" : ""}`;
      const name = document.createElement("span");
      name.className = "scrim-quick-open-name";
      name.textContent = it.folder ? `${it.name}/` : it.name;
      const dir = document.createElement("span");
      dir.className = "scrim-quick-open-dir";
      dir.textContent = ellipsize(it.dir);
      row.append(name, dir);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.choose(it, e.ctrlKey || e.metaKey);
      });
      this.list.appendChild(row);
    });
  }

  private move(d: number, e: Event) {
    e.preventDefault();
    if (!this.shown.length) return;
    this.index = (this.index + d + this.shown.length) % this.shown.length;
    this.render();
  }

  private choose(it: Item | undefined, newWindow: boolean) {
    if (!it) return;
    this.close();
    this.open(it.path, newWindow, it.folder);
  }
}
