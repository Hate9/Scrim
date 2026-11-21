// Sidebar (spec 07, 7.4 and 7.7): Files (tree / list), Outline, Search. DOM follows the
// theme contract (10.3): #scrim-sidebar, .sidebar-tabs, #file-library, .file-tree-node,
// .file-list-item, #outline-content, .outline-item, .outline-hN.

import { listen } from "@tauri-apps/api/event";
import { TextSelection } from "prosemirror-state";
import type { Editor } from "../editor/editor";
import { headingKey, type HeadingInfo } from "../editor/headings";
import { ipc, type DirEntry, type FileInfo, type ListOptions, type SearchFileResult } from "../ipc";

export interface SidebarHooks {
  /** Open a file in this window (asking about unsaved changes) or a new window. */
  openFile(path: string, newWindow: boolean, select?: { line: number; start: number; length: number }): void;
  confirm(message: string): Promise<boolean>;
  notify(message: string): void;
  currentPath(): string | null;
  setSetting(key: string, value: unknown): void;
  setting<T>(key: string, fallback: T): T;
}

type Tab = "files" | "outline" | "search";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function dirname(p: string) {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}
function basename(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

export class Sidebar {
  root = document.getElementById("scrim-sidebar") as HTMLDivElement;
  folder: string | null = null;
  private tab: Tab = "files";
  private listView = false;
  private tabs = el("div", "sidebar-tabs");
  private library = el("div");
  private outline = el("div");
  private search = el("div", "scrim-search-panel");
  private bottom = el("div", "scrim-sidebar-bottom");
  private expanded = new Set<string>();
  private selectedDir: string | null = null;
  private outlineFilter = "";
  private collapsedHeadings = new Set<number>();
  private menu: HTMLDivElement | null = null;

  constructor(private editor: Editor, private hooks: SidebarHooks) {
    this.library.id = "file-library";
    this.outline.id = "outline-content";
    this.root.append(this.tabs, this.library, this.outline, this.search, this.bottom, this.resizeHandle());
    this.renderTabs();
    document.addEventListener("mousedown", (e) => {
      if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
    });
    void listen("scrim://folder-changed", () => void this.refreshFiles());
    this.setWidth(this.hooks.setting("sidebarWidth", 240));
    this.renderSearch();
    this.show(this.tab);
  }

  get visible() {
    return !this.root.hidden;
  }

  toggle(force?: boolean) {
    const on = force ?? !this.visible;
    this.root.hidden = !on;
    document.body.classList.toggle("pin-outline", on);
    if (on) this.show(this.tab);
  }

  show(tab: Tab) {
    this.tab = tab;
    this.library.hidden = tab !== "files";
    this.outline.hidden = tab !== "outline";
    this.search.hidden = tab !== "search";
    this.bottom.hidden = tab !== "files";
    this.renderTabs();
    if (tab === "files") void this.refreshFiles();
    if (tab === "outline") this.renderOutline();
  }

  showFiles(list: boolean) {
    this.listView = list;
    this.toggle(true);
    this.show("files");
  }

  private renderTabs() {
    this.tabs.textContent = "";
    const tab = (id: Tab, label: string) => {
      const t = el("div", `info-panel-tab${this.tab === id ? " active" : ""}`, label);
      t.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.show(id);
      });
      this.tabs.appendChild(t);
    };
    if (this.tab === "search") {
      tab("search", "Search");
      const close = el("button", "scrim-sidebar-tab-button", "×");
      close.title = "Close search";
      close.addEventListener("mousedown", (e) => {
        e.preventDefault();
        void ipc.searchCancel();
        this.show("files");
      });
      this.tabs.appendChild(close);
      return;
    }
    tab("files", "Files");
    tab("outline", "Outline");
    const view = el("button", "scrim-sidebar-tab-button", this.listView ? "☰" : "≣");
    view.title = this.listView ? "Tree view" : "List view";
    view.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.listView = !this.listView;
      this.show("files");
    });
    this.tabs.appendChild(view);
  }

  // ---- width -------------------------------------------------------------------------

  private setWidth(w: number) {
    const max = window.innerWidth * 0.5;
    const width = Math.max(180, Math.min(max, w));
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
    return width;
  }

  private resizeHandle() {
    const h = el("div", "scrim-sidebar-resize");
    h.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const move = (m: MouseEvent) => this.setWidth(m.clientX);
      const up = (m: MouseEvent) => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        this.hooks.setSetting("sidebarWidth", this.setWidth(m.clientX));
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
    return h;
  }

  // ---- files -------------------------------------------------------------------------

  setFolder(path: string | null) {
    this.folder = path;
    this.selectedDir = path;
    if (path) {
      try {
        this.expanded = new Set(JSON.parse(localStorage.getItem(`scrim.expanded:${path}`) ?? "[]"));
      } catch {
        this.expanded = new Set();
      }
      this.toggle(true);
      this.show("files");
    }
    this.renderBottom();
  }

  private listOptions(): ListOptions {
    return {
      filter: this.hooks.setting("fileFilter", "markdown"),
      sort: this.hooks.setting("fileSort", "name"),
      hidden: this.hooks.setting("showHiddenFiles", false),
    };
  }

  private saveExpanded() {
    if (!this.folder) return;
    try {
      localStorage.setItem(`scrim.expanded:${this.folder}`, JSON.stringify([...this.expanded]));
    } catch {
      /* per-viewer convenience only */
    }
  }

  async refreshFiles() {
    if (this.tab !== "files" || !this.visible) return;
    this.library.textContent = "";
    if (!this.folder) {
      const empty = el("div", "scrim-sidebar-empty");
      const b = el("button", "", "Open Folder…");
      b.addEventListener("click", () => void this.openFolderDialog());
      empty.append(el("div", "", "No folder open."), b);
      this.library.appendChild(empty);
      return;
    }
    if (this.listView) return this.renderList();
    await this.renderDir(this.folder, this.library, 0);
  }

  private async renderDir(dir: string, into: HTMLElement, depth: number) {
    let entries: DirEntry[];
    try {
      entries = await ipc.listDir(dir, this.listOptions());
    } catch (e) {
      into.appendChild(el("div", "scrim-sidebar-error", String(e)));
      return;
    }
    const current = this.hooks.currentPath();
    for (const entry of entries) {
      const row = el("div", "file-library-node file-tree-node");
      row.dataset.path = entry.path;
      row.dataset.dir = String(entry.isDir);
      row.style.paddingLeft = `${8 + depth * 14}px`;
      const open = entry.isDir && this.expanded.has(entry.path);
      row.append(el("span", "file-tree-arrow", entry.isDir ? (open ? "▾" : "▸") : ""), el("span", "file-node-title", entry.name));
      if (entry.path === current) row.classList.add("active");
      if (entry.path === this.selectedDir) row.classList.add("selected");
      into.appendChild(row);
      this.bindRow(row, entry.path, entry.isDir);
      if (open) {
        const children = el("div", "file-tree-children");
        into.appendChild(children);
        await this.renderDir(entry.path, children, depth + 1);
      }
    }
  }

  private bindRow(row: HTMLElement, path: string, isDir: boolean) {
    row.addEventListener("mousedown", (e) => {
      if (e.button === 2) return;
      e.preventDefault();
      if (isDir) {
        this.selectedDir = path;
        if (this.expanded.has(path)) this.expanded.delete(path);
        else this.expanded.add(path);
        this.saveExpanded();
        void this.refreshFiles();
      } else {
        this.selectedDir = dirname(path);
        this.hooks.openFile(path, e.ctrlKey || e.metaKey);
      }
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.contextMenu(e.clientX, e.clientY, path, isDir, row);
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "F2") this.inlineRename(row, path);
    });
    row.tabIndex = -1;
  }

  private async renderList() {
    const limit = this.hooks.setting("fileListLimit", 500);
    let files: FileInfo[];
    try {
      files = await ipc.walk(this.folder!, this.listOptions(), limit, true);
    } catch (e) {
      this.library.appendChild(el("div", "scrim-sidebar-error", String(e)));
      return;
    }
    const current = this.hooks.currentPath();
    for (const f of files) {
      const card = el("div", "file-list-item");
      if (f.path === current) card.classList.add("active");
      card.dataset.path = f.path;
      card.append(
        el("div", "file-list-item-title", f.title ?? f.name),
        el("div", "file-list-item-time", new Date(f.modified).toLocaleString()),
        el("div", "file-list-item-summary", f.excerpt ?? ""),
      );
      this.library.appendChild(card);
      this.bindRow(card, f.path, false);
    }
  }

  private renderBottom() {
    this.bottom.textContent = "";
    const add = el("button", "scrim-sidebar-add", "+");
    add.title = "New file";
    add.addEventListener("click", () => void this.newEntry(this.selectedDir ?? this.folder, false));
    const menu = el("button", "scrim-sidebar-menu", "⋯");
    menu.addEventListener("click", (e) => {
      const r = (e.target as HTMLElement).getBoundingClientRect();
      this.bottomMenu(r.left, r.top);
    });
    this.bottom.append(add, menu, el("span", "scrim-sidebar-folder", this.folder ? basename(this.folder) : ""));
  }

  async openFolderDialog() {
    const p = await ipc.folderDialog();
    if (p) await ipc.folderOpen(p);
  }

  // ---- menus -------------------------------------------------------------------------

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  private popup(x: number, y: number, items: ([string, () => void] | null)[]) {
    this.closeMenu();
    const m = el("div", "scrim-context-menu");
    for (const it of items) {
      if (!it) {
        m.appendChild(el("div", "scrim-context-sep"));
        continue;
      }
      const row = el("div", "scrim-context-item", it[0]);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.closeMenu();
        it[1]();
      });
      m.appendChild(row);
    }
    document.body.appendChild(m);
    m.style.left = `${Math.min(x, window.innerWidth - m.offsetWidth - 4)}px`;
    m.style.top = `${Math.min(y, window.innerHeight - m.offsetHeight - 4)}px`;
    this.menu = m;
  }

  private contextMenu(x: number, y: number, path: string, isDir: boolean, row: HTMLElement) {
    const dir = isDir ? path : dirname(path);
    this.popup(x, y, [
      ["New File", () => void this.newEntry(dir, false)],
      ["New Folder", () => void this.newEntry(dir, true)],
      null,
      ["Rename", () => this.inlineRename(row, path)],
      ["Duplicate", () => void ipc.fsDuplicate(path).then(() => this.refreshFiles(), (e) => this.hooks.notify(String(e)))],
      ["Delete", () => void this.trash(path)],
      null,
      ["Copy Path", () => void ipc.clipboardWrite(path)],
      ["Reveal in Folder", () => void ipc.fsReveal(path)],
      ...(isDir ? [] : ([["Open in New Window", () => this.hooks.openFile(path, true)]] as [string, () => void][])),
      ["Search in Folder", () => this.startSearch(dir)],
      null,
      ...this.sortItems(),
      ["Refresh", () => void this.refreshFiles()],
    ]);
  }

  private sortItems(): [string, () => void][] {
    const sort = (s: string) => () => {
      this.hooks.setSetting("fileSort", s);
      void this.refreshFiles();
    };
    return [
      ["Sort by Name", sort("name")],
      ["Sort by Modified Date", sort("modified")],
      ["Sort by Created Date", sort("created")],
    ];
  }

  private bottomMenu(x: number, y: number) {
    const filter = (f: string) => () => {
      this.hooks.setSetting("fileFilter", f);
      void this.refreshFiles();
    };
    this.popup(x, y - 220, [
      ["Open Folder…", () => void this.openFolderDialog()],
      null,
      ...this.sortItems(),
      null,
      ["Show Markdown Files", filter("markdown")],
      ["Show Supported Files", filter("supported")],
      ["Show All Files", filter("all")],
      [this.hooks.setting("showHiddenFiles", false) ? "Hide Hidden Files" : "Show Hidden Files", () => {
        this.hooks.setSetting("showHiddenFiles", !this.hooks.setting("showHiddenFiles", false));
        void this.refreshFiles();
      }],
      ["Refresh", () => void this.refreshFiles()],
    ]);
  }

  private async trash(path: string) {
    if (!(await this.hooks.confirm(`Move "${basename(path)}" to the trash?`))) return;
    try {
      await ipc.fsTrash(path);
    } catch (e) {
      this.hooks.notify(String(e));
    }
    void this.refreshFiles();
  }

  private async newEntry(dir: string | null, folder: boolean) {
    if (!dir) return;
    this.expanded.add(dir);
    this.saveExpanded();
    const name = await this.askName(folder ? "New folder" : "New file", folder ? "New Folder" : "Untitled.md");
    if (!name) return;
    try {
      const p = folder ? await ipc.fsCreateDir(dir, name) : await ipc.fsCreateFile(dir, name);
      if (!folder) this.hooks.openFile(p, false);
    } catch (e) {
      this.hooks.notify(String(e));
    }
    void this.refreshFiles();
  }

  private askName(title: string, value: string): Promise<string | null> {
    return new Promise((resolve) => {
      const row = el("div", "file-tree-node scrim-inline-new");
      const input = el("input", "scrim-inline-rename");
      input.value = value;
      input.title = title;
      row.appendChild(input);
      this.library.prepend(row);
      input.focus();
      input.setSelectionRange(0, value.lastIndexOf(".") > 0 ? value.lastIndexOf(".") : value.length);
      const done = (v: string | null) => {
        row.remove();
        resolve(v && v.trim() ? v.trim() : null);
      };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") done(input.value);
        if (e.key === "Escape") done(null);
      });
      input.addEventListener("blur", () => done(null));
    });
  }

  /** Inline rename (F2): Enter commits, Escape cancels (7.4). */
  inlineRename(row: HTMLElement, path: string) {
    const title = row.querySelector(".file-node-title, .file-list-item-title") as HTMLElement | null;
    if (!title) return;
    const input = el("input", "scrim-inline-rename");
    input.value = basename(path);
    title.replaceWith(input);
    input.focus();
    const dot = input.value.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    let finished = false;
    const finish = async (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (commit && input.value.trim() && input.value !== basename(path)) {
        try {
          await ipc.fsRename(path, input.value.trim());
        } catch (e) {
          this.hooks.notify(String(e));
        }
      }
      void this.refreshFiles();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void finish(true);
      if (e.key === "Escape") void finish(false);
    });
    input.addEventListener("blur", () => void finish(true));
    input.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  /** F2 on the current file (W-2) or the selected tree row. */
  renameCurrent() {
    const current = this.hooks.currentPath();
    const row = this.library.querySelector<HTMLElement>(`[data-path="${CSS.escape(current ?? "")}"]`);
    if (row && current) this.inlineRename(row, current);
  }

  // ---- outline -------------------------------------------------------------------------

  updateOutline() {
    if (this.tab === "outline" && this.visible) this.renderOutline();
  }

  private currentHeading(list: HeadingInfo[]): number {
    const head = this.editor.view.state.selection.head;
    let idx = -1;
    list.forEach((h, i) => {
      if (h.pos <= head) idx = i;
    });
    return idx;
  }

  private renderOutline() {
    const list = headingKey.getState(this.editor.view.state)?.list ?? [];
    const active = this.currentHeading(list);
    this.outline.textContent = "";
    if (this.outlineFilter) {
      const f = el("div", "scrim-outline-filter", `Filter: ${this.outlineFilter}`);
      this.outline.appendChild(f);
    }
    const collapsible = this.hooks.setting("collapsibleOutline", true);
    let hideBelow = Infinity;
    list.forEach((h, i) => {
      if (h.level > hideBelow) return;
      hideBelow = Infinity;
      if (this.outlineFilter && !h.text.toLowerCase().includes(this.outlineFilter.toLowerCase())) return;
      const wrap = el("div", `outline-h${h.level}`);
      const item = el("div", `outline-item${i === active ? " outline-item-active" : ""}`);
      item.style.paddingLeft = `${8 + (h.level - 1) * 14}px`;
      const hasChildren = list[i + 1] && list[i + 1].level > h.level;
      const arrow = el("span", "outline-expander", collapsible && hasChildren ? (this.collapsedHeadings.has(h.pos) ? "▸" : "▾") : "");
      arrow.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.collapsedHeadings.has(h.pos)) this.collapsedHeadings.delete(h.pos);
        else this.collapsedHeadings.add(h.pos);
        this.renderOutline();
      });
      item.append(arrow, el("span", "outline-label", h.text || "(empty)"));
      item.dataset.index = String(i);
      item.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this.startOutlineDrag(e, i, list);
      });
      wrap.appendChild(item);
      this.outline.appendChild(wrap);
      if (collapsible && this.collapsedHeadings.has(h.pos)) hideBelow = h.level;
    });
    this.outline.tabIndex = 0;
  }

  /** Filter box: typing while the outline has focus (7.4). */
  outlineKey(e: KeyboardEvent): boolean {
    if (this.tab !== "outline" || document.activeElement !== this.outline) return false;
    if (e.key === "Escape") this.outlineFilter = "";
    else if (e.key === "Backspace") this.outlineFilter = this.outlineFilter.slice(0, -1);
    else if (e.key.length === 1 && !e.ctrlKey && !e.altKey) this.outlineFilter += e.key;
    else return false;
    this.renderOutline();
    return true;
  }

  private jumpTo(h: HeadingInfo) {
    const view = this.editor.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, h.pos + 1)));
    const dom = view.nodeDOM(h.pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start" });
    view.focus();
  }

  /** Click jumps; dragging an entry moves its section (7.4, W-9). */
  private startOutlineDrag(down: MouseEvent, index: number, list: HeadingInfo[]) {
    let dragging = false;
    let target: number | null = null;
    const line = el("div", "scrim-outline-drop");
    const move = (e: MouseEvent) => {
      if (!dragging && Math.abs(e.clientY - down.clientY) < 5) return;
      dragging = true;
      const items = [...this.outline.querySelectorAll<HTMLElement>(".outline-item")];
      let best: HTMLElement | null = null;
      for (const it of items) if (it.getBoundingClientRect().top + it.offsetHeight / 2 < e.clientY) best = it;
      target = best ? Number(best.dataset.index) + 1 : 0;
      const ref = items.find((it) => Number(it.dataset.index) >= (target ?? 0));
      if (ref) ref.parentElement!.before(line);
      else this.outline.appendChild(line);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      line.remove();
      if (!dragging) return this.jumpTo(list[index]);
      if (target !== null) this.moveSection(index, target, list);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  /** Move heading `index` and its content before heading `before` (or to the end). */
  moveSection(index: number, before: number, list: HeadingInfo[]) {
    const view = this.editor.view;
    const doc = view.state.doc;
    const h = list[index];
    const $h = doc.resolve(h.pos);
    if ($h.depth !== 0) return this.hooks.notify("Only top-level headings can be moved from the outline.");
    let end = doc.content.size;
    for (let j = index + 1; j < list.length; j++) {
      if (list[j].level <= h.level && doc.resolve(list[j].pos).depth === 0) {
        end = list[j].pos;
        break;
      }
    }
    const to = before >= list.length ? doc.content.size : list[before].pos;
    if (to >= h.pos && to <= end) return;
    const slice = doc.slice(h.pos, end);
    const tr = view.state.tr;
    if (to > h.pos) {
      tr.insert(to, slice.content);
      tr.delete(h.pos, end);
    } else {
      tr.delete(h.pos, end);
      tr.insert(to, slice.content);
    }
    const at = to > h.pos ? to - (end - h.pos) : to;
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView());
    view.focus();
  }

  // ---- search in files (7.7) -------------------------------------------------------------

  private searchInput = el("input", "scrim-search-input");
  private searchResults = el("div", "scrim-search-results");
  private searchStatus = el("div", "scrim-search-status");
  private searchOpts = { caseSensitive: false, wholeWord: false, regex: false };
  private searchRoot: string | null = null;
  private searchId = 0;
  private searchTimer = 0;
  private firstResultAt = 0;

  private renderSearch() {
    this.searchInput.placeholder = "Search in folder";
    this.searchInput.addEventListener("input", () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => void this.runSearch(), 200);
    });
    this.searchInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void this.runSearch();
      if (e.key === "Escape") this.show("files");
    });
    const opts = el("div", "scrim-search-options");
    const toggle = (key: keyof typeof this.searchOpts, label: string, title: string) => {
      const b = el("button", "scrim-search-toggle", label);
      b.title = title;
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.searchOpts[key] = !this.searchOpts[key];
        b.classList.toggle("active", this.searchOpts[key]);
        void this.runSearch();
      });
      opts.appendChild(b);
    };
    toggle("caseSensitive", "Aa", "Case sensitive");
    toggle("wholeWord", "ab", "Whole word");
    toggle("regex", ".*", "Regex");
    this.search.append(this.searchInput, opts, this.searchStatus, this.searchResults);
    void listen<SearchFileResult>("scrim://search-result", (e) => this.addResult(e.payload));
    void listen<{ id: number; files: number; matches: number; error: string | null; cancelled: boolean }>("scrim://search-done", (e) => {
      if (e.payload.id !== this.searchId || e.payload.cancelled) return;
      this.searchStatus.textContent = e.payload.error
        ? e.payload.error
        : `${e.payload.matches} results in ${e.payload.files} files`;
    });
  }

  /** Mod+Shift+F (7.7): open the Search tab for `dir` (default: the open folder). */
  async startSearch(dir?: string) {
    let root = dir ?? this.folder;
    if (!root) {
      if (!(await this.hooks.confirm("Search in files needs an open folder. Open a folder?"))) return;
      await this.openFolderDialog();
      return;
    }
    this.searchRoot = root;
    this.toggle(true);
    this.show("search");
    const sel = this.editor.view.state.selection;
    if (!sel.empty && sel.$from.sameParent(sel.$to)) this.searchInput.value = this.editor.view.state.doc.textBetween(sel.from, sel.to);
    this.searchInput.focus();
    this.searchInput.select();
    if (this.searchInput.value) void this.runSearch();
  }

  private async runSearch() {
    const query = this.searchInput.value;
    this.searchResults.textContent = "";
    if (!query || !this.searchRoot) {
      this.searchStatus.textContent = "";
      return;
    }
    this.searchStatus.textContent = "Searching…";
    this.firstResultAt = 0;
    const started = performance.now();
    this.searchId = await ipc.searchStart({ root: this.searchRoot, query, ...this.searchOpts, options: this.listOptions() });
    (this.searchResults as HTMLElement & { __started?: number }).__started = started;
  }

  private addResult(r: SearchFileResult) {
    if (r.id !== this.searchId) return;
    if (!this.firstResultAt) this.firstResultAt = performance.now();
    const group = el("div", "scrim-search-file");
    const head = el("div", "scrim-search-file-name");
    head.append(el("span", "", basename(r.path)), el("span", "scrim-search-count", String(r.matches.length)));
    head.title = r.path;
    group.appendChild(head);
    for (const m of r.matches) {
      const line = el("div", "scrim-search-line");
      line.append(document.createTextNode(m.text.slice(0, m.start)), el("mark", "md-search-hit", m.text.slice(m.start, m.end)), document.createTextNode(m.text.slice(m.end)));
      line.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.hooks.openFile(r.path, false, { line: m.line, start: m.lineStart, length: m.end - m.start });
      });
      group.appendChild(line);
    }
    this.searchResults.appendChild(group);
  }

  /** Milliseconds from starting the search to the first result (W-7). */
  get firstResultMs(): number | null {
    const s = (this.searchResults as HTMLElement & { __started?: number }).__started;
    return this.firstResultAt && s ? this.firstResultAt - s : null;
  }
}
