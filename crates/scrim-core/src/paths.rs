//! Config directory location (spec 01, "Identity" and "Settings storage").

use std::path::PathBuf;

use crate::identity::PACKAGE_NAME;

/// Environment variable that overrides the config directory. Used by the test suites so
/// they never touch the real user profile.
pub const CONFIG_DIR_ENV: &str = "SCRIM_CONFIG_DIR";

/// Linux: `$XDG_CONFIG_HOME/scrim` or `~/.config/scrim`. Windows: `%APPDATA%\scrim`.
pub fn config_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os(CONFIG_DIR_ENV).filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    platform_config_base().map(|base| base.join(PACKAGE_NAME))
}

#[cfg(windows)]
fn platform_config_base() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

#[cfg(not(windows))]
fn platform_config_base() -> Option<PathBuf> {
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        let p = PathBuf::from(xdg);
        if p.is_absolute() {
            return Some(p);
        }
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config"))
}

/// Ensure the config directory exists and return it.
pub fn ensure_config_dir() -> std::io::Result<PathBuf> {
    let dir = config_dir().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "no home/config directory")
    })?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
