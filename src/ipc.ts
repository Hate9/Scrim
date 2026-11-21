// Typed wrappers for the Rust commands in src-tauri/src/commands.rs.
import { invoke } from "@tauri-apps/api/core";

export type LineEndingName = "lf" | "crlf" | "cr";

export interface TextEncoding {
  name: string;
  bom: boolean;
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

export const ipc = {
  docInit: () => invoke<DocInit>("doc_init"),
  setDirty: (dirty: boolean) => invoke<string>("doc_set_dirty", { dirty }),
  setTitleOverride: (title: string | null) => invoke<string>("doc_set_title_override", { title }),
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
  allowFiles: (paths: string[]) => invoke<void>("scope_allow_files", { paths }),
  clipboardText: () => invoke<string | null>("clipboard_read_text"),
  clipboardMedia: () => invoke<{ imageBase64: string | null; files: string[] }>("clipboard_read_media"),
  clipboardWrite: (text: string) => invoke<void>("clipboard_write_text", { text }),
  log: (level: "info" | "warn" | "error", message: string) => invoke<void>("log_frontend", { level, message }),
};
