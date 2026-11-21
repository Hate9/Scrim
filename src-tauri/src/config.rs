//! `config.jsonc` commands and live reload (spec 11, "Storage"; 12: shortcuts reload
//! when the file is saved).

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;
use scrim_core::config;

#[derive(Serialize)]
pub struct ConfigInfo {
    pub config: serde_json::Value,
    pub error: Option<String>,
    pub path: String,
}

#[tauri::command]
pub fn config_get(state: State<'_, AppState>) -> ConfigInfo {
    let (cfg, error) = config::load(&state.config_dir);
    ConfigInfo { config: cfg, error, path: config::path(&state.config_dir).to_string_lossy().into_owned() }
}

/// "Reset Advanced Settings" (11, General): restore the commented default.
#[tauri::command]
pub fn config_reset(state: State<'_, AppState>) -> Result<(), String> {
    config::reset(&state.config_dir).map_err(|e| e.to_string())?;
    state.logger.info("config.jsonc reset to the default");
    Ok(())
}

pub struct ConfigWatcher(pub Mutex<Option<notify::RecommendedWatcher>>);

pub fn setup(app: &AppHandle) {
    use notify::Watcher;
    let state = app.state::<AppState>();
    if let Err(e) = config::ensure_default(&state.config_dir) {
        state.logger.warn(&format!("cannot write {}: {e}", config::FILE_NAME));
    }
    let app2 = app.clone();
    let pending = std::sync::Arc::new(Mutex::new(false));
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if !ev.paths.iter().any(|p| p.file_name().is_some_and(|n| n == config::FILE_NAME)) {
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
            let _ = app3.emit("scrim://config-changed", ());
        });
    });
    // The folder, not the file: editors save by replacing the file.
    if let Ok(mut w) = watcher {
        if w.watch(&state.config_dir, notify::RecursiveMode::NonRecursive).is_ok() {
            *app.state::<ConfigWatcher>().0.lock().unwrap() = Some(w);
        }
    }
}
