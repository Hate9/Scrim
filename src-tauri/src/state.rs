//! Process-wide state shared by commands, windows, and the protocol handler.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use scrim_core::encoding::TextEncoding;
use scrim_core::logging::Logger;
use scrim_core::paths;
use scrim_core::settings::Settings;

/// One document window's document.
#[derive(Debug, Default)]
pub struct DocState {
    /// File path, `None` for an untitled document.
    pub path: Option<PathBuf>,
    /// Encoding the file was read with (UTF-8 for new documents).
    pub encoding: Option<TextEncoding>,
    /// Decoded text exactly as loaded (or as last saved), with original line endings.
    pub saved_text: String,
    /// The bytes on disk that `saved_text` came from. When the text to save equals
    /// `saved_text`, these are written verbatim so open-then-save is byte-identical even
    /// for encodings whose decode/encode is not a bijection.
    pub saved_bytes: Option<Vec<u8>>,
    /// Whether the document has unsaved changes (reported by the frontend).
    pub dirty: bool,
    /// The file had bytes that did not decode (shown as U+FFFD).
    pub malformed: bool,
    /// Set once the frontend has called `doc_init` for this window.
    pub initialized: bool,
    /// Front matter `title`, shown instead of the file name (spec 04, 4.11).
    pub title_override: Option<String>,
    /// Images saved for this untitled document, moved on its first save (6.4).
    pub temp_images: Vec<PathBuf>,
    /// The sidebar folder of this window (7.4).
    pub folder: Option<PathBuf>,
    /// Id of this document's draft in the recovery store (7.6).
    pub draft_id: Option<String>,
    /// A recovered draft to load into this (new) window.
    pub recover_id: Option<String>,
}

pub struct AppState {
    pub logger: Logger,
    pub config_dir: PathBuf,
    pub settings: Mutex<Settings>,
    /// Keyed by window label.
    pub docs: Mutex<HashMap<String, DocState>>,
    next_window: AtomicU64,
    /// Extra files and folders the `scrim-file` protocol may serve (spec 01, "Local
    /// files in the webview"). The theme and recovery folders are always allowed.
    pub file_scope: Mutex<FileScope>,
}

#[derive(Debug, Default)]
pub struct FileScope {
    pub files: HashSet<PathBuf>,
    pub dirs: HashSet<PathBuf>,
}

impl FileScope {
    pub fn allows(&self, path: &Path) -> bool {
        self.files.contains(path) || self.dirs.iter().any(|d| path.starts_with(d))
    }
}

impl AppState {
    pub fn init() -> Self {
        let config_dir = paths::ensure_config_dir().unwrap_or_else(|e| {
            let fallback = std::env::temp_dir().join(scrim_core::identity::PACKAGE_NAME);
            eprintln!("cannot create config directory ({e}); using {}", fallback.display());
            let _ = std::fs::create_dir_all(&fallback);
            fallback
        });
        let logger = Logger::new(&config_dir);
        let (settings, err) = Settings::load(&config_dir);
        if let Some(err) = err {
            logger.warn(&format!("settings ignored: {err}"));
        }
        let mut scope = FileScope::default();
        for sub in ["themes", "recovery", "tmp-images"] {
            let d = config_dir.join(sub);
            scope.dirs.insert(std::fs::canonicalize(&d).unwrap_or(d));
        }
        Self {
            logger,
            config_dir,
            settings: Mutex::new(settings),
            docs: Mutex::new(HashMap::new()),
            next_window: AtomicU64::new(1),
            file_scope: Mutex::new(scope),
        }
    }

    pub fn next_window_label(&self) -> String {
        format!("doc-{}", self.next_window.fetch_add(1, Ordering::Relaxed))
    }

    pub fn docs(&self) -> MutexGuard<'_, HashMap<String, DocState>> {
        self.docs.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn settings(&self) -> MutexGuard<'_, Settings> {
        self.settings.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn scope(&self) -> MutexGuard<'_, FileScope> {
        self.file_scope.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Label of the window that has `path` open, if any. Paths are compared after
    /// resolving symlinks so two names for one file count as the same document.
    pub fn window_for_path(&self, path: &Path) -> Option<String> {
        let key = canonical(path);
        self.docs()
            .iter()
            .find(|(_, d)| d.path.as_deref().map(canonical).as_deref() == Some(key.as_path()))
            .map(|(label, _)| label.clone())
    }
}

/// Best-effort canonical form of a path for identity comparisons.
pub fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path)
        .or_else(|_| scrim_core::save::resolve_symlinks(path))
        .unwrap_or_else(|_| path.to_path_buf())
}
