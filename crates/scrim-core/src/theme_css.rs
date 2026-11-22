//! Theme CSS compatibility rewrite (spec 10, 10.3; QA-LOG Q-000).
//!
//! Themes written for other popular live-preview Markdown editors use a few ID and
//! class selectors carrying that editor's name. This module rewrites them to Scrim's
//! names while the theme is served (spec 01, "Local files in the webview") and when theme
//! CSS is inlined into exports (P5).
//!
//! It is a CSS Syntax Level 3 tokenizer plus the rule-structure part of the parser:
//! selectors are rewritten only in style-rule preludes (top level, inside conditional
//! group rules, and in nested rules), including inside `:is()`, `:not()`, `:where()`,
//! `:has()`. Strings, `url()`, comments, declarations (custom properties included), and
//! the bodies of `@font-face`, `@keyframes`, `@page`, and similar rules are copied byte
//! for byte. Everything that is not rewritten is reproduced exactly.

/// The prefix that compatible themes use (the rewrite table of 10.3; Q-000 allows the
/// name only here and in the tests).
const FOREIGN: &str = "typora-";

/// Rewrite one ID or class name, or return None to keep it.
fn rename(name: &str) -> Option<String> {
    match name {
        "typora-node" => Some("scrim".into()),
        "ty-on-typewriter-mode" => Some("scrim-typewriter-mode".into()),
        "cm-s-typora-default" => Some("cm-s-scrim-default".into()),
        _ => name.strip_prefix(FOREIGN).map(|rest| format!("scrim-{rest}")),
    }
}

/// Whether the build rewrites at all (`THEME_COMPAT_REWRITE`, 10.3): the cargo feature
/// `theme-compat-rewrite`, on by default.
pub const ENABLED: bool = cfg!(feature = "theme-compat-rewrite");

/// Rewrite a theme or user CSS file. Returns the input unchanged when the build flag is
/// off.
pub fn rewrite(css: &str) -> String {
    if !ENABLED {
        return css.to_string();
    }
    rewrite_always(css)
}

/// The rewrite regardless of the build flag (tests and exports that force it).
pub fn rewrite_always(css: &str) -> String {
    let tokens = tokenize(css);
    let mut out = String::with_capacity(css.len());
    let mut p = Walker { src: css, toks: &tokens, i: 0, out: &mut out };
    p.rule_list(false);
    out
}

/// One reference to another file in a style sheet: `url(…)` (quoted or not) or the
/// string of an `@import`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CssRef {
    /// the URL as written (escapes resolved only for `\` + one character)
    pub url: String,
    /// `@import` target (a style sheet) rather than a resource
    pub import: bool,
}

/// Replace every `url()` and `@import` target with what `map` returns for it (None keeps
/// it). Everything else is copied byte for byte. Used by exports (spec 09, 9.1 item 4):
/// relative references in inlined theme CSS must still resolve from the export's place.
pub fn map_urls(css: &str, mut map: impl FnMut(&CssRef) -> Option<String>) -> String {
    let toks = tokenize(css);
    let mut out = String::with_capacity(css.len());
    let mut i = 0;
    let quote = |u: &str| format!("\"{}\"", u.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\a "));
    let unescape = |s: &str| {
        let mut o = String::new();
        let mut it = s.chars();
        while let Some(c) = it.next() {
            if c == '\\' {
                if let Some(n) = it.next() {
                    o.push(n);
                }
            } else {
                o.push(c);
            }
        }
        o
    };
    let mut import_next = false;
    while i < toks.len() {
        let t = toks[i];
        let text = &css[t.start..t.end];
        match t.kind {
            Kind::At => {
                import_next = text.eq_ignore_ascii_case("@import");
                out.push_str(text);
            }
            Kind::Url => {
                let inner = text[4..text.len().saturating_sub(1)].trim();
                let r = CssRef { url: unescape(inner), import: import_next };
                import_next = false;
                match map(&r) {
                    Some(u) => {
                        out.push_str("url(");
                        out.push_str(&quote(&u));
                        out.push(')');
                    }
                    None => out.push_str(text),
                }
            }
            Kind::Function if text.eq_ignore_ascii_case("url(") => {
                // url( ws* string ws* )
                let mut j = i + 1;
                while j < toks.len() && toks[j].kind == Kind::Ws {
                    j += 1;
                }
                if j < toks.len() && toks[j].kind == Kind::Str {
                    let st = &css[toks[j].start..toks[j].end];
                    let inner = &st[1..st.len().saturating_sub(1).max(1)];
                    let r = CssRef { url: unescape(inner), import: import_next };
                    import_next = false;
                    out.push_str(&css[t.start..toks[j].start]);
                    match map(&r) {
                        Some(u) => out.push_str(&quote(&u)),
                        None => out.push_str(st),
                    }
                    i = j + 1;
                    continue;
                }
                out.push_str(text);
            }
            Kind::Str if import_next => {
                let inner = &text[1..text.len().saturating_sub(1).max(1)];
                let r = CssRef { url: unescape(inner), import: true };
                import_next = false;
                match map(&r) {
                    Some(u) => out.push_str(&quote(&u)),
                    None => out.push_str(text),
                }
            }
            Kind::Ws | Kind::Comment => out.push_str(text),
            Kind::Semi | Kind::OpenCurly | Kind::CloseCurly => {
                import_next = false;
                out.push_str(text);
            }
            _ => out.push_str(text),
        }
        i += 1;
    }
    out
}

// ---- tokenizer ------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Ws,
    Comment,
    Str,
    Url,
    /// `#name` (start, end of the whole token); name starts after `#`
    Hash,
    Ident,
    /// `name(`
    Function,
    At,
    Number,
    Delim,
    Colon,
    Semi,
    Comma,
    OpenCurly,
    CloseCurly,
    OpenParen,
    CloseParen,
    OpenSquare,
    CloseSquare,
    /// `<!--` / `-->`
    Cdo,
}

#[derive(Debug, Clone, Copy)]
struct Tok {
    kind: Kind,
    start: usize,
    end: usize,
}

fn is_name_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || !c.is_ascii()
}
fn is_name(c: char) -> bool {
    is_name_start(c) || c.is_ascii_digit() || c == '-'
}
/// "valid escape": `\` not followed by a newline
fn valid_escape(s: &str, i: usize) -> bool {
    let b = s.as_bytes();
    i < b.len() && b[i] == b'\\' && !matches!(b.get(i + 1), None | Some(b'\n') | Some(b'\r') | Some(b'\x0c'))
}
fn char_at(s: &str, i: usize) -> Option<char> {
    s.get(i..).and_then(|r| r.chars().next())
}
/// "would start an identifier" at byte i
fn starts_ident(s: &str, i: usize) -> bool {
    match char_at(s, i) {
        Some('-') => match char_at(s, i + 1) {
            Some(c) if is_name_start(c) || c == '-' => true,
            Some('\\') => valid_escape(s, i + 1),
            _ => false,
        },
        Some('\\') => valid_escape(s, i),
        Some(c) => is_name_start(c),
        None => false,
    }
}
fn consume_escape(s: &str, mut i: usize) -> usize {
    // at the char after `\`
    let b = s.as_bytes();
    if i >= b.len() {
        return i;
    }
    if b[i].is_ascii_hexdigit() {
        let mut n = 0;
        while i < b.len() && b[i].is_ascii_hexdigit() && n < 6 {
            i += 1;
            n += 1;
        }
        if i < b.len() && matches!(b[i], b' ' | b'\t' | b'\n' | b'\x0c') {
            i += 1;
        } else if i + 1 < b.len() && b[i] == b'\r' && b[i + 1] == b'\n' {
            i += 2;
        } else if i < b.len() && b[i] == b'\r' {
            i += 1;
        }
        i
    } else {
        i + char_at(s, i).map_or(1, char::len_utf8)
    }
}
fn consume_name(s: &str, mut i: usize) -> usize {
    while let Some(c) = char_at(s, i) {
        if is_name(c) {
            i += c.len_utf8();
        } else if valid_escape(s, i) {
            i = consume_escape(s, i + 1);
        } else {
            break;
        }
    }
    i
}

fn tokenize(s: &str) -> Vec<Tok> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let start = i;
        let c = char_at(s, i).unwrap();
        let kind = match c {
            ' ' | '\t' | '\n' | '\r' | '\x0c' => {
                while i < b.len() && matches!(b[i], b' ' | b'\t' | b'\n' | b'\r' | b'\x0c') {
                    i += 1;
                }
                Kind::Ws
            }
            '/' if b.get(i + 1) == Some(&b'*') => {
                i = s[i + 2..].find("*/").map_or(b.len(), |e| i + 2 + e + 2);
                Kind::Comment
            }
            '"' | '\'' => {
                i += 1;
                while i < b.len() {
                    match b[i] {
                        q if q == c as u8 => {
                            i += 1;
                            break;
                        }
                        b'\n' => break, // bad string: ends before the newline
                        b'\\' => i = (i + 2).min(b.len()),
                        _ => i += 1,
                    }
                }
                Kind::Str
            }
            '#' if char_at(s, i + 1).is_some_and(is_name) || valid_escape(s, i + 1) => {
                i = consume_name(s, i + 1);
                Kind::Hash
            }
            '0'..='9' => number(s, &mut i),
            '+' | '.' if starts_number(s, i) => number(s, &mut i),
            '-' if starts_number(s, i) => number(s, &mut i),
            '-' if s[i..].starts_with("-->") => {
                i += 3;
                Kind::Cdo
            }
            '<' if s[i..].starts_with("<!--") => {
                i += 4;
                Kind::Cdo
            }
            '@' if starts_ident(s, i + 1) => {
                i = consume_name(s, i + 1);
                Kind::At
            }
            _ if starts_ident(s, i) => {
                i = consume_name(s, i);
                if b.get(i) == Some(&b'(') {
                    let name = &s[start..i];
                    i += 1;
                    if name.eq_ignore_ascii_case("url") {
                        // unquoted url(…) is one token; a quoted one is function + string
                        let mut j = i;
                        while j < b.len() && matches!(b[j], b' ' | b'\t' | b'\n' | b'\r' | b'\x0c') {
                            j += 1;
                        }
                        if j < b.len() && b[j] != b'"' && b[j] != b'\'' {
                            while j < b.len() && b[j] != b')' {
                                if b[j] == b'\\' {
                                    j += 1;
                                }
                                j += 1;
                            }
                            i = (j + 1).min(b.len());
                            out.push(Tok { kind: Kind::Url, start, end: i });
                            continue;
                        }
                    }
                    Kind::Function
                } else {
                    Kind::Ident
                }
            }
            '{' => {
                i += 1;
                Kind::OpenCurly
            }
            '}' => {
                i += 1;
                Kind::CloseCurly
            }
            '(' => {
                i += 1;
                Kind::OpenParen
            }
            ')' => {
                i += 1;
                Kind::CloseParen
            }
            '[' => {
                i += 1;
                Kind::OpenSquare
            }
            ']' => {
                i += 1;
                Kind::CloseSquare
            }
            ';' => {
                i += 1;
                Kind::Semi
            }
            ':' => {
                i += 1;
                Kind::Colon
            }
            ',' => {
                i += 1;
                Kind::Comma
            }
            _ => {
                i += c.len_utf8();
                Kind::Delim
            }
        };
        out.push(Tok { kind, start, end: i });
    }
    out
}

fn starts_number(s: &str, i: usize) -> bool {
    let b = s.as_bytes();
    let digit = |k: usize| b.get(k).is_some_and(u8::is_ascii_digit);
    match b.get(i) {
        Some(b'+') | Some(b'-') => digit(i + 1) || (b.get(i + 1) == Some(&b'.') && digit(i + 2)),
        Some(b'.') => digit(i + 1),
        _ => digit(i),
    }
}

fn number(s: &str, i: &mut usize) -> Kind {
    let b = s.as_bytes();
    if matches!(b.get(*i), Some(b'+') | Some(b'-')) {
        *i += 1;
    }
    while b.get(*i).is_some_and(|c| c.is_ascii_digit() || *c == b'.') {
        *i += 1;
    }
    if matches!(b.get(*i), Some(b'e') | Some(b'E')) && b.get(*i + 1).is_some_and(u8::is_ascii_digit) {
        *i += 1;
        while b.get(*i).is_some_and(u8::is_ascii_digit) {
            *i += 1;
        }
    }
    // dimension unit or percentage belong to the number token
    if starts_ident(s, *i) {
        *i = consume_name(s, *i);
    } else if b.get(*i) == Some(&b'%') {
        *i += 1;
    }
    Kind::Number
}

/// The value of an identifier, with escapes resolved.
fn unescape(raw: &str) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < raw.len() {
        if raw.as_bytes()[i] == b'\\' && i + 1 < raw.len() {
            let after = i + 1;
            let end = consume_escape(raw, after);
            let body = raw[after..end].trim_end();
            if body.chars().next().is_some_and(|c| c.is_ascii_hexdigit()) {
                let v = u32::from_str_radix(body, 16).unwrap_or(0xfffd);
                out.push(char::from_u32(v).filter(|_| v != 0).unwrap_or('\u{fffd}'));
            } else {
                out.push_str(body);
            }
            i = end;
        } else {
            let c = char_at(raw, i).unwrap();
            out.push(c);
            i += c.len_utf8();
        }
    }
    out
}

fn escape_ident(name: &str) -> String {
    let mut out = String::new();
    for (k, c) in name.chars().enumerate() {
        if is_name(c) && !(k == 0 && c.is_ascii_digit()) {
            out.push(c);
        } else {
            out.push_str(&format!("\\{:x} ", c as u32));
        }
    }
    out
}

/// Rewrite the name part of a hash or class token, or None to keep its bytes.
fn renamed(raw: &str) -> Option<String> {
    if !raw.contains('\\') {
        return rename(raw);
    }
    rename(&unescape(raw)).map(|n| escape_ident(&n))
}

// ---- rule structure -----------------------------------------------------------------

/// At-rules whose block holds rules (rewrite inside); everything else with a block is
/// copied verbatim (`@font-face`, `@keyframes`, `@page`, `@property`, …).
const GROUP_RULES: &[&str] = &["media", "supports", "layer", "container", "document", "scope", "starting-style", "-moz-document"];

struct Walker<'a> {
    src: &'a str,
    toks: &'a [Tok],
    i: usize,
    out: &'a mut String,
}

impl Walker<'_> {
    fn peek(&self) -> Option<Tok> {
        self.toks.get(self.i).copied()
    }
    fn copy(&mut self, t: Tok) {
        self.out.push_str(&self.src[t.start..t.end]);
    }
    fn text(&self, t: Tok) -> &str {
        &self.src[t.start..t.end]
    }

    /// Index of the token that ends the segment starting at `self.i` at this nesting
    /// level: the first top-level `{`, `;`, or `}` (or the end).
    fn segment_end(&self) -> usize {
        let mut depth = 0i32;
        let mut k = self.i;
        while let Some(t) = self.toks.get(k) {
            match t.kind {
                Kind::OpenParen | Kind::OpenSquare | Kind::Function => depth += 1,
                Kind::CloseParen | Kind::CloseSquare => depth -= 1,
                Kind::OpenCurly | Kind::Semi | Kind::CloseCurly if depth <= 0 => return k,
                _ => {}
            }
            k += 1;
        }
        k
    }

    /// Copy tokens up to (not including) `end`, rewriting selectors when `selectors`.
    fn emit(&mut self, end: usize, selectors: bool) {
        while self.i < end {
            let t = self.toks[self.i];
            self.i += 1;
            if selectors {
                if t.kind == Kind::Hash {
                    if let Some(n) = renamed(&self.src[t.start + 1..t.end]) {
                        self.out.push('#');
                        self.out.push_str(&n);
                        continue;
                    }
                } else if t.kind == Kind::Delim && self.text(t) == "." {
                    if let Some(next) = self.toks.get(self.i).copied().filter(|n| n.kind == Kind::Ident) {
                        if let Some(n) = renamed(self.text(next)) {
                            self.out.push('.');
                            self.out.push_str(&n);
                            self.i += 1;
                            continue;
                        }
                    }
                }
            }
            self.copy(t);
        }
    }

    /// Copy a `{ … }` block verbatim, including nested blocks; `self.i` is at `{`.
    fn copy_block(&mut self) {
        let mut depth = 0;
        while let Some(t) = self.peek() {
            self.i += 1;
            self.copy(t);
            match t.kind {
                Kind::OpenCurly => depth += 1,
                Kind::CloseCurly => {
                    depth -= 1;
                    if depth == 0 {
                        return;
                    }
                }
                _ => {}
            }
        }
    }

    /// A list of rules (stylesheet top level, group rule bodies) when `in_block` is
    /// false/true; or the contents of a style rule's block (declarations and nested
    /// rules) via `declarations`.
    fn rule_list(&mut self, in_block: bool) {
        while let Some(t) = self.peek() {
            match t.kind {
                Kind::Ws | Kind::Comment | Kind::Cdo | Kind::Semi => {
                    self.i += 1;
                    self.copy(t);
                }
                Kind::CloseCurly if in_block => return,
                Kind::CloseCurly => {
                    self.i += 1;
                    self.copy(t);
                }
                _ => self.rule(false),
            }
        }
    }

    /// One rule starting at `self.i`. `nested`: inside a style rule (bodies are
    /// declaration lists).
    fn rule(&mut self, nested: bool) {
        let first = self.toks[self.i];
        let end = self.segment_end();
        let ends_with_block = self.toks.get(end).is_some_and(|t| t.kind == Kind::OpenCurly);
        if first.kind == Kind::At {
            let name = self.text(first)[1..].to_ascii_lowercase();
            let group = GROUP_RULES.contains(&name.as_str());
            // `@scope (.a) to (.b)` has selectors in its prelude
            self.emit(end, name == "scope");
            if !ends_with_block {
                if self.peek().is_some_and(|t| t.kind == Kind::Semi) {
                    let t = self.toks[self.i];
                    self.i += 1;
                    self.copy(t);
                }
                return;
            }
            if group {
                self.open_block();
                if nested {
                    self.declarations();
                } else {
                    self.rule_list(true);
                }
                self.close_block();
            } else {
                self.copy_block();
            }
            return;
        }
        // qualified (style) rule
        self.emit(end, true);
        if ends_with_block {
            self.open_block();
            self.declarations();
            self.close_block();
        }
    }

    fn open_block(&mut self) {
        let t = self.toks[self.i];
        self.i += 1;
        self.copy(t);
    }
    fn close_block(&mut self) {
        if let Some(t) = self.peek().filter(|t| t.kind == Kind::CloseCurly) {
            self.i += 1;
            self.copy(t);
        }
    }

    /// The body of a style rule: declarations (copied) and nested rules (rewritten).
    fn declarations(&mut self) {
        while let Some(t) = self.peek() {
            match t.kind {
                Kind::Ws | Kind::Comment | Kind::Semi => {
                    self.i += 1;
                    self.copy(t);
                }
                Kind::CloseCurly => return,
                Kind::Ident if self.text(t).starts_with("--") => self.declaration(),
                Kind::At => self.rule(true),
                _ => {
                    let end = self.segment_end();
                    if self.toks.get(end).is_some_and(|t| t.kind == Kind::OpenCurly) {
                        self.rule(true);
                    } else {
                        self.declaration();
                    }
                }
            }
        }
    }

    /// A declaration up to and including its `;` (or the block end), copied verbatim;
    /// `{}` inside custom property values are part of the value.
    fn declaration(&mut self) {
        let mut depth = 0i32;
        while let Some(t) = self.peek() {
            match t.kind {
                Kind::OpenCurly | Kind::OpenParen | Kind::OpenSquare | Kind::Function => depth += 1,
                Kind::CloseParen | Kind::CloseSquare => depth -= 1,
                Kind::CloseCurly if depth <= 0 => return,
                Kind::CloseCurly => depth -= 1,
                Kind::Semi if depth <= 0 => {
                    self.i += 1;
                    self.copy(t);
                    return;
                }
                _ => {}
            }
            self.i += 1;
            self.copy(t);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::map_urls;
    use super::rewrite_always as rw;

    #[test]
    fn table_of_10_3() {
        assert_eq!(rw("#typora-sidebar{}"), "#scrim-sidebar{}");
        assert_eq!(rw("#typora-source .x{}"), "#scrim-source .x{}");
        assert_eq!(rw(".typora-export h1{}"), ".scrim-export h1{}");
        assert_eq!(rw(".typora-quick-open-item{}"), ".scrim-quick-open-item{}");
        assert_eq!(rw(".typora-node #write{}"), ".scrim #write{}");
        assert_eq!(rw(".ty-on-typewriter-mode #write{}"), ".scrim-typewriter-mode #write{}");
        assert_eq!(rw(".typora-anything, #typora-y{}"), ".scrim-anything, #scrim-y{}");
        assert_eq!(rw("#typora-source .cm-s-typora-default .cm-keyword{}"), "#scrim-source .cm-s-scrim-default .cm-keyword{}");
    }

    #[test]
    fn t6_leaves_strings_urls_comments_values() {
        let css = r##"/* #typora-sidebar */
#typora-sidebar { background: red; content: "#typora-sidebar"; background-image: url("typora-bg.png"); }
.a::before { content: '.typora-export'; background: url(typora-bg.png) }
:root { --x: #typora-sidebar; --y: { .typora-export: 1 } }
@font-face { font-family: typora-font; src: url(typora-font.woff) }
@keyframes typora-spin { from { color: red } }
"##;
        let want = r##"/* #typora-sidebar */
#scrim-sidebar { background: red; content: "#typora-sidebar"; background-image: url("typora-bg.png"); }
.a::before { content: '.typora-export'; background: url(typora-bg.png) }
:root { --x: #typora-sidebar; --y: { .typora-export: 1 } }
@font-face { font-family: typora-font; src: url(typora-font.woff) }
@keyframes typora-spin { from { color: red } }
"##;
        assert_eq!(rw(css), want);
    }

    #[test]
    fn functional_pseudo_classes_and_nesting() {
        assert_eq!(rw(":is(.typora-a, #typora-b) :not(.typora-c):where(.x):has(> .typora-d){}"), ":is(.scrim-a, #scrim-b) :not(.scrim-c):where(.x):has(> .scrim-d){}");
        assert_eq!(rw(".p { color: red; .typora-a & { color: blue } &:hover .typora-b { x: y } }"), ".p { color: red; .scrim-a & { color: blue } &:hover .scrim-b { x: y } }");
        assert_eq!(rw("@media (min-width: 1px) { @supports (display: grid) { .typora-a { b: c } } }"), "@media (min-width: 1px) { @supports (display: grid) { .scrim-a { b: c } } }");
        assert_eq!(rw(".p { @media print { .typora-a { b: c } } }"), ".p { @media print { .scrim-a { b: c } } }");
    }

    #[test]
    fn declarations_and_numbers_untouched() {
        assert_eq!(rw("a { margin: .5em; color: #abcdef; width: calc(1px + .typora); }"), "a { margin: .5em; color: #abcdef; width: calc(1px + .typora); }");
        assert_eq!(rw("@import url(typora.css);\n@import \"x.css\";"), "@import url(typora.css);\n@import \"x.css\";");
        assert_eq!(rw("[class=\"typora-node\"], [id~=typora-sidebar] {}"), "[class=\"typora-node\"], [id~=typora-sidebar] {}");
    }

    #[test]
    fn escapes_and_odd_input() {
        assert_eq!(rw(".typora\\-export{}"), ".scrim-export{}");
        assert_eq!(rw(".x { unclosed"), ".x { unclosed");
        assert_eq!(rw("}} .typora-a {"), "}} .scrim-a {");
        assert_eq!(rw("\"bad\nstring .typora-a{}"), "\"bad\nstring .scrim-a{}");
        assert_eq!(rw("é.typora-a{}"), "é.scrim-a{}");
    }

    #[test]
    fn everything_else_byte_identical() {
        let css = "@charset \"utf-8\";\n:root{--bg:#fff}\n<!-- -->\nbody>p+p~p{a:b!important}\n@page :first{margin:1in}\n";
        assert_eq!(rw(css), css);
    }

    #[test]
    fn map_urls_rewrites_references_only() {
        let css = "@import \"a.css\";\n@import url(b.css) screen;\n.x { background: url(img/p.png) } .y { src: url( 'f o.woff2' ) format('woff2') }\n.z::after { content: \"url(no)\" }\n/* url(no) */";
        let out = map_urls(css, |r| Some(format!("{}{}", if r.import { "I:" } else { "R:" }, r.url)));
        assert_eq!(
            out,
            "@import \"I:a.css\";\n@import url(\"I:b.css\") screen;\n.x { background: url(\"R:img/p.png\") } .y { src: url( \"R:f o.woff2\" ) format('woff2') }\n.z::after { content: \"url(no)\" }\n/* url(no) */"
        );
        assert_eq!(map_urls(css, |_| None), css);
    }
}
