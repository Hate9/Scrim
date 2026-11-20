//! Acceptance test S-2: kill -9 during save never leaves an empty or partial file.
//!
//! The test re-runs this test binary as a child process (`child_save` below), which saves
//! a large file slowly through the fault-injection hook. The parent SIGKILLs the child at
//! several points and checks that the file is always either the complete old content or
//! the complete new content.

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use scrim_core::save::{save_with_hooks, SaveHooks};

const CHILD_ENV: &str = "SCRIM_S2_CHILD_TARGET";
const SIZE: usize = 8 * 1024 * 1024;

fn content(fill: u8) -> Vec<u8> {
    let mut v = vec![fill; SIZE];
    for i in (0..SIZE).step_by(80) {
        v[i] = b'\n';
    }
    v
}

/// Child side. Ignored so it only runs when the parent asks for it explicitly.
#[test]
#[ignore]
fn child_save() {
    let Some(target) = std::env::var_os(CHILD_ENV) else { return };
    let new = content(b'n');
    let slow = |_: &Path| std::thread::sleep(Duration::from_millis(2));
    let hooks = SaveHooks { after_temp_chunk: Some(&slow), chunk_size: 64 * 1024, ..Default::default() };
    save_with_hooks(Path::new(&target), &new, &hooks).unwrap();
}

fn spawn_child(target: &Path) -> std::process::Child {
    Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "child_save", "--ignored", "--nocapture"])
        .env(CHILD_ENV, target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

fn check(target: &PathBuf, old: &[u8], new: &[u8]) -> &'static str {
    let got = std::fs::read(target).unwrap();
    if got == old {
        "old"
    } else if got == new {
        "new"
    } else {
        panic!("partial file after kill: {} bytes", got.len());
    }
}

#[test]
fn kill_dash_nine_during_save() {
    let old = content(b'o');
    let new = content(b'n');
    let mut seen_old = false;
    let mut seen_new = false;
    // The full slow save takes ~128 chunks * 2 ms ≈ 0.3 s plus process start.
    for delay_ms in [0u64, 30, 80, 150, 250, 400, 2000] {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("big.md");
        std::fs::write(&target, &old).unwrap();
        let mut child = spawn_child(&target);
        let start = Instant::now();
        if delay_ms == 2000 {
            child.wait().unwrap();
        } else {
            std::thread::sleep(Duration::from_millis(delay_ms));
            child.kill().unwrap(); // SIGKILL
            child.wait().unwrap();
        }
        match check(&target, &old, &new) {
            "old" => seen_old = true,
            _ => seen_new = true,
        }
        eprintln!("kill after {delay_ms} ms ({:?}): ok", start.elapsed());
    }
    assert!(seen_old, "never interrupted mid-save; test timing is off");
    assert!(seen_new, "save never completed");
}
