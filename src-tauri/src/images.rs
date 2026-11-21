//! Image insertion (spec 06, 6.4; spec 04, 4.8): copies or saves images per the insert
//! policy, runs the upload command, and keeps images of untitled documents in a
//! temporary folder until the first save.

use std::path::{Path, PathBuf};

use base64::Engine;
use scrim_core::images::{self, ImageOptions, Policy};
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSource {
    /// A local file (dropped, pasted from the file manager, or chosen in a dialog).
    pub path: Option<String>,
    /// Image data (pasted), base64, with its file extension.
    pub data_base64: Option<String>,
    pub ext: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inserted {
    /// What to write in `![](…)`.
    pub src: String,
    /// The local file now referenced (for the protocol scope), if any.
    pub path: Option<String>,
}

fn same_file_content(a: &Path, b: &Path) -> bool {
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(x), Ok(y)) if x.len() == y.len() => std::fs::read(a).ok() == std::fs::read(b).ok(),
        _ => false,
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn temp_folder(state: &AppState, label: &str) -> PathBuf {
    state.config_dir.join("tmp-images").join(label)
}

/// Run the upload command with `paths`; the URLs it prints, one per line.
fn upload(cmd: &str, paths: &[PathBuf]) -> Result<Vec<String>, String> {
    let mut command = if cfg!(windows) {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg(cmd);
        c
    } else {
        let mut c = std::process::Command::new("sh");
        c.arg("-c").arg(format!("{cmd} \"$@\"")).arg("sh");
        c
    };
    command.args(paths);
    let out = command.output().map_err(|e| format!("Could not run the upload command: {e}"))?;
    if !out.status.success() {
        return Err(format!("The upload command failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let urls: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| l.starts_with("http://") || l.starts_with("https://"))
        .map(str::to_string)
        .collect();
    if urls.len() < paths.len() {
        return Err("The upload command did not print a URL for every image.".into());
    }
    Ok(urls[urls.len() - paths.len()..].to_vec())
}

#[tauri::command]
pub async fn image_insert(
    window: WebviewWindow,
    state: State<'_, AppState>,
    source: ImageSource,
    front_matter_folder: Option<String>,
) -> Result<Inserted, String> {
    let label = window.label().to_string();
    let doc_path = state.docs().get(&label).and_then(|d| d.path.clone());
    let opts = ImageOptions::from_settings(&state.settings().values);
    let doc_dir = doc_path.as_deref().and_then(Path::parent).map(Path::to_path_buf);

    // 1. Have the image as a file.
    let (file, is_data) = match (&source.path, &source.data_base64) {
        (Some(p), _) => (PathBuf::from(p), false),
        (None, Some(b64)) => {
            let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
            let ext = source.ext.clone().unwrap_or_else(|| "png".into());
            let folder = match &doc_path {
                Some(d) => images::target_folder(d, &opts, front_matter_folder.as_deref())
                    .unwrap_or_else(|| doc_dir.clone().unwrap_or_else(|| temp_folder(&state, &label))),
                None => temp_folder(&state, &label),
            };
            std::fs::create_dir_all(&folder).map_err(|e| format!("Could not create {}: {e}", folder.display()))?;
            let target = images::free_path(&folder, &images::data_file_name(now_millis(), &ext), |_| false);
            std::fs::write(&target, &bytes).map_err(|e| format!("Could not save the image: {e}"))?;
            state.logger.info(&format!("image saved: {}", target.display()));
            (target, true)
        }
        _ => return Err("no image".into()),
    };

    // 2. Upload policy: the URL replaces the file.
    if opts.policy == Policy::Upload && !opts.upload_command.trim().is_empty() {
        let cmd = opts.upload_command.clone();
        let f = file.clone();
        let urls = tauri::async_runtime::spawn_blocking(move || upload(&cmd, &[f])).await.map_err(|e| e.to_string())??;
        return Ok(Inserted { src: urls[0].clone(), path: None });
    }

    // 3. Copy local files per policy (data was already saved in the right folder).
    let final_path = if is_data || !opts.apply_to_local {
        file
    } else {
        let folder = match &doc_path {
            Some(d) => images::target_folder(d, &opts, front_matter_folder.as_deref()),
            None if opts.policy == Policy::None => None,
            None => Some(temp_folder(&state, &label)),
        };
        match folder {
            None => file,
            Some(folder) if file.parent() == Some(folder.as_path()) => file,
            Some(folder) => {
                std::fs::create_dir_all(&folder).map_err(|e| format!("Could not create {}: {e}", folder.display()))?;
                let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "image".into());
                let target = images::free_path(&folder, &name, |p| same_file_content(p, &file));
                if !target.exists() {
                    std::fs::copy(&file, &target).map_err(|e| format!("Could not copy the image: {e}"))?;
                }
                state.logger.info(&format!("image copied: {}", target.display()));
                target
            }
        }
    };
    if doc_path.is_none() && final_path.starts_with(temp_folder(&state, &label)) {
        if let Some(d) = state.docs().get_mut(&label) {
            d.temp_images.push(final_path.clone());
        }
    }
    if let Ok(c) = std::fs::canonicalize(&final_path) {
        state.scope().files.insert(c);
    }
    Ok(Inserted {
        src: images::markdown_src(&final_path, doc_dir.as_deref(), &opts),
        path: Some(final_path.to_string_lossy().into_owned()),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
    /// The `src` written while the document was untitled.
    pub old_src: String,
    pub new_src: String,
}

/// After the first save of an untitled document: move its images from the temporary
/// folder to the policy folder and report how to rewrite their paths (6.4).
#[tauri::command]
pub async fn image_finalize(window: WebviewWindow, state: State<'_, AppState>, front_matter_folder: Option<String>) -> Result<Vec<Moved>, String> {
    let label = window.label().to_string();
    let (doc_path, temps) = {
        let mut docs = state.docs();
        let Some(d) = docs.get_mut(&label) else { return Ok(vec![]) };
        (d.path.clone(), std::mem::take(&mut d.temp_images))
    };
    let Some(doc_path) = doc_path else { return Ok(vec![]) };
    let opts = ImageOptions::from_settings(&state.settings().values);
    let doc_dir = doc_path.parent().map(Path::to_path_buf);
    let folder = images::target_folder(&doc_path, &opts, front_matter_folder.as_deref())
        .unwrap_or_else(|| doc_dir.clone().unwrap_or_default());
    let mut out = vec![];
    for t in temps {
        if !t.exists() {
            continue;
        }
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let name = t.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let target = images::free_path(&folder, &name, |_| false);
        if std::fs::rename(&t, &target).is_err() {
            std::fs::copy(&t, &target).map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&t);
        }
        if let Ok(c) = std::fs::canonicalize(&target) {
            state.scope().files.insert(c);
        }
        out.push(Moved {
            old_src: images::markdown_src(&t, None, &opts),
            new_src: images::markdown_src(&target, doc_dir.as_deref(), &opts),
        });
    }
    Ok(out)
}

/// How a dropped or pasted non-image file is linked: relative path when possible.
#[tauri::command]
pub async fn link_target(window: WebviewWindow, state: State<'_, AppState>, path: String) -> Result<String, String> {
    let label = window.label().to_string();
    let doc_dir = state.docs().get(&label).and_then(|d| d.path.as_deref().and_then(Path::parent).map(Path::to_path_buf));
    let opts = ImageOptions::from_settings(&state.settings().values);
    Ok(images::markdown_src(Path::new(&path), doc_dir.as_deref(), &opts))
}

/// Is this path a directory? (Dropping a folder opens it in the sidebar, P3.)
#[tauri::command]
pub async fn path_kind(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    Ok(if p.is_dir() { "dir" } else if images::is_image(p) { "image" } else { "file" }.into())
}
