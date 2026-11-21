//! Workspace services (spec 07): folders, file operations, recent files, watching,
//! search in files, draft recovery.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::state::AppState;

const MARKDOWN_EXT: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext", "text", "txt", "rmd"];
const SUPPORTED_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "pdf", "html", "htm", "css"];

#[derive(Deserialize, Default, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FileFilter {
    #[default]
    Markdown,
    Supported,
    All,
}

#[derive(Deserialize, Default, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SortBy {
    #[default]
    Name,
    Modified,
    Created,
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListOptions {
    #[serde(default)]
    pub filter: FileFilter,
    #[serde(default)]
    pub sort: SortBy,
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub modified: u64,
    pub created: u64,
}

fn millis(t: std::io::Result<SystemTime>) -> u64 {
    t.ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn is_markdown(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| MARKDOWN_EXT.contains(&e.to_ascii_lowercase().as_str()))
}

fn passes(p: &Path, filter: FileFilter) -> bool {
    match filter {
        FileFilter::All => true,
        FileFilter::Markdown => is_markdown(p),
        FileFilter::Supported => {
            is_markdown(p)
                || p.extension().and_then(|e| e.to_str()).is_some_and(|e| SUPPORTED_EXT.contains(&e.to_ascii_lowercase().as_str()))
        }
    }
}

fn sort_entries(v: &mut [Entry], sort: SortBy) {
    v.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| match sort {
            SortBy::Name => natord::compare_ignore_case(&a.name, &b.name),
            SortBy::Modified => b.modified.cmp(&a.modified),
            SortBy::Created => b.created.cmp(&a.created),
        })
    });
}

/// One level of a folder for the tree view (7.4).
pub fn list_dir_sync(dir: &Path, opts: &ListOptions) -> std::io::Result<Vec<Entry>> {
    let mut out = vec![];
    for e in std::fs::read_dir(dir)? {
        let Ok(e) = e else { continue };
        let name = e.file_name().to_string_lossy().into_owned();
        if !opts.hidden && name.starts_with('.') {
            continue;
        }
        let path = e.path();
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        if !meta.is_dir() && !passes(&path, opts.filter) {
            continue;
        }
        out.push(Entry {
            name,
            path: path.to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            modified: millis(meta.modified()),
            created: millis(meta.created()),
        });
    }
    sort_entries(&mut out, opts.sort);
    Ok(out)
}

#[tauri::command]
pub async fn fs_list_dir(path: String, options: Option<ListOptions>) -> Result<Vec<Entry>, String> {
    let opts = options.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || list_dir_sync(Path::new(&path), &opts).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub modified: u64,
    pub created: u64,
    /// First heading, for the list view (7.4).
    pub title: Option<String>,
    pub excerpt: Option<String>,
}

fn title_and_excerpt(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(bytes) = std::fs::read(path) else { return (None, None) };
    let head = &bytes[..bytes.len().min(16 * 1024)];
    let text = scrim_core::encoding::decode(head).text;
    let mut title = None;
    let mut body = String::new();
    let mut in_fm = text.starts_with("---");
    for (i, line) in text.lines().enumerate() {
        if in_fm {
            if i > 0 && (line == "---" || line == "...") {
                in_fm = false;
            }
            continue;
        }
        let t = line.trim();
        if title.is_none() {
            if let Some(h) = t.strip_prefix('#') {
                let h = h.trim_start_matches('#').trim().trim_end_matches('#').trim();
                if !h.is_empty() {
                    title = Some(h.to_string());
                    continue;
                }
            }
        }
        if !t.is_empty() && !t.starts_with('#') && body.len() < 200 {
            if !body.is_empty() {
                body.push(' ');
            }
            body.push_str(t);
        }
    }
    let excerpt = (!body.is_empty()).then(|| body.chars().take(160).collect());
    (title, excerpt)
}

/// All matching files under `root` (recursive, respecting .gitignore). `details` adds
/// titles and excerpts for the list view.
pub fn walk_files(root: &Path, opts: &ListOptions, limit: usize, details: bool) -> Vec<FileInfo> {
    let mut out = vec![];
    let walker = ignore::WalkBuilder::new(root).hidden(!opts.hidden).git_ignore(true).parents(true).build();
    for e in walker.flatten() {
        if out.len() >= limit {
            break;
        }
        let p = e.path();
        if !e.file_type().is_some_and(|t| t.is_file()) || !passes(p, opts.filter) {
            continue;
        }
        let meta = e.metadata().ok();
        let (title, excerpt) = if details { title_and_excerpt(p) } else { (None, None) };
        out.push(FileInfo {
            path: p.to_string_lossy().into_owned(),
            name: e.file_name().to_string_lossy().into_owned(),
            modified: meta.as_ref().map(|m| millis(m.modified())).unwrap_or(0),
            created: meta.as_ref().map(|m| millis(m.created())).unwrap_or(0),
            title,
            excerpt,
        });
    }
    out
}

#[tauri::command]
pub async fn fs_walk(path: String, options: Option<ListOptions>, limit: Option<usize>, details: Option<bool>) -> Result<Vec<FileInfo>, String> {
    let opts = options.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let mut v = walk_files(Path::new(&path), &opts, limit.unwrap_or(20_000), details.unwrap_or(false));
        match opts.sort {
            SortBy::Name => v.sort_by(|a, b| natord::compare_ignore_case(&a.path, &b.path)),
            SortBy::Modified => v.sort_by_key(|f| std::cmp::Reverse(f.modified)),
            SortBy::Created => v.sort_by_key(|f| std::cmp::Reverse(f.created)),
        }
        v
    })
    .await
    .map_err(|e| e.to_string())
}

// ---- file operations (7.2, 7.4) ------------------------------------------------------

fn not_exists(p: &Path) -> Result<(), String> {
    if p.exists() {
        Err(format!("{} already exists", p.display()))
    } else {
        Ok(())
    }
}

/// After a file or folder moved on disk, point open documents at the new place.
fn follow_move(app: &AppHandle, from: &Path, to: &Path) {
    let state = app.state::<AppState>();
    let moved: Vec<(String, PathBuf)> = {
        let mut docs = state.docs();
        let mut changed = vec![];
        for (label, d) in docs.iter_mut() {
            if let Some(p) = &d.path {
                if let Ok(rest) = p.strip_prefix(from) {
                    let np = if rest.as_os_str().is_empty() { to.to_path_buf() } else { to.join(rest) };
                    d.path = Some(np.clone());
                    changed.push((label.clone(), np));
                }
            }
        }
        changed
    };
    for (l, np) in moved {
        crate::windows::update_title(app, &l);
        watch_file(app, &l, &np);
        let _ = app.emit_to(&l, "scrim://doc-moved", np.to_string_lossy().to_string());
    }
}

#[tauri::command]
pub async fn fs_create_file(dir: String, name: String) -> Result<String, String> {
    let p = Path::new(&dir).join(&name);
    not_exists(&p)?;
    std::fs::write(&p, b"").map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn fs_create_dir(dir: String, name: String) -> Result<String, String> {
    let p = Path::new(&dir).join(&name);
    not_exists(&p)?;
    std::fs::create_dir(&p).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn fs_rename(app: AppHandle, path: String, new_name: String) -> Result<String, String> {
    if new_name.contains(['/', '\\']) || new_name.trim().is_empty() {
        return Err("Invalid name".into());
    }
    let from = PathBuf::from(&path);
    let to = from.with_file_name(new_name.trim());
    if to == from {
        return Ok(path);
    }
    not_exists(&to)?;
    std::fs::rename(&from, &to).map_err(|e| e.to_string())?;
    follow_move(&app, &from, &to);
    Ok(to.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn fs_move(app: AppHandle, path: String, dest_dir: String) -> Result<String, String> {
    let from = PathBuf::from(&path);
    let to = Path::new(&dest_dir).join(from.file_name().ok_or("no file name")?);
    not_exists(&to)?;
    if std::fs::rename(&from, &to).is_err() {
        std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        std::fs::remove_file(&from).map_err(|e| e.to_string())?;
    }
    follow_move(&app, &from, &to);
    Ok(to.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn fs_duplicate(path: String) -> Result<String, String> {
    let from = PathBuf::from(&path);
    let stem = from.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = from.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let dir = from.parent().ok_or("no parent")?;
    let mut n = 1;
    let to = loop {
        let name = if n == 1 { format!("{stem} copy{ext}") } else { format!("{stem} copy {n}{ext}") };
        let p = dir.join(name);
        if !p.exists() {
            break p;
        }
        n += 1;
    };
    std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().into_owned())
}

/// Delete = move to the system trash (7.2, 7.4).
#[tauri::command]
pub async fn fs_trash(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    tauri::async_runtime::spawn_blocking(move || trash::delete(&p).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())??;
    state.logger.info("moved a file to the trash");
    Ok(())
}

#[tauri::command]
pub async fn fs_reveal(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

// ---- recent files (7.2) ------------------------------------------------------------------

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct History {
    pub files: Vec<String>,
    pub folders: Vec<String>,
    /// The files and folders open when the last window closed ("On launch: restore
    /// last closed files and folders", 7.1).
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "lastSession")]
    pub last_session: Option<Session>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct Session {
    pub files: Vec<String>,
    pub folders: Vec<String>,
}

/// Windows closed in the last few seconds (a Quit closes them one after another).
static CLOSING: Mutex<Vec<(std::time::Instant, Option<PathBuf>, Option<PathBuf>)>> = Mutex::new(Vec::new());

/// Called when a window is destroyed, before its state is dropped. When it was the last
/// window, the files and folders of the windows closed together with it become the
/// remembered session.
pub fn note_window_closed(state: &AppState, label: &str) {
    let (path, folder) = state.docs().get(label).map(|d| (d.path.clone(), d.folder.clone())).unwrap_or_default();
    let mut closing = CLOSING.lock().unwrap();
    closing.retain(|(t, _, _)| t.elapsed() < Duration::from_secs(10));
    closing.push((std::time::Instant::now(), path, folder));
    let others = state.docs().keys().filter(|l| l.as_str() != label).count();
    if others > 0 {
        return;
    }
    let mut session = Session::default();
    for (_, p, f) in closing.drain(..) {
        if let Some(f) = f.map(|f| f.to_string_lossy().into_owned()) {
            if !session.folders.contains(&f) {
                session.folders.push(f);
            }
        } else if let Some(p) = p.filter(|p| p.exists()).map(|p| p.to_string_lossy().into_owned()) {
            session.files.push(p);
        }
    }
    let mut h = load_history(state);
    h.last_session = Some(session);
    save_history(state, &h);
}

/// What to open at launch without paths (7.1, Preferences → General → On launch).
pub fn launch_paths(state: &AppState) -> Vec<PathBuf> {
    let mode = state.settings().values.get("onLaunch").and_then(|v| v.as_str()).unwrap_or("newFile").to_string();
    let h = load_history(state);
    let existing = |v: Vec<String>| v.into_iter().map(PathBuf::from).filter(|p| p.exists()).collect::<Vec<_>>();
    match mode.as_str() {
        "lastFolder" => existing(h.last_session.map(|s| s.folders).filter(|f| !f.is_empty()).unwrap_or_else(|| h.folders.into_iter().take(1).collect()))
            .into_iter()
            .take(1)
            .collect(),
        "lastSession" => h.last_session.map(|s| existing([s.folders, s.files].concat())).unwrap_or_default(),
        "customFolder" => state
            .settings()
            .values
            .get("onLaunchFolder")
            .and_then(|v| v.as_str())
            .map(|f| existing(vec![f.to_string()]))
            .unwrap_or_default(),
        _ => vec![],
    }
}

fn history_path(state: &AppState) -> PathBuf {
    state.config_dir.join("history.json")
}

pub fn load_history(state: &AppState) -> History {
    std::fs::read(history_path(state)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_history(state: &AppState, h: &History) {
    if let Ok(text) = serde_json::to_string_pretty(h) {
        let _ = scrim_core::save::save(&history_path(state), text.as_bytes());
    }
}

/// Record a recently used file or folder (most recent first; 20 files, 10 folders).
pub fn remember(state: &AppState, path: &Path, folder: bool) {
    let p = path.to_string_lossy().into_owned();
    let mut h = load_history(state);
    let (list, max) = if folder { (&mut h.folders, 10) } else { (&mut h.files, 20) };
    list.retain(|x| x != &p);
    list.insert(0, p);
    list.truncate(max);
    save_history(state, &h);
}

#[tauri::command]
pub async fn recent_get(state: State<'_, AppState>) -> Result<History, String> {
    let mut h = load_history(&state);
    h.files.retain(|f| Path::new(f).exists());
    h.folders.retain(|f| Path::new(f).is_dir());
    Ok(h)
}

#[tauri::command]
pub async fn recent_clear(state: State<'_, AppState>) -> Result<(), String> {
    save_history(&state, &History::default());
    Ok(())
}

// ---- folders in windows (7.4, 7.8) -----------------------------------------------------

#[tauri::command]
pub async fn folder_get(window: WebviewWindow, state: State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(state.docs().get(window.label()).and_then(|d| d.folder.clone()).map(|p| p.to_string_lossy().into_owned()))
}

/// Open `path` as this window's sidebar folder.
#[tauri::command]
pub async fn folder_open(window: WebviewWindow, state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("{path} is not a folder"));
    }
    if let Some(d) = state.docs().get_mut(window.label()) {
        d.folder = Some(p.clone());
    }
    remember(&state, &p, true);
    if let Ok(c) = std::fs::canonicalize(&p) {
        state.scope().dirs.insert(c);
    }
    watch_folder(window.app_handle(), window.label(), &p);
    let _ = window.emit_to(window.label(), "scrim://folder-opened", path);
    Ok(())
}

/// Watch the document's own folder (the implicit folder, QA-LOG Q-016): like an opened
/// folder for the tree, but not stored as the window's folder, not remembered in recent
/// folders, and not restored on launch.
#[tauri::command]
pub async fn folder_watch_implicit(window: WebviewWindow, state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("{path} is not a folder"));
    }
    if state.docs().get(window.label()).is_some_and(|d| d.folder.is_some()) {
        return Ok(()); // an opened folder wins
    }
    watch_folder(window.app_handle(), window.label(), &p);
    Ok(())
}

#[tauri::command]
pub async fn folder_dialog(window: WebviewWindow) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let d = window.app_handle().dialog().file().set_parent(&window);
    let picked = tauri::async_runtime::spawn_blocking(move || d.blocking_pick_folder()).await.map_err(|e| e.to_string())?;
    Ok(picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
}

// ---- watching (7.3, 7.4) ---------------------------------------------------------------------

/// A window's watchers: its open file, its sidebar folder.
type WindowWatchers = (Option<notify::RecommendedWatcher>, Option<notify::RecommendedWatcher>);

#[derive(Default)]
pub struct Watchers {
    /// window label → watchers
    map: Mutex<HashMap<String, WindowWatchers>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileChanged {
    kind: &'static str,
}

/// Watch the window's open file (its folder, non-recursively, to see replaces and deletes).
pub fn watch_file(app: &AppHandle, label: &str, path: &Path) {
    use notify::Watcher;
    let Some(dir) = path.parent().map(Path::to_path_buf) else { return };
    let app2 = app.clone();
    let label2 = label.to_string();
    let target = path.to_path_buf();
    let last = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(10)));
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if !ev.paths.iter().any(|p| p == &target) {
            return;
        }
        // Coalesce bursts (editors write in several steps).
        {
            let mut l = last.lock().unwrap();
            if l.elapsed() < Duration::from_millis(100) {
                return;
            }
            *l = Instant::now();
        }
        let app3 = app2.clone();
        let label3 = label2.clone();
        let target2 = target.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            let state = app3.state::<AppState>();
            let kind = match std::fs::read(&target2) {
                Err(_) => "removed",
                Ok(bytes) => {
                    // Our own save: the bytes on disk are the ones we wrote.
                    let ours = state.docs().get(&label3).is_some_and(|d| d.saved_bytes.as_deref() == Some(&bytes[..]));
                    if ours {
                        return;
                    }
                    "modified"
                }
            };
            state.logger.info(&format!("open file {kind} on disk"));
            let _ = app3.emit_to(&label3, "scrim://file-changed", FileChanged { kind });
        });
    });
    let Ok(mut watcher) = watcher else { return };
    if watcher.watch(&dir, notify::RecursiveMode::NonRecursive).is_err() {
        return;
    }
    let state = app.state::<Watchers>();
    let mut map = state.map.lock().unwrap();
    map.entry(label.to_string()).or_default().0 = Some(watcher);
}

pub fn watch_folder(app: &AppHandle, label: &str, folder: &Path) {
    use notify::Watcher;
    let app2 = app.clone();
    let label2 = label.to_string();
    let pending = Arc::new(Mutex::new(false));
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_err() {
            return;
        }
        let mut p = pending.lock().unwrap();
        if *p {
            return;
        }
        *p = true;
        let app3 = app2.clone();
        let label3 = label2.clone();
        let pending2 = pending.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(250));
            *pending2.lock().unwrap() = false;
            let _ = app3.emit_to(&label3, "scrim://folder-changed", ());
        });
    });
    let Ok(mut watcher) = watcher else { return };
    if watcher.watch(folder, notify::RecursiveMode::Recursive).is_err() {
        return;
    }
    let state = app.state::<Watchers>();
    let mut map = state.map.lock().unwrap();
    map.entry(label.to_string()).or_default().1 = Some(watcher);
}

pub fn unwatch(app: &AppHandle, label: &str) {
    app.state::<Watchers>().map.lock().unwrap().remove(label);
}

/// Re-read the open file after an external change (7.3).
#[tauri::command]
pub async fn doc_reload(window: WebviewWindow, state: State<'_, AppState>) -> Result<String, String> {
    let label = window.label().to_string();
    let path = state.docs().get(&label).and_then(|d| d.path.clone()).ok_or("untitled")?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let decoded = scrim_core::encoding::decode(&bytes);
    if let Some(d) = state.docs().get_mut(&label) {
        d.saved_text = decoded.text.clone();
        d.saved_bytes = Some(bytes);
        d.encoding = Some(decoded.encoding);
        d.malformed = decoded.malformed;
    }
    state.logger.info("reloaded the open file from disk");
    Ok(decoded.text)
}

// ---- search in files (7.7) ---------------------------------------------------------------------

static SEARCH_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub root: String,
    pub query: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub options: ListOptions,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub line: u64,
    /// the line's text (trimmed to context around the match)
    pub text: String,
    /// match range inside `text` (UTF-16 offsets, for the frontend)
    pub start: usize,
    pub end: usize,
    /// match range inside the whole line (UTF-16 offsets)
    pub line_start: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileResult {
    pub id: u64,
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchDone {
    pub id: u64,
    pub files: usize,
    pub matches: usize,
    pub cancelled: bool,
    pub error: Option<String>,
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Line text around a match: about 40 characters of context on each side.
fn context(line: &str, start: usize, end: usize) -> (String, usize, usize, usize) {
    let line = line.trim_end_matches(['\r', '\n']);
    let start = start.min(line.len());
    let end = end.clamp(start, line.len());
    let mut from = start;
    for (n, (i, _)) in line[..start].char_indices().rev().enumerate() {
        from = i;
        if n >= 40 {
            break;
        }
    }
    if start == 0 {
        from = 0;
    }
    let mut to = end;
    for (n, (i, c)) in line[end..].char_indices().enumerate() {
        to = end + i + c.len_utf8();
        if n >= 40 {
            break;
        }
    }
    let text = &line[from..to];
    let s = utf16_len(&line[from..start]);
    let e = s + utf16_len(&line[start..end]);
    (text.to_string(), s, e, utf16_len(&line[..start]))
}

pub fn run_search(q: &SearchQuery, id: u64, mut on_file: impl FnMut(SearchFileResult)) -> SearchDone {
    use grep_matcher::Matcher;
    use grep_searcher::{BinaryDetection, SearcherBuilder, Sink, SinkMatch};
    let pattern = if q.regex { q.query.clone() } else { regex_escape(&q.query) };
    let matcher = grep_regex::RegexMatcherBuilder::new()
        .case_insensitive(!q.case_sensitive)
        .word(q.whole_word)
        .build(&pattern);
    let matcher = match matcher {
        Ok(m) => m,
        Err(e) => return SearchDone { id, files: 0, matches: 0, cancelled: false, error: Some(e.to_string()) },
    };
    let mut searcher = SearcherBuilder::new().binary_detection(BinaryDetection::quit(b'\x00')).line_number(true).build();
    let walker = ignore::WalkBuilder::new(&q.root).hidden(!q.options.hidden).git_ignore(true).build();
    let (mut files, mut total) = (0, 0);
    struct Collect<'a, M: Matcher> {
        matcher: &'a M,
        out: Vec<SearchMatch>,
    }
    impl<M: Matcher> Sink for Collect<'_, M> {
        type Error = std::io::Error;
        fn matched(&mut self, _s: &grep_searcher::Searcher, m: &SinkMatch<'_>) -> Result<bool, std::io::Error> {
            let line = String::from_utf8_lossy(m.bytes());
            let ln = m.line_number().unwrap_or(0);
            let bytes = line.as_bytes();
            let _ = self.matcher.find_iter(bytes, |r| {
                let (text, start, end, line_start) = context(&line, r.start(), r.end());
                self.out.push(SearchMatch { line: ln, text, start, end, line_start });
                self.out.len() < 1000
            });
            Ok(self.out.len() < 1000)
        }
    }
    for e in walker.flatten() {
        if SEARCH_ID.load(Ordering::Relaxed) != id {
            return SearchDone { id, files, matches: total, cancelled: true, error: None };
        }
        let p = e.path();
        if !e.file_type().is_some_and(|t| t.is_file()) || !passes(p, q.options.filter) {
            continue;
        }
        if e.metadata().map(|m| m.len() > 10 * 1024 * 1024).unwrap_or(true) {
            continue;
        }
        let mut sink = Collect { matcher: &matcher, out: vec![] };
        if searcher.search_path(&matcher, p, &mut sink).is_err() || sink.out.is_empty() {
            continue;
        }
        files += 1;
        total += sink.out.len();
        on_file(SearchFileResult { id, path: p.to_string_lossy().into_owned(), matches: sink.out });
    }
    SearchDone { id, files, matches: total, cancelled: false, error: None }
}

fn regex_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        if "\\.+*?()|[]{}^$#&-~".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Start a search; results stream as `scrim://search-result` events to this window,
/// followed by `scrim://search-done`. Starting another search cancels this one.
#[tauri::command]
pub async fn search_start(window: WebviewWindow, query: SearchQuery) -> Result<u64, String> {
    let id = SEARCH_ID.fetch_add(1, Ordering::Relaxed) + 1;
    let label = window.label().to_string();
    let app = window.app_handle().clone();
    std::thread::spawn(move || {
        let done = run_search(&query, id, |r| {
            let _ = app.emit_to(&label, "scrim://search-result", r);
        });
        let _ = app.emit_to(&label, "scrim://search-done", done);
    });
    Ok(id)
}

#[tauri::command]
pub async fn search_cancel() -> Result<(), String> {
    SEARCH_ID.fetch_add(1, Ordering::Relaxed);
    Ok(())
}

// ---- draft recovery (7.6) ----------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DraftMeta {
    pub id: String,
    pub path: Option<String>,
    pub time: u64,
    pub encoding: Option<String>,
    pub title: String,
}

fn recovery_dir(state: &AppState) -> PathBuf {
    state.config_dir.join("recovery")
}

/// Write a dirty document's text (every 30 s and on blur).
#[tauri::command]
pub async fn recovery_write(window: WebviewWindow, state: State<'_, AppState>, text: String, title: String) -> Result<(), String> {
    let label = window.label().to_string();
    let (id, path, enc) = {
        let mut docs = state.docs();
        let d = docs.get_mut(&label).ok_or("no document")?;
        let id = d.draft_id.get_or_insert_with(|| format!("{}-{}", millis(Ok(SystemTime::now())), std::process::id())).clone();
        (id, d.path.clone(), d.encoding.as_ref().map(|e| e.name.clone()))
    };
    let dir = recovery_dir(&state);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let meta = DraftMeta { id: id.clone(), path: path.map(|p| p.to_string_lossy().into_owned()), time: millis(Ok(SystemTime::now())), encoding: enc, title };
    scrim_core::save::save(&dir.join(format!("{id}.md")), text.as_bytes()).map_err(|e| e.to_string())?;
    scrim_core::save::save(&dir.join(format!("{id}.json")), serde_json::to_string(&meta).unwrap().as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove this window's draft: on save (`discard` false) or after "Don't Save" (`discard`
/// true: kept 7 days in `recovery/discarded/`).
#[tauri::command]
pub async fn recovery_remove(window: WebviewWindow, state: State<'_, AppState>, discard: bool) -> Result<(), String> {
    let id = state.docs().get_mut(window.label()).and_then(|d| d.draft_id.take());
    if let Some(id) = id {
        remove_draft(&state, &id, discard);
    }
    Ok(())
}

fn remove_draft(state: &AppState, id: &str, discard: bool) {
    let dir = recovery_dir(state);
    for ext in ["md", "json"] {
        let f = dir.join(format!("{id}.{ext}"));
        if discard {
            let d = dir.join("discarded");
            let _ = std::fs::create_dir_all(&d);
            let _ = std::fs::rename(&f, d.join(format!("{id}.{ext}")));
        } else {
            let _ = std::fs::remove_file(&f);
        }
    }
}

/// Drafts left by a previous run (or by closed windows), newest first. Drafts that belong
/// to a window of this run are not listed.
#[tauri::command]
pub async fn recovery_list(state: State<'_, AppState>) -> Result<Vec<DraftMeta>, String> {
    let dir = recovery_dir(&state);
    let mine: Vec<String> = state.docs().values().filter_map(|d| d.draft_id.clone()).collect();
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Some(meta) = std::fs::read(&p).ok().and_then(|b| serde_json::from_slice::<DraftMeta>(&b).ok()) {
                if !mine.contains(&meta.id) && dir.join(format!("{}.md", meta.id)).exists() {
                    out.push(meta);
                }
            }
        }
    }
    out.sort_by_key(|d| std::cmp::Reverse(d.time));
    Ok(out)
}

#[tauri::command]
pub async fn recovery_read(state: State<'_, AppState>, id: String) -> Result<String, String> {
    if id.contains(['/', '\\']) {
        return Err("bad id".into());
    }
    std::fs::read_to_string(recovery_dir(&state).join(format!("{id}.md"))).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn recovery_discard(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if id.contains(['/', '\\']) {
        return Err("bad id".into());
    }
    remove_draft(&state, &id, true);
    Ok(())
}

/// Adopt a recovered draft in this window: its text becomes the window's draft.
#[tauri::command]
pub async fn recovery_adopt(window: WebviewWindow, state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(d) = state.docs().get_mut(window.label()) {
        d.draft_id = Some(id);
    }
    Ok(())
}

/// Delete discarded drafts older than 7 days (at startup).
pub fn purge_discarded(state: &AppState) {
    let dir = recovery_dir(state).join("discarded");
    let Ok(rd) = std::fs::read_dir(&dir) else { return };
    let week = Duration::from_secs(7 * 24 * 3600);
    for e in rd.flatten() {
        if e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > week) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_finds_and_respects_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "one needle here\nno\nNEEDLE again\n").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/b.md"), "deep needle\n").unwrap();
        std::fs::write(dir.path().join("c.txt"), "needle in txt\n").unwrap();
        std::fs::write(dir.path().join("d.png"), "needle\0binary").unwrap();
        std::fs::write(dir.path().join(".gitignore"), "ignored.md\n").unwrap();
        std::fs::write(dir.path().join("ignored.md"), "needle\n").unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        let q = SearchQuery { root: dir.path().to_string_lossy().into(), query: "needle".into(), case_sensitive: false, whole_word: false, regex: false, options: ListOptions::default() };
        SEARCH_ID.store(7, Ordering::Relaxed);
        let mut got = vec![];
        let done = run_search(&q, 7, |r| got.push((Path::new(&r.path).file_name().unwrap().to_string_lossy().into_owned(), r.matches.len())));
        got.sort();
        assert_eq!(got, vec![("a.md".into(), 2), ("b.md".into(), 1), ("c.txt".into(), 1)]);
        assert_eq!(done.matches, 4);
        let q2 = SearchQuery { case_sensitive: true, ..q };
        let mut n = 0;
        run_search(&q2, 7, |r| n += r.matches.len());
        assert_eq!(n, 3);
    }

    #[test]
    fn context_window() {
        let line = format!("{}needle{}", "a".repeat(100), "b".repeat(100));
        let (text, s, e, ls) = context(&line, 100, 106);
        assert_eq!(&text[s..e], "needle");
        assert_eq!(ls, 100);
        assert!(text.len() < 100);
    }

    #[test]
    fn natural_sort_folders_first() {
        let dir = tempfile::tempdir().unwrap();
        for n in ["file10.md", "file2.md", "notes.txt"] {
            std::fs::write(dir.path().join(n), "").unwrap();
        }
        std::fs::create_dir(dir.path().join("zdir")).unwrap();
        let names: Vec<String> = list_dir_sync(dir.path(), &ListOptions::default()).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["zdir", "file2.md", "file10.md", "notes.txt"]);
    }
}

#[tauri::command]
pub async fn fs_read_text(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(scrim_core::encoding::decode(&bytes).text)
}

/// Copy a file, creating the destination folder (Save As → "Copy images", D-7).
#[tauri::command]
pub async fn fs_copy(from: String, to: String) -> Result<(), String> {
    if let Some(dir) = Path::new(&to).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&from, &to).map(|_| ()).map_err(|e| e.to_string())
}

/// Open a recovered draft in a new window: the draft's text, bound to its file if it
/// had one, marked unsaved (7.6).
#[tauri::command]
pub async fn recovery_open(window: WebviewWindow, state: State<'_, AppState>, id: String) -> Result<(), String> {
    if id.contains(['/', '\\']) {
        return Err("bad id".into());
    }
    let app = window.app_handle().clone();
    let app2 = app.clone();
    let id2 = id.clone();
    let _ = state;
    app.run_on_main_thread(move || {
        let st = app2.state::<AppState>();
        match crate::windows::open_untitled(&app2) {
            Ok(w) => {
                if let Some(d) = st.docs().get_mut(w.label()) {
                    d.recover_id = Some(id2);
                }
            }
            Err(e) => st.logger.error(&format!("cannot open window: {e}")),
        }
    })
    .map_err(|e| e.to_string())
}
