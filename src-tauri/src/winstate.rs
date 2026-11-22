//! Window size and position, remembered per screen configuration (spec 07, 7.1).
//!
//! The configuration key lists the monitors (position, size, scale), so a laptop alone
//! and the laptop at a desk with a second screen each keep their own geometry. Saved in
//! `<config>/window-state.json` whenever a document window settles after moving or
//! resizing; a new window opens with the geometry for the current configuration (offset
//! when another window is already there). Window managers that place windows themselves
//! (Wayland) may ignore the position.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::state::AppState;

const FILE: &str = "window-state.json";
const CASCADE: i32 = 30;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Default)]
pub struct WindowStates {
    map: Mutex<Option<HashMap<String, Geometry>>>,
    /// Bumped on every change; a write waits until changes stop for a moment.
    generation: AtomicU64,
}

fn path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE)
}

/// The key of the current screen configuration.
pub fn screen_key(app: &AppHandle) -> Option<String> {
    let mut parts: Vec<String> = app
        .available_monitors()
        .ok()?
        .iter()
        .map(|m| {
            let p = m.position();
            let s = m.size();
            format!("{}x{}@{},{}*{}", s.width, s.height, p.x, p.y, (m.scale_factor() * 100.0).round())
        })
        .collect();
    if parts.is_empty() {
        return None;
    }
    parts.sort();
    Some(parts.join(";"))
}

fn with_map<T>(app: &AppHandle, f: impl FnOnce(&mut HashMap<String, Geometry>) -> T) -> T {
    let states = app.state::<WindowStates>();
    let mut guard = states.map.lock().unwrap();
    let map = guard.get_or_insert_with(|| {
        let dir = &app.state::<AppState>().config_dir;
        std::fs::read_to_string(path(dir)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    });
    f(map)
}

/// The geometry to open a new window with, if one is remembered for this configuration.
pub fn initial(app: &AppHandle) -> Option<Geometry> {
    let key = screen_key(app)?;
    let mut g = with_map(app, |m| m.get(&key).copied())?;
    // Cascade past windows already open at that spot.
    let taken: Vec<(i32, i32)> = app
        .webview_windows()
        .values()
        .filter(|w| w.label().starts_with("doc-"))
        .filter_map(|w| w.outer_position().ok().map(|p| (p.x, p.y)))
        .collect();
    // Within half a step counts as the same spot (window managers adjust by a few pixels).
    while taken.iter().any(|&(x, y)| (x - g.x).abs() < CASCADE / 2 && (y - g.y).abs() < CASCADE / 2) {
        g.x += CASCADE;
        g.y += CASCADE;
    }
    Some(g)
}

/// Apply a remembered geometry to a window that was just built (hidden until then is not
/// needed: the change happens before the first frame on both platforms).
pub fn apply(window: &WebviewWindow, g: Geometry) {
    let _ = window.set_size(PhysicalSize::new(g.width, g.height));
    let _ = window.set_position(PhysicalPosition::new(g.x, g.y));
    if g.maximized {
        let _ = window.maximize();
    }
}

/// Record a document window's geometry (after a move or resize).
pub fn record(window: &tauri::Window) {
    if !window.label().starts_with("doc-") {
        return;
    }
    let app = window.app_handle();
    let Some(key) = screen_key(app) else { return };
    let maximized = window.is_maximized().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if minimized {
        return;
    }
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else { return };
    let changed = with_map(app, |m| {
        let prev = m.get(&key).copied();
        // Maximized: keep the normal geometry, remember only the state.
        let g = if maximized {
            Geometry { maximized: true, ..prev.unwrap_or(Geometry { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized: true }) }
        } else {
            Geometry { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized: false }
        };
        if prev == Some(g) {
            return None;
        }
        m.insert(key.clone(), g);
        serde_json::to_string_pretty(&*m).ok()
    });
    if let Some(text) = changed {
        // Moves and resizes arrive continuously while dragging: write once they stop.
        let gen = app.state::<WindowStates>().generation.fetch_add(1, Ordering::SeqCst) + 1;
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(500));
            if app.state::<WindowStates>().generation.load(Ordering::SeqCst) == gen {
                let dir = &app.state::<AppState>().config_dir;
                let _ = scrim_core::save::save(&path(dir), format!("{text}\n").as_bytes());
            }
        });
    }
}
