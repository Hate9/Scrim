//! Time the block tree of a file (Q-026 measurements): `cargo run --release -p scrim-core --example bench_blocks FILE`.
use std::time::Instant;
fn main() {
    let path = std::env::args().nth(1).expect("a Markdown file");
    let src = std::fs::read_to_string(path).expect("readable");
    for _ in 0..3 {
        let t = Instant::now();
        let tree = scrim_core::blocks::block_tree(&src);
        let n = tree["children"].as_array().map_or(0, |a| a.len());
        println!("{} bytes: {} top-level blocks in {:?}", src.len(), n, t.elapsed());
    }
}
