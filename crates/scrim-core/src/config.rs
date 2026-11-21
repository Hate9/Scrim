//! `config.jsonc`: advanced options not shown in the preferences (spec 11, "Storage").
//!
//! JSON with `//` and `/* */` comments and trailing commas. The default file written on
//! first run is fully commented. Unknown keys are kept as they are (the file is the
//! user's; Scrim only writes it on first run and on "Reset Advanced Settings").

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

pub const FILE_NAME: &str = "config.jsonc";

/// The default file: every option with its default, explained (11).
pub const DEFAULT_JSONC: &str = r#"// Scrim advanced settings.
//
// This file is JSON with comments. Scrim reads it at startup and again every time it is
// saved, so changes apply without a restart. Preferences → General → "Reset Advanced
// Settings" restores this commented default.
{
  // Keyboard shortcuts for menu items, by the item's English label (case does not
  // matter; "…" and "." are ignored). An empty string removes the shortcut.
  // Accelerators look like "Ctrl+Shift+B", "Alt+Up", "F7". Prefix "global:" to ask for
  // a system-wide shortcut (best effort).
  // Example: "Strong": "Ctrl+Shift+B"
  "shortcuts": {},

  // "Search with…" entries in the document's context menu when text is selected. %s is
  // replaced by the selected text, URL-encoded. Opens in the system browser.
  "contextSearch": [
    { "label": "Search with DuckDuckGo", "url": "https://duckduckgo.com/?q=%s" }
  ],

  // Domains whose iframes may run scripts, when "Allow iframes in HTML" is on
  // (Preferences → Markdown). Example: ["www.youtube.com"]
  "iframeAllowlist": [],

  // Extra command-line flags for the webview. Best effort: ignored where the platform
  // webview does not support them. Applies after restart.
  "webviewFlags": [],

  // Font families used when a theme does not set them. null = the app's built-in choice.
  "defaultFonts": { "body": null, "serif": null, "sans": null, "mono": null },

  // Maximum number of files shown in the sidebar's file list view.
  "fileListLimit": 500
}
"#;

/// Strip comments and trailing commas, leaving strings intact.
pub fn strip_jsonc(text: &str) -> String {
    let b: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let mut in_str = false;
    while i < b.len() {
        let c = b[i];
        if in_str {
            out.push(c);
            if c == '\\' && i + 1 < b.len() {
                out.push(b[i + 1]);
                i += 2;
                continue;
            }
            if c == '"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match c {
            '"' => {
                in_str = true;
                out.push(c);
                i += 1;
            }
            '/' if b.get(i + 1) == Some(&'/') => {
                while i < b.len() && b[i] != '\n' {
                    i += 1;
                }
            }
            '/' if b.get(i + 1) == Some(&'*') => {
                i += 2;
                while i < b.len() && !(b[i] == '*' && b.get(i + 1) == Some(&'/')) {
                    if b[i] == '\n' {
                        out.push('\n'); // keep line numbers for error messages
                    }
                    i += 1;
                }
                i += 2;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    // trailing commas: `,` followed by whitespace and `}` or `]`
    let chars: Vec<char> = out.chars().collect();
    let mut res = String::with_capacity(out.len());
    let mut in_str = false;
    let mut k = 0;
    while k < chars.len() {
        let c = chars[k];
        if in_str {
            res.push(c);
            if c == '\\' && k + 1 < chars.len() {
                res.push(chars[k + 1]);
                k += 2;
                continue;
            }
            if c == '"' {
                in_str = false;
            }
        } else if c == '"' {
            in_str = true;
            res.push(c);
        } else if c == ',' {
            let next = chars[k + 1..].iter().find(|c| !c.is_whitespace());
            if !matches!(next, Some('}') | Some(']')) {
                res.push(c);
            }
        } else {
            res.push(c);
        }
        k += 1;
    }
    res
}

pub fn parse_jsonc(text: &str) -> Result<Value, String> {
    serde_json::from_str(&strip_jsonc(text)).map_err(|e| e.to_string())
}

pub fn path(config_dir: &Path) -> PathBuf {
    config_dir.join(FILE_NAME)
}

/// Write the commented default if the file does not exist (first run).
pub fn ensure_default(config_dir: &Path) -> std::io::Result<()> {
    let p = path(config_dir);
    if !p.exists() {
        std::fs::write(p, DEFAULT_JSONC)?;
    }
    Ok(())
}

/// Restore the commented default ("Reset Advanced Settings").
pub fn reset(config_dir: &Path) -> std::io::Result<()> {
    std::fs::write(path(config_dir), DEFAULT_JSONC)
}

/// The effective configuration: the defaults, overlaid key by key with the file's
/// values. A missing file gives the defaults; a broken file gives the defaults and the
/// error (shown to the user, file left untouched).
pub fn load(config_dir: &Path) -> (Value, Option<String>) {
    let mut cfg = match parse_jsonc(DEFAULT_JSONC) {
        Ok(Value::Object(m)) => m,
        _ => Map::new(),
    };
    let err = match std::fs::read_to_string(path(config_dir)) {
        Err(_) => None,
        Ok(text) => match parse_jsonc(&text) {
            Ok(Value::Object(m)) => {
                for (k, v) in m {
                    cfg.insert(k, v);
                }
                None
            }
            Ok(_) => Some(format!("{FILE_NAME}: the top level must be an object")),
            Err(e) => Some(format!("{FILE_NAME}: {e}")),
        },
    };
    (Value::Object(cfg), err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_parses() {
        let v = parse_jsonc(DEFAULT_JSONC).unwrap();
        assert_eq!(v["fileListLimit"], 500);
        assert_eq!(v["contextSearch"][0]["url"], "https://duckduckgo.com/?q=%s");
        assert!(v["shortcuts"].as_object().unwrap().is_empty());
    }

    #[test]
    fn comments_and_trailing_commas() {
        let v = parse_jsonc("{ // a\n \"a\": \"x // not a comment\", /* b */ \"b\": [1, 2,], \"c\": \"/* s */\",\n}").unwrap();
        assert_eq!(v["a"], "x // not a comment");
        assert_eq!(v["b"], serde_json::json!([1, 2]));
        assert_eq!(v["c"], "/* s */");
        assert_eq!(parse_jsonc(r#"{"q": "a\"//b"}"#).unwrap()["q"], "a\"//b");
    }

    #[test]
    fn load_overlays_defaults() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(path(d.path()), "{ \"shortcuts\": { \"Strong\": \"Ctrl+Shift+B\" }, \"mine\": 1 }").unwrap();
        let (v, err) = load(d.path());
        assert!(err.is_none());
        assert_eq!(v["shortcuts"]["Strong"], "Ctrl+Shift+B");
        assert_eq!(v["fileListLimit"], 500);
        assert_eq!(v["mine"], 1);
        std::fs::write(path(d.path()), "{ broken").unwrap();
        let (v, err) = load(d.path());
        assert!(err.is_some());
        assert_eq!(v["fileListLimit"], 500);
    }
}
