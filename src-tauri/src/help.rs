//! Help menu (spec 12): local documents written for this project, the log folder, and
//! developer tools. No web links.

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::state::AppState;

pub const DOCS: &[(&str, &str)] = &[
    ("quick-start", include_str!("../help/Quick Start.md")),
    ("markdown-reference", include_str!("../help/Markdown Reference.md")),
    ("shortcuts", include_str!("../help/Shortcuts.md")),
    ("custom-themes", include_str!("../help/Custom Themes.md")),
    ("snippets-and-custom-tags", include_str!("../help/Snippets and Custom Tags.md")),
    ("credits", include_str!("../../THIRD_PARTY.md")),
];

fn file_name(id: &str) -> &'static str {
    match id {
        "quick-start" => "Quick Start.md",
        "markdown-reference" => "Markdown Reference.md",
        "shortcuts" => "Shortcuts.md",
        "custom-themes" => "Custom Themes.md",
        "snippets-and-custom-tags" => "Snippets and Custom Tags.md",
        _ => "Credits.md",
    }
}

/// Open a help document in a new window. The text is written to `<config>/help/` each
/// time (so it always matches this version) and opened like any file.
#[tauri::command]
pub fn help_open(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let (_, text) = DOCS.iter().find(|(k, _)| *k == id).ok_or("unknown help document")?;
    let dir = state.config_dir.join("help");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(file_name(&id));
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    crate::windows::open_paths(&app, &[path], crate::windows::Reuse::Never);
    Ok(())
}

#[tauri::command]
pub fn log_folder_open(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(state.config_dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// View → Toggle DevTools (only when "Enable debugging tools" is on, 11).
#[tauri::command]
pub fn devtools_toggle(window: WebviewWindow) {
    if let Some(w) = window.app_handle().get_webview_window(window.label()) {
        if w.is_devtools_open() {
            w.close_devtools();
        } else {
            w.open_devtools();
        }
    }
}

/// Edit → Emoji and Symbols… (Windows only, 12): open the system emoji panel by sending
/// Win+. to the system.
#[tauri::command]
pub fn emoji_panel() {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_LWIN, VK_OEM_PERIOD,
        };
        let key = |vk: u16, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { 0 }, time: 0, dwExtraInfo: 0 },
            },
        };
        let inputs = [key(VK_LWIN, false), key(VK_OEM_PERIOD, false), key(VK_OEM_PERIOD, true), key(VK_LWIN, true)];
        SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
    }
}
