//! Document windows: one webview window per document (spec 01, "Process model"; spec 07,
//! 7.1).

use std::path::{Path, PathBuf};

use scrim_core::identity::window_title;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::hardening;
use crate::state::{canonical, AppState, DocState};

/// Event telling a window to re-run `doc_init` because its document was replaced.
pub const EVENT_RELOAD: &str = "scrim://doc-reload";

/// Command-line flag that forces a new window (spec 07, 7.8).
pub const NEW_WINDOW_FLAG: &str = "--new-window";

/// How `open_paths` may reuse an existing window for a file that is not open yet.
#[derive(Debug, Clone)]
pub enum Reuse {
    /// "Open files in: current window when possible" for an action in window `label`
    /// (Open dialog): reuse it if its document is unmodified, untitled or saved.
    Current(String),
    /// Paths handed over by a launch (QA-LOG Q-007): never replace an open document;
    /// only a fresh untitled, unmodified, empty window is reused.
    FreshOnly,
    /// Always open a new window (`--new-window`).
    Never,
    /// Replace the document in this window even if it has unsaved changes (the user
    /// already chose "Don't Save").
    Force(String),
}

/// Reuse policy for paths given on a command line.
pub fn reuse_for_args(args: &[String]) -> Reuse {
    if args.iter().any(|a| a == NEW_WINDOW_FLAG) {
        Reuse::Never
    } else {
        Reuse::FreshOnly
    }
}

/// Turn command-line arguments into absolute paths. Options (leading `-`) are ignored;
/// `file://` URIs (as passed by Linux desktop launchers) are converted to paths.
pub fn paths_from_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .filter(|a| !a.is_empty() && !a.starts_with('-'))
        .map(|a| {
            let p = match a.strip_prefix("file://") {
                Some(rest) => {
                    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
                    PathBuf::from(
                        percent_encoding::percent_decode_str(rest).decode_utf8_lossy().into_owned(),
                    )
                }
                None => PathBuf::from(a),
            };
            if p.is_absolute() {
                p
            } else {
                cwd.join(p)
            }
        })
        .collect()
}

/// File name shown in the title bar.
pub fn display_name(path: Option<&Path>) -> Option<String> {
    path.and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned())
}

/// Set the window title from the document state and return it. The frontend mirrors it
/// into `document.title`, so WebDriver tests can read it.
pub fn update_title(app: &AppHandle, label: &str) -> String {
    let state = app.state::<AppState>();
    let title = {
        let docs = state.docs();
        match docs.get(label) {
            Some(doc) => {
                let name = doc.title_override.clone().or_else(|| display_name(doc.path.as_deref()));
                window_title(name.as_deref(), doc.dirty)
            }
            None => window_title(None, false),
        }
    };
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_title(&title);
    }
    title
}

/// A window can take over another document if its document is untitled and unmodified,
/// or saved and unmodified (spec 07, 7.1, "current window when possible").
fn reusable(doc: &DocState) -> bool {
    doc.initialized && !doc.dirty
}

/// A fresh "New" window: untitled, unmodified, and empty (QA-LOG Q-007).
fn fresh(doc: &DocState) -> bool {
    doc.initialized && !doc.dirty && doc.path.is_none() && doc.saved_text.is_empty()
}

fn focused_window(app: &AppHandle) -> Option<String> {
    app.webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(label, _)| label)
}

/// The window a not-yet-open file may replace under `reuse`, if any.
fn reuse_target(app: &AppHandle, reuse: &Reuse) -> Option<String> {
    let state = app.state::<AppState>();
    match reuse {
        Reuse::Never => None,
        Reuse::Force(label) => state.docs().contains_key(label).then(|| label.clone()),
        Reuse::Current(label) => state.docs().get(label).is_some_and(reusable).then(|| label.clone()),
        Reuse::FreshOnly => {
            let docs = state.docs();
            if let Some(f) = focused_window(app).filter(|l| docs.get(l).is_some_and(fresh)) {
                return Some(f);
            }
            let mut candidates: Vec<&String> =
                docs.iter().filter(|(_, d)| fresh(d)).map(|(l, _)| l).collect();
            candidates.sort_by_key(|l| l.trim_start_matches("doc-").parse::<u64>().unwrap_or(u64::MAX));
            candidates.first().map(|l| (*l).clone())
        }
    }
}

/// Open each path: focus the window that already has it, else replace a window allowed
/// by `reuse`, else open a new window. Only the first path may reuse a window (each
/// further file gets its own window, spec 07, 7.8).
pub fn open_paths(app: &AppHandle, paths: &[PathBuf], reuse: Reuse) {
    let state = app.state::<AppState>();
    let mut reuse = Some(reuse);
    for path in paths {
        if path.is_dir() {
            // A folder opens as the sidebar folder of a new window (7.8).
            let reusable_label = reuse.take().and_then(|r| reuse_target(app, &r));
            let label = match reusable_label {
                Some(l) => l,
                None => match create_window(app, None) {
                    Ok(w) => w.label().to_string(),
                    Err(e) => {
                        state.logger.error(&format!("cannot open window: {e}"));
                        continue;
                    }
                },
            };
            if let Some(d) = state.docs().get_mut(&label) {
                d.folder = Some(path.clone());
            }
            crate::workspace::remember(&state, path, true);
            if let Ok(c) = std::fs::canonicalize(path) {
                state.scope().dirs.insert(c);
            }
            crate::workspace::watch_folder(app, &label, path);
            let _ = app.emit_to(&label, "scrim://folder-opened", path.to_string_lossy().to_string());
            continue;
        }
        if let Some(label) = state.window_for_path(path) {
            state.logger.info(&format!("focus window for {}", path.display()));
            focus(app, &label);
            continue;
        }
        let target = reuse.take().and_then(|r| reuse_target(app, &r));
        match target {
            Some(label) => {
                state.logger.info(&format!("open {} in {label}", path.display()));
                {
                    let mut docs = state.docs();
                    let folder = docs.get(&label).and_then(|d| d.folder.clone());
                    docs.insert(label.clone(), DocState { path: Some(canonical_or(path)), folder, ..Default::default() });
                }
                update_title(app, &label);
                let _ = app.emit_to(&label, EVENT_RELOAD, ());
                focus(app, &label);
            }
            None => {
                state.logger.info(&format!("open {} in new window", path.display()));
                if let Err(e) = create_window(app, Some(path.clone())) {
                    state.logger.error(&format!("cannot open window: {e}"));
                }
            }
        }
    }
}

/// Keep the user's spelling of the path (so a symlink's own name shows in the title)
/// unless it is relative.
fn canonical_or(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        canonical(path)
    }
}

pub fn open_untitled(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    create_window(app, None)
}

pub fn focus(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn create_window(app: &AppHandle, path: Option<PathBuf>) -> tauri::Result<WebviewWindow> {
    let state = app.state::<AppState>();
    let label = state.next_window_label();
    let title = window_title(display_name(path.as_deref()).as_deref(), false);
    state.docs().insert(label.clone(), DocState { path: path.map(|p| canonical_or(&p)), ..Default::default() });

    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(900.0, 760.0)
        .min_inner_size(400.0, 300.0);
    let builder = hardening::configure_builder(builder);
    match builder.build() {
        Ok(window) => {
            hardening::configure_webview(&window, &state.logger);
            Ok(window)
        }
        Err(e) => {
            state.docs().remove(&label);
            Err(e)
        }
    }
}
