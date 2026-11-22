//! P0 prototype of print-to-PDF on Linux (spec 21, "Known hard parts" item 5: "PDF
//! export on Linux. WebKitGTK print-to-file must be driven from Rust via the webview
//! handle. Prototype in P0 to de-risk.").
//!
//! Not a user feature. When `SCRIM_PROTO_PRINT_PDF=/abs/out.pdf` is set, the first
//! window prints itself to that file without a dialog once its document has loaded, and
//! the outcome is logged. The real export pipeline (spec 09) is built in P5.

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub const ENV: &str = "SCRIM_PROTO_PRINT_PDF";

#[cfg(target_os = "linux")]
pub fn maybe_print<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::Manager;
    static DONE: AtomicBool = AtomicBool::new(false);

    let Some(out) = std::env::var_os(ENV) else { return };
    if DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    let out = std::path::PathBuf::from(out);
    let app = window.app_handle().clone();
    let res = window.with_webview(move |wv| {
        use webkit2gtk::PrintOperationExt;
        let logger = move |msg: String| app.state::<crate::state::AppState>().logger.info(&msg);
        let settings = gtk::PrintSettings::new();
        settings.set_printer("Print to File");
        settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
        let uri = format!("file://{}", out.display());
        settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(&uri));
        let page = gtk::PageSetup::new();
        page.set_paper_size(&gtk::PaperSize::new(Some(gtk::PAPER_NAME_A4)));
        let op = webkit2gtk::PrintOperation::new(&wv.inner());
        op.set_print_settings(&settings);
        op.set_page_setup(&page);
        let l1 = logger.clone();
        let path = out.clone();
        op.connect_finished(move |_| {
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            l1(format!("pdf prototype: finished, {} ({size} bytes)", path.display()));
        });
        let l2 = logger.clone();
        op.connect_failed(move |_, err| l2(format!("pdf prototype: failed: {err}")));
        logger(format!("pdf prototype: printing to {uri}"));
        op.print();
    });
    if let Err(e) = res {
        eprintln!("pdf prototype: {e}");
    }
}

#[cfg(not(target_os = "linux"))]
pub fn maybe_print<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}
