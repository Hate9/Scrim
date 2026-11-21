//! Scrim's Tauri shell. Platform-independent logic lives in `scrim-core`; this crate
//! wires it to windows, IPC commands, the `scrim-file` protocol, and the webviews.

mod commands;
mod embed;
mod hardening;
mod images;
mod pdf_proto;
mod protocol;
mod state;
mod windows;
mod workspace;

use std::path::PathBuf;

use scrim_core::identity::DISPLAY_NAME;
use tauri::Manager;

use crate::state::AppState;

pub fn run() {
    let state = AppState::init();
    state.logger.info(&format!(
        "{DISPLAY_NAME} {} starting (pid {}, {})",
        env!("CARGO_PKG_VERSION"),
        std::process::id(),
        std::env::consts::OS
    ));

    state.logger.info(&format!("config directory {}", state.config_dir.display()));

    let result = tauri::Builder::default()
        // Must be the first plugin: a second instance hands its arguments over here and
        // exits before anything else starts (spec 01, "Single instance").
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let state = app.state::<AppState>();
            state.logger.info(&format!("second instance forwarded {} argument(s)", argv.len().saturating_sub(1)));
            let args: Vec<String> = argv.iter().skip(1).cloned().collect();
            let paths = windows::paths_from_args(args.clone(), &PathBuf::from(cwd));
            if paths.is_empty() {
                // `scrim` with no file while running: a new untitled window.
                if let Err(e) = windows::open_untitled(app) {
                    state.logger.error(&format!("cannot open window: {e}"));
                }
            } else {
                windows::open_paths(app, &paths, windows::reuse_for_args(&args));
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .manage(workspace::Watchers::default())
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, protocol::handle)
        .register_asynchronous_uri_scheme_protocol(embed::SCHEME, embed::handle)
        .invoke_handler(tauri::generate_handler![
            commands::doc_init,
            commands::doc_set_dirty,
            commands::doc_set_title_override,
            commands::doc_save,
            commands::doc_open_dialog,
            commands::doc_new,
            commands::log_csp_violation,
            commands::log_frontend,
            commands::scope_allow_files,
            commands::clipboard_read_text,
            commands::clipboard_write_text,
            commands::clipboard_read_media,
            commands::doc_open_path,
            commands::open_external,
            commands::settings_get,
            commands::settings_set,
            images::image_insert,
            images::image_finalize,
            images::link_target,
            images::path_kind,
            workspace::fs_list_dir,
            workspace::fs_walk,
            workspace::fs_create_file,
            workspace::fs_create_dir,
            workspace::fs_rename,
            workspace::fs_move,
            workspace::fs_duplicate,
            workspace::fs_trash,
            workspace::fs_reveal,
            workspace::recent_get,
            workspace::recent_clear,
            workspace::folder_get,
            workspace::folder_open,
            workspace::folder_dialog,
            workspace::doc_reload,
            workspace::search_start,
            workspace::search_cancel,
            workspace::recovery_write,
            workspace::recovery_remove,
            workspace::recovery_list,
            workspace::recovery_read,
            workspace::recovery_discard,
            workspace::recovery_adopt,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                workspace::unwatch(window.app_handle(), window.label());
                let state = window.state::<AppState>();
                state.docs().remove(window.label());
                state.logger.info(&format!("window {} closed", window.label()));
            }
        })
        .setup(|app| {
            workspace::purge_discarded(&app.state::<AppState>());
            let cwd = std::env::current_dir().unwrap_or_default();
            let args: Vec<String> = std::env::args().skip(1).collect();
            let paths = windows::paths_from_args(args.clone(), &cwd);
            let handle = app.handle().clone();
            if paths.is_empty() {
                windows::open_untitled(&handle)?;
            } else {
                windows::open_paths(&handle, &paths, windows::reuse_for_args(&args));
            }
            Ok(())
        })
        .build(tauri::generate_context!());

    match result {
        Ok(app) => app.run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<AppState>().logger.info("exit");
            }
        }),
        Err(e) => {
            eprintln!("{DISPLAY_NAME}: failed to start: {e}");
            std::process::exit(1);
        }
    }
}
