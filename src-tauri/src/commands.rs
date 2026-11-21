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
    /// Window title.
    pub title: String,
    /// The preferences (`settings.json`), as stored.
    pub settings: serde_json::Value,
    /// The window's sidebar folder, if any (7.4).
    pub folder: Option<String>,
    /// The text is a recovered draft (unsaved).
    pub recovered: bool,
}

#[tauri::command]
pub async fn doc_init(window: WebviewWindow, state: State<'_, AppState>) -> Result<DocInit, String> {
    let label = window.label().to_string();
    let (mut path, folder, recover) =
        state.docs().get(&label).map(|d| (d.path.clone(), d.folder.clone(), d.recover_id.clone())).unwrap_or_default();
    // A recovered draft (7.6): its text, bound to its file if it had one.
    let mut recovered: Option<String> = None;
    if let Some(id) = &recover {
        let dir = state.config_dir.join("recovery");
        recovered = std::fs::read_to_string(dir.join(format!("{id}.md"))).ok();
        if let Some(meta) = std::fs::read(dir.join(format!("{id}.json"))).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()) {
            path = meta.get("path").and_then(|p| p.as_str()).map(PathBuf::from);
        }
    }
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
        title: String::new(),
        settings: serde_json::Value::Object(state.settings().values.clone()),
        folder: None,
        recovered: false,
    };
    let mut doc = DocState { initialized: true, folder: folder.clone(), ..Default::default() };
    init.folder = folder.map(|f| f.to_string_lossy().into_owned());
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
                crate::workspace::remember(&state, &path, false);
                crate::workspace::watch_file(window.app_handle(), &label, &path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // QA-LOG Q-003: a path that does not exist opens as an empty document
                // that is created at that path on save.
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
    if let (Some(text), Some(id)) = (recovered, recover) {
        init.text = text;
        init.recovered = true;
        doc.draft_id = Some(id);
        doc.dirty = true;
    }
    state.docs().insert(label.clone(), doc);
    init.title = windows::update_title(window.app_handle(), &label);
    crate::pdf_proto::maybe_print(&window);
    Ok(init)
}

#[tauri::command]
pub async fn doc_set_dirty(window: WebviewWindow, state: State<'_, AppState>, dirty: bool) -> Result<String, String> {
    let label = window.label().to_string();
    if let Some(doc) = state.docs().get_mut(&label) {
        doc.dirty = dirty;
    }
    Ok(windows::update_title(window.app_handle(), &label))
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
    /// The user confirmed creating the missing parent folder (QA-LOG Q-003).
    #[serde(default)]
    pub create_folder: bool,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveResult {
    #[serde(rename_all = "camelCase")]
    Saved { path: String, file_name: Option<String>, encoding: TextEncoding, title: String },
    Cancelled,
    /// The text has characters the file's encoding cannot represent.
    #[serde(rename_all = "camelCase")]
    Unrepresentable { encoding: String, first: String, count: usize },
    /// The file had undecodable bytes (shown as U+FFFD); saving would replace them.
    #[serde(rename_all = "camelCase")]
    Lossy { encoding: String },
    /// The parent folder of the path does not exist (QA-LOG Q-003).
    #[serde(rename_all = "camelCase")]
    NeedsFolder { folder: String },
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
            // Debug builds only: the E2E suite cannot drive the native save dialog, so it
            // names the Save As target in a file (one use per write).
            #[cfg(debug_assertions)]
            let test_target = std::env::var_os("SCRIM_TEST_SAVE_AS")
                .map(PathBuf::from)
                .and_then(|f| std::fs::read_to_string(&f).ok().filter(|t| !t.trim().is_empty()).map(|t| (f, t)))
                .map(|(f, t)| {
                    let _ = std::fs::write(f, "");
                    PathBuf::from(t.trim())
                });
            #[cfg(not(debug_assertions))]
            let test_target: Option<PathBuf> = None;
            if let Some(p) = test_target {
                p
            } else {
                let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
                    .await
                    .map_err(|e| e.to_string())?;
                match picked.and_then(|p| p.into_path().ok()) {
                    Some(p) => p,
                    None => return Ok(SaveResult::Cancelled),
                }
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
        // QA-LOG Q-005: undecodable bytes are only written back as U+FFFD after the user
        // confirms.
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

    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        if !parent.exists() {
            if !request.create_folder {
                return Ok(SaveResult::NeedsFolder { folder: parent.to_string_lossy().into_owned() });
            }
            if let Err(e) = std::fs::create_dir_all(parent) {
                state.logger.error(&format!("cannot create folder {}: {e}", parent.display()));
                return Ok(SaveResult::Error { message: format!("Could not create folder {}: {e}", parent.display()) });
            }
            state.logger.info(&format!("created folder {}", parent.display()));
        }
    }

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
            crate::workspace::remember(&state, &path, false);
            if current_path.as_ref() != Some(&path) {
                crate::workspace::watch_file(window.app_handle(), &label, &path);
            }
            if let Some(doc) = state.docs().get_mut(&label) {
                doc.path = Some(path.clone());
                doc.encoding = Some(target_enc.clone());
                doc.saved_text = request.text;
                doc.saved_bytes = Some(bytes);
                doc.malformed = malformed && unchanged;
                doc.dirty = false;
            }
            let title = windows::update_title(window.app_handle(), &label);
            Ok(SaveResult::Saved {
                path: path.to_string_lossy().into_owned(),
                file_name: windows::display_name(Some(&path)),
                encoding: target_enc,
                title,
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
        let reuse = if always_new_window(&state) { windows::Reuse::Never } else { windows::Reuse::Current(label) };
        open_on_main(app, vec![path], reuse);
    }
    Ok(())
}

/// Preferences → General → "Open files in: always new window" (7.1).
fn always_new_window(state: &AppState) -> bool {
    state.settings().values.get("openFilesIn").and_then(|v| v.as_str()) == Some("new")
}

/// New file (Mod+N) follows the "open files in" rule; new window (Mod+Shift+N) always
/// opens a window (spec 07, 7.1).
#[tauri::command]
pub async fn doc_new(window: WebviewWindow, state: State<'_, AppState>, new_window: bool) -> Result<(), String> {
    let label = window.label().to_string();
    let reuse = !new_window && !always_new_window(&state) && state.docs().get(&label).is_some_and(|d| d.initialized && !d.dirty);
    let app = window.app_handle().clone();
    if reuse {
        let folder = state.docs().get(&label).and_then(|d| d.folder.clone());
        state.docs().insert(label.clone(), DocState { folder, ..Default::default() });
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

fn open_on_main(app: AppHandle, paths: Vec<PathBuf>, reuse: windows::Reuse) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || windows::open_paths(&app2, &paths, reuse));
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

/// Files referenced by an open document that the `scrim-file` protocol may serve (spec
/// 01, "Local files in the webview", scope a). Paths are canonicalized; directories are
/// ignored.
#[tauri::command]
pub async fn scope_allow_files(state: State<'_, AppState>, paths: Vec<String>) -> Result<(), String> {
    let mut scope = state.scope();
    for p in paths {
        if let Ok(c) = std::fs::canonicalize(&p) {
            if c.is_file() {
                scope.files.insert(c);
            }
        }
    }
    Ok(())
}

/// Plain text on the system clipboard (Mod+K reads a URL from it, spec 03, 3.6).
#[tauri::command]
pub async fn clipboard_read_text() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use clipboard_rs::{Clipboard, ClipboardContext};
        let ctx = ClipboardContext::new().map_err(|e| e.to_string())?;
        Ok(ctx.get_text().ok())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open a Markdown file from a link in the document (spec 03, 3.9): `mode` is
/// "current" (this window; the frontend already asked about unsaved changes) or "new".
#[tauri::command]
pub async fn doc_open_path(window: WebviewWindow, path: String, mode: String) -> Result<(), String> {
    let label = window.label().to_string();
    let reuse = if mode == "new" { windows::Reuse::Never } else { windows::Reuse::Force(label) };
    open_on_main(window.app_handle().clone(), vec![PathBuf::from(path)], reuse);
    Ok(())
}

/// Hand a link the user opened to the system (spec 03, 3.9; spec 19: user-initiated,
/// nothing is fetched by Scrim).
#[tauri::command]
pub async fn open_external(app: AppHandle, state: State<'_, AppState>, target: String, is_path: bool) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    state.logger.info(&format!("open externally: {}", if is_path { "local file" } else { "url" }));
    let r = if is_path { app.opener().open_path(&target, None::<&str>) } else { app.opener().open_url(&target, None::<&str>) };
    r.map_err(|e| e.to_string())
}

/// Put plain text on the system clipboard (code block copy button, spec 04, 4.5).
#[tauri::command]
pub async fn clipboard_write_text(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use clipboard_rs::{Clipboard, ClipboardContext};
        let ctx = ClipboardContext::new().map_err(|e| e.to_string())?;
        ctx.set_text(text).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Front matter `title` (spec 04, 4.11): shown in the window title instead of the file
/// name; `None` restores the file name (QA-LOG Q-013).
#[tauri::command]
pub async fn doc_set_title_override(window: WebviewWindow, state: State<'_, AppState>, title: Option<String>) -> Result<String, String> {
    let label = window.label().to_string();
    if let Some(doc) = state.docs().get_mut(&label) {
        doc.title_override = title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    }
    Ok(windows::update_title(window.app_handle(), &label))
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardMedia {
    /// PNG data, base64, when the clipboard holds an image.
    pub image_base64: Option<String>,
    /// Copied files (from a file manager).
    pub files: Vec<String>,
}

/// Image data or a file list from the system clipboard. WebKitGTK's paste event does
/// not expose them, so keyboard paste falls back to this (spec 06, 6.2 items 3–4).
#[tauri::command]
pub async fn clipboard_read_media() -> Result<ClipboardMedia, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use base64::Engine;
        use clipboard_rs::common::RustImage;
        use clipboard_rs::{Clipboard, ClipboardContext};
        let ctx = ClipboardContext::new().map_err(|e| e.to_string())?;
        let mut out = ClipboardMedia::default();
        if let Ok(files) = ctx.get_files() {
            out.files = files
                .into_iter()
                .map(|f| match f.strip_prefix("file://") {
                    Some(rest) => percent_encoding::percent_decode_str(rest).decode_utf8_lossy().into_owned(),
                    None => f,
                })
                .collect();
        }
        if out.files.is_empty() {
            if let Ok(img) = ctx.get_image() {
                if let Ok(png) = img.to_png() {
                    out.image_base64 = Some(base64::engine::general_purpose::STANDARD.encode(png.get_bytes()));
                }
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The current preferences (`settings.json`), for windows refreshing after a change.
#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    Ok(serde_json::Value::Object(state.settings().values.clone()))
}

/// Change one preference: written to `settings.json` and applied in every window
/// (spec 11: "Settings changes made in one window apply to all open windows
/// immediately"). The preferences window (P4) uses this.
#[tauri::command]
pub async fn settings_set(app: AppHandle, state: State<'_, AppState>, key: String, value: serde_json::Value) -> Result<(), String> {
    {
        let mut settings = state.settings();
        if value.is_null() {
            settings.values.remove(&key);
        } else {
            settings.values.insert(key.clone(), value);
        }
        settings.save(&state.config_dir).map_err(|e| e.to_string())?;
    }
    state.logger.info(&format!("setting changed: {key}"));
    use tauri::Emitter;
    app.emit("scrim://settings-changed", key).map_err(|e| e.to_string())
}

/// Put text and HTML on the clipboard (menu-driven Copy/Cut, spec 01 "Keyboard routing"
/// rule 2: no DOM clipboard event fires for a menu click).
#[tauri::command]
pub async fn clipboard_write_flavors(text: String, html: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use clipboard_rs::{Clipboard, ClipboardContent, ClipboardContext};
        let ctx = ClipboardContext::new().map_err(|e| e.to_string())?;
        let mut parts = vec![ClipboardContent::Text(text)];
        if let Some(h) = html {
            parts.push(ClipboardContent::Html(h));
        }
        ctx.set(parts).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// HTML from the clipboard, if any (menu-driven Paste).
#[tauri::command]
pub async fn clipboard_read_html() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use clipboard_rs::{Clipboard, ClipboardContext};
        let ctx = ClipboardContext::new().map_err(|e| e.to_string())?;
        Ok(ctx.get_html().ok())
    })
    .await
    .map_err(|e| e.to_string())?
}
