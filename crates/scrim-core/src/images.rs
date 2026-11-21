//! Image insert policy (spec 06, 6.4): where pasted, dropped, and inserted images go and
//! how they are referenced from the document.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Policy {
    /// Reference the image where it is.
    None,
    /// Copy next to the document (`./`).
    Current,
    /// Copy into `assets/` next to the document (default).
    #[default]
    Assets,
    /// Copy into `<document-name>.assets/`.
    DocAssets,
    /// Copy into a user folder (`{{name}}`, `{{dir}}` placeholders).
    Custom,
    /// Run the upload command and insert the URLs it prints.
    Upload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageOptions {
    pub policy: Policy,
    pub custom_folder: String,
    /// Apply the policy to local image files too (default on).
    pub apply_to_local: bool,
    /// Use a relative path if possible (default on).
    pub relative: bool,
    /// Prefer `./` in relative paths (default off).
    pub prefer_dot_slash: bool,
    /// Encode spaces and other unsafe characters (default on).
    pub escape_url: bool,
    pub upload_command: String,
}

impl Default for ImageOptions {
    fn default() -> Self {
        Self {
            policy: Policy::Assets,
            custom_folder: String::new(),
            apply_to_local: true,
            relative: true,
            prefer_dot_slash: false,
            escape_url: true,
            upload_command: String::new(),
        }
    }
}

impl ImageOptions {
    /// From `settings.json` keys (spec 11, Image).
    pub fn from_settings(v: &serde_json::Map<String, serde_json::Value>) -> Self {
        let mut o = Self::default();
        if let Some(p) = v.get("imagePolicy").and_then(|p| serde_json::from_value::<Policy>(p.clone()).ok()) {
            o.policy = p;
        }
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
        let b = |k: &str, d: bool| v.get(k).and_then(|x| x.as_bool()).unwrap_or(d);
        o.custom_folder = s("imageCustomFolder").unwrap_or_default();
        o.upload_command = s("imageUploadCommand").unwrap_or_default();
        o.apply_to_local = b("imageApplyToLocal", true);
        o.relative = b("imageRelativePath", true);
        o.prefer_dot_slash = b("imagePreferDotSlash", false);
        o.escape_url = b("imageEscapeUrl", true);
        o
    }
}

/// The folder images go to for a saved document at `doc`, or None for "reference where
/// it is". `front_matter_folder` (key `image-folder`) overrides the policy folder.
pub fn target_folder(doc: &Path, opts: &ImageOptions, front_matter_folder: Option<&str>) -> Option<PathBuf> {
    let dir = doc.parent().unwrap_or(Path::new("."));
    let stem = doc.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    if let Some(f) = front_matter_folder.filter(|f| !f.trim().is_empty()) {
        return Some(join_rel(dir, f.trim()));
    }
    match opts.policy {
        Policy::None | Policy::Upload => None,
        Policy::Current => Some(dir.to_path_buf()),
        Policy::Assets => Some(dir.join("assets")),
        Policy::DocAssets => Some(dir.join(format!("{stem}.assets"))),
        Policy::Custom => {
            let f = opts.custom_folder.replace("{{name}}", &stem).replace("{{dir}}", &dir.to_string_lossy());
            if f.trim().is_empty() {
                Some(dir.join("assets"))
            } else {
                Some(join_rel(dir, f.trim()))
            }
        }
    }
}

fn join_rel(dir: &Path, f: &str) -> PathBuf {
    let p = Path::new(f);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        normalize(&dir.join(p))
    }
}

/// Lexically normalize `.` and `..` components.
pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// `image-YYYYMMDDHHMMSSmmm.<ext>` for image data without a name (6.4).
pub fn data_file_name(unix_millis: i64, ext: &str) -> String {
    let ts = crate::time::format_unix_millis(unix_millis);
    // "2026-11-21T04:19:28.997Z" → "20261121041928997"
    let digits: String = ts.chars().filter(|c| c.is_ascii_digit()).collect();
    format!("image-{}.{}", &digits[..17.min(digits.len())], ext.trim_start_matches('.'))
}

/// A free path for `name` in `folder`: `name`, `name-1`, `name-2`, …
pub fn free_path(folder: &Path, name: &str, same_content: impl Fn(&Path) -> bool) -> PathBuf {
    let p = folder.join(name);
    if !p.exists() || same_content(&p) {
        return p;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1.. {
        let p = folder.join(format!("{stem}-{n}{ext}"));
        if !p.exists() || same_content(&p) {
            return p;
        }
    }
    unreachable!()
}

/// How an image file is written in the document (6.4 options).
pub fn markdown_src(image: &Path, doc_dir: Option<&Path>, opts: &ImageOptions) -> String {
    let rel = doc_dir.filter(|_| opts.relative).and_then(|d| relative_path(&normalize(image), &normalize(d)));
    let mut s = match rel {
        Some(r) => {
            let r = r.to_string_lossy().replace('\\', "/");
            if opts.prefer_dot_slash && !r.starts_with("../") {
                format!("./{r}")
            } else {
                r
            }
        }
        None => image.to_string_lossy().replace('\\', "/"),
    };
    if opts.escape_url {
        s = escape_url(&s);
    }
    s
}

/// Percent-encode characters that break a Markdown link destination.
pub fn escape_url(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            ' ' => out.push_str("%20"),
            '(' => out.push_str("%28"),
            ')' => out.push_str("%29"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            _ => out.push(c),
        }
    }
    out
}

/// `path` relative to `base` (both absolute and normalized), or None on different roots.
pub fn relative_path(path: &Path, base: &Path) -> Option<PathBuf> {
    let p: Vec<_> = path.components().collect();
    let b: Vec<_> = base.components().collect();
    if p.first() != b.first() {
        return None;
    }
    let common = p.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let mut out = PathBuf::new();
    for _ in common..b.len() {
        out.push("..");
    }
    for c in &p[common..] {
        out.push(c.as_os_str());
    }
    Some(out)
}

pub fn is_image(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "avif" | "ico" | "tif" | "tiff")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(policy: Policy) -> ImageOptions {
        ImageOptions { policy, ..Default::default() }
    }

    #[test]
    fn folders() {
        let doc = Path::new("/x/notes/doc.md");
        assert_eq!(target_folder(doc, &opts(Policy::Assets), None), Some(PathBuf::from("/x/notes/assets")));
        assert_eq!(target_folder(doc, &opts(Policy::DocAssets), None), Some(PathBuf::from("/x/notes/doc.assets")));
        assert_eq!(target_folder(doc, &opts(Policy::Current), None), Some(PathBuf::from("/x/notes")));
        assert_eq!(target_folder(doc, &opts(Policy::None), None), None);
        let custom = ImageOptions { policy: Policy::Custom, custom_folder: "../img/{{name}}".into(), ..Default::default() };
        assert_eq!(target_folder(doc, &custom, None), Some(PathBuf::from("/x/img/doc")));
        assert_eq!(target_folder(doc, &opts(Policy::None), Some("pics")), Some(PathBuf::from("/x/notes/pics")));
    }

    #[test]
    fn sources() {
        let o = ImageOptions::default();
        assert_eq!(markdown_src(Path::new("/x/assets/a b.png"), Some(Path::new("/x")), &o), "assets/a%20b.png");
        assert_eq!(markdown_src(Path::new("/y/a.png"), Some(Path::new("/x/z")), &o), "../../y/a.png");
        let dot = ImageOptions { prefer_dot_slash: true, ..Default::default() };
        assert_eq!(markdown_src(Path::new("/x/a.png"), Some(Path::new("/x")), &dot), "./a.png");
        let abs = ImageOptions { relative: false, escape_url: false, ..Default::default() };
        assert_eq!(markdown_src(Path::new("/x/a b.png"), Some(Path::new("/x")), &abs), "/x/a b.png");
    }

    #[test]
    fn names() {
        assert_eq!(data_file_name(1_795_564_800_123, "png"), "image-20261125000000123.png");
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.png"), b"1").unwrap();
        std::fs::write(dir.path().join("a-1.png"), b"2").unwrap();
        assert_eq!(free_path(dir.path(), "a.png", |_| false), dir.path().join("a-2.png"));
        assert_eq!(free_path(dir.path(), "b.png", |_| false), dir.path().join("b.png"));
    }
}
