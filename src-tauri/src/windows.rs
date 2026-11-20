//! Document windows: one webview window per document (spec 01, "Process model"; spec 07,
//! 7.1).

use std::path::{Path, PathBuf};

use scrim_core::identity::window_title;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::hardening;
use crate::state::{canonical, AppState, DocState};

/// Event telling a window to re-run `doc_init` because its document was replaced.
pub const EVENT_RELOAD: &str = "scrim://doc-reload";

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
            Some(doc) => window_title(display_name(doc.path.as_deref()).as_deref(), doc.dirty),
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

fn focused_window(app: &AppHandle) -> Option<String> {
    app.webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(label, _)| label)
}

/// Open each path: focus the window that already has it, else reuse `prefer` (or the
/// focused window) when it is reusable, else open a new window. Only the first path may
/// reuse a window.
pub fn open_paths(app: &AppHandle, paths: &[PathBuf], prefer: Option<&str>) {
    let state = app.state::<AppState>();
    let mut reuse = prefer.map(str::to_string).or_else(|| focused_window(app));
    for path in paths {
        if let Some(label) = state.window_for_path(path) {
            state.logger.info(&format!("focus window for {}", path.display()));
            focus(app, &label);
            reuse = None;
            continue;
        }
        let target = reuse.take().filter(|l| state.docs().get(l).is_some_and(reusable));
        match target {
            Some(label) => {
                state.logger.info(&format!("open {} in {label}", path.display()));
                {
                    let mut docs = state.docs();
                    docs.insert(label.clone(), DocState { path: Some(canonical_or(path)), ..Default::default() });
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
