//! Webview settings that keep the webview from making background network requests or
//! handling browser shortcuts (spec 19, "Enforcement" item 3; spec 01, "Keyboard
//! routing" rule 4).

use scrim_core::logging::Logger;
use tauri::{Runtime, WebviewWindow, WebviewWindowBuilder};

/// WebView2 browser arguments. Setting them replaces wry's defaults, so wry's own
/// defaults (`msWebOOUI`, `msPdfOOUI`, `msSmartScreenProtection`) are repeated here.
/// SPEC-QUESTION Q-006: argument names not yet verified against a live WebView2 runtime.
#[cfg(windows)]
pub const WEBVIEW2_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Translate,SpareRendererForSitePerProcess \
--disable-background-networking --disable-component-update --disable-domain-reliability --no-pings";

pub fn configure_builder<'a, R: Runtime, M: tauri::Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    #[cfg(windows)]
    let builder = builder.additional_browser_args(WEBVIEW2_ARGS);
    builder
}

pub fn configure_webview<R: Runtime>(window: &WebviewWindow<R>, logger: &Logger) {
    let result = window.with_webview(|wv| {
        #[cfg(target_os = "linux")]
        {
            use webkit2gtk::{SettingsExt, WebViewExt};
            if let Some(s) = wv.inner().settings() {
                s.set_enable_dns_prefetching(false);
                s.set_enable_page_cache(false);
            }
        }
        #[cfg(windows)]
        {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2Settings3, ICoreWebView2Settings8,
            };
            use windows_core::Interface;
            unsafe {
                if let Ok(core) = wv.controller().CoreWebView2() {
                    if let Ok(settings) = core.Settings() {
                        if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
                            let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
                        }
                        if let Ok(s8) = settings.cast::<ICoreWebView2Settings8>() {
                            let _ = s8.SetIsReputationCheckingRequired(false);
                        }
                    }
                }
            }
        }
        let _ = wv;
    });
    if let Err(e) = result {
        logger.warn(&format!("cannot configure webview: {e}"));
    }
}
