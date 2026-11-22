//! `global:` shortcuts (spec 12): `config.jsonc` `shortcuts` entries with the `global:`
//! prefix are registered system-wide, best effort. Every window reports the same map
//! (command id → key) after reading the config; registration happens once, here. A
//! press runs the command in the document window that had focus last (shown and focused
//! first), or in a new window when none is open.
//! Wayland offers no global key grabs to applications; there, registration fails and is
//! logged.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::state::AppState;

#[derive(Default)]
pub struct Hotkeys {
    /// Registered shortcut (its string form) → command id.
    bound: Mutex<HashMap<String, (Shortcut, String)>>,
    /// The map last applied, to skip repeats from other windows.
    applied: Mutex<Vec<(String, String)>>,
    last_focused: Mutex<Option<String>>,
    /// A command for a window that is still loading (window label, command id).
    pending: Mutex<Option<(String, String)>>,
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let hk = app.state::<Hotkeys>();
            let id = hk.bound.lock().unwrap().values().find(|(s, _)| s == shortcut).map(|(_, id)| id.clone());
            if let Some(id) = id {
                run(app, &id);
            }
        })
        .build()
}

/// A document window gained focus.
pub fn note_focus(app: &AppHandle, label: &str) {
    if label.starts_with("doc-") {
        *app.state::<Hotkeys>().last_focused.lock().unwrap() = Some(label.to_string());
    }
}

fn run(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    state.logger.info(&format!("global shortcut: {id}"));
    let last = app.state::<Hotkeys>().last_focused.lock().unwrap().clone();
    let target = last
        .and_then(|l| app.get_webview_window(&l))
        .or_else(|| app.webview_windows().into_iter().filter(|(l, _)| l.starts_with("doc-")).map(|(_, w)| w).next());
    match target {
        Some(w) => {
            crate::windows::focus(app, w.label());
            let _ = w.emit_to(w.label(), "scrim://global-shortcut", id.to_string());
        }
        None => {
            if let Ok(w) = crate::windows::create_window(app, None) {
                // The new window runs it once its page is ready (`global_shortcut_take`).
                *app.state::<Hotkeys>().pending.lock().unwrap() = Some((w.label().to_string(), id.to_string()));
            }
        }
    }
}

/// Register exactly these global shortcuts (command id → Scrim accelerator text, e.g.
/// `Ctrl+Alt+N`). Returns the entries that could not be registered, with the reason.
#[tauri::command]
pub fn global_shortcuts_set(app: AppHandle, map: HashMap<String, String>) -> Vec<String> {
    let hk = app.state::<Hotkeys>();
    let mut wanted: Vec<(String, String)> = map.into_iter().collect();
    wanted.sort();
    {
        let mut applied = hk.applied.lock().unwrap();
        if *applied == wanted {
            return vec![];
        }
        *applied = wanted.clone();
    }
    let gs = app.global_shortcut();
    let mut bound = hk.bound.lock().unwrap();
    for (_, (s, _)) in bound.drain() {
        let _ = gs.unregister(s);
    }
    let logger = &app.state::<AppState>().logger;
    let mut problems = vec![];
    for (id, key) in wanted {
        let text = key
            .split('+')
            .map(|t| match t {
                "Ctrl" => "CommandOrControl",
                "Esc" => "Escape",
                other => other,
            })
            .collect::<Vec<_>>()
            .join("+");
        let result = text.parse::<Shortcut>().map_err(|e| e.to_string()).and_then(|s| gs.register(s).map(|_| s).map_err(|e| e.to_string()));
        match result {
            Ok(s) => {
                logger.info(&format!("global shortcut {key} → {id}"));
                bound.insert(key.clone(), (s, id));
            }
            Err(e) => {
                logger.warn(&format!("global shortcut {key} ({id}) not registered: {e}"));
                problems.push(format!("{key}: {e}"));
            }
        }
    }
    problems
}

/// The command a global shortcut opened this window for, if any (asked once at startup).
#[tauri::command]
pub fn global_shortcut_take(window: tauri::WebviewWindow, app: AppHandle) -> Option<String> {
    let hk = app.state::<Hotkeys>();
    let mut pending = hk.pending.lock().unwrap();
    match pending.take() {
        Some((label, id)) if label == window.label() => Some(id),
        other => {
            *pending = other;
            None
        }
    }
}
