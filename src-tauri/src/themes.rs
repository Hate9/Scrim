//! Themes (spec 10): the theme folder, built-in themes, listing, and live reload.
//!
//! Themes are served by the `scrim-file` handler, which applies the compatibility
//! selector rewrite to CSS files in the theme folder (spec 01, "Local files in the
//! webview"), so relative `url()` and `@import` resolve against the theme's own URL.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;

/// Built-in themes, written from scratch from `22-visual-design.md` (10.2).
pub const BUILTIN: &[(&str, &str)] = &[
    ("paper.css", include_str!("../themes/paper.css")),
    ("clean.css", include_str!("../themes/clean.css")),
    ("night.css", include_str!("../themes/night.css")),
    ("plain.css", include_str!("../themes/plain.css")),
];

/// Hashes of the built-in files as last installed, to tell user edits apart (10.1).
const HASHES: &str = ".builtin-hashes.json";

pub fn themes_dir(state: &AppState) -> PathBuf {
    state.config_dir.join("themes")
}

/// FNV-1a 64: stable across builds (std's hasher is not).
fn fnv(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// Install built-in themes that are missing, and update ones the user has not edited
/// (the file still has the hash recorded when it was installed). Edited files are never
/// overwritten.
pub fn install_builtin(state: &AppState) {
    let dir = themes_dir(state);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        state.logger.warn(&format!("cannot create {}: {e}", dir.display()));
        return;
    }
    let hash_file = dir.join(HASHES);
    let mut hashes: BTreeMap<String, String> =
        std::fs::read_to_string(&hash_file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let mut changed = false;
    for (name, text) in BUILTIN {
        let path = dir.join(name);
        let new_hash = fnv(text.as_bytes());
        let write = match std::fs::read(&path) {
            Err(_) => true,
            Ok(cur) => {
                let cur_hash = fnv(&cur);
                cur_hash != new_hash && hashes.get(*name) == Some(&cur_hash)
            }
        };
        if write {
            match std::fs::write(&path, text) {
                Ok(()) => {
                    state.logger.info(&format!("installed built-in theme {name}"));
                    hashes.insert((*name).to_string(), new_hash);
                    changed = true;
                }
                Err(e) => state.logger.warn(&format!("cannot install {name}: {e}")),
            }
        } else if !hashes.contains_key(*name) && std::fs::read(&path).is_ok_and(|c| fnv(&c) == new_hash) {
            hashes.insert((*name).to_string(), new_hash);
            changed = true;
        }
    }
    if changed {
        let _ = std::fs::write(&hash_file, serde_json::to_string_pretty(&hashes).unwrap_or_default());
    }
}

/// Menu name of a theme file: `my-theme.css` → "My Theme" (10.1).
pub fn display_name(stem: &str) -> String {
    stem.split(['-', '_'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeInfo {
    /// file stem, the value stored in settings (`theme`)
    pub id: String,
    pub name: String,
    pub path: String,
}

/// Every `*.css` directly in the folder whose name does not end in `.user.css`.
pub fn list(dir: &Path) -> Vec<ThemeInfo> {
    let mut out: Vec<ThemeInfo> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let file = p.file_name()?.to_str()?.to_string();
            let lower = file.to_ascii_lowercase();
            if !lower.ends_with(".css") || lower.ends_with(".user.css") || !p.is_file() {
                return None;
            }
            let stem = file[..file.len() - 4].to_string();
            Some(ThemeInfo { name: display_name(&stem), id: stem, path: p.to_string_lossy().into_owned() })
        })
        .collect();
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemesInfo {
    pub dir: String,
    pub themes: Vec<ThemeInfo>,
}

#[tauri::command]
pub fn themes_list(state: State<'_, AppState>) -> ThemesInfo {
    let dir = themes_dir(&state);
    ThemesInfo { dir: dir.to_string_lossy().into_owned(), themes: list(&dir) }
}

/// Open the theme folder in the file manager, creating the (empty) user CSS files on
/// demand so they are there to edit (10.1).
#[tauri::command]
pub fn themes_open_folder(app: AppHandle, state: State<'_, AppState>, theme: Option<String>) -> Result<(), String> {
    let dir = themes_dir(&state);
    let mut files = vec!["base.user.css".to_string()];
    if let Some(t) = theme.filter(|t| !t.contains(['/', '\\'])) {
        files.push(format!("{t}.user.css"));
    }
    for f in files {
        let p = dir.join(f);
        if !p.exists() {
            let _ = std::fs::write(&p, "");
        }
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Is `path` (canonical) a CSS file in the theme folder (theme or user CSS)?
pub fn is_theme_css(state: &AppState, path: &Path) -> bool {
    let dir = themes_dir(state);
    let dir = std::fs::canonicalize(&dir).unwrap_or(dir);
    path.starts_with(&dir) && path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("css"))
}

pub struct ThemeWatcher(pub Mutex<Option<notify::RecommendedWatcher>>);

/// Watch the theme folder; any change re-applies themes in every window (10.1).
pub fn watch(app: &AppHandle) {
    use notify::Watcher;
    let state = app.state::<AppState>();
    let dir = themes_dir(&state);
    let app2 = app.clone();
    let pending = std::sync::Arc::new(Mutex::new(false));
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if !crate::workspace::is_change(&ev) {
            return;
        }
        if ev.paths.iter().all(|p| p.file_name().is_some_and(|n| n == HASHES)) {
            return;
        }
        let mut p = pending.lock().unwrap();
        if *p {
            return;
        }
        *p = true;
        let app3 = app2.clone();
        let pending2 = pending.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            *pending2.lock().unwrap() = false;
            let _ = app3.emit("scrim://themes-changed", ());
        });
    });
    match watcher {
        Ok(mut w) => {
            if let Err(e) = w.watch(&dir, notify::RecursiveMode::Recursive) {
                state.logger.warn(&format!("cannot watch {}: {e}", dir.display()));
            }
            *app.state::<ThemeWatcher>().0.lock().unwrap() = Some(w);
        }
        Err(e) => state.logger.warn(&format!("theme watcher: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(display_name("my-theme"), "My Theme");
        assert_eq!(display_name("night_owl-dark"), "Night Owl Dark");
        assert_eq!(display_name("paper"), "Paper");
    }

    #[test]
    fn lists_themes_not_user_css() {
        let d = tempfile::tempdir().unwrap();
        for f in ["b-theme.css", "a.css", "base.user.css", "a.user.css", "notes.txt"] {
            std::fs::write(d.path().join(f), "").unwrap();
        }
        std::fs::create_dir(d.path().join("a")).unwrap();
        let ids: Vec<_> = list(d.path()).into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["a", "b-theme"]);
    }
}
