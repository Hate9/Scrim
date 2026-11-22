//! Cursor blink (spec 11, Editor; default on). WebKitGTK draws the caret with GTK's
//! `gtk-cursor-blink` setting, so Linux applies the preference there. WebView2 has no
//! switch for the caret; on Windows the system setting applies.

use tauri::AppHandle;

/// Apply the `cursorBlink` preference (`None`: default, on).
pub fn apply(app: &AppHandle, value: Option<&serde_json::Value>) {
    let on = value.and_then(|v| v.as_bool()).unwrap_or(true);
    #[cfg(target_os = "linux")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            use gtk::prelude::ObjectExt;
            use tauri::Manager;
            if let Some(settings) = gtk::Settings::default() {
                settings.set_property("gtk-cursor-blink", on);
                let now: bool = settings.property("gtk-cursor-blink");
                handle.state::<crate::state::AppState>().logger.info(&format!("cursor blink: {}", if now { "on" } else { "off" }));
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, on);
    }
}
