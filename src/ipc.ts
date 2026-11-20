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
}

export type SaveResult =
  | { status: "saved"; path: string; fileName: string | null; encoding: TextEncoding; title: string }
  | { status: "cancelled" }
  | { status: "unrepresentable"; encoding: string; first: string; count: number }
  | { status: "lossy"; encoding: string }
  | { status: "error"; message: string };

export interface SaveRequest {
  text: string;
  saveAs?: boolean;
  suggestedName?: string;
  convertToUtf8?: boolean;
  acceptLossy?: boolean;
}

export const ipc = {
  docInit: () => invoke<DocInit>("doc_init"),
  setDirty: (dirty: boolean) => invoke<string>("doc_set_dirty", { dirty }),
  save: (request: SaveRequest) => invoke<SaveResult>("doc_save", { request }),
  openDialog: () => invoke<void>("doc_open_dialog"),
  newDoc: (newWindow: boolean) => invoke<void>("doc_new", { newWindow }),
  logCsp: (violation: { blockedUri: string; violatedDirective: string; sourceFile?: string }) =>
    invoke<void>("log_csp_violation", { violation }),
  log: (level: "info" | "warn" | "error", message: string) => invoke<void>("log_frontend", { level, message }),
};
