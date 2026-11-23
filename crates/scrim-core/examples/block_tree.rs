//! Parity helper (QA-LOG Q-026): reads a JSON array of Markdown documents on stdin and
//! prints the JSON array of their Rust block trees; with `--encoded`, the compact
//! encodings instead, as base64 strings. Used by `src/md/rustparity.test.ts`.
use std::io::Read;

fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
            | u32::from(*c.get(2).unwrap_or(&0));
        for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            out.push(if i <= c.len() {
                A[(n >> shift) as usize & 63] as char
            } else {
                '='
            });
        }
    }
    out
}

fn main() {
    let encoded = std::env::args().any(|a| a == "--encoded");
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).expect("stdin");
    let docs: Vec<String> = serde_json::from_str(&input).expect("a JSON array of strings");
    let trees: Vec<serde_json::Value> = docs
        .iter()
        .map(|d| {
            if encoded {
                serde_json::Value::String(base64(&scrim_core::blocks::encoded_tree(d)))
            } else {
                scrim_core::blocks::block_tree(d)
            }
        })
        .collect();
    println!("{}", serde_json::to_string(&trees).expect("json"));
}
