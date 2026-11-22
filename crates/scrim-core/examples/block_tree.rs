//! Parity helper (QA-LOG Q-026): reads a JSON array of Markdown documents on stdin and
//! prints the JSON array of their Rust block trees. Used by `src/md/rustparity.test.ts`.
use std::io::Read;

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).expect("stdin");
    let docs: Vec<String> = serde_json::from_str(&input).expect("a JSON array of strings");
    let trees: Vec<serde_json::Value> = docs.iter().map(|d| scrim_core::blocks::block_tree(d)).collect();
    println!("{}", serde_json::to_string(&trees).expect("json"));
}
