//! Export (spec 09): the parts that need the file system. The document itself is
//! rendered in its window (src/export/); Rust supplies the theme CSS for inlining,
//! writes the result, prints PDFs, and runs pandoc and custom commands.

use std::path::{Path, PathBuf};

use base64::Engine;
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Deserialize;
use tauri::State;

use crate::protocol::mime_for;
use crate::state::AppState;
use crate::themes::themes_dir;

/// How references to other files in inlined CSS are written (9.1 item 4).
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RefMode {
    /// absolute `file://` URLs (HTML export)
    File,
    /// `scrim-file` URLs (PDF and print: the page is loaded in Scrim's webview)
    ScrimFile,
    /// data URLs (HTML export with "embed assets")
    Embed,
}

const PATH_SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~');

/// `file://` URL of an absolute path.
pub fn file_url(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    let segs: Vec<String> = s.split('/').map(|p| if p.ends_with(':') { p.to_string() } else { utf8_percent_encode(p, PATH_SEGMENT).to_string() }).collect();
    let joined = segs.join("/");
    if joined.starts_with('/') {
        format!("file://{joined}")
    } else {
        format!("file:///{joined}")
    }
}

/// `scrim-file` URL of an absolute path, with real path segments so relative references
/// inside the file resolve against its folder (same as the frontend's `themeFileUrl`).
pub fn scrim_file_url(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    let segs: Vec<String> = s.trim_start_matches('/').split('/').map(|p| utf8_percent_encode(p, PATH_SEGMENT).to_string()).collect();
    if cfg!(windows) {
        format!("http://scrim-file.localhost/{}", segs.join("/"))
    } else {
        format!("scrim-file://localhost/{}", segs.join("/"))
    }
}

pub fn data_url(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mime = mime_for(path).split(';').next().unwrap_or("application/octet-stream");
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Whether a CSS reference points at a local, relative file.
fn is_relative(url: &str) -> bool {
    let u = url.trim();
    !(u.is_empty() || u.starts_with('#') || u.starts_with('/') || u.starts_with("//") || u.contains(':'))
}

/// One style sheet, compatibility-rewritten (10.3), with its references resolved against
/// its own folder per `mode`. Imported sheets are inlined as data URLs (they need the
/// same treatment, and a `file://` import would not get it).
pub fn sheet(path: &Path, mode: RefMode, depth: u32) -> Option<String> {
    let css = std::fs::read_to_string(path).ok()?;
    let css = scrim_core::theme_css::rewrite(&css);
    let dir = path.parent().unwrap_or(Path::new("."));
    Some(scrim_core::theme_css::map_urls(&css, |r| {
        if !is_relative(&r.url) {
            return None;
        }
        let rel = r.url.split(['?', '#']).next().unwrap_or("");
        let rel = percent_encoding::percent_decode_str(rel).decode_utf8_lossy().to_string();
        let target = scrim_core::images::normalize(&dir.join(rel));
        if r.import {
            if depth >= 8 {
                return None;
            }
            let inner = sheet(&target, mode, depth + 1)?;
            return Some(format!("data:text/css;base64,{}", base64::engine::general_purpose::STANDARD.encode(inner)));
        }
        let suffix = r.url.find('#').map(|i| &r.url[i..]).unwrap_or("");
        match mode {
            RefMode::File => Some(format!("{}{suffix}", file_url(&target))),
            RefMode::ScrimFile => Some(format!("{}{suffix}", scrim_file_url(&target))),
            RefMode::Embed => data_url(&target).map(|d| format!("{d}{suffix}")),
        }
    }))
}

/// Theme CSS for an export (9.2): the theme, `base.user.css`, `<theme>.user.css`, each
/// rewritten and with resolved references. `theme` None means no theme at all.
#[tauri::command]
pub fn export_theme_css(state: State<'_, AppState>, theme: Option<String>, mode: RefMode) -> Result<String, String> {
    let Some(theme) = theme.filter(|t| !t.is_empty()) else { return Ok(String::new()) };
    if theme.contains(['/', '\\']) || theme.starts_with('.') {
        return Err("invalid theme name".into());
    }
    let dir = themes_dir(&state);
    let mut out = String::new();
    for name in [format!("{theme}.css"), "base.user.css".to_string(), format!("{theme}.user.css")] {
        if let Some(css) = sheet(&dir.join(&name), mode, 0) {
            out.push_str(&format!("/* {name} */\n{css}\n"));
        }
    }
    Ok(out)
}

/// Write an export file (atomically, like a document save).
#[tauri::command]
pub fn export_write(state: State<'_, AppState>, path: PathBuf, text: String) -> Result<(), String> {
    scrim_core::save::save(&path, text.as_bytes()).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    state.logger.info(&format!("exported {}", path.display()));
    Ok(())
}

/// An image of the document as a data URL ("embed images", 9.1 item 4). Only image
/// files are read.
#[tauri::command]
pub fn export_embed_image(path: PathBuf) -> Option<String> {
    if !scrim_core::images::is_image(&path) {
        return None;
    }
    data_url(&path)
}

/// Where to write an export: a native save dialog in the document's folder.
#[tauri::command]
pub async fn export_pick_path(
    window: tauri::WebviewWindow,
    default_name: String,
    directory: Option<PathBuf>,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    // Debug builds only: the E2E suite cannot drive the native dialog (same hook as Save As).
    #[cfg(debug_assertions)]
    if let Some(f) = std::env::var_os("SCRIM_TEST_SAVE_AS").map(PathBuf::from) {
        if let Ok(t) = std::fs::read_to_string(&f) {
            if !t.trim().is_empty() {
                let _ = std::fs::write(&f, "");
                return Ok(Some(PathBuf::from(t.trim())));
            }
        }
    }
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let mut dialog = window.dialog().file().set_parent(&window).set_file_name(default_name).add_filter(filter_name, &exts);
    if let Some(d) = directory.filter(|d| d.is_dir()) {
        dialog = dialog.set_directory(d);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file()).await.map_err(|e| e.to_string())?;
    Ok(picked.and_then(|p| p.into_path().ok()))
}

/// Open an exported file with the system's default application.
#[tauri::command]
pub fn export_open(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert_eq!(file_url(Path::new("/a b/c#d.css")), "file:///a%20b/c%23d.css");
        assert!(is_relative("fonts/x.woff2"));
        assert!(!is_relative("data:font/woff2;base64,AA"));
        assert!(!is_relative("https://x/y"));
        assert!(!is_relative("#frag"));
    }

    #[test]
    fn sheet_resolves_and_inlines() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("t/fonts")).unwrap();
        std::fs::write(d.path().join("t/fonts/f.woff2"), b"x").unwrap();
        std::fs::write(d.path().join("t/more.css"), "#typora-sidebar { background: url(fonts/f.woff2) }").unwrap();
        std::fs::write(d.path().join("t/main.css"), "@import 'more.css';\n@font-face { src: url('fonts/f.woff2') }").unwrap();
        let file = sheet(&d.path().join("t/main.css"), RefMode::File, 0).unwrap();
        assert!(file.contains(&format!("url(\"{}\")", file_url(&d.path().join("t/fonts/f.woff2")))), "{file}");
        assert!(file.starts_with("@import \"data:text/css;base64,"), "{file}");
        let b64 = file.split("base64,").nth(1).unwrap().split('"').next().unwrap();
        let inner = String::from_utf8(base64::engine::general_purpose::STANDARD.decode(b64).unwrap()).unwrap();
        assert!(inner.contains("#scrim-sidebar"), "imported sheets are rewritten too: {inner}");
        let embed = sheet(&d.path().join("t/main.css"), RefMode::Embed, 0).unwrap();
        assert!(embed.contains("data:font/woff2;base64,eA=="), "{embed}");
    }
}
