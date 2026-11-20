//! Product identity (spec 01, "Identity"). Keep each name in exactly one constant so a
//! rename is a three-line change.

/// Name shown to users (window titles, dialogs).
pub const DISPLAY_NAME: &str = "Scrim";
/// Package, binary, and config-directory name.
pub const PACKAGE_NAME: &str = "scrim";
/// Reverse-DNS application id.
pub const APP_ID: &str = "io.gitlab.sisters_vibecode.Scrim";

/// Window title for a document (spec 07, 7.1): `<file name> - Scrim`, with a `•`
/// before the name when the document has unsaved changes.
pub fn window_title(file_name: Option<&str>, dirty: bool) -> String {
    let name = file_name.unwrap_or("Untitled");
    let mark = if dirty { "• " } else { "" };
    format!("{mark}{name} - {DISPLAY_NAME}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles() {
        assert_eq!(window_title(Some("notes.md"), false), "notes.md - Scrim");
        assert_eq!(window_title(Some("notes.md"), true), "• notes.md - Scrim");
        assert_eq!(window_title(None, false), "Untitled - Scrim");
    }
}
