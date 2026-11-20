//! Read-only access to `settings.json` for P0 (spec 11, "Storage": flat camelCase keys,
//! unknown keys preserved). The preferences window (P4) adds writing.

use std::path::Path;

use serde_json::{Map, Value};

use crate::line_endings::LineEnding;

pub const SETTINGS_FILE: &str = "settings.json";

/// Key for "Default line ending for new files" (spec 11, Markdown section).
pub const DEFAULT_LINE_ENDING: &str = "defaultLineEnding";

#[derive(Debug, Clone, Default)]
pub struct Settings {
    pub values: Map<String, Value>,
}

impl Settings {
    /// Load from the config directory. A missing or unreadable file yields defaults; a
    /// corrupt file is reported to the caller for logging and also yields defaults.
    pub fn load(config_dir: &Path) -> (Self, Option<String>) {
        let path = config_dir.join(SETTINGS_FILE);
        match std::fs::read(&path) {
            Err(_) => (Self::default(), None),
            Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
                Ok(Value::Object(values)) => (Self { values }, None),
                Ok(_) => (Self::default(), Some(format!("{} is not a JSON object", path.display()))),
                Err(e) => (Self::default(), Some(format!("{}: {e}", path.display()))),
            },
        }
    }

    pub fn default_line_ending(&self) -> LineEnding {
        match self.values.get(DEFAULT_LINE_ENDING).and_then(Value::as_str) {
            Some("lf") => LineEnding::Lf,
            Some("crlf") => LineEnding::CrLf,
            _ => LineEnding::platform_default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_line_ending() {
        let dir = tempfile::tempdir().unwrap();
        let (s, err) = Settings::load(dir.path());
        assert!(err.is_none());
        assert_eq!(s.default_line_ending(), LineEnding::platform_default());
        std::fs::write(dir.path().join(SETTINGS_FILE), r#"{"defaultLineEnding":"crlf","x":1}"#)
            .unwrap();
        assert_eq!(Settings::load(dir.path()).0.default_line_ending(), LineEnding::CrLf);
        std::fs::write(dir.path().join(SETTINGS_FILE), "{oops").unwrap();
        let (s, err) = Settings::load(dir.path());
        assert!(err.is_some());
        assert_eq!(s.default_line_ending(), LineEnding::platform_default());
    }
}
