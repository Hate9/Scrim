//! The `scrim-file` URI scheme: serves local files to the webview (spec 01, "Local files
//! in the webview").
//!
//! URL forms (built by the frontend only through `convertFileSrc(path, "scrim-file")`):
//! Linux `scrim-file://localhost/<percent-encoded absolute path>`, Windows
//! `http://scrim-file.localhost/<percent-encoded absolute path>`.
//!
//! Only paths in scope are served; everything else gets 403 and a log line. P0 scope is
//! the theme and recovery folders plus whatever `AppState::file_scope` has been given.
//! Document references (scope a) and the sidebar folder (scope b) are added in P1/P3,
//! and the theme CSS selector rewrite (`themes::is_theme_css`) in P4.

use std::path::{Path, PathBuf};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, UriSchemeContext, UriSchemeResponder};

use crate::state::AppState;

pub const SCHEME: &str = "scrim-file";

pub fn handle<R: tauri::Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let response = serve(&state, request.uri().path());
        responder.respond(response);
    });
}

/// Decode the request path into an absolute filesystem path.
pub fn path_from_uri_path(uri_path: &str) -> Option<PathBuf> {
    let trimmed = uri_path.strip_prefix('/').unwrap_or(uri_path);
    let decoded = percent_encoding::percent_decode_str(trimmed).decode_utf8().ok()?;
    let p = PathBuf::from(decoded.as_ref());
    if p.is_absolute() {
        return Some(p);
    }
    // `convertFileSrc` encodes the leading `/` of a Unix path, so `trimmed` normally
    // starts with `%2F`; if a client did not encode it, restore it.
    let with_root = PathBuf::from(format!("/{decoded}"));
    (cfg!(unix) && with_root.is_absolute()).then_some(with_root)
}

fn serve(state: &AppState, uri_path: &str) -> Response<Vec<u8>> {
    let Some(path) = path_from_uri_path(uri_path) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let resolved = match std::fs::canonicalize(&path) {
        Ok(p) => p,
        Err(_) => return status(StatusCode::NOT_FOUND),
    };
    if !state.scope().allows(&resolved) {
        state.logger.warn(&format!("{SCHEME}: 403 for {}", path.display()));
        return status(StatusCode::FORBIDDEN);
    }
    match std::fs::read(&resolved) {
        Ok(bytes) if crate::themes::is_theme_css(state, &resolved) => {
            // Theme and user CSS: the compatibility selector rewrite (10.3).
            let css = scrim_core::theme_css::rewrite(&String::from_utf8_lossy(&bytes));
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/css; charset=utf-8")
                .header(header::CACHE_CONTROL, "no-cache")
                .body(css.into_bytes())
                .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
        }
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime_for(&resolved))
            .header(header::CACHE_CONTROL, "no-cache")
            .body(bytes)
            .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR)),
        Err(e) => {
            state.logger.warn(&format!("{SCHEME}: cannot read {}: {e}", resolved.display()));
            status(StatusCode::NOT_FOUND)
        }
    }
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(code).body(Vec::new()).expect("static response")
}

pub fn mime_for(path: &Path) -> &'static str {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "ogg" | "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "pdf" => "application/pdf",
        "md" | "markdown" | "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_paths() {
        #[cfg(unix)]
        {
            assert_eq!(path_from_uri_path("/%2Fhome%2Fa%20b%2Fx.png"), Some(PathBuf::from("/home/a b/x.png")));
            assert_eq!(path_from_uri_path("/home/x.png"), Some(PathBuf::from("/home/x.png")));
        }
        #[cfg(windows)]
        assert_eq!(path_from_uri_path("/C%3A%5Cdocs%5Cx.png"), Some(PathBuf::from(r"C:\docs\x.png")));
    }
}
