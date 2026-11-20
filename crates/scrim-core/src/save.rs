//! Atomic save (spec 01, "Persistence").
//!
//! 1. Resolve symlinks and write to the link's final target.
//! 2. Write a temp file in the target's directory and fsync it.
//! 3. Copy permissions (and on Linux ownership, when permitted, and extended attributes)
//!    from the original.
//! 4. Replace the original: `rename` on Unix, `ReplaceFileW` on Windows (keeps ACLs and
//!    attributes). On Unix the directory is fsynced afterwards.
//! 5. If the temp file cannot be created or the replace fails, fall back to writing in
//!    place.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Test-only hooks. Production code passes `SaveHooks::default()`.
#[derive(Default)]
pub struct SaveHooks<'a> {
    /// Called after each chunk is written to the temp file, with the temp path.
    pub after_temp_chunk: Option<&'a dyn Fn(&Path)>,
    /// Bytes per write call to the temp file (0 = write everything at once).
    pub chunk_size: usize,
    /// Force the atomic replace step to fail, exercising the in-place fallback.
    pub fail_replace: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveMethod {
    Atomic,
    InPlace,
}

#[derive(Debug)]
pub struct SaveOutcome {
    /// The file actually written (after resolving symlinks).
    pub target: PathBuf,
    pub method: SaveMethod,
    /// Why the atomic path was abandoned, when `method` is `InPlace`.
    pub fallback_reason: Option<String>,
}

/// Follow a chain of symlinks to the final path, even if that final path does not exist
/// yet (a dangling link is saved by creating its target).
pub fn resolve_symlinks(path: &Path) -> io::Result<PathBuf> {
    let mut cur = absolute(path)?;
    for _ in 0..40 {
        match fs::symlink_metadata(&cur) {
            Ok(m) if m.file_type().is_symlink() => {
                let link = fs::read_link(&cur)?;
                cur = if link.is_absolute() {
                    link
                } else {
                    cur.parent().unwrap_or(Path::new("/")).join(link)
                };
            }
            _ => return Ok(cur),
        }
    }
    Err(io::Error::other("too many levels of symbolic links"))
}

fn absolute(path: &Path) -> io::Result<PathBuf> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}

pub fn save(path: &Path, bytes: &[u8]) -> io::Result<SaveOutcome> {
    save_with_hooks(path, bytes, &SaveHooks::default())
}

pub fn save_with_hooks(path: &Path, bytes: &[u8], hooks: &SaveHooks) -> io::Result<SaveOutcome> {
    let target = resolve_symlinks(path)?;
    let dir = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
    let original = fs::metadata(&target).ok();
    if original.as_ref().is_some_and(|m| m.is_dir()) {
        return Err(io::Error::new(io::ErrorKind::IsADirectory, "target is a directory"));
    }

    let temp = temp_path(dir, &target);
    let atomic = (|| -> io::Result<()> {
        write_temp(&temp, bytes, hooks)?;
        if let Some(meta) = &original {
            copy_metadata(&target, &temp, meta);
        }
        if hooks.fail_replace {
            return Err(io::Error::other("injected replace failure"));
        }
        replace(&temp, &target, original.is_some())?;
        sync_dir(dir);
        Ok(())
    })();

    match atomic {
        Ok(()) => Ok(SaveOutcome { target, method: SaveMethod::Atomic, fallback_reason: None }),
        Err(e) => {
            let _ = fs::remove_file(&temp);
            write_in_place(&target, bytes)?;
            Ok(SaveOutcome {
                target,
                method: SaveMethod::InPlace,
                fallback_reason: Some(e.to_string()),
            })
        }
    }
}

fn temp_path(dir: &Path, target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    dir.join(format!(".{name}.scrim-save-{}-{nanos:08x}.tmp", std::process::id()))
}

fn write_temp(temp: &Path, bytes: &[u8], hooks: &SaveHooks) -> io::Result<()> {
    let mut f = OpenOptions::new().write(true).create_new(true).open(temp)?;
    let chunk = if hooks.chunk_size == 0 { bytes.len().max(1) } else { hooks.chunk_size };
    for part in bytes.chunks(chunk) {
        f.write_all(part)?;
        if let Some(cb) = hooks.after_temp_chunk {
            cb(temp);
        }
    }
    f.sync_all()
}

fn write_in_place(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut f = OpenOptions::new().write(true).create(true).truncate(true).open(target)?;
    f.write_all(bytes)?;
    f.sync_all()
}

#[cfg(unix)]
fn copy_metadata(original: &Path, temp: &Path, meta: &fs::Metadata) {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;
    let _ = fs::set_permissions(temp, meta.permissions());
    if let Ok(c) = std::ffi::CString::new(temp.as_os_str().as_bytes()) {
        // Fails with EPERM unless we are root or the owner already matches; ignore.
        unsafe {
            libc::chown(c.as_ptr(), meta.uid(), meta.gid());
        }
        // chown may clear setuid/setgid bits; reapply the mode.
        let _ = fs::set_permissions(temp, meta.permissions());
    }
    if let Ok(names) = xattr::list(original) {
        for name in names {
            if let Ok(Some(value)) = xattr::get(original, &name) {
                let _ = xattr::set(temp, &name, &value);
            }
        }
    }
}

#[cfg(windows)]
fn copy_metadata(_original: &Path, temp: &Path, meta: &fs::Metadata) {
    // ReplaceFileW carries ACLs and attributes over from the replaced file; the readonly
    // flag is the only permission bit std exposes.
    let _ = fs::set_permissions(temp, meta.permissions());
}

#[cfg(not(any(unix, windows)))]
fn copy_metadata(_original: &Path, temp: &Path, meta: &fs::Metadata) {
    let _ = fs::set_permissions(temp, meta.permissions());
}

#[cfg(not(windows))]
fn replace(temp: &Path, target: &Path, _exists: bool) -> io::Result<()> {
    fs::rename(temp, target)
}

#[cfg(windows)]
fn replace(temp: &Path, target: &Path, exists: bool) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        REPLACEFILE_IGNORE_MERGE_ERRORS,
    };
    let wide = |p: &Path| -> Vec<u16> { p.as_os_str().encode_wide().chain(Some(0)).collect() };
    let (t, s) = (wide(target), wide(temp));
    let ok = unsafe {
        if exists {
            ReplaceFileW(
                t.as_ptr(),
                s.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_IGNORE_MERGE_ERRORS,
                std::ptr::null(),
                std::ptr::null(),
            )
        } else {
            MoveFileExW(s.as_ptr(), t.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)
        }
    };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn leftovers(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".scrim-save-"))
            .collect()
    }

    #[test]
    fn creates_and_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        let out = save(&p, b"one").unwrap();
        assert_eq!(out.method, SaveMethod::Atomic);
        assert_eq!(fs::read(&p).unwrap(), b"one");
        save(&p, b"two\r\n").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"two\r\n");
        assert!(leftovers(dir.path()).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn keeps_permissions_and_follows_symlinks() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let real_dir = dir.path().join("real");
        fs::create_dir(&real_dir).unwrap();
        let real = real_dir.join("doc.md");
        fs::write(&real, b"old").unwrap();
        fs::set_permissions(&real, fs::Permissions::from_mode(0o640)).unwrap();
        let link = dir.path().join("link.md");
        symlink("real/doc.md", &link).unwrap();

        let out = save(&link, b"new").unwrap();
        assert_eq!(out.target, real);
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(&real).unwrap(), b"new");
        assert_eq!(fs::metadata(&real).unwrap().permissions().mode() & 0o777, 0o640);
    }

    #[cfg(unix)]
    #[test]
    fn xattrs_survive_when_supported() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.md");
        fs::write(&p, b"old").unwrap();
        if xattr::set(&p, "user.scrim-test", b"value").is_err() {
            eprintln!("filesystem has no user xattrs; skipping");
            return;
        }
        save(&p, b"new").unwrap();
        assert_eq!(xattr::get(&p, "user.scrim-test").unwrap().as_deref(), Some(&b"value"[..]));
    }

    #[test]
    fn dangling_symlink_creates_target() {
        #[cfg(unix)]
        {
            let dir = tempfile::tempdir().unwrap();
            let link = dir.path().join("l.md");
            std::os::unix::fs::symlink("target.md", &link).unwrap();
            save(&link, b"x").unwrap();
            assert_eq!(fs::read(dir.path().join("target.md")).unwrap(), b"x");
        }
    }

    #[test]
    fn falls_back_to_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        fs::write(&p, b"old").unwrap();
        let hooks = SaveHooks { fail_replace: true, ..Default::default() };
        let out = save_with_hooks(&p, b"new", &hooks).unwrap();
        assert_eq!(out.method, SaveMethod::InPlace);
        assert_eq!(fs::read(&p).unwrap(), b"new");
        assert!(leftovers(dir.path()).is_empty());
    }

    #[test]
    fn interrupted_temp_write_leaves_original() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        fs::write(&p, b"original").unwrap();
        let boom = |_: &Path| panic!("simulated crash mid-write");
        let hooks = SaveHooks { after_temp_chunk: Some(&boom), chunk_size: 2, ..Default::default() };
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            save_with_hooks(&p, b"replacement text", &hooks)
        }));
        assert!(r.is_err());
        assert_eq!(fs::read(&p).unwrap(), b"original");
    }
}
