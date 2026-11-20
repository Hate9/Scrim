//! Rotating log file (spec 01, "Logging"): `app.log` in the config directory, at most
//! 2 MB, one previous file kept as `app.log.1`. Never log document contents.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::time::now_rfc3339;

pub const LOG_FILE: &str = "app.log";
pub const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

pub struct Logger {
    path: PathBuf,
    max_bytes: u64,
    inner: Mutex<Option<(File, u64)>>,
}

impl Logger {
    pub fn new(config_dir: &Path) -> Self {
        Self::with_limit(config_dir, MAX_LOG_BYTES)
    }

    pub fn with_limit(config_dir: &Path, max_bytes: u64) -> Self {
        Self { path: config_dir.join(LOG_FILE), max_bytes, inner: Mutex::new(None) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Append one line. Errors writing the log are swallowed (logging must never take
    /// the app down), but are echoed to stderr.
    pub fn log(&self, level: &str, msg: &str) {
        let line = format!("{} {level:<5} {}\n", now_rfc3339(), msg.replace('\n', "\\n"));
        if cfg!(debug_assertions) {
            eprint!("{line}");
        }
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if let Err(e) = self.write_line(&mut guard, line.as_bytes()) {
            eprintln!("scrim: cannot write log {}: {e}", self.path.display());
        }
    }

    pub fn info(&self, msg: &str) {
        self.log("INFO", msg)
    }
    pub fn warn(&self, msg: &str) {
        self.log("WARN", msg)
    }
    pub fn error(&self, msg: &str) {
        self.log("ERROR", msg)
    }

    fn write_line(&self, slot: &mut Option<(File, u64)>, line: &[u8]) -> std::io::Result<()> {
        if slot.is_none() {
            if let Some(dir) = self.path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            let f = OpenOptions::new().create(true).append(true).open(&self.path)?;
            let len = f.metadata()?.len();
            *slot = Some((f, len));
        }
        let needs_rotate = slot.as_ref().is_some_and(|(_, len)| {
            *len > 0 && *len + line.len() as u64 > self.max_bytes
        });
        if needs_rotate {
            *slot = None;
            let prev = self.path.with_extension("log.1");
            let _ = std::fs::remove_file(&prev);
            std::fs::rename(&self.path, &prev)?;
            let f = OpenOptions::new().create(true).append(true).open(&self.path)?;
            *slot = Some((f, 0));
        }
        let (f, len) = slot.as_mut().expect("opened above");
        f.write_all(line)?;
        *len += line.len() as u64;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotates_and_keeps_one() {
        let dir = tempfile::tempdir().unwrap();
        let log = Logger::with_limit(dir.path(), 200);
        for i in 0..30 {
            log.info(&format!("line {i}"));
        }
        let cur = std::fs::read_to_string(dir.path().join("app.log")).unwrap();
        let prev = std::fs::read_to_string(dir.path().join("app.log.1")).unwrap();
        assert!(cur.len() <= 200 && prev.len() <= 200);
        assert!(cur.contains("line 29"));
        assert!(!cur.contains("line 0 ") && !prev.contains("line 0\n"));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
