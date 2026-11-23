//! Time the block tree of a file (Q-026, Q-027 measurements):
//! `cargo run --release -p scrim-core --example bench_blocks FILE`.
use std::time::Instant;
fn main() {
    let path = std::env::args().nth(1).expect("a Markdown file");
    let src = std::fs::read_to_string(path).expect("readable");
    for _ in 0..5 {
        let t = Instant::now();
        let enc = scrim_core::blocks::encoded_tree(&src);
        println!(
            "{} bytes: encoded tree in {:?} ({} bytes)",
            src.len(),
            t.elapsed(),
            enc.len()
        );
    }
    println!("phases: {}", scrim_core::blocks::profile(&src));
}
