//! IPC commands called by the frontend. All are async so none blocks the UI thread
//! (spec 01, "Process model").

use std::path::{Path, PathBuf};

use scrim_core::encoding::{self, EncodeError, TextEncoding};
use scrim_core::line_endings::{self, LineEnding};
use scrim_core::save::{self, SaveMethod};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::state::{AppState, DocState};
use crate::windows;

/// Extensions offered by the Open dialog's Markdown filter (spec 07, 7.2).
pub const MARKDOWN_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext", "text", "txt", "Rmd",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocInit {
    pub path: Option<String>,
    pub file_name: Option<String>,
    /// Decoded text with its original line endings.
    pub text: String,
    pub encoding: TextEncoding,
    /// Majority line ending of the file, `None` if it has no line break.
    pub line_ending: Option<LineEnding>,
    /// Line ending for new lines when the file has none (settings default).
    pub default_line_ending: LineEnding,
    /// Some bytes could not be decoded and are shown as U+FFFD.
    pub malformed: bool,
    /// The path does not exist yet; saving creates it.
    pub missing: bool,
    /// The file could not be read; the window shows an untitled document instead.
    pub error: Option<String>,
}

#[tauri::command]
pub async fn doc_init(window: WebviewWindow, state: State<'_, AppState>) -> Result<DocInit, String> {
    let label = window.label().to_string();
    let path = state.docs().get(&label).and_then(|d| d.path.clone());
    let default_line_ending = state.settings().default_line_ending();
    let mut init = DocInit {
        path: None,
        file_name: None,
        text: String::new(),
        encoding: TextEncoding::utf8(),
        line_ending: None,
        default_line_ending,
        malformed: false,
        missing: false,
        error: None,
    };
    let mut doc = DocState { initialized: true, ..Default::default() };
    if let Some(path) = path {
        let read = {
            let p = path.clone();
            tauri::async_runtime::spawn_blocking(move || std::fs::read(&p))
                .await
                .map_err(|e| e.to_string())?
        };
        match read {
            Ok(bytes) => {
                let decoded = encoding::decode(&bytes);
                state.logger.info(&format!(
                    "opened {} ({} bytes, {}{})",
                    path.display(),
                    bytes.len(),
                    decoded.encoding.name,
                    if decoded.encoding.bom { " with BOM" } else { "" }
                ));
                if decoded.malformed {
                    state.logger.warn(&format!("{} has malformed {} bytes", path.display(), decoded.encoding.name));
                }
                init.line_ending = line_endings::detect(&decoded.text);
                init.text = decoded.text.clone();
                init.encoding = decoded.encoding.clone();
                init.malformed = decoded.malformed;
                doc.saved_text = decoded.text;
                doc.encoding = Some(decoded.encoding);
                doc.saved_bytes = Some(bytes);
                doc.malformed = decoded.malformed;
                doc.path = Some(path.clone());
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // SPEC-QUESTION Q-003: a path that does not exist opens as an empty
                // document that will be created at that path on save.
                state.logger.info(&format!("{} does not exist; new document", path.display()));
                init.missing = true;
                doc.path = Some(path.clone());
            }
            Err(e) => {
                state.logger.error(&format!("cannot read {}: {e}", path.display()));
                init.error = Some(format!("Cannot open {}: {e}", path.display()));
            }
        }
        if doc.path.is_some() {
            init.path = Some(path.to_string_lossy().into_owned());
            init.file_name = windows::display_name(Some(&path));
        }
    }
    state.docs().insert(label.clone(), doc);
    windows::update_title(window.app_handle(), &label);
    Ok(init)
}

#[tauri::command]
pub async fn doc_set_dirty(window: WebviewWindow, state: State<'_, AppState>, dirty: bool) -> Result<(), String> {
    let label = window.label().to_string();
    let changed = match state.docs().get_mut(&label) {
        Some(doc) if doc.dirty != dirty => {
            doc.dirty = dirty;
            true
        }
        _ => false,
    };
    if changed {
        windows::update_title(window.app_handle(), &label);
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    /// Full text with the line endings to write.
    pub text: String,
    /// Ask for a new path even if the document has one.
    #[serde(default)]
    pub save_as: bool,
    /// File name proposed by the save dialog for untitled documents.
    pub suggested_name: Option<String>,
    /// The user confirmed saving as UTF-8 after an `unrepresentable` result.
    #[serde(default)]
    pub convert_to_utf8: bool,
    /// The user confirmed saving a document that had undecodable bytes.
    #[serde(default)]
    pub accept_lossy: bool,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveResult {
    #[serde(rename_all = "camelCase")]
    Saved { path: String, file_name: Option<String>, encoding: TextEncoding },
    Cancelled,
    /// The text has characters the file's encoding cannot represent.
    #[serde(rename_all = "camelCase")]
    Unrepresentable { encoding: String, first: String, count: usize },
    /// The file had undecodable bytes (shown as U+FFFD); saving would replace them.
    #[serde(rename_all = "camelCase")]
    Lossy { encoding: String },
    Error { message: String },
}

#[tauri::command]
pub async fn doc_save(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: SaveRequest,
) -> Result<SaveResult, String> {
    let label = window.label().to_string();
    let (current_path, enc, saved_text, saved_bytes, malformed) = {
        let docs = state.docs();
        let Some(doc) = docs.get(&label) else { return Err("unknown window".into()) };
        (doc.path.clone(), doc.encoding.clone(), doc.saved_text.clone(), doc.saved_bytes.clone(), doc.malformed)
    };

    let path = match (&current_path, request.save_as) {
        (Some(p), false) => p.clone(),
        _ => {
            let default_name = current_path
                .as_deref()
                .and_then(Path::file_name)
                .map(|n| n.to_string_lossy().into_owned())
                .or(request.suggested_name.clone())
                .unwrap_or_else(|| "Untitled.md".into());
            let mut dialog = window
                .app_handle()
                .dialog()
                .file()
                .set_parent(&window)
                .set_file_name(default_name)
                .add_filter("Markdown", MARKDOWN_EXTENSIONS);
            if let Some(dir) = current_path.as_deref().and_then(Path::parent) {
                dialog = dialog.set_directory(dir);
            }
            let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
                .await
                .map_err(|e| e.to_string())?;
            match picked.and_then(|p| p.into_path().ok()) {
                Some(p) => p,
                None => return Ok(SaveResult::Cancelled),
            }
        }
    };

    let mut target_enc = enc.unwrap_or_else(TextEncoding::utf8);
    if request.convert_to_utf8 {
        target_enc = TextEncoding::utf8();
    }
    let unchanged = request.text == saved_text
        && Some(&path) == current_path.as_ref()
        && !request.convert_to_utf8
        && saved_bytes.is_some();
    let bytes = if unchanged {
        saved_bytes.expect("checked above")
    } else {
        if malformed && !request.accept_lossy && !request.convert_to_utf8 {
            return Ok(SaveResult::Lossy { encoding: target_enc.name });
        }
        match encoding::encode(&request.text, &target_enc) {
            Ok(b) => b,
            Err(EncodeError::Unrepresentable { encoding, first, count }) => {
                return Ok(SaveResult::Unrepresentable { encoding, first: first.to_string(), count });
            }
        }
    };

    let write_path = path.clone();
    let write_bytes = bytes.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || save::save(&write_path, &write_bytes))
        .await
        .map_err(|e| e.to_string())?;
    match outcome {
        Ok(out) => {
            match (&out.method, &out.fallback_reason) {
                (SaveMethod::Atomic, _) => state.logger.info(&format!("saved {} (atomic)", out.target.display())),
                (SaveMethod::InPlace, reason) => state.logger.warn(&format!(
                    "saved {} in place: {}",
                    out.target.display(),
                    reason.as_deref().unwrap_or("?")
                )),
            }
            if let Some(doc) = state.docs().get_mut(&label) {
                doc.path = Some(path.clone());
                doc.encoding = Some(target_enc.clone());
                doc.saved_text = request.text;
                doc.saved_bytes = Some(bytes);
                doc.malformed = malformed && unchanged;
                doc.dirty = false;
            }
            windows::update_title(window.app_handle(), &label);
            Ok(SaveResult::Saved {
                path: path.to_string_lossy().into_owned(),
                file_name: windows::display_name(Some(&path)),
                encoding: target_enc,
            })
        }
        Err(e) => {
            state.logger.error(&format!("save {} failed: {e}", path.display()));
            Ok(SaveResult::Error { message: format!("Could not save {}: {e}", path.display()) })
        }
    }
}

#[tauri::command]
pub async fn doc_open_dialog(window: WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    let label = window.label().to_string();
    let dir = state.docs().get(&label).and_then(|d| d.path.as_deref().and_then(Path::parent).map(Path::to_path_buf));
    let mut dialog = window
        .app_handle()
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Markdown", MARKDOWN_EXTENSIONS)
        .add_filter("All files", &["*"]);
    if let Some(dir) = dir {
        dialog = dialog.set_directory(dir);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|e| e.to_string())?;
    if let Some(path) = picked.and_then(|p| p.into_path().ok()) {
        let app = window.app_handle().clone();
        open_on_main(app, vec![path], Some(label));
    }
    Ok(())
}

/// New file (Mod+N) follows the "open files in" rule; new window (Mod+Shift+N) always
/// opens a window (spec 07, 7.1).
#[tauri::command]
pub async fn doc_new(window: WebviewWindow, state: State<'_, AppState>, new_window: bool) -> Result<(), String> {
    let label = window.label().to_string();
    let reuse = !new_window && state.docs().get(&label).is_some_and(|d| d.initialized && !d.dirty);
    let app = window.app_handle().clone();
    if reuse {
        state.docs().insert(label.clone(), DocState::default());
        windows::update_title(&app, &label);
        use tauri::Emitter;
        let _ = app.emit_to(&label, windows::EVENT_RELOAD, ());
    } else {
        let app2 = app.clone();
        app.run_on_main_thread(move || {
            if let Err(e) = windows::open_untitled(&app2) {
                app2.state::<AppState>().logger.error(&format!("cannot open window: {e}"));
            }
        })
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn open_on_main(app: AppHandle, paths: Vec<PathBuf>, prefer: Option<String>) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || windows::open_paths(&app2, &paths, prefer.as_deref()));
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CspViolation {
    pub blocked_uri: String,
    pub violated_directive: String,
    pub source_file: Option<String>,
}

/// Every CSP violation is logged with its URL (spec 19, "Enforcement" item 5).
#[tauri::command]
pub async fn log_csp_violation(window: WebviewWindow, state: State<'_, AppState>, violation: CspViolation) -> Result<(), String> {
    state.logger.warn(&format!(
        "blocked by CSP in {}: {} (directive {}{})",
        window.label(),
        violation.blocked_uri,
        violation.violated_directive,
        violation.source_file.map(|s| format!(", source {s}")).unwrap_or_default()
    ));
    Ok(())
}

#[tauri::command]
pub async fn log_frontend(window: WebviewWindow, state: State<'_, AppState>, level: String, message: String) -> Result<(), String> {
    let level = match level.as_str() {
        "error" => "ERROR",
        "warn" => "WARN",
        _ => "INFO",
    };
    state.logger.log(level, &format!("[{}] {message}", window.label()));
    Ok(())
}
