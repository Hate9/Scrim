//! The temporary folder of exports, `<config>/tmp-export` (PDF and print pages, pandoc
//! input). Created when an export needs it; each export deletes its own files when it
//! finishes, successful or not, and the folder goes once it is empty. Anything left by a
//! crash is deleted at the next start, and the folder is deleted when the app exits.

use std::path::{Path, PathBuf};

use crate::state::AppState;

pub const NAME: &str = "tmp-export";

/// The folder for an export about to write files (created if needed).
pub fn dir(state: &AppState) -> Result<PathBuf, String> {
    let d = state.config_dir.join(NAME);
    std::fs::create_dir_all(&d).map_err(|e| format!("cannot create {}: {e}", d.display()))?;
    Ok(std::fs::canonicalize(&d).unwrap_or(d))
}

/// Files an export wrote, deleted when it is dropped (every return path), together with
/// the folder when no other export is using it.
pub struct Cleanup(pub Vec<PathBuf>);

impl Drop for Cleanup {
    fn drop(&mut self) {
        let mut parent = None;
        for f in &self.0 {
            let _ = std::fs::remove_file(f);
            parent = parent.or_else(|| f.parent().map(Path::to_path_buf));
        }
        if let Some(p) = parent {
            let _ = std::fs::remove_dir(p); // fails while another export still has files there
        }
    }
}

/// Delete the folder and everything in it (start and exit).
pub fn clear(config_dir: &Path) {
    let d = config_dir.join(NAME);
    if d.exists() {
        let _ = std::fs::remove_dir_all(&d);
    }
}
