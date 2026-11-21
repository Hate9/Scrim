//! Platform-independent core of Scrim.
//!
//! Everything here is plain Rust with no webview or GUI dependency, so it can be unit
//! tested headless. The Tauri shell (`src-tauri`) is a thin layer over this crate.

pub mod encoding;
pub mod identity;
pub mod images;
pub mod line_endings;
pub mod logging;
pub mod paths;
pub mod save;
pub mod settings;
pub mod time;
