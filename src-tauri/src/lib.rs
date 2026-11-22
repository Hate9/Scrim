//! Scrim's Tauri shell. Platform-independent logic lives in `scrim-core`; this crate
//! wires it to windows, IPC commands, the `scrim-file` protocol, and the webviews.

mod commands;
mod config;
mod embed;
mod export;
mod hardening;
mod help;
mod images;
mod local;
mod pandoc;
mod pdf;
#[cfg(windows)]
mod pdf_windows;
mod pdf_proto;
mod protocol;
mod spell;
mod state;
mod themes;
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

    #[cfg(target_os = "linux")]
    wait_for_exiting_instance(&state);

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
        .manage(spell::Spell::default())
        .manage(themes::ThemeWatcher(std::sync::Mutex::new(None)))
        .manage(config::ConfigWatcher(std::sync::Mutex::new(None)))
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, protocol::handle)
        .register_asynchronous_uri_scheme_protocol(embed::SCHEME, embed::handle)
        .invoke_handler(tauri::generate_handler![
            commands::doc_init,
            export::export_theme_css,
            export::export_write,
            export::export_embed_image,
            export::export_pick_path,
            export::export_open,
            pdf::export_pdf,
            pdf::export_print,
            pandoc::pandoc_info,
            pandoc::pandoc_export,
            pandoc::import_file,
            pandoc::open_untitled_text,
            pandoc::custom_export,
            local::local_get,
            local::local_set,
            local::config_text,
            local::config_save,
            local::user_css_get,
            local::user_css_save,
            spell::spell_info,
            spell::spell_check,
            spell::spell_suggest,
            spell::spell_add,
            spell::spell_open_personal,
            spell::spell_reload_personal,
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
            workspace::folder_watch_implicit,
            themes::themes_list,
            config::config_get,
            commands::clipboard_write_flavors,
            commands::clipboard_read_html,
            help::help_open,
            help::log_folder_open,
            help::devtools_toggle,
            help::emoji_panel,
            config::config_reset,
            themes::themes_open_folder,
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
            workspace::recovery_open,
            workspace::fs_read_text,
            workspace::fs_copy,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                workspace::unwatch(window.app_handle(), window.label());
                let state = window.state::<AppState>();
                workspace::note_window_closed(&state, window.label());
                state.docs().remove(window.label());
                state.logger.info(&format!("window {} closed", window.label()));
            }
        })
        .setup(|app| {
            workspace::purge_discarded(&app.state::<AppState>());
            themes::install_builtin(&app.state::<AppState>());
            themes::watch(app.handle());
            config::setup(app.handle());
            let cwd = std::env::current_dir().unwrap_or_default();
            let args: Vec<String> = std::env::args().skip(1).collect();
            let paths = windows::paths_from_args(args.clone(), &cwd);
            let handle = app.handle().clone();
            let launch = if paths.is_empty() { workspace::launch_paths(&app.state::<AppState>()) } else { vec![] };
            if paths.is_empty() && launch.is_empty() {
                windows::open_untitled(&handle)?;
            } else if paths.is_empty() {
                windows::open_paths(&handle, &launch, windows::Reuse::Never);
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

/// A launch that races an instance which is exiting finds the single-instance D-Bus name
/// still owned, forwards its arguments, and gets no reply: the plugin then fails the start.
/// So when the name is owned, check that its owner still answers; while it does not, wait
/// (up to 3 s) for the name to be released.
#[cfg(target_os = "linux")]
fn wait_for_exiting_instance(state: &AppState) {
    use std::time::{Duration, Instant};
    let name = format!("{}.SingleInstance", scrim_core::identity::APP_ID);
    let Ok(conn) = zbus::blocking::Connection::session() else { return };
    let Ok(dbus) = zbus::blocking::fdo::DBusProxy::new(&conn) else { return };
    let Ok(bus_name) = zbus::names::BusName::try_from(name.as_str()) else { return };
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if !dbus.name_has_owner(bus_name.clone()).unwrap_or(false) {
            return; // nobody running: this becomes the first instance
        }
        let alive = zbus::blocking::fdo::PeerProxy::builder(&conn)
            .destination(bus_name.clone())
            .and_then(|b| b.path("/"))
            .and_then(|b| b.build())
            .and_then(|p| p.ping())
            .is_ok();
        if alive {
            return; // a live instance: the plugin hands our arguments over
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    state.logger.warn("another instance owns the single-instance name but does not answer");
}
