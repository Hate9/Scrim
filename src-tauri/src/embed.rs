//! The `scrim-embed` protocol (spec 19, "Iframe wrapper"; QA-LOG Q-015). HTML blocks
//! never frame remote pages directly: the sanitizer points every iframe here. On each
//! request this handler reads the current "Allow iframes" setting and serves either a
//! static, script-free page holding the real (sandboxed) iframe, or a placeholder.

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, UriSchemeContext, UriSchemeResponder};

use crate::state::AppState;

pub const SCHEME: &str = "scrim-embed";

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn query_src(query: Option<&str>) -> Option<String> {
    query?.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == "src").then(|| percent_encoding::percent_decode_str(&v.replace('+', " ")).decode_utf8_lossy().into_owned())
    })
}

/// Host of an https URL, lowercased.
fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit('@').next()?.split(':').next()?;
    Some(host.to_ascii_lowercase())
}

/// The page served for an iframe source, given the setting and the allowlist.
pub fn page(src: &str, allow: bool, allowlist: &[String]) -> (String, String) {
    let blocked = |why: &str| {
        (
            "default-src 'none'; style-src 'unsafe-inline'".to_string(),
            format!(
                "<!doctype html><meta charset=utf-8><style>body{{margin:0;font:13px system-ui,sans-serif;color:#888;\
                 display:flex;align-items:center;justify-content:center;height:100vh;border:1px dashed #bbb;box-sizing:border-box;\
                 text-align:center;padding:8px;overflow:hidden}}</style><div>{why}<br><small>{}</small></div>",
                escape_html(src)
            ),
        )
    };
    if !allow {
        return blocked("Iframe blocked");
    }
    let Some(host) = host_of(src) else { return blocked("Iframe blocked (only https sources)") };
    let scripts = allowlist.iter().any(|d| {
        let d = d.trim().trim_start_matches('.').to_ascii_lowercase();
        !d.is_empty() && (host == d || host.ends_with(&format!(".{d}")))
    });
    let sandbox = if scripts { "allow-scripts allow-same-origin allow-popups" } else { "" };
    (
        "default-src 'none'; style-src 'unsafe-inline'; frame-src https:".to_string(),
        format!(
            "<!doctype html><meta charset=utf-8><style>html,body{{margin:0;height:100%;overflow:hidden}}\
             iframe{{border:0;width:100%;height:100%}}</style><iframe src=\"{}\" sandbox=\"{sandbox}\" referrerpolicy=\"no-referrer\"></iframe>",
            escape_html(src)
        ),
    )
}

pub fn handle<R: tauri::Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let state = ctx.app_handle().state::<AppState>();
    let src = query_src(request.uri().query()).unwrap_or_default();
    let (allow, allowlist) = {
        let settings = state.settings();
        let allow = settings.values.get("allowIframes").and_then(|v| v.as_bool()).unwrap_or(false);
        let list = settings
            .values
            .get("iframeAllowlist")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect::<Vec<_>>())
            .unwrap_or_default();
        (allow, list)
    };
    if !allow {
        state.logger.info("scrim-embed: iframe blocked by setting");
    }
    let (csp, body) = page(&src, allow, &allowlist);
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header("Content-Security-Policy", csp)
        .header(header::CACHE_CONTROL, "no-store")
        .body(body.into_bytes())
        .unwrap_or_else(|_| Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR).body(Vec::new()).unwrap());
    responder.respond(response);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages() {
        let (_, off) = page("https://a.b/x", false, &[]);
        assert!(off.contains("Iframe blocked") && off.contains("https://a.b/x"));
        let (csp, on) = page("https://www.youtube.com/embed/1", true, &["youtube.com".into()]);
        assert!(csp.contains("frame-src https:"));
        assert!(on.contains("sandbox=\"allow-scripts"));
        let (_, plain) = page("https://evil.example/", true, &["youtube.com".into()]);
        assert!(plain.contains("sandbox=\"\""));
        let (_, http) = page("http://a.b/", true, &[]);
        assert!(http.contains("only https"));
        assert!(!page("https://a.b/\"><script>x</script>", true, &[]).1.contains("<script>"));
        assert_eq!(query_src(Some("src=https%3A%2F%2Fa.b%2Fx%3Fy%3D1")).as_deref(), Some("https://a.b/x?y=1"));
    }
}
