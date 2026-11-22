//! Pandoc export and import (spec 09, 9.4) and custom export commands (9.5).
//!
//! Every process is started with an argument vector, never a shell string, except the
//! custom commands, whose template is a shell command by definition: there each
//! placeholder value is quoted for the shell (POSIX single quotes; on Windows, `cmd`
//! caret escapes inside double quotes, passed with `raw_arg`).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use wait_timeout::ChildExt;

use crate::state::AppState;

const TIMEOUT: Duration = Duration::from_secs(120);

/// Pandoc: the user-set path, or the first `pandoc` on PATH.
pub fn find_pandoc(user_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = user_path.map(str::trim).filter(|p| !p.is_empty()) {
        let p = PathBuf::from(p);
        return p.is_file().then_some(p);
    }
    let exe = if cfg!(windows) { "pandoc.exe" } else { "pandoc" };
    std::env::var_os("PATH").and_then(|paths| std::env::split_paths(&paths).map(|d| d.join(exe)).find(|p| p.is_file()))
}

#[derive(Debug, Serialize)]
pub struct PandocInfo {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[tauri::command]
pub async fn pandoc_info(pandoc_path: Option<String>) -> PandocInfo {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(p) = find_pandoc(pandoc_path.as_deref()) else { return PandocInfo { available: false, version: None, path: None } };
        let version = Command::new(&p)
            .arg("--version")
            .stdin(Stdio::null())
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8_lossy(&o.stdout).lines().next().map(|l| l.trim().to_string()));
        PandocInfo { available: version.is_some(), version, path: Some(p.to_string_lossy().into_owned()) }
    })
    .await
    .unwrap_or(PandocInfo { available: false, version: None, path: None })
}

/// Run a command with the 120 s timeout; Ok(stdout) or Err(stderr).
fn run(mut cmd: Command) -> Result<Vec<u8>, String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("cannot start {:?}: {e}", cmd.get_program()))?;
    // Drain both pipes while waiting (a full pipe would block the child).
    let mut out = child.stdout.take().expect("piped");
    let mut err = child.stderr.take().expect("piped");
    let t_out = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = out.read_to_end(&mut b);
        b
    });
    let t_err = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = err.read_to_end(&mut b);
        b
    });
    let status = match child.wait_timeout(TIMEOUT).map_err(|e| e.to_string())? {
        Some(s) => s,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("timed out after {} s", TIMEOUT.as_secs()));
        }
    };
    let stdout = t_out.join().unwrap_or_default();
    let stderr = String::from_utf8_lossy(&t_err.join().unwrap_or_default()).trim().to_string();
    if status.success() {
        Ok(stdout)
    } else {
        Err(if stderr.is_empty() { format!("exited with {status}") } else { stderr })
    }
}

fn tmp_dir(state: &AppState) -> Result<PathBuf, String> {
    let d = state.config_dir.join("tmp-export");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// The pandoc export argument vector (9.4).
pub fn export_args(input: &Path, to: &str, out: &Path, doc_dir: Option<&Path>, extensions: &str, reference_doc: Option<&Path>) -> Vec<std::ffi::OsString> {
    let mut a: Vec<std::ffi::OsString> = vec![
        input.into(),
        "-f".into(),
        format!("gfm+tex_math_dollars+footnotes+yaml_metadata_block{extensions}").into(),
        "-t".into(),
        to.into(),
        "-o".into(),
        out.into(),
    ];
    if let Some(d) = doc_dir {
        let mut r = std::ffi::OsString::from("--resource-path=");
        r.push(d);
        a.push(r);
    }
    if let Some(r) = reference_doc {
        let mut x = std::ffi::OsString::from("--reference-doc=");
        x.push(r);
        a.push(x);
    }
    a
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn pandoc_export(
    state: State<'_, AppState>,
    markdown: String,
    to: String,
    out: PathBuf,
    doc_dir: Option<PathBuf>,
    extensions: String,
    reference_doc: Option<PathBuf>,
    pandoc_path: Option<String>,
) -> Result<(), String> {
    if !extensions.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '_' || c == '-') || !to.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("bad pandoc format".into());
    }
    let pandoc = find_pandoc(pandoc_path.as_deref()).ok_or("Requires pandoc")?;
    let dir = tmp_dir(&state)?;
    let input = dir.join(format!("pandoc-{}.md", std::process::id() as u64 * 1000 + rand_suffix()));
    std::fs::write(&input, markdown).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&pandoc);
    cmd.args(export_args(&input, &to, &out, doc_dir.as_deref(), &extensions, reference_doc.as_deref().filter(|p| p.is_file())));
    if let Some(d) = doc_dir.as_deref().filter(|d| d.is_dir()) {
        cmd.current_dir(d);
    }
    state.logger.info(&format!("pandoc export to {} ({to})", out.display()));
    let res = tauri::async_runtime::spawn_blocking(move || run(cmd)).await.map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&input);
    res.map(|_| ()).map_err(|e| format!("pandoc: {e}"))
}

fn rand_suffix() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| u64::from(d.subsec_nanos() % 1000)).unwrap_or(0)
}

/// File types File → Import reads (9.4).
pub const IMPORT_EXTENSIONS: &[&str] = &["docx", "odt", "rtf", "epub", "html", "htm", "tex", "latex", "rst", "textile", "wiki", "mediawiki", "org", "opml"];

fn reader_for(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "docx" => "docx",
        "odt" => "odt",
        "rtf" => "rtf",
        "epub" => "epub",
        "html" | "htm" => "html",
        "tex" | "latex" => "latex",
        "rst" => "rst",
        "textile" => "textile",
        "wiki" | "mediawiki" => "mediawiki",
        "org" => "org",
        "opml" => "opml",
        _ => return None,
    })
}

/// The pandoc import argument vector (9.4).
pub fn import_args(input: &Path, from: &str, media: &Path) -> Vec<std::ffi::OsString> {
    let mut m = std::ffi::OsString::from("--extract-media=");
    m.push(media);
    vec![input.into(), "-f".into(), from.into(), "-t".into(), "gfm-tex_math_gfm+tex_math_dollars+footnotes".into(), "--wrap=none".into(), m]
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Imported {
    /// Markdown from pandoc
    Markdown { text: String },
    /// An HTML file for the built-in converter (no pandoc)
    Html { text: String },
}

/// File → Import…: pick a file and convert it. The result opens as a new untitled
/// document; images go to the folder untitled documents use, and move with the
/// document when it is first saved (6.4).
#[tauri::command]
pub async fn import_file(window: tauri::WebviewWindow, state: State<'_, AppState>, pandoc_path: Option<String>) -> Result<Option<Imported>, String> {
    use tauri_plugin_dialog::DialogExt;
    let pandoc = find_pandoc(pandoc_path.as_deref());
    #[cfg(debug_assertions)]
    let test_pick = std::env::var_os("SCRIM_TEST_OPEN").map(PathBuf::from).and_then(|f| {
        let t = std::fs::read_to_string(&f).ok().filter(|t| !t.trim().is_empty())?;
        let _ = std::fs::write(&f, "");
        Some(PathBuf::from(t.trim()))
    });
    #[cfg(not(debug_assertions))]
    let test_pick: Option<PathBuf> = None;
    let path = match test_pick {
        Some(p) => p,
        None => {
            let exts: &[&str] = if pandoc.is_some() { IMPORT_EXTENSIONS } else { &["html", "htm"] };
            let dialog = window.dialog().file().set_parent(&window).add_filter(if pandoc.is_some() { "Documents" } else { "HTML" }, exts);
            match tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file()).await.map_err(|e| e.to_string())?.and_then(|p| p.into_path().ok()) {
                Some(p) => p,
                None => return Ok(None),
            }
        }
    };
    let from = reader_for(&path).ok_or("This file type cannot be imported.")?;
    let Some(pandoc) = pandoc else {
        if from == "html" {
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            return Ok(Some(Imported::Html { text: scrim_core::encoding::decode(&bytes).text }));
        }
        return Err("Importing this file type requires pandoc.".into());
    };
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let media = state.config_dir.join("tmp-images").join(format!("import-{stamp}"));
    std::fs::create_dir_all(&media).map_err(|e| e.to_string())?;
    let media = std::fs::canonicalize(&media).unwrap_or(media);
    let mut cmd = Command::new(&pandoc);
    cmd.args(import_args(&path, from, &media));
    state.logger.info(&format!("pandoc import {}", path.display()));
    let out = tauri::async_runtime::spawn_blocking(move || run(cmd)).await.map_err(|e| e.to_string())?.map_err(|e| format!("pandoc: {e}"))?;
    if std::fs::read_dir(&media).map(|mut d| d.next().is_none()).unwrap_or(false) {
        let _ = std::fs::remove_dir(&media);
    }
    Ok(Some(Imported::Markdown { text: String::from_utf8_lossy(&out).into_owned() }))
}

/// Open `text` as a new untitled, unsaved document.
#[tauri::command]
pub fn open_untitled_text(app: AppHandle, text: String) -> Result<(), String> {
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let st = app2.state::<AppState>();
        match crate::windows::open_untitled(&app2) {
            Ok(w) => {
                if let Some(d) = st.docs().get_mut(w.label()) {
                    d.initial_text = Some(text);
                }
            }
            Err(e) => st.logger.error(&format!("cannot open window: {e}")),
        }
    })
    .map_err(|e| e.to_string())
}

// ---- custom export commands (9.5) -----------------------------------------------------

/// POSIX single-quote a value (`'` becomes `'\''`).
pub fn sh_quote(v: &str) -> String {
    format!("'{}'", v.replace('\'', "'\\''"))
}

/// Windows `cmd`: double quotes, with `%`, `^`, `&`, `|`, `<`, `>`, `(`, `)`, `!`, `"`
/// inside caret-escaped.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn cmd_quote(v: &str) -> String {
    let mut s = String::from("\"");
    for c in v.chars() {
        if matches!(c, '%' | '^' | '&' | '|' | '<' | '>' | '(' | ')' | '!' | '"') {
            s.push('^');
        }
        s.push(c);
    }
    s.push('"');
    s
}

/// Fill a custom command template; `quote` is the platform's quoting.
pub fn fill_template(template: &str, input: &Path, out: &Path, quote: fn(&str) -> String) -> String {
    let dir = input.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    let name = input.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    // One pass, so a value containing a placeholder is not expanded again.
    let mut outs = String::new();
    let mut rest = template;
    while let Some(i) = rest.find("{{") {
        outs.push_str(&rest[..i]);
        let after = &rest[i..];
        let (val, len) = if after.starts_with("{{input}}") {
            (Some(input.to_string_lossy().into_owned()), 9)
        } else if after.starts_with("{{output}}") {
            (Some(out.to_string_lossy().into_owned()), 10)
        } else if after.starts_with("{{dir}}") {
            (Some(dir.clone()), 7)
        } else if after.starts_with("{{name}}") {
            (Some(name.clone()), 8)
        } else {
            (None, 2)
        };
        match val {
            Some(v) => outs.push_str(&quote(&v)),
            None => outs.push_str("{{"),
        }
        rest = &after[len..];
    }
    outs.push_str(rest);
    outs
}

#[tauri::command]
pub async fn custom_export(state: State<'_, AppState>, command: String, input: PathBuf, out: PathBuf) -> Result<(), String> {
    // The command comes from Preferences (never from a document, 9.6).
    let custom = state.settings().values.get("exportCustomCommands").and_then(|v| v.as_array()).is_some_and(|a| a.iter().any(|c| c.get("command").and_then(|x| x.as_str()) == Some(command.as_str())));
    if !custom {
        return Err("This command is not in Export Settings.".into());
    }
    let cmd = shell_command(&command, &input, &out);
    state.logger.info(&format!("custom export to {}", out.display()));
    tauri::async_runtime::spawn_blocking(move || run(cmd)).await.map_err(|e| e.to_string())?.map(|_| ())
}

#[cfg(not(windows))]
fn shell_command(template: &str, input: &Path, out: &Path) -> Command {
    let mut c = Command::new("sh");
    c.arg("-c").arg(fill_template(template, input, out, sh_quote));
    if let Some(d) = input.parent() {
        c.current_dir(d);
    }
    c
}

#[cfg(windows)]
fn shell_command(template: &str, input: &Path, out: &Path) -> Command {
    use std::os::windows::process::CommandExt;
    let mut c = Command::new("cmd");
    c.raw_arg(format!("/C {}", fill_template(template, input, out, cmd_quote)));
    if let Some(d) = input.parent() {
        c.current_dir(d);
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting() {
        assert_eq!(sh_quote("it's a b"), "'it'\\''s a b'");
        assert_eq!(cmd_quote("50% (a&b)!\""), "\"50^% ^(a^&b^)^!^\"\"");
        let t = fill_template("cp {{input}} {{output}} # {{name}} in {{dir}} {{x}}", Path::new("/d/my 'doc'.md"), Path::new("/o/x.out"), sh_quote);
        assert_eq!(t, "cp '/d/my '\\''doc'\\''.md' '/o/x.out' # 'my '\\''doc'\\''' in '/d' {{x}}");
    }

    #[cfg(unix)]
    #[test]
    fn shell_runs_with_awkward_paths() {
        let d = tempfile::tempdir().unwrap();
        let input = d.path().join("a b 'q' $HOME.md");
        std::fs::write(&input, "hello").unwrap();
        let out = d.path().join("out put.txt");
        run(shell_command("cp {{input}} {{output}}", &input, &out)).unwrap();
        assert_eq!(std::fs::read_to_string(out).unwrap(), "hello");
    }

    #[test]
    fn args() {
        let a = export_args(Path::new("/t/in.md"), "docx", Path::new("/o/x.docx"), Some(Path::new("/d")), "+hard_line_breaks+emoji", None);
        let a: Vec<String> = a.iter().map(|s| s.to_string_lossy().into_owned()).collect();
        assert_eq!(a, ["/t/in.md", "-f", "gfm+tex_math_dollars+footnotes+yaml_metadata_block+hard_line_breaks+emoji", "-t", "docx", "-o", "/o/x.docx", "--resource-path=/d"]);
    }
}
