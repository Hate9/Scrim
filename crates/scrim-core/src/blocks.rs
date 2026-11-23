//! Block structure of a whole document in Rust (QA-LOG Q-026, spec 01): the same block
//! tree the frontend's block-only micromark parse builds, from markdown-rs (the Rust port
//! of micromark, same author and behavior), for the parses of whole documents (open,
//! reload). The frontend turns it into its document model exactly as it turns its own
//! parse; `src/md/rustparity.test.ts` checks that both give equal models for the corpus.
//!
//! Output is mdast-shaped JSON with only the fields the frontend reads. Offsets are in
//! UTF-16 code units, the frontend's string indices (markdown-rs counts bytes).
//!
//! Not covered here, decided by the frontend before it asks: strict mode off (lenient
//! forms, `src/md/lenient.ts`) and registered custom block tags (17), which change what
//! micromark sees as a block. The frontend parses such documents itself when they contain
//! a line that could be affected.

use markdown::mdast::{AlignKind, Node};
use markdown::{Constructs, ParseOptions};
use serde_json::{json, Map, Value};

/// The constructs of the frontend's block-only parse (`src/md/mdast.ts`): CommonMark +
/// GFM tables, footnote definitions, task list items + math blocks + YAML front matter,
/// with every inline construct off (paragraph content stays one text node).
fn options(frontmatter: bool) -> ParseOptions {
    ParseOptions {
        constructs: Constructs {
            // flow and containers
            block_quote: true,
            code_fenced: true,
            code_indented: true,
            definition: true,
            frontmatter,
            gfm_footnote_definition: true,
            gfm_table: true,
            gfm_task_list_item: true,
            heading_atx: true,
            heading_setext: true,
            html_flow: true,
            list_item: true,
            math_flow: true,
            thematic_break: true,
            // inline: off (block-only)
            attention: false,
            autolink: false,
            character_escape: false,
            character_reference: false,
            code_text: false,
            gfm_autolink_literal: false,
            gfm_label_start_footnote: false,
            gfm_strikethrough: false,
            hard_break_escape: false,
            // Not a construct in micromark (part of text), so on in the block-only parse too.
            hard_break_trailing: true,
            html_text: false,
            label_end: false,
            label_start_image: false,
            label_start_link: false,
            math_text: false,
            mdx_esm: false,
            mdx_expression_flow: false,
            mdx_expression_text: false,
            mdx_jsx_flow: false,
            mdx_jsx_text: false,
        },
        ..ParseOptions::default()
    }
}

/// Byte offset → UTF-16 offset, for every byte offset of `src` (and its end).
struct Utf16Map(Vec<u32>);

impl Utf16Map {
    fn new(src: &str) -> Self {
        let mut map = vec![0u32; src.len() + 1];
        let mut units = 0u32;
        for (i, c) in src.char_indices() {
            for b in 0..c.len_utf8() {
                map[i + b] = units;
            }
            units += c.len_utf16() as u32;
        }
        map[src.len()] = units;
        Utf16Map(map)
    }
    fn at(&self, byte: usize) -> u32 {
        self.0[byte.min(self.0.len() - 1)]
    }
}

/// Positions as micromark's: (start, end) byte offsets.
type Span = (usize, usize);

/// micromark starts a flow node after the line's indentation; markdown-rs at the
/// indentation. Skip spaces and tabs on the node's first line.
fn skip_indent(src: &[u8], mut at: usize, end: usize) -> usize {
    while at < end && (src[at] == b' ' || src[at] == b'\t') {
        at += 1;
    }
    at
}

/// Remove the indentation after each line break of a text value.
fn strip_continuation(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    let mut lines = v.split('\n');
    if let Some(first) = lines.next() {
        out.push_str(first);
    }
    for l in lines {
        out.push('\n');
        out.push_str(l.trim_start_matches([' ', '\t']));
    }
    out
}

// ---- the encoding (Q-027, Q-028) -------------------------------------------------------
//
// The tree goes to the frontend as little-endian `u32` words, decoded by
// `src/md/rustblocks.ts` (`decodeTree`) and, for tests, by `decode` below:
//
//   magic "SBT1", flags (1 = unsure), node count, string table length (UTF-16 units),
//   then each node in document order (pre-order):
//     type, start, end, line, child count, then per type:
//       heading: depth; list: ordered, start (u32::MAX = none), spread;
//       listItem: checked (0, 1, 2 = none); code: value, lang, meta; math: value, meta;
//       yaml, toml, html, text: value; table: align count, aligns (0 none, 1 left,
//       2 right, 3 center); footnoteDefinition: identifier, label;
//       definition: identifier, label, url, title; link: url
//     strings as (start, length) in UTF-16 units of the string table, u32::MAX = none
//   then the string table as UTF-16 code units, 2 bytes each.
//
// markdown-rs's tree is converted straight into this (no intermediate JSON: building and
// copying JSON took longer than parsing, Q-028).

const TYPES: [&str; 21] = [
    "root",
    "paragraph",
    "heading",
    "thematicBreak",
    "blockquote",
    "list",
    "listItem",
    "code",
    "math",
    "yaml",
    "toml",
    "html",
    "table",
    "tableRow",
    "tableCell",
    "footnoteDefinition",
    "definition",
    "text",
    "break",
    "link",
    "unknown",
];
const NONE: u32 = u32::MAX;
const T_HEADING: u32 = 2;
const T_LIST: u32 = 5;
const T_LIST_ITEM: u32 = 6;
const T_DEFINITION: u32 = 16;

/// Encoded nodes of one part: words, its string table, and where its string starts are
/// (so parts can be joined).
#[derive(Default)]
struct Out {
    words: Vec<u32>,
    strings: Vec<u16>,
    string_slots: Vec<usize>,
    nodes: u32,
}

impl Out {
    fn string(&mut self, v: Option<&str>) {
        match v {
            Some(s) => {
                let start = self.strings.len();
                if s.contains('\0') {
                    self.strings
                        .extend(s.replace('\0', "\u{FFFD}").encode_utf16());
                } else {
                    self.strings.extend(s.encode_utf16());
                }
                self.string_slots.push(self.words.len());
                self.words.push(start as u32);
                self.words.push((self.strings.len() - start) as u32);
            }
            None => {
                self.words.push(NONE);
                self.words.push(0);
            }
        }
    }
}

/// What a parent needs to know about a converted child.
struct Done {
    ty: u32,
    span: Span,
    /// Index of the child's start word (patched by the setext rule).
    start_word: usize,
}

struct Conv<'a> {
    /// The part being converted (the whole document, or one part of it).
    src: &'a [u8],
    /// Byte offset and line number (0-based) of the part in the document.
    base: usize,
    line_base: usize,
    map: &'a Utf16Map,
    /// Set when the tree may differ from micromark's in a way not reproduced here: the
    /// frontend then parses the document itself.
    unsure: bool,
}

impl Conv<'_> {
    /// The raw label of a definition (`skip` = 1 for `[`, 2 for `[^`), as micromark keeps
    /// it (line breaks and indentation included).
    fn raw_label(&self, raw: Span, skip: usize) -> Option<&str> {
        let start = skip_indent(self.src, raw.0, raw.1) + skip;
        let mut i = start;
        while i < raw.1 {
            match self.src[i] {
                b'\\' => i += 2,
                b']' => return std::str::from_utf8(&self.src[start..i]).ok(),
                _ => i += 1,
            }
        }
        None
    }

    fn line_start(&self, at: usize) -> usize {
        self.src[..at]
            .iter()
            .rposition(|&b| b == b'\n' || b == b'\r')
            .map_or(0, |p| p + 1)
    }

    /// Whether a blank line lies between two offsets.
    fn blank_between(&self, a: usize, b: usize) -> bool {
        let text = String::from_utf8_lossy(&self.src[a.min(b)..b])
            .replace("\r\n", "\n")
            .replace('\r', "\n");
        let lines: Vec<&str> = text.split('\n').collect();
        // The first piece ends the earlier node's line, the last starts the later one.
        lines.len() > 2
            && lines[1..lines.len() - 1]
                .iter()
                .any(|l| l.trim().is_empty())
    }

    /// Visual column (0-based, tabs to multiples of 4) of a byte offset in its line.
    fn visual_col(&self, at: usize) -> usize {
        let mut col = 0usize;
        for &b in &self.src[self.line_start(at)..at] {
            col = if b == b'\t' {
                col + 4 - col % 4
            } else {
                col + 1
            };
        }
        col
    }

    fn at(&self, byte: usize) -> u32 {
        self.map.at(self.base + byte)
    }

    /// Encode `node` (micromark's positions and values, see the module comment).
    fn node(&mut self, node: &Node, out: &mut Out) -> Done {
        let pos = node.position();
        let raw: Span = pos
            .map(|p| (p.start.offset, p.end.offset))
            .unwrap_or((0, 0));
        let line = pos.map(|p| p.start.line).unwrap_or(1);
        let column = pos.map_or(0, |p| p.start.column);
        let children: &[Node] = node.children().map(|c| c.as_slice()).unwrap_or(&[]);
        let (ty, indent): (u32, bool) = match node {
            Node::Root(_) => (0, false),
            Node::Paragraph(_) => (1, true),
            Node::Heading(_) => (T_HEADING, true),
            Node::ThematicBreak(_) => (3, true),
            Node::Blockquote(_) => (4, true),
            Node::List(_) => (T_LIST, true),
            Node::ListItem(_) => (T_LIST_ITEM, true),
            Node::Code(_) => {
                // Fenced: after the indentation; indented: from markdown-rs's start.
                let at = skip_indent(self.src, raw.0, raw.1);
                let fenced = at < raw.1
                    && (self.src[at] == b'`' || self.src[at] == b'~')
                    && self.visual_col(at) < self.visual_col(raw.0) + 4;
                // Indented code starting inside a tab a container partly used: micromark
                // keeps the tab's remaining columns as spaces in the value. Not
                // reproduced: unsure.
                if !fenced && self.visual_col(raw.0) + 1 < column {
                    self.unsure = true;
                }
                (7, fenced)
            }
            Node::Math(_) => (8, true),
            Node::Yaml(_) => (9, false),
            Node::Toml(_) => (10, false),
            Node::Html(_) => (11, false),
            Node::Table(_) => (12, true),
            Node::TableRow(_) => (13, false),
            Node::TableCell(_) => (14, false),
            Node::FootnoteDefinition(_) => (15, true),
            Node::Definition(_) => (T_DEFINITION, true),
            Node::Text(_) => (17, false),
            Node::Break(_) => (18, false),
            Node::Link(_) => (19, false),
            _ => (20, false),
        };
        let mut sp = raw;
        let mut text_value: Option<String> = None;
        if indent {
            sp.0 = skip_indent(self.src, sp.0, sp.1);
        }
        if let Node::Text(n) = node {
            // micromark drops the indentation of continuation lines from the text.
            let mut v = if n.value.contains('\n') {
                strip_continuation(&n.value)
            } else {
                n.value.clone()
            };
            // Text starting inside a tab a container partly used: micromark starts after it.
            if sp.0 < sp.1 && self.src[sp.0] == b'\t' && self.visual_col(sp.0) + 1 < column {
                sp.0 += 1;
                if let Some(rest) = v.strip_prefix('\t') {
                    v = rest.to_string();
                }
            }
            text_value = Some(v);
        }
        out.nodes += 1;
        out.words.push(ty);
        let start_word = out.words.len();
        out.words.push(self.at(sp.0));
        let end_word = out.words.len();
        out.words.push(self.at(sp.1));
        out.words.push((line + self.line_base) as u32);
        out.words.push(children.len() as u32);
        match node {
            Node::Heading(n) => out.words.push(u32::from(n.depth)),
            Node::List(n) => {
                out.words.push(u32::from(n.ordered));
                out.words.push(n.start.unwrap_or(NONE));
                out.words.push(u32::from(n.spread));
            }
            Node::ListItem(n) => out.words.push(match n.checked {
                Some(false) => 0,
                Some(true) => 1,
                None => 2,
            }),
            Node::Code(n) => {
                out.string(Some(&n.value));
                out.string(n.lang.as_deref());
                out.string(n.meta.as_deref());
            }
            Node::Math(n) => {
                out.string(Some(&n.value));
                out.string(n.meta.as_deref());
            }
            Node::Yaml(n) => out.string(Some(&n.value)),
            Node::Toml(n) => out.string(Some(&n.value)),
            Node::Html(n) => out.string(Some(&n.value)),
            Node::Text(_) => out.string(text_value.as_deref()),
            Node::Table(n) => {
                out.words.push(n.align.len() as u32);
                for a in &n.align {
                    out.words.push(match a {
                        AlignKind::None => 0,
                        AlignKind::Left => 1,
                        AlignKind::Right => 2,
                        AlignKind::Center => 3,
                    });
                }
            }
            Node::FootnoteDefinition(n) => {
                out.string(Some(&n.identifier));
                out.string(self.raw_label(raw, 2).or(n.label.as_deref()));
            }
            Node::Definition(n) => {
                out.string(Some(&n.identifier));
                out.string(self.raw_label(raw, 1).or(n.label.as_deref()));
                out.string(Some(&n.url));
                out.string(n.title.as_deref());
            }
            Node::Link(n) => out.string(Some(&n.url)),
            _ => {}
        }
        let mut kids: Vec<Done> = Vec::with_capacity(children.len());
        for c in children {
            kids.push(self.node(c, out));
        }
        // Items end where their last child ends; lists before trailing whitespace, but not
        // before their last item.
        if ty == T_LIST_ITEM {
            if let Some(last) = kids.last() {
                sp.1 = last.span.1;
            }
        } else if ty == T_LIST {
            let floor = kids.last().map(|k| k.span.1).unwrap_or(sp.0);
            while sp.1 > floor && matches!(self.src[sp.1 - 1], b' ' | b'\t' | b'\n' | b'\r') {
                sp.1 -= 1;
            }
        }
        if sp.1 != raw.1 {
            out.words[end_word] = self.at(sp.1);
        }
        // A setext heading right after definitions starts where they start (micromark).
        for i in 1..kids.len() {
            if kids[i].ty != T_HEADING || self.src.get(kids[i].span.0) == Some(&b'#') {
                continue;
            }
            let mut j = i;
            while j > 0
                && kids[j - 1].ty == T_DEFINITION
                && !self.blank_between(kids[j - 1].span.1, kids[j].span.0)
            {
                j -= 1;
            }
            if j < i {
                let start = kids[j].span.0;
                kids[i].span.0 = start;
                out.words[kids[i].start_word] = self.at(start);
            }
        }
        Done {
            ty,
            span: sp,
            start_word,
        }
    }
}

/// Documents larger than this are parsed in parallel parts.
const PARALLEL_MIN: usize = 128 * 1024;

/// The encoded block tree of a whole document (see the encoding above). Large documents
/// are parsed in parallel parts (`split_points`).
pub fn encoded_tree(src: &str) -> Vec<u8> {
    let threads = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .clamp(1, 16);
    let cuts = if src.len() < PARALLEL_MIN || threads == 1 {
        Vec::new()
    } else {
        split_points(src, src.len() / threads)
    };
    encode_parts(src, &cuts)
}

/// The block tree as mdast-shaped JSON (tests and the parity helper): the decoded
/// encoding, so both come from one conversion.
pub fn block_tree(src: &str) -> Value {
    decode(&encoded_tree(src))
}

/// Parse the parts between the cut points (in parallel) and join their top-level blocks.
fn encode_parts(src: &str, cuts: &[usize]) -> Vec<u8> {
    let map = Utf16Map::new(src);
    let mut bounds = vec![0usize];
    bounds.extend_from_slice(cuts);
    bounds.push(src.len());
    let lines_before: Vec<usize> = bounds
        .iter()
        .map(|&b| line_breaks(&src.as_bytes()[..b]))
        .collect();
    let parse = |i: usize| -> Option<(Out, u32, bool)> {
        let (a, b) = (bounds[i], bounds[i + 1]);
        let chunk = &src[a..b];
        let root = markdown::to_mdast(chunk, &options(i == 0)).ok()?;
        let mut conv = Conv {
            src: chunk.as_bytes(),
            base: a,
            line_base: lines_before[i],
            map: &map,
            unsure: false,
        };
        let mut out = Out::default();
        let kids = match &root {
            Node::Root(r) => &r.children,
            _ => return None,
        };
        let mut done: Vec<Done> = Vec::with_capacity(kids.len());
        for k in kids {
            done.push(conv.node(k, &mut out));
        }
        // The setext rule across this part's top level (parts start at headings).
        for i in 1..done.len() {
            if done[i].ty != T_HEADING || conv.src.get(done[i].span.0) == Some(&b'#') {
                continue;
            }
            let mut j = i;
            while j > 0
                && done[j - 1].ty == T_DEFINITION
                && !conv.blank_between(done[j - 1].span.1, done[j].span.0)
            {
                j -= 1;
            }
            if j < i {
                out.words[done[i].start_word] = conv.at(done[j].span.0);
            }
        }
        // Dropping a large tree takes a while; nothing waits for it.
        std::thread::spawn(move || drop(root));
        Some((out, kids_len(&done), conv.unsure))
    };
    fn kids_len(d: &[Done]) -> u32 {
        d.len() as u32
    }
    let results: Vec<Option<(Out, u32, bool)>> = if bounds.len() == 2 {
        vec![parse(0)]
    } else {
        std::thread::scope(|scope| {
            let handles: Vec<_> = (0..bounds.len() - 1)
                .map(|i| scope.spawn(move || parse(i)))
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().ok().flatten())
                .collect()
        })
    };
    let mut parts = Vec::with_capacity(results.len());
    for r in results {
        match r {
            Some(p) => parts.push(p),
            None => return Vec::new(),
        }
    }
    let nodes: u32 = 1 + parts.iter().map(|p| p.0.nodes).sum::<u32>();
    let top: u32 = parts.iter().map(|p| p.1).sum();
    let unsure = parts.iter().any(|p| p.2);
    let strings_len: usize = parts.iter().map(|p| p.0.strings.len()).sum();
    let words_len: usize = 5 + parts.iter().map(|p| p.0.words.len()).sum::<usize>();
    let mut bytes = Vec::with_capacity(16 + words_len * 4 + strings_len * 2);
    bytes.extend_from_slice(b"SBT1");
    bytes.extend_from_slice(&u32::from(unsure).to_le_bytes());
    bytes.extend_from_slice(&nodes.to_le_bytes());
    bytes.extend_from_slice(&(strings_len as u32).to_le_bytes());
    // The root: the whole document, line 1, every part's top-level blocks.
    for w in [0u32, 0, map.at(src.len()), 1, top] {
        bytes.extend_from_slice(&w.to_le_bytes());
    }
    let mut string_base = 0u32;
    for (out, _, _) in &mut parts {
        if string_base > 0 {
            for &slot in &out.string_slots {
                out.words[slot] += string_base;
            }
        }
        for w in &out.words {
            bytes.extend_from_slice(&w.to_le_bytes());
        }
        string_base += out.strings.len() as u32;
    }
    for (out, _, _) in &parts {
        for u in &out.strings {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
    }
    bytes
}

/// Decode an encoded tree to mdast-shaped JSON (the same objects `decodeTree` builds in
/// the frontend). `Value::Null` for empty or invalid input.
pub fn decode(bytes: &[u8]) -> Value {
    if bytes.len() < 16 || &bytes[..4] != b"SBT1" {
        return Value::Null;
    }
    let word = |i: usize| {
        u32::from_le_bytes([
            bytes[i * 4],
            bytes[i * 4 + 1],
            bytes[i * 4 + 2],
            bytes[i * 4 + 3],
        ])
    };
    let flags = word(1);
    let str_len = word(3) as usize;
    let words_end = (bytes.len() - str_len * 2) / 4;
    let table: Vec<u16> = bytes[words_end * 4..]
        .chunks(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let mut i = 4usize;
    fn node(i: &mut usize, word: &dyn Fn(usize) -> u32, table: &[u16]) -> Value {
        let mut next = || {
            let w = word(*i);
            *i += 1;
            w
        };
        let ty = TYPES.get(next() as usize).copied().unwrap_or("unknown");
        let (start, end, line, count) = (next(), next(), next(), next());
        let mut o = Map::new();
        o.insert("type".into(), json!(ty));
        o.insert(
            "position".into(),
            json!({ "start": { "line": line, "offset": start }, "end": { "offset": end } }),
        );
        let s = |o: &mut Map<String, Value>, key: &str, i: &mut usize| {
            let (a, n) = (word(*i), word(*i + 1));
            *i += 2;
            let v = if a == NONE {
                Value::Null
            } else {
                json!(String::from_utf16_lossy(
                    &table[a as usize..(a + n) as usize]
                ))
            };
            o.insert(key.into(), v);
        };
        match ty {
            "heading" => {
                o.insert("depth".into(), json!(word(*i)));
                *i += 1;
            }
            "list" => {
                o.insert("ordered".into(), json!(word(*i) == 1));
                let st = word(*i + 1);
                o.insert(
                    "start".into(),
                    if st == NONE { Value::Null } else { json!(st) },
                );
                o.insert("spread".into(), json!(word(*i + 2) == 1));
                *i += 3;
            }
            "listItem" => {
                let c = word(*i);
                *i += 1;
                o.insert(
                    "checked".into(),
                    if c == 2 { Value::Null } else { json!(c == 1) },
                );
            }
            "code" => {
                s(&mut o, "value", i);
                s(&mut o, "lang", i);
                s(&mut o, "meta", i);
            }
            "math" => {
                s(&mut o, "value", i);
                s(&mut o, "meta", i);
            }
            "yaml" | "toml" | "html" | "text" => s(&mut o, "value", i),
            "table" => {
                let k = word(*i) as usize;
                *i += 1;
                let align: Vec<Value> = (0..k)
                    .map(|x| match word(*i + x) {
                        1 => json!("left"),
                        2 => json!("right"),
                        3 => json!("center"),
                        _ => Value::Null,
                    })
                    .collect();
                *i += k;
                o.insert("align".into(), Value::Array(align));
            }
            "footnoteDefinition" => {
                s(&mut o, "identifier", i);
                s(&mut o, "label", i);
            }
            "definition" => {
                s(&mut o, "identifier", i);
                s(&mut o, "label", i);
                s(&mut o, "url", i);
                s(&mut o, "title", i);
            }
            "link" => s(&mut o, "url", i),
            _ => {}
        }
        const PARENTS: [&str; 11] = [
            "root",
            "paragraph",
            "heading",
            "blockquote",
            "list",
            "listItem",
            "table",
            "tableRow",
            "tableCell",
            "footnoteDefinition",
            "link",
        ];
        if count > 0 || PARENTS.contains(&ty) {
            let kids: Vec<Value> = (0..count).map(|_| node(i, word, table)).collect();
            o.insert("children".into(), Value::Array(kids));
        }
        Value::Object(o)
    }
    let mut tree = node(&mut i, &word, &table);
    if flags & 1 == 1 {
        tree["unsure"] = json!(true);
    }
    tree
}

/// A reply of a JSON header followed by an encoded tree (one IPC message, Q-026/Q-027):
/// the header's length as `u32`, the header (UTF-8 JSON), then the encoded tree.
pub fn reply_with_tree(header: &Value, tree: &[u8]) -> Vec<u8> {
    let head = serde_json::to_vec(header).unwrap_or_default();
    let mut out = Vec::with_capacity(4 + head.len() + tree.len());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(tree);
    out
}

/// Phase timings for the bench example: split scan, then markdown-rs and conversion of
/// each part, single-threaded.
pub fn profile(src: &str) -> String {
    use std::time::Instant;
    let threads = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .clamp(1, 16);
    let t = Instant::now();
    let cuts = split_points(src, src.len() / threads);
    let split = t.elapsed();
    let map = Utf16Map::new(src);
    let mut bounds = vec![0usize];
    bounds.extend_from_slice(&cuts);
    bounds.push(src.len());
    let (mut parse, mut conv) = (std::time::Duration::ZERO, std::time::Duration::ZERO);
    for i in 0..bounds.len() - 1 {
        let chunk = &src[bounds[i]..bounds[i + 1]];
        let t = Instant::now();
        let root = markdown::to_mdast(chunk, &options(i == 0)).unwrap();
        parse += t.elapsed();
        let t = Instant::now();
        let mut c = Conv {
            src: chunk.as_bytes(),
            base: bounds[i],
            line_base: 0,
            map: &map,
            unsure: false,
        };
        let mut out = Out::default();
        c.node(&root, &mut out);
        conv += t.elapsed();
    }
    format!(
        "split {split:?}, markdown-rs {parse:?}, convert {conv:?} (single thread, {} parts)",
        bounds.len() - 1
    )
}

/// Byte offsets where the document can be cut into parts that parse to the same top-level
/// blocks as the whole: the start of a line that begins with `#` and a space or tab at
/// column 0, right after a blank line, outside any top-level fenced code, math block, or
/// HTML block of kinds 1 to 5 (which a blank line does not end). Such a line closes every
/// open container (none continues on an unindented line after a blank line, and nothing
/// continues lazily across a blank line) and starts an ATX heading. Parts are at least
/// `min_len` bytes long.
fn split_points(src: &str, min_len: usize) -> Vec<usize> {
    let mut cuts = Vec::new();
    if min_len >= src.len() {
        return cuts;
    }
    let bytes = src.as_bytes();
    let mut last_cut = 0usize;
    let mut prev_blank = false;
    // Open region: a fence (char, length), math, or an HTML end marker.
    enum Region {
        /// char, length, indentation of the opener
        Fence(u8, usize, usize),
        /// indentation of the opener
        Math(usize),
        /// A fence closed by a line less indented than its opener: that line may instead
        /// have opened a new fence (the opener may have been in a list item the line
        /// ends). Not decided here: no more cuts.
        Unknown,
        Html(&'static [&'static str]),
    }
    let mut region: Option<Region> = None;
    let mut at = 0usize;
    // Front matter: never cut inside the first `---` block.
    if src.starts_with("---") {
        region = Some(Region::Fence(b'-', 3, 0));
        if let Some(nl) = src.find('\n') {
            at = nl + 1;
        }
    }
    while at < bytes.len() {
        let end = src[at..].find('\n').map_or(bytes.len(), |i| at + i + 1);
        let line = &src[at..end];
        let content = line.trim_end_matches(['\n', '\r']);
        let indent = content.len() - content.trim_start_matches(' ').len();
        let lead = &content[indent..];
        match &region {
            Some(Region::Fence(c, n, open_indent)) => {
                // Front matter closes with `---` or `...`; fences with at least as many.
                if *c == b'-' {
                    if content.trim_end() == "---" || content.trim_end() == "..." {
                        region = None;
                    }
                } else if indent < 4 && lead.bytes().take_while(|b| b == c).count() >= *n && lead.trim_start_matches(*c as char).trim().is_empty() {
                    // Less indented than the opener: see `Region::Unknown`.
                    region = if indent < *open_indent { Some(Region::Unknown) } else { None };
                }
            }
            Some(Region::Math(open_indent)) => {
                if indent < 4 && lead.trim_end().starts_with("$$") && lead.trim_end().trim_start_matches('$').is_empty() {
                    region = if indent < *open_indent { Some(Region::Unknown) } else { None };
                }
            }
            Some(Region::Unknown) => {}
            Some(Region::Html(markers)) => {
                let l = content.to_ascii_lowercase();
                if markers.iter().any(|m| l.contains(m)) {
                    region = None;
                }
            }
            None => {
                if prev_blank && at - last_cut >= min_len && (content.starts_with("# ") || content.starts_with("#\t") || content == "#" || content.starts_with("## ") || content.starts_with("### ")) {
                    cuts.push(at);
                    last_cut = at;
                }
                if indent < 4 {
                    let fence = lead.bytes().next().filter(|b| *b == b'`' || *b == b'~');
                    if let Some(c) = fence {
                        let n = lead.bytes().take_while(|b| *b == c).count();
                        // A backtick fence's info string has no backtick (CommonMark).
                        if n >= 3 && !(c == b'`' && lead[n..].contains('`')) {
                            region = Some(Region::Fence(c, n, indent));
                        }
                    } else if lead.starts_with("$$") {
                        region = Some(Region::Math(indent));
                    } else if lead.starts_with('<') {
                        if let Some(m) = html_region(&lead.to_ascii_lowercase()) {
                            region = Some(Region::Html(m));
                        }
                    }
                }
            }
        }
        prev_blank = content.trim().is_empty();
        at = end;
    }
    cuts
}

/// Line breaks in `b`: `\r\n`, `\r` and `\n` each count once (as markdown-rs counts lines).
fn line_breaks(b: &[u8]) -> usize {
    let mut n = 0;
    for (i, &c) in b.iter().enumerate() {
        if c == b'\n' || (c == b'\r' && b.get(i + 1) != Some(&b'\n')) {
            n += 1;
        }
    }
    n
}

/// HTML blocks a blank line does not end (CommonMark kinds 1 to 5): the end markers of
/// the block this line opens, unless the line also closes it.
fn html_region(l: &str) -> Option<&'static [&'static str]> {
    const RAW: &[&str] = &["</script>", "</pre>", "</style>", "</textarea>"];
    let markers: &'static [&'static str] = if ["<script", "<pre", "<style", "<textarea"]
        .iter()
        .any(|t| l.starts_with(t) && l[t.len()..].chars().next().is_none_or(|c| c == '>' || c.is_whitespace()))
    {
        RAW
    } else if l.starts_with("<!--") {
        &["-->"]
    } else if l.starts_with("<?") {
        &["?>"]
    } else if l.starts_with("<![cdata[") {
        &["]]>"]
    } else if l.len() > 2 && l.starts_with("<!") && l.as_bytes()[2].is_ascii_alphabetic() {
        &[">"]
    } else {
        return None;
    };
    // The end marker on the opening line itself (after the opener) closes it there.
    let rest = &l[2..];
    if markers.iter().any(|m| rest.contains(m)) {
        None
    } else {
        Some(markers)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parts give exactly the tree of the whole, for documents with every kind of block.
    #[test]
    fn parts_equal_whole() {
        let corpus = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/corpus");
        let mut docs: Vec<String> = Vec::new();
        fn walk(d: &std::path::Path, out: &mut Vec<String>) {
            for e in std::fs::read_dir(d).into_iter().flatten().flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, out);
                } else if p.extension().is_some_and(|x| x == "md") {
                    if let Ok(t) = std::fs::read_to_string(&p) {
                        out.push(t.trim_start_matches('\u{feff}').to_string());
                    }
                }
            }
        }
        walk(&corpus, &mut docs);
        if let Ok(spec) = std::fs::read_to_string(corpus.join("spec-examples.json")) {
            let v: Value = serde_json::from_str(&spec).unwrap();
            for e in v["examples"].as_array().unwrap() {
                docs.push(e["markdown"].as_str().unwrap().to_string());
            }
        }
        assert!(docs.len() > 600);
        // Everything in one document, separated by headings that may be cut points; and
        // each document followed by a heading, so cuts land right after any construct.
        let mut big = String::new();
        for (i, d) in docs.iter().enumerate() {
            big.push_str(d);
            big.push_str(&format!("\n\n# part {i}\n\n"));
        }
        let cuts = split_points(&big, 1);
        assert!(cuts.len() > 50, "only {} cut points", cuts.len());
        let whole = encode_parts(&big, &[]);
        let parts = encode_parts(&big, &cuts);
        assert!(whole == parts, "parts differ from the whole for the concatenated corpus");
        // Each document on its own, between headings that are cut points when the
        // document leaves nothing open, so no earlier document can hide a mistake.
        let mut checked = 0;
        for d in &docs {
            let one = format!("# a\n\n{d}\n\n# b\n\ntext\n\n# c\n");
            let cuts = split_points(&one, 1);
            checked += cuts.len();
            assert!(encode_parts(&one, &[]) == encode_parts(&one, &cuts), "parts differ for {d:?}");
        }
        assert!(checked > 1000, "only {checked} cut points over the single documents");
        // And the public entry point, which cuts large documents.
        assert!(encoded_tree(&big) == whole);
    }

    #[test]
    fn utf16_offsets() {
        let t = block_tree("é 😀\n\n# Hi\n");
        let kids = t["children"].as_array().unwrap();
        assert_eq!(kids[0]["type"], "paragraph");
        assert_eq!(kids[0]["position"]["end"]["offset"], 4); // é, space, 😀 (2 units)
        assert_eq!(kids[1]["type"], "heading");
        assert_eq!(kids[1]["position"]["start"]["offset"], 6);
        assert_eq!(kids[1]["children"][0]["value"], "Hi");
    }

    #[test]
    fn extensions() {
        let t = block_tree("---\na: 1\n---\n\n$$\nx\n$$\n\n- [x] done\n\n| a |\n|---|\n| b |\n\n[^1]: note\n\n[d]: /u\n");
        let types: Vec<&str> = t["children"].as_array().unwrap().iter().map(|n| n["type"].as_str().unwrap()).collect();
        assert_eq!(types, ["yaml", "math", "list", "table", "footnoteDefinition", "definition"]);
        assert_eq!(t["children"][2]["children"][0]["checked"], true);
    }
}
