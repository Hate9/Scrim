//! Reading and writing text in the encoding a file came in (spec 01, "Persistence").
//!
//! - BOM detection first (UTF-8, UTF-16LE, UTF-16BE).
//! - No BOM: UTF-8 if the bytes are valid UTF-8, otherwise a detected legacy encoding.
//! - Saving re-encodes in the same encoding and keeps the BOM. Characters the encoding
//!   cannot represent are an error ([`EncodeError::Unrepresentable`]); the caller asks the
//!   user whether to save as UTF-8 instead. Replacement characters are never written
//!   silently.

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde::{Deserialize, Serialize};

const LATIN1: &str = "ISO-8859-1";

/// How a document's bytes are encoded on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEncoding {
    /// WHATWG encoding label, e.g. `UTF-8`, `UTF-16LE`, `windows-1252`.
    pub name: String,
    /// Whether the file starts with a byte order mark.
    pub bom: bool,
}

impl TextEncoding {
    /// Encoding for new files: UTF-8 without BOM.
    pub fn utf8() -> Self {
        Self { name: UTF_8.name().to_string(), bom: false }
    }

    fn encoding(&self) -> &'static Encoding {
        Encoding::for_label(self.name.as_bytes()).unwrap_or(UTF_8)
    }

    /// True ISO-8859-1. The WHATWG standard aliases this label to windows-1252, so it is
    /// handled separately: a file detected as windows-1252 that has no byte in
    /// 0x80..=0x9F is valid Latin-1 and is kept as Latin-1 (QA-LOG Q-004).
    fn is_latin1(&self) -> bool {
        self.name == LATIN1
    }

    pub fn is_utf8(&self) -> bool {
        !self.is_latin1() && self.encoding() == UTF_8
    }
}

/// Result of decoding a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decoded {
    pub text: String,
    pub encoding: TextEncoding,
    /// True when some bytes were malformed for the chosen encoding and were decoded as
    /// U+FFFD. Saving such a text in the same encoding would change those bytes.
    pub malformed: bool,
}

/// Decode file bytes, detecting the encoding.
pub fn decode(bytes: &[u8]) -> Decoded {
    if let Some((enc, bom_len)) = Encoding::for_bom(bytes) {
        let (text, malformed) = enc.decode_without_bom_handling(&bytes[bom_len..]);
        return Decoded {
            text: text.into_owned(),
            encoding: TextEncoding { name: enc.name().to_string(), bom: true },
            malformed,
        };
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Decoded { text: s.to_string(), encoding: TextEncoding::utf8(), malformed: false };
    }
    let mut det = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Allow);
    det.feed(bytes, true);
    let enc = det.guess(None, chardetng::Utf8Detection::Allow);
    if enc == encoding_rs::WINDOWS_1252 && !bytes.iter().any(|b| (0x80..=0x9F).contains(b)) {
        return Decoded {
            text: bytes.iter().map(|&b| b as char).collect(),
            encoding: TextEncoding { name: LATIN1.to_string(), bom: false },
            malformed: false,
        };
    }
    let (text, malformed) = enc.decode_without_bom_handling(bytes);
    Decoded {
        text: text.into_owned(),
        encoding: TextEncoding { name: enc.name().to_string(), bom: false },
        malformed,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EncodeError {
    /// The text contains characters the target encoding cannot represent.
    #[error("{count} character(s) cannot be represented in {encoding}, first {first:?}")]
    Unrepresentable { encoding: String, first: char, count: usize },
}

/// Encode text for writing in `enc`.
pub fn encode(text: &str, enc: &TextEncoding) -> Result<Vec<u8>, EncodeError> {
    let mut out = Vec::with_capacity(text.len() + 3);
    if enc.is_latin1() {
        let bad: Vec<char> = text.chars().filter(|&c| (c as u32) > 0xFF).collect();
        if let Some(&first) = bad.first() {
            return Err(EncodeError::Unrepresentable {
                encoding: LATIN1.to_string(),
                first,
                count: bad.len(),
            });
        }
        out.extend(text.chars().map(|c| c as u32 as u8));
        return Ok(out);
    }
    let encoding = enc.encoding();
    if encoding == UTF_8 {
        if enc.bom {
            out.extend_from_slice(b"\xEF\xBB\xBF");
        }
        out.extend_from_slice(text.as_bytes());
        return Ok(out);
    }
    if encoding == UTF_16LE || encoding == UTF_16BE {
        let le = encoding == UTF_16LE;
        let push = |out: &mut Vec<u8>, u: u16| {
            out.extend_from_slice(&if le { u.to_le_bytes() } else { u.to_be_bytes() })
        };
        if enc.bom {
            push(&mut out, 0xFEFF);
        }
        for u in text.encode_utf16() {
            push(&mut out, u);
        }
        return Ok(out);
    }
    // Legacy encodings: encode without replacement so unmappable characters surface as
    // an error instead of becoming numeric character references or `?`.
    let unrepresentable: Vec<char> =
        text.chars().filter(|c| !char_representable(encoding, *c)).collect();
    if let Some(&first) = unrepresentable.first() {
        return Err(EncodeError::Unrepresentable {
            encoding: encoding.name().to_string(),
            first,
            count: unrepresentable.len(),
        });
    }
    let mut encoder = encoding.new_encoder();
    let max = encoder
        .max_buffer_length_from_utf8_without_replacement(text.len())
        .unwrap_or(text.len() * 4 + 16);
    out.resize(max, 0);
    let (result, _read, written) =
        encoder.encode_from_utf8_without_replacement(text, &mut out, true);
    match result {
        encoding_rs::EncoderResult::InputEmpty => {
            out.truncate(written);
            Ok(out)
        }
        encoding_rs::EncoderResult::Unmappable(c) => Err(EncodeError::Unrepresentable {
            encoding: encoding.name().to_string(),
            first: c,
            count: 1,
        }),
        encoding_rs::EncoderResult::OutputFull => unreachable!("buffer sized by max length"),
    }
}

fn char_representable(encoding: &'static Encoding, c: char) -> bool {
    if c.is_ascii() {
        return true;
    }
    let mut buf = [0u8; 4];
    let s = c.encode_utf8(&mut buf);
    let mut enc = encoding.new_encoder();
    let mut out = [0u8; 16];
    let (r, _, _) = enc.encode_from_utf8_without_replacement(s, &mut out, true);
    matches!(r, encoding_rs::EncoderResult::InputEmpty)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(bytes: &[u8]) {
        let d = decode(bytes);
        assert!(!d.malformed, "{d:?}");
        assert_eq!(encode(&d.text, &d.encoding).unwrap(), bytes, "{d:?}");
    }

    #[test]
    fn utf8_plain_and_bom() {
        roundtrip(b"# hi\r\nthere\n");
        roundtrip("caf\u{e9}\n".as_bytes());
        let d = decode(b"\xEF\xBB\xBFx");
        assert_eq!(d.text, "x");
        assert!(d.encoding.bom && d.encoding.is_utf8());
        roundtrip(b"\xEF\xBB\xBFx\n");
        roundtrip(b"");
    }

    #[test]
    fn utf16() {
        let mut le = vec![0xFF, 0xFE];
        for u in "a\u{e9}\u{1F600}\n".encode_utf16() {
            le.extend_from_slice(&u.to_le_bytes());
        }
        roundtrip(&le);
        let mut be = vec![0xFE, 0xFF];
        for u in "b\r\n".encode_utf16() {
            be.extend_from_slice(&u.to_be_bytes());
        }
        roundtrip(&be);
        assert_eq!(decode(&be).encoding.name, "UTF-16BE");
    }

    #[test]
    fn latin1_detected_and_preserved() {
        // "Café crème à la française\n" in ISO-8859-1 / windows-1252.
        let bytes = b"Caf\xE9 cr\xE8me \xE0 la fran\xE7aise, d\xE9j\xE0 vu, \xE9t\xE9\n";
        let d = decode(bytes);
        assert_eq!(d.encoding.name, "ISO-8859-1");
        assert!(d.text.starts_with("Café crème"));
        roundtrip(bytes);
        // With a 0x80..=0x9F byte (here the windows-1252 euro sign) it is windows-1252.
        let bytes = b"Caf\xE9 cr\xE8me \xE0 la fran\xE7aise co\xFBte 5 \x80, d\xE9j\xE0\n";
        let d = decode(bytes);
        assert_eq!(d.encoding.name, "windows-1252");
        assert!(d.text.contains('€'));
        roundtrip(bytes);
    }

    #[test]
    fn unrepresentable_is_an_error() {
        let enc = TextEncoding { name: "windows-1252".into(), bom: false };
        assert_eq!(encode("€ ok", &enc).unwrap(), b"\x80 ok"); // € exists in 1252
        let err = encode("a \u{4E2D} b \u{1F600}", &enc).unwrap_err();
        assert_eq!(
            err,
            EncodeError::Unrepresentable {
                encoding: "windows-1252".into(),
                first: '\u{4E2D}',
                count: 2
            }
        );
        let latin2 = TextEncoding { name: "ISO-8859-2".into(), bom: false };
        assert!(encode("\u{263A}", &latin2).is_err());
        let latin1 = TextEncoding { name: "ISO-8859-1".into(), bom: false };
        assert!(matches!(encode("€", &latin1), Err(EncodeError::Unrepresentable { .. })));
        assert_eq!(encode("\u{e9}", &latin1).unwrap(), b"\xE9");
    }
}
