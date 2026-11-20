//! Line-ending detection (spec 01, "Persistence": detect on load, majority wins).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LineEnding {
    #[serde(rename = "lf")]
    Lf,
    #[serde(rename = "crlf")]
    CrLf,
    #[serde(rename = "cr")]
    Cr,
}

impl LineEnding {
    pub fn as_str(self) -> &'static str {
        match self {
            LineEnding::Lf => "\n",
            LineEnding::CrLf => "\r\n",
            LineEnding::Cr => "\r",
        }
    }

    /// Platform default for new files, used when settings do not say otherwise.
    pub fn platform_default() -> Self {
        if cfg!(windows) {
            LineEnding::CrLf
        } else {
            LineEnding::Lf
        }
    }
}

/// Count of each terminator in `text`.
pub fn count(text: &str) -> (usize, usize, usize) {
    let b = text.as_bytes();
    let (mut lf, mut crlf, mut cr) = (0, 0, 0);
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\r' if b.get(i + 1) == Some(&b'\n') => {
                crlf += 1;
                i += 1;
            }
            b'\r' => cr += 1,
            b'\n' => lf += 1,
            _ => {}
        }
        i += 1;
    }
    (lf, crlf, cr)
}

/// Majority terminator, or `None` for text without any line break. Ties prefer LF, then
/// CRLF.
pub fn detect(text: &str) -> Option<LineEnding> {
    let (lf, crlf, cr) = count(text);
    if lf + crlf + cr == 0 {
        None
    } else if lf >= crlf && lf >= cr {
        Some(LineEnding::Lf)
    } else if crlf >= cr {
        Some(LineEnding::CrLf)
    } else {
        Some(LineEnding::Cr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn majority() {
        assert_eq!(detect("a"), None);
        assert_eq!(detect("a\nb\r\nc\r\n"), Some(LineEnding::CrLf));
        assert_eq!(detect("a\rb\rc\n"), Some(LineEnding::Cr));
        assert_eq!(detect("a\nb\r\n"), Some(LineEnding::Lf));
        assert_eq!(count("\r\n\r\r\n\n"), (1, 2, 1));
    }
}
