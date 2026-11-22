//! `local.json` (snippets, custom HTML tags, picker shortcut: specs 16, 17) and the files
//! the Customize pane edits (18): `base.user.css` and `config.jsonc`.
//!
//! Every save is written atomically; the config folder watcher (config.rs) then tells all
//! windows (`scrim://local-changed`, `scrim://config-changed`; the theme watcher reloads
//! user CSS), so a change applies everywhere whether it came from the pane or an
//! external editor.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

pub const FILE_NAME: &str = "local.json";

pub fn default_local() -> Value {
    json!({ "snippets": [], "customHTMLTags": { "inline": [], "block": [] }, "pickerKey": "Ctrl+Alt+Space" })
}

/// The file's object, with missing keys filled from the defaults. A broken file reads as
/// the defaults (and the error).
pub fn read_local(state: &AppState) -> (Value, Option<String>) {
    let mut out = default_local();
    let path = state.config_dir.join(FILE_NAME);
    let Ok(text) = std::fs::read_to_string(&path) else { return (out, None) };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(m)) => {
            for (k, v) in m {
                out[k] = v;
            }
            (out, None)
        }
        Ok(_) => (out, Some(format!("{FILE_NAME}: the top level must be an object"))),
        Err(e) => (out, Some(format!("{FILE_NAME}: {e}"))),
    }
}

#[derive(Serialize)]
pub struct LocalInfo {
    pub local: Value,
    pub error: Option<String>,
}

#[tauri::command]
pub fn local_get(state: State<'_, AppState>) -> LocalInfo {
    let (local, error) = read_local(&state);
    LocalInfo { local, error }
}

/// Save `local.json` (pretty-printed; unknown keys kept as given).
#[tauri::command]
pub fn local_set(app: AppHandle, state: State<'_, AppState>, local: Value) -> Result<(), String> {
    if !local.is_object() {
        return Err("local.json must be an object".into());
    }
    let text = serde_json::to_string_pretty(&local).map_err(|e| e.to_string())? + "\n";
    scrim_core::save::save(&state.config_dir.join(FILE_NAME), text.as_bytes()).map_err(|e| e.to_string())?;
    // The watcher also reports it; this makes the saving window's own update immediate.
    let _ = app.emit("scrim://local-changed", ());
    Ok(())
}

#[derive(Serialize)]
pub struct TextFile {
    pub path: String,
    pub text: String,
}

/// `config.jsonc` as written (comments kept), for the Customize pane.
#[tauri::command]
pub fn config_text(state: State<'_, AppState>) -> TextFile {
    let p = scrim_core::config::path(&state.config_dir);
    TextFile { text: std::fs::read_to_string(&p).unwrap_or_default(), path: p.to_string_lossy().into_owned() }
}

/// Save `config.jsonc` verbatim after validating it (18, Tab 3). Returns the parser error
/// (with line and column) instead of saving when it does not parse.
#[tauri::command]
pub fn config_save(state: State<'_, AppState>, text: String) -> Result<(), String> {
    match scrim_core::config::parse_jsonc(&text) {
        Ok(Value::Object(_)) => {}
        Ok(_) => return Err("the top level must be an object".into()),
        Err(e) => return Err(e),
    }
    scrim_core::save::save(&scrim_core::config::path(&state.config_dir), text.as_bytes()).map(|_| ()).map_err(|e| e.to_string())
}

fn user_css_path(state: &AppState) -> std::path::PathBuf {
    crate::themes::themes_dir(state).join("base.user.css")
}

#[tauri::command]
pub fn user_css_get(state: State<'_, AppState>) -> TextFile {
    let p = user_css_path(&state);
    TextFile { text: std::fs::read_to_string(&p).unwrap_or_default(), path: p.to_string_lossy().into_owned() }
}

#[tauri::command]
pub fn user_css_save(state: State<'_, AppState>, text: String) -> Result<(), String> {
    scrim_core::save::save(&user_css_path(&state), text.as_bytes()).map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn jsonc_errors_have_line_and_column() {
        let e = scrim_core::config::parse_jsonc("{\n  // c\n  broken: [ }").unwrap_err();
        assert!(e.contains("line 3"), "{e}");
        assert!(e.contains("column"), "{e}");
    }
}
