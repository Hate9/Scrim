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
   connect-src 'self' <ipc>:; frame-src https:`. When "Allow iframes" is off, each editor
   page adds a second, stricter policy at startup (`<meta http-equiv=
   "Content-Security-Policy" content="frame-src 'none'">`), on top of the sanitizer.
   Turning the setting off adds that meta tag to open windows immediately; turning it
   on applies to windows opened afterwards, since a policy cannot be loosened in place
   (Q-015). Note `connect-src` excludes
   `http(s)`: frontend code cannot `fetch()` the internet.
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
