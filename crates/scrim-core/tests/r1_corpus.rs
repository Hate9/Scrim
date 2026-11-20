//! R-1, file-layer form (runs from P0): every corpus file decodes and re-encodes to the
//! identical bytes, and the detected encoding is the expected one. This is R-1's P0 form
//! (QA-LOG Q-002); the parse/serialize form is in the frontend tests from P1.

use std::path::PathBuf;

use scrim_core::encoding::{decode, encode};

fn corpus_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/corpus")
}

fn assert_roundtrip(name: &str, bytes: &[u8]) {
    let d = decode(bytes);
    assert!(!d.malformed, "{name}: malformed decode as {}", d.encoding.name);
    let back = encode(&d.text, &d.encoding).unwrap_or_else(|e| panic!("{name}: {e}"));
    assert!(back == bytes, "{name}: round trip differs ({})", d.encoding.name);
}

#[test]
fn corpus_files_roundtrip() {
    let mut n = 0;
    for entry in std::fs::read_dir(corpus_dir()).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let bytes = std::fs::read(&path).unwrap();
        assert_roundtrip(&path.display().to_string(), &bytes);
        n += 1;
    }
    assert!(n >= 20, "corpus too small: {n}");
}

#[test]
fn expected_encodings() {
    let cases = [
        ("features.md", "UTF-8", false),
        ("bom-utf8.md", "UTF-8", true),
        ("latin1.md", "ISO-8859-1", false),
        ("latin1-crlf.md", "ISO-8859-1", false),
        ("windows-1252.md", "windows-1252", false),
        ("utf16le-bom.md", "UTF-16LE", true),
        ("utf16be-bom.md", "UTF-16BE", true),
        ("nul-and-controls.md", "UTF-8", false),
    ];
    for (name, enc, bom) in cases {
        let d = decode(&std::fs::read(corpus_dir().join(name)).unwrap());
        assert_eq!((d.encoding.name.as_str(), d.encoding.bom), (enc, bom), "{name}");
    }
}

#[test]
fn spec_examples_roundtrip_lf_and_crlf() {
    let json = std::fs::read_to_string(corpus_dir().join("spec-examples.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    let examples = v["examples"].as_array().unwrap();
    assert!(examples.len() > 650);
    for ex in examples {
        let md = ex["markdown"].as_str().unwrap();
        let name = format!("{} #{}", ex["source"].as_str().unwrap(), ex["number"]);
        assert_roundtrip(&name, md.as_bytes());
        assert_roundtrip(&format!("{name} crlf"), md.replace('\n', "\r\n").as_bytes());
    }
}

#[test]
fn five_megabyte_file_roundtrips() {
    let mut s = String::with_capacity(5 * 1024 * 1024 + 1024);
    let mut i = 0;
    while s.len() < 5 * 1024 * 1024 {
        s.push_str(&format!("## Section {i}\r\n\r\nSome *text* with `code` and caf\u{e9} {i}.\n\n- item\n- item\r\n\r\n"));
        i += 1;
    }
    assert_roundtrip("5MB", s.as_bytes());
}
