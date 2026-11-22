//! WebView2 print-to-PDF and print dialog (spec 09, 9.3; Windows only).

use std::path::Path;
use std::sync::mpsc::Sender;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2_16, ICoreWebView2_7, COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows_core::{Interface, HSTRING};

use crate::pdf::PageSpec;

const MM_PER_INCH: f64 = 25.4;

pub fn print_to_pdf(pw: tauri::webview::PlatformWebview, out: &Path, spec: &PageSpec, done: Sender<Result<(), String>>) -> Result<(), String> {
    let e = |x: windows_core::Error| x.message().to_string();
    unsafe {
        let core = pw.controller().CoreWebView2().map_err(e)?;
        let core7: ICoreWebView2_7 = core.cast().map_err(e)?;
        let env6: ICoreWebView2Environment6 = pw.environment().cast().map_err(e)?;
        let settings = env6.CreatePrintSettings().map_err(e)?;
        settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT).map_err(e)?;
        settings.SetPageWidth(spec.width / MM_PER_INCH).map_err(e)?;
        settings.SetPageHeight(spec.height / MM_PER_INCH).map_err(e)?;
        settings.SetMarginTop(spec.margin_top / MM_PER_INCH).map_err(e)?;
        settings.SetMarginBottom(spec.margin_bottom / MM_PER_INCH).map_err(e)?;
        settings.SetMarginLeft(spec.margin_left / MM_PER_INCH).map_err(e)?;
        settings.SetMarginRight(spec.margin_right / MM_PER_INCH).map_err(e)?;
        settings.SetShouldPrintBackgrounds(true).map_err(e)?;
        settings.SetShouldPrintHeaderAndFooter(false).map_err(e)?;
        let handler = PrintToPdfCompletedHandler::create(Box::new(move |res, ok| {
            let _ = done.send(match res {
                Ok(()) if ok => Ok(()),
                Ok(()) => Err("printing failed".into()),
                Err(err) => Err(format!("printing failed: {}", err.message())),
            });
            Ok(())
        }));
        core7.PrintToPdf(&HSTRING::from(out.as_os_str()), &settings, &handler).map_err(e)?;
    }
    Ok(())
}

pub fn print_dialog(pw: tauri::webview::PlatformWebview) {
    unsafe {
        if let Ok(core) = pw.controller().CoreWebView2() {
            if let Ok(core16) = core.cast::<ICoreWebView2_16>() {
                let _ = core16.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM);
            }
        }
    }
}
