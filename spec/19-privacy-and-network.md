# 19. Privacy and network policy

## Rule

The editor makes **no network requests of its own**. The only network traffic allowed
is for resources that the currently open document explicitly references and that the
user can see in its source:

- remote images (`![](https://…)`, `<img src="https://…">`),
- remote media and iframes inside HTML blocks (iframes only when enabled),
- remote CSS/fonts referenced by the active theme or user CSS,
- links the user explicitly opens (handed to the system browser, not fetched by us),
- pandoc, custom export commands, and the image upload command the user configures and
  runs (their own behavior is theirs).

## Explicitly forbidden

- Telemetry, analytics, crash reporting, usage pings, error reporting to any server.
- Update checks or auto-update (a later opt-in "Check for updates" that only runs when
  clicked may be added by the owner; not in v1).
- Downloading dictionaries, fonts, themes, language packs, or anything else.
- Fetching link titles/favicons/previews automatically.
- Loading any UI asset (fonts, icons, scripts) from a CDN. Everything ships in the app.

## Enforcement

1. **CSP is the primary enforcement** on both platforms (Tauri/wry has no general request
   interceptor for http(s) subresources on WebKitGTK). App-origin pages (UI,
   preferences) load only bundled resources. Remote loads are allowed only for document
   media and theme/user CSS as listed above. Where WebView2 offers request filtering
   (`WebResourceRequested`), use it as a second layer on Windows.
2. A Content-Security-Policy on the app pages: `default-src 'self' <app-protocol>:;
   img-src * data: blob: scrim-file:; media-src * data: blob: scrim-file:; style-src 'self'
   'unsafe-inline' <app-protocol>: scrim-file: https:; font-src 'self' data: scrim-file: https:;
   connect-src 'self' <ipc>:; frame-src <embed-protocol>:`. App pages never frame remote
   pages directly; iframes go through the `scrim-embed` wrapper below (Q-015). Note
   `connect-src` excludes
   `http(s)`: frontend code cannot `fetch()` the internet.
   **Iframe wrapper (`scrim-embed`, Q-015).** A Rust URI-scheme handler, same URL forms
   as `scrim-file` (Linux `scrim-embed://localhost/?src=<percent-encoded URL>`, Windows
   `http://scrim-embed.localhost/?src=…`; CSP source `scrim-embed:` or
   `http://scrim-embed.localhost`). The sanitizer rewrites every iframe in an HTML
   block to point at it, moving `width`, `height`, `title`, and `style` onto that outer
   frame. On each request the handler reads the current "Allow iframes" setting:
   - **on** and `src` is `https:`: a static page (no scripts) with its own CSP
     `default-src 'none'; style-src 'unsafe-inline'; frame-src https:`, containing one
     iframe at 100% width and height with the original `src`, sandboxed per 4.10
     (`allow-scripts` only for `iframeAllowlist` domains);
   - otherwise: a static placeholder showing "Iframe blocked" and the URL.
   When the setting changes, every open window re-renders its HTML blocks, so both
   directions take effect immediately with no window reload. Exports emit the original
   iframe (with the sandbox rules) and no wrapper.
3. **Webview background traffic off.** WebView2: `IsReputationCheckingRequired = false`
   (no SmartScreen lookups), and browser arguments
   `--disable-features=msSmartScreenProtection,Translate,SpareRendererForSitePerProcess`
   `--disable-background-networking --disable-component-update
   --disable-domain-reliability --no-pings` (verify the current WebView2 argument
   names during P0). WebKitGTK: no prefetch (`enable-dns-prefetching` off), no
   site-specific quirks updates; WebKitGTK makes no background requests by default.
   Scrim does not try to control the WebView2 runtime's own updater, which runs outside
   the app process tree.
4. The Rust side has no HTTP client dependency at all. CI checks `cargo tree` for
   `reqwest`, `hyper`, `ureq`, `isahc`, `curl` and fails if found (allowlist only for
   crates pulled in by Tauri itself and verified unused at runtime).
5. Logging: every CSP violation is reported through the `securitypolicyviolation` DOM
   event and logged (`app.log`) with its URL, plus anything blocked by the WebView2
   filter.

## Test

Acceptance test N-1 (`20-acceptance-tests.md`) runs the full test suite while logging
every outbound connection made by Scrim's process tree (Linux: network namespace or
per-process firewall rule; Windows: per-process firewall/ETW trace of `scrim.exe` and its
WebView2 child processes). The only allowed destination is the local test server.
