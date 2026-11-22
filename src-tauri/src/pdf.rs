//! PDF export and print (spec 09, 9.3).
//!
//! The export page is written to a temporary file and loaded in a hidden window through
//! `scrim-file`; the platform's print-to-PDF runs on that webview (WebKitGTK print
//! operation on Linux, WebView2 `PrintToPdf` on Windows). The webview's own headers and
//! footers are off.
//!
//! Header and footer: neither webview supports templates with page numbers, so they are
//! stamped onto the finished PDF. Scrim lays them out as a second document with one page
//! per page of the first (text in the bundled Noto Sans, other scripts falling back to
//! system fonts), prints that the same way, and overlays its pages onto the export's
//! pages with `lopdf` (each stamp page becomes a form XObject drawn after the page's own
//! content). The text stays text, with its fonts subset and embedded by the PDF writer.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use base64::Engine;
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use serde::Deserialize;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::export::scrim_file_url;
use crate::state::AppState;

/// Bundled font for header and footer text (SIL Open Font License, `fonts/OFL.txt`).
/// Scripts it lacks (CJK, symbols) fall back to system fonts; no CJK font is bundled
/// (QA-LOG Q-024).
const NOTO_SANS: &[u8] = include_bytes!("../fonts/NotoSans-Regular.ttf");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSpec {
    /// mm, after orientation
    pub width: f64,
    pub height: f64,
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
    /// left, center, right templates
    pub header: [String; 3],
    pub footer: [String; 3],
}

impl PageSpec {
    fn without_margins(&self) -> Self {
        Self { margin_top: 0.0, margin_bottom: 0.0, margin_left: 0.0, margin_right: 0.0, ..self.clone() }
    }
    fn has_stamp(&self) -> bool {
        self.header.iter().chain(self.footer.iter()).any(|t| !t.trim().is_empty())
    }
}

static SEQ: AtomicU64 = AtomicU64::new(1);

fn tmp_dir(state: &AppState) -> Result<PathBuf, String> {
    let d = state.config_dir.join("tmp-export");
    std::fs::create_dir_all(&d).map_err(|e| format!("cannot create {}: {e}", d.display()))?;
    Ok(std::fs::canonicalize(&d).unwrap_or(d))
}

/// Load `html` (a file in the temporary folder) in a hidden window and print it to `out`.
async fn print_file(app: &AppHandle, html: &Path, out: &Path, page: &PageSpec) -> Result<(), String> {
    let url = scrim_file_url(html);
    let label = format!("export-{}", SEQ.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let tx = std::sync::Mutex::new(Some(tx));
    let out_buf = out.to_path_buf();
    let spec = page.clone();
    let started = std::sync::atomic::AtomicBool::new(false);
    let initial = url.clone();
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url.parse().map_err(|e| format!("{e}"))?))
        .visible(false)
        .inner_size(900.0, 1200.0)
        // Nothing but the export page loads in this window.
        .on_navigation(move |u| u.as_str() == initial)
        .on_page_load(move |w, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished || started.swap(true, Ordering::SeqCst) {
                return;
            }
            let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) else { return };
            let out = out_buf.clone();
            let spec = spec.clone();
            // Web fonts and late layout: give them a moment after the load event.
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(700));
                let tx2 = tx.clone();
                if let Err(e) = w.with_webview(move |pw| platform::print(pw, &out, &spec, tx2)) {
                    let _ = tx.send(Err(e.to_string()));
                }
            });
        })
        .build()
        .map_err(|e| format!("cannot open the print window: {e}"))?;
    let res = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(120)).unwrap_or_else(|_| Err("printing timed out".into())))
        .await
        .map_err(|e| e.to_string())?;
    let _ = window.destroy();
    res?;
    if !out.exists() {
        return Err("the PDF was not written".into());
    }
    Ok(())
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Fill a header/footer template.
pub fn fill(template: &str, title: &str, page: usize, pages: usize, date: &str) -> String {
    template.replace("{{title}}", title).replace("{{page}}", &page.to_string()).replace("{{pages}}", &pages.to_string()).replace("{{date}}", date)
}

/// The stamp document: one page per page of the export, header and footer text placed
/// inside its top and bottom margins, 9 pt.
fn stamp_html(page: &PageSpec, pages: usize, title: &str, date: &str, font_url: &str) -> String {
    let mut body = String::new();
    for n in 1..=pages {
        let slots = |t: &[String; 3]| -> String {
            t.iter()
                .zip(["l", "c", "r"])
                .map(|(s, c)| format!("<span class=\"{c}\">{}</span>", escape(&fill(s, title, n, pages, date))))
                .collect()
        };
        body.push_str(&format!(
            "<div class=\"p\"><div class=\"row h\">{}</div><div class=\"row f\">{}</div></div>",
            slots(&page.header),
            slots(&page.footer)
        ));
    }
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: "Scrim Noto Sans"; src: url("{font_url}"); font-display: block; }}
@page {{ size: {w}mm {h}mm; margin: 0; }}
html, body {{ margin: 0; padding: 0; background: transparent; }}
.p {{ position: relative; width: {w}mm; height: {ph}mm; overflow: hidden; break-after: page; }}
.p:last-child {{ break-after: auto; }}
.row {{ position: absolute; left: {ml}mm; right: {mr}mm; display: flex; font: 9pt/1 "Scrim Noto Sans", sans-serif; color: #444; white-space: pre; }}
.row span {{ flex: 1 1 0; overflow: hidden; }}
.row .c {{ text-align: center; }} .row .r {{ text-align: right; }}
.h {{ top: {ht}mm; }} .f {{ bottom: {fb}mm; }}
</style></head><body>{body}</body></html>"#,
        w = page.width,
        h = page.height,
        ph = page.height - 0.3,
        ml = page.margin_left,
        mr = page.margin_right,
        // centered in the margins (9 pt ≈ 3.2 mm)
        ht = (page.margin_top / 2.0 - 1.6).max(0.0),
        fb = (page.margin_bottom / 2.0 - 1.6).max(0.0),
    )
}

fn resolve(doc: &Document, obj: &Object) -> Option<Object> {
    match obj {
        Object::Reference(id) => doc.get_object(*id).ok().cloned(),
        o => Some(o.clone()),
    }
}

/// An inheritable page attribute (MediaBox, Resources).
fn page_attr(doc: &Document, page: ObjectId, key: &[u8]) -> Option<Object> {
    let mut id = page;
    for _ in 0..32 {
        let dict = doc.get_dictionary(id).ok()?;
        if let Ok(v) = dict.get(key) {
            return Some(v.clone());
        }
        id = dict.get(b"Parent").and_then(Object::as_reference).ok()?;
    }
    None
}

/// Draw page i of `stamp` over page i of `main`.
pub fn overlay(main: &mut Document, mut stamp: Document) -> Result<(), String> {
    stamp.renumber_objects_with(main.max_id + 1);
    main.max_id = stamp.max_id.max(main.max_id);
    let mut forms = Vec::new();
    for (_, pid) in stamp.get_pages() {
        let content = stamp.get_page_content(pid).map_err(|e| e.to_string())?;
        let bbox = page_attr(&stamp, pid, b"MediaBox").unwrap_or_else(|| vec![0.into(), 0.into(), 612.into(), 792.into()].into());
        let res = page_attr(&stamp, pid, b"Resources").unwrap_or_else(|| Object::Dictionary(dictionary! {}));
        forms.push((content, bbox, res));
    }
    for (id, obj) in std::mem::take(&mut stamp.objects) {
        main.objects.insert(id, obj);
    }
    let pages: Vec<ObjectId> = main.get_pages().into_values().collect();
    for (page_id, (content, bbox, res)) in pages.into_iter().zip(forms) {
        let form = Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Form", "BBox" => bbox, "Resources" => res },
            content,
        );
        let form_id = main.add_object(form);
        // Resources: a page-level dictionary of its own (inherited or referenced ones are
        // copied), with the stamp added under XObject.
        let mut resources = page_attr(main, page_id, b"Resources").and_then(|r| resolve(main, &r)).and_then(|r| r.as_dict().ok().cloned()).unwrap_or_default();
        let mut xobjects = resources.get(b"XObject").ok().and_then(|x| resolve(main, x)).and_then(|x| x.as_dict().ok().cloned()).unwrap_or_default();
        xobjects.set("ScrimStamp", Object::Reference(form_id));
        resources.set("XObject", Object::Dictionary(xobjects));
        // Contents: the page's own content between q/Q, then the stamp.
        let before = main.add_object(Stream::new(dictionary! {}, b"q\n".to_vec()));
        let after = main.add_object(Stream::new(dictionary! {}, b"\nQ\nq /ScrimStamp Do Q\n".to_vec()));
        let page = main.get_object_mut(page_id).and_then(Object::as_dict_mut).map_err(|e| e.to_string())?;
        let mut contents = vec![Object::Reference(before)];
        match page.get(b"Contents") {
            Ok(Object::Array(a)) => contents.extend(a.iter().cloned()),
            Ok(o) => contents.push(o.clone()),
            Err(_) => {}
        }
        contents.push(Object::Reference(after));
        page.set("Contents", Object::Array(contents));
        page.set("Resources", Object::Dictionary(resources));
    }
    main.prune_objects();
    Ok(())
}

/// Print the export page to a PDF at `out`, then stamp header and footer.
async fn make_pdf(app: &AppHandle, html: &str, out: &Path, page: &PageSpec, title: &str, date: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let dir = tmp_dir(&state)?;
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let html_path = dir.join(format!("export-{n}.html"));
    let pdf_path = dir.join(format!("export-{n}.pdf"));
    let cleanup = [html_path.clone(), pdf_path.clone(), dir.join(format!("stamp-{n}.html")), dir.join(format!("stamp-{n}.pdf"))];
    let result = async {
        std::fs::write(&html_path, html).map_err(|e| e.to_string())?;
        print_file(app, &html_path, &pdf_path, page).await?;
        let bytes = if page.has_stamp() {
            let mut main = Document::load(&pdf_path).map_err(|e| format!("cannot read the printed PDF: {e}"))?;
            let pages = main.get_pages().len();
            // Embedded, so the face is there before the page prints (a font file loaded on
            // first use could arrive after printing started).
            let font = format!("data:font/ttf;base64,{}", base64::engine::general_purpose::STANDARD.encode(NOTO_SANS));
            let stamp_html_path = dir.join(format!("stamp-{n}.html"));
            let stamp_pdf_path = dir.join(format!("stamp-{n}.pdf"));
            std::fs::write(&stamp_html_path, stamp_html(page, pages, title, date, &font)).map_err(|e| e.to_string())?;
            print_file(app, &stamp_html_path, &stamp_pdf_path, &page.without_margins()).await?;
            let stamp = Document::load(&stamp_pdf_path).map_err(|e| format!("cannot read the header/footer PDF: {e}"))?;
            overlay(&mut main, stamp)?;
            let mut buf = Vec::new();
            main.save_to(&mut buf).map_err(|e| e.to_string())?;
            buf
        } else {
            std::fs::read(&pdf_path).map_err(|e| e.to_string())?
        };
        scrim_core::save::save(out, &bytes).map_err(|e| format!("Cannot write {}: {e}", out.display()))?;
        Ok::<(), String>(())
    }
    .await;
    for f in cleanup {
        let _ = std::fs::remove_file(f);
    }
    result
}

#[tauri::command]
pub async fn export_pdf(app: AppHandle, html: String, out: PathBuf, page: PageSpec, title: String, date: String) -> Result<(), String> {
    make_pdf(&app, &html, &out, &page, &title, &date).await?;
    app.state::<AppState>().logger.info(&format!("exported PDF {}", out.display()));
    Ok(())
}

/// File → Print: the native print dialog for the export page.
#[tauri::command]
pub async fn export_print(app: AppHandle, state: State<'_, AppState>, html: String, page: PageSpec) -> Result<(), String> {
    let dir = tmp_dir(&state)?;
    let path = dir.join(format!("print-{}.html", SEQ.fetch_add(1, Ordering::Relaxed)));
    std::fs::write(&path, html).map_err(|e| e.to_string())?;
    let url = scrim_file_url(&path);
    let label = format!("print-{}", SEQ.fetch_add(1, Ordering::Relaxed));
    let initial = url.clone();
    let spec = page.clone();
    let started = std::sync::atomic::AtomicBool::new(false);
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url.parse().map_err(|e| format!("{e}"))?))
        .visible(false)
        .inner_size(900.0, 1200.0)
        .on_navigation(move |u| u.as_str() == initial)
        .on_page_load(move |w, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished || started.swap(true, Ordering::SeqCst) {
                return;
            }
            let spec = spec.clone();
            let p = path.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(500));
                let w2 = w.clone();
                let _ = w.with_webview(move |pw| platform::print_dialog(pw, &spec, move || {
                    let _ = w2.destroy();
                    let _ = std::fs::remove_file(&p);
                }));
            });
        })
        .build()
        .map_err(|e| format!("cannot open the print window: {e}"))?;
    Ok(())
}

#[cfg(target_os = "linux")]
mod platform {
    use super::PageSpec;
    use std::path::Path;
    use std::sync::mpsc::Sender;
    use std::sync::{Arc, Mutex};
    use webkit2gtk::PrintOperationExt;

    fn setup(spec: &PageSpec) -> gtk::PageSetup {
        let setup = gtk::PageSetup::new();
        let paper = gtk::PaperSize::new_custom("scrim", "Scrim", spec.width, spec.height, gtk::Unit::Mm);
        setup.set_paper_size(&paper);
        setup.set_orientation(gtk::PageOrientation::Portrait);
        setup.set_top_margin(spec.margin_top, gtk::Unit::Mm);
        setup.set_bottom_margin(spec.margin_bottom, gtk::Unit::Mm);
        setup.set_left_margin(spec.margin_left, gtk::Unit::Mm);
        setup.set_right_margin(spec.margin_right, gtk::Unit::Mm);
        setup
    }

    pub fn print(pw: tauri::webview::PlatformWebview, out: &Path, spec: &PageSpec, done: Sender<Result<(), String>>) {
        use webkit2gtk::WebViewExt;
        // No base page color: what the page does not paint stays transparent, so a header
        // and footer page can be laid over the export's pages.
        pw.inner().set_background_color(&gtk::gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));
        let settings = gtk::PrintSettings::new();
        settings.set_printer("Print to File");
        settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
        settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(&crate::export::file_url(out)));
        let op = webkit2gtk::PrintOperation::new(&pw.inner());
        op.set_print_settings(&settings);
        op.set_page_setup(&setup(spec));
        let done = Arc::new(Mutex::new(Some(done)));
        let d1 = done.clone();
        op.connect_failed(move |_, err| {
            if let Some(tx) = d1.lock().ok().and_then(|mut t| t.take()) {
                let _ = tx.send(Err(format!("printing failed: {err}")));
            }
        });
        op.connect_finished(move |_| {
            if let Some(tx) = done.lock().ok().and_then(|mut t| t.take()) {
                let _ = tx.send(Ok(()));
            }
        });
        op.print();
    }

    pub fn print_dialog(pw: tauri::webview::PlatformWebview, spec: &PageSpec, finished: impl Fn() + 'static) {
        let op = webkit2gtk::PrintOperation::new(&pw.inner());
        op.set_page_setup(&setup(spec));
        op.connect_finished(move |_| finished());
        let _ = op.run_dialog(None::<&gtk::Window>);
    }
}

#[cfg(windows)]
mod platform {
    use super::PageSpec;
    use std::path::Path;
    use std::sync::mpsc::Sender;

    pub fn print(pw: tauri::webview::PlatformWebview, out: &Path, spec: &PageSpec, done: Sender<Result<(), String>>) {
        if let Err(e) = crate::pdf_windows::print_to_pdf(pw, out, spec, done.clone()) {
            let _ = done.send(Err(e));
        }
    }

    pub fn print_dialog(pw: tauri::webview::PlatformWebview, _spec: &PageSpec, finished: impl Fn() + 'static) {
        crate::pdf_windows::print_dialog(pw);
        finished();
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod platform {
    use super::PageSpec;
    use std::path::Path;
    use std::sync::mpsc::Sender;
    pub fn print(_pw: tauri::webview::PlatformWebview, _out: &Path, _spec: &PageSpec, done: Sender<Result<(), String>>) {
        let _ = done.send(Err("PDF export is not available on this platform".into()));
    }
    pub fn print_dialog(_pw: tauri::webview::PlatformWebview, _spec: &PageSpec, finished: impl Fn() + 'static) {
        finished();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn templates() {
        assert_eq!(fill("{{page}} / {{pages}}", "T", 2, 3, "d"), "2 / 3");
        assert_eq!(fill("{{title}} – {{date}}", "日本語 ✓", 1, 1, "2026-11-22"), "日本語 ✓ – 2026-11-22");
    }

    #[test]
    fn stamp_page_count_and_escaping() {
        let spec = PageSpec {
            width: 210.0,
            height: 297.0,
            margin_top: 18.0,
            margin_bottom: 18.0,
            margin_left: 16.0,
            margin_right: 16.0,
            header: ["".into(), "{{title}}".into(), "".into()],
            footer: ["".into(), "{{page}} / {{pages}}".into(), "".into()],
        };
        let html = stamp_html(&spec, 3, "<a&b>", "d", "scrim-file://localhost/f.ttf");
        assert_eq!(html.matches("class=\"p\"").count(), 3);
        assert!(html.contains("&lt;a&amp;b&gt;"));
        assert!(html.contains(">3 / 3<"));
        assert!(spec.has_stamp());
    }
}
