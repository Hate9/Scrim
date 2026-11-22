// Typed wrappers for the Rust commands in src-tauri/src/commands.rs.
import { invoke } from "@tauri-apps/api/core";

export type LineEndingName = "lf" | "crlf" | "cr";

export interface TextEncoding {
  name: string;
  bom: boolean;
}

export interface ThemeInfo {
  id: string;
  name: string;
  path: string;
}

export interface DocInit {
  path: string | null;
  fileName: string | null;
  text: string;
  encoding: TextEncoding;
  lineEnding: LineEndingName | null;
  defaultLineEnding: LineEndingName;
  malformed: boolean;
  missing: boolean;
  error: string | null;
  title: string;
  settings: Record<string, unknown>;
  folder: string | null;
  recovered: boolean;
  testNoRemote: boolean;
  /** Rust's block tree of `text` (Q-026). */
  blocks: unknown;
}

export type SaveResult =
  | { status: "saved"; path: string; fileName: string | null; encoding: TextEncoding; title: string }
  | { status: "cancelled" }
  | { status: "unrepresentable"; encoding: string; first: string; count: number }
  | { status: "lossy"; encoding: string }
  | { status: "needsFolder"; folder: string }
  | { status: "error"; message: string };

export interface SaveRequest {
  text: string;
  saveAs?: boolean;
  suggestedName?: string;
  convertToUtf8?: boolean;
  acceptLossy?: boolean;
  createFolder?: boolean;
}

export interface ListOptions {
  filter?: "markdown" | "supported" | "all";
  sort?: "name" | "modified" | "created";
  hidden?: boolean;
}
export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  modified: number;
  created: number;
}
export interface FileInfo {
  path: string;
  name: string;
  modified: number;
  created: number;
  title: string | null;
  excerpt: string | null;
}
export interface SearchFileResult {
  id: number;
  path: string;
  matches: { line: number; text: string; start: number; end: number; lineStart: number }[];
}
export interface DraftMeta {
  id: string;
  path: string | null;
  time: number;
  encoding: string | null;
  title: string;
}

/** Async commands run concurrently in Rust, so two quick dirty/title changes (a reload
 * marks dirty, then clean) could finish out of order and leave the wrong state and
 * title. Title-affecting calls run one after another, in call order. */
let titleQueue: Promise<unknown> = Promise.resolve();
function inOrder<T>(call: () => Promise<T>): Promise<T> {
  const next = titleQueue.then(call, call);
  titleQueue = next.catch(() => null);
  return next;
}

export const ipc = {
  globalShortcutsSet: (map: Record<string, string>) => invoke<string[]>("global_shortcuts_set", { map }),
  globalShortcutTake: () => invoke<string | null>("global_shortcut_take"),
  listDir: (path: string, options: ListOptions) => invoke<DirEntry[]>("fs_list_dir", { path, options }),
  walk: (path: string, options: ListOptions, limit?: number, details?: boolean) =>
    invoke<FileInfo[]>("fs_walk", { path, options, limit, details }),
  fsCreateFile: (dir: string, name: string) => invoke<string>("fs_create_file", { dir, name }),
  fsCreateDir: (dir: string, name: string) => invoke<string>("fs_create_dir", { dir, name }),
  fsRename: (path: string, newName: string) => invoke<string>("fs_rename", { path, newName }),
  fsMove: (path: string, destDir: string) => invoke<string>("fs_move", { path, destDir }),
  fsDuplicate: (path: string) => invoke<string>("fs_duplicate", { path }),
  fsTrash: (path: string) => invoke<void>("fs_trash", { path }),
  fsReveal: (path: string) => invoke<void>("fs_reveal", { path }),
  recent: () => invoke<{ files: string[]; folders: string[] }>("recent_get"),
  recentClear: () => invoke<void>("recent_clear"),
  folderGet: () => invoke<string | null>("folder_get"),
  folderOpen: (path: string) => invoke<void>("folder_open", { path }),
  clipboardFlavors: (text: string, html: string | null) => invoke<void>("clipboard_write_flavors", { text, html }),
  clipboardHtml: () => invoke<string | null>("clipboard_read_html"),
  config: () => invoke<{ config: Record<string, unknown>; error: string | null; path: string }>("config_get"),
  configReset: () => invoke<void>("config_reset"),
  helpOpen: (id: string) => invoke<void>("help_open", { id }),
  logFolder: () => invoke<void>("log_folder_open"),
  devtools: () => invoke<void>("devtools_toggle"),
  emojiPanel: () => invoke<void>("emoji_panel"),
  themesList: () => invoke<{ dir: string; themes: ThemeInfo[] }>("themes_list"),
  themesOpenFolder: (theme: string | null) => invoke<void>("themes_open_folder", { theme }),
  folderWatchImplicit: (path: string) => invoke<void>("folder_watch_implicit", { path }),
  folderDialog: () => invoke<string | null>("folder_dialog"),
  reload: () => invoke<{ text: string; blocks: unknown }>("doc_reload"),
  parseBlocks: (text: string) => invoke<unknown>("parse_blocks", { text }),
  readText: (path: string) => invoke<string>("fs_read_text", { path }),
  copyFile: (from: string, to: string) => invoke<void>("fs_copy", { from, to }),
  recoveryOpen: (id: string) => invoke<void>("recovery_open", { id }),
  searchStart: (query: Record<string, unknown>) => invoke<number>("search_start", { query }),
  searchCancel: () => invoke<void>("search_cancel"),
  recoveryWrite: (text: string, title: string) => invoke<void>("recovery_write", { text, title }),
  recoveryRemove: (discard: boolean) => invoke<void>("recovery_remove", { discard }),
  recoveryList: () => invoke<DraftMeta[]>("recovery_list"),
  recoveryRead: (id: string) => invoke<string>("recovery_read", { id }),
  recoveryDiscard: (id: string) => invoke<void>("recovery_discard", { id }),
  recoveryAdopt: (id: string) => invoke<void>("recovery_adopt", { id }),
  docInit: () => invoke<DocInit>("doc_init"),
  setDirty: (dirty: boolean) => inOrder(() => invoke<string>("doc_set_dirty", { dirty })),
  setTitleOverride: (title: string | null) => inOrder(() => invoke<string>("doc_set_title_override", { title })),
  save: (request: SaveRequest) => invoke<SaveResult>("doc_save", { request }),
  openDialog: () => invoke<void>("doc_open_dialog"),
  newDoc: (newWindow: boolean) => invoke<void>("doc_new", { newWindow }),
  logCsp: (violation: { blockedUri: string; violatedDirective: string; sourceFile?: string }) =>
    invoke<void>("log_csp_violation", { violation }),
  openPath: (path: string, mode: "current" | "new") => invoke<void>("doc_open_path", { path, mode }),
  openExternal: (target: string, isPath: boolean) => invoke<void>("open_external", { target, isPath }),
  imageInsert: (source: { path?: string; dataBase64?: string; ext?: string }, frontMatterFolder: string | null) =>
    invoke<{ src: string; path: string | null }>("image_insert", { source, frontMatterFolder }),
  imageFinalize: (frontMatterFolder: string | null) =>
    invoke<{ oldSrc: string; newSrc: string }[]>("image_finalize", { frontMatterFolder }),
  linkTarget: (path: string) => invoke<string>("link_target", { path }),
  pathKind: (path: string) => invoke<"dir" | "image" | "file">("path_kind", { path }),
  settings: () => invoke<Record<string, unknown>>("settings_get"),
  setSetting: (key: string, value: unknown) => invoke<void>("settings_set", { key, value }),
  allowFiles: (paths: string[]) => invoke<void>("scope_allow_files", { paths }),
  clipboardText: () => invoke<string | null>("clipboard_read_text"),
  clipboardMedia: () => invoke<{ imageBase64: string | null; files: string[] }>("clipboard_read_media"),
  clipboardWrite: (text: string) => invoke<void>("clipboard_write_text", { text }),
  log: (level: "info" | "warn" | "error", message: string) => invoke<void>("log_frontend", { level, message }),
};
