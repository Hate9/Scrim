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

fn span_json(sp: Span, line: usize, map: &Utf16Map) -> Value {
    json!({
        "start": { "line": line, "offset": map.at(sp.0) },
        "end": { "offset": map.at(sp.1) },
    })
}

/// micromark starts a flow node after the line's indentation; markdown-rs at the
/// indentation. Skip spaces and tabs on the node's first line.
fn skip_indent(src: &[u8], mut at: usize, end: usize) -> usize {
    while at < end && (src[at] == b' ' || src[at] == b'\t') {
        at += 1;
    }
    at
}

/// Text values: micromark replaces NUL with U+FFFD.
fn value(v: &str) -> Value {
    if v.contains('\0') {
        json!(v.replace('\0', "\u{FFFD}"))
    } else {
        json!(v)
    }
}

struct Conv<'a> {
    /// The chunk being converted (the whole document, or one part of it).
    src: &'a [u8],
    /// Byte offset and line number (0-based) of the chunk in the document.
    base: usize,
    line_base: usize,
    map: &'a Utf16Map,
    /// Set when the tree may differ from micromark's in a way not reproduced here: the
    /// frontend then parses the document itself.
    unsure: std::cell::Cell<bool>,
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

impl Conv<'_> {
    /// The raw label of a definition (`skip` = 1 for `[`, 2 for `[^`), as micromark keeps
    /// it (line breaks and indentation included).
    fn raw_label(&self, raw: Span, skip: usize) -> Option<String> {
        let start = skip_indent(self.src, raw.0, raw.1) + skip;
        let mut i = start;
        while i < raw.1 {
            match self.src[i] {
                b'\\' => i += 2,
                b']' => return std::str::from_utf8(&self.src[start..i]).ok().map(str::to_string),
                _ => i += 1,
            }
        }
        None
    }

    fn line_start(&self, at: usize) -> usize {
        self.src[..at].iter().rposition(|&b| b == b'\n' || b == b'\r').map_or(0, |p| p + 1)
    }

    /// Whether a blank line lies between two offsets.
    fn blank_between(&self, a: usize, b: usize) -> bool {
        let text = String::from_utf8_lossy(&self.src[a.min(b)..b]).replace("\r\n", "\n").replace('\r', "\n");
        let lines: Vec<&str> = text.split('\n').collect();
        // The first piece ends the earlier node's line, the last starts the later one.
        lines.len() > 2 && lines[1..lines.len() - 1].iter().any(|l| l.trim().is_empty())
    }

    /// Visual column (0-based, tabs to multiples of 4) of a byte offset in its line.
    fn visual_col(&self, at: usize) -> usize {
        let mut col = 0usize;
        for &b in &self.src[self.line_start(at)..at] {
            col = if b == b'\t' { col + 4 - col % 4 } else { col + 1 };
        }
        col
    }

    /// Convert a node; returns its JSON and its (micromark) span.
    fn node(&self, node: &Node) -> (Value, Span) {
        let mut o = Map::new();
        let pos = node.position();
        let raw: Span = pos.map(|p| (p.start.offset, p.end.offset)).unwrap_or((0, 0));
        let line = pos.map(|p| p.start.line).unwrap_or(1);
        let mut kids: Vec<(Value, Span)> = Vec::new();
        let mut kind_children = |c: &Vec<Node>| kids = c.iter().map(|n| self.node(n)).collect();
        let (kind, container, indent): (&str, bool, bool) = match node {
            Node::Root(n) => {
                kind_children(&n.children);
                ("root", false, false)
            }
            Node::Paragraph(n) => {
                kind_children(&n.children);
                ("paragraph", false, true)
            }
            Node::Heading(n) => {
                o.insert("depth".into(), json!(n.depth));
                kind_children(&n.children);
                ("heading", false, true)
            }
            Node::ThematicBreak(_) => ("thematicBreak", false, true),
            Node::Blockquote(n) => {
                kind_children(&n.children);
                ("blockquote", true, true)
            }
            Node::List(n) => {
                o.insert("ordered".into(), json!(n.ordered));
                o.insert("start".into(), json!(n.start));
                o.insert("spread".into(), json!(n.spread));
                kind_children(&n.children);
                ("list", true, true)
            }
            Node::ListItem(n) => {
                // `spread` of items differs between the two and the frontend does not read it.
                o.insert("checked".into(), json!(n.checked));
                kind_children(&n.children);
                ("listItem", true, true)
            }
            Node::Code(n) => {
                o.insert("value".into(), value(&n.value));
                o.insert("lang".into(), json!(n.lang));
                o.insert("meta".into(), json!(n.meta));
                // Fenced: after the indentation; indented: see below.
                let fenced = {
                    let at = skip_indent(self.src, raw.0, raw.1);
                    at < raw.1 && (self.src[at] == b'`' || self.src[at] == b'~') && self.visual_col(at) < self.visual_col(raw.0) + 4
                };
                if !fenced {
                    o.insert("indented".into(), json!(true));
                }
                ("code", false, fenced)
            }
            Node::Math(n) => {
                o.insert("value".into(), value(&n.value));
                o.insert("meta".into(), json!(n.meta));
                ("math", false, true)
            }
            Node::Yaml(n) => {
                o.insert("value".into(), value(&n.value));
                ("yaml", false, false)
            }
            Node::Toml(n) => {
                o.insert("value".into(), value(&n.value));
                ("toml", false, false)
            }
            Node::Html(n) => {
                o.insert("value".into(), value(&n.value));
                ("html", false, false)
            }
            Node::Table(n) => {
                let align: Vec<Value> = n
                    .align
                    .iter()
                    .map(|a| match a {
                        AlignKind::Left => json!("left"),
                        AlignKind::Right => json!("right"),
                        AlignKind::Center => json!("center"),
                        AlignKind::None => Value::Null,
                    })
                    .collect();
                o.insert("align".into(), Value::Array(align));
                kind_children(&n.children);
                ("table", false, true)
            }
            Node::TableRow(n) => {
                kind_children(&n.children);
                ("tableRow", false, false)
            }
            Node::TableCell(n) => {
                kind_children(&n.children);
                ("tableCell", false, false)
            }
            Node::FootnoteDefinition(n) => {
                o.insert("identifier".into(), json!(n.identifier));
                o.insert("label".into(), json!(self.raw_label(raw, 2).or(n.label.clone())));
                kind_children(&n.children);
                ("footnoteDefinition", true, true)
            }
            Node::Definition(n) => {
                o.insert("identifier".into(), json!(n.identifier));
                o.insert("label".into(), json!(self.raw_label(raw, 1).or(n.label.clone())));
                o.insert("url".into(), json!(n.url));
                o.insert("title".into(), json!(n.title));
                ("definition", false, true)
            }
            Node::Text(n) => {
                // micromark drops the indentation of continuation lines from the text.
                let v = if n.value.contains('\n') { strip_continuation(&n.value) } else { n.value.clone() };
                o.insert("value".into(), value(&v));
                ("text", false, false)
            }
            Node::Break(_) => ("break", false, false),
            Node::Link(n) => {
                o.insert("url".into(), json!(n.url));
                kind_children(&n.children);
                ("link", false, false)
            }
            other => {
                if let Some(c) = other.children() {
                    kind_children(c);
                }
                ("unknown", false, false)
            }
        };
        let _ = container;
        let mut sp = raw;
        if indent {
            sp.0 = skip_indent(self.src, sp.0, sp.1);
        } else if kind == "text" && sp.0 < sp.1 && self.src[sp.0] == b'\t' && self.visual_col(sp.0) + 1 < pos.map_or(0, |p| p.start.column) {
            // Text starting inside a tab a container partly used: micromark starts after it.
            sp.0 += 1;
            if let Some(v) = o.get("value").and_then(|v| v.as_str()).and_then(|v| v.strip_prefix('\t')) {
                let v = v.to_string();
                o.insert("value".into(), json!(v));
            }
        }
        match kind {
            // Items end where their last child ends.
            "listItem" => {
                if let Some((_, last)) = kids.last() {
                    sp.1 = last.1;
                }
            }
            // Lists end before trailing whitespace, but not before their last item.
            "list" => {
                let floor = kids.last().map(|k| k.1 .1).unwrap_or(sp.0);
                while sp.1 > floor && matches!(self.src[sp.1 - 1], b' ' | b'\t' | b'\n' | b'\r') {
                    sp.1 -= 1;
                }
            }
            "code" if o.contains_key("indented") => {
                o.remove("indented");
                // Starting inside a tab a container partly used: micromark keeps the tab's
                // remaining columns as spaces in the value. Not reproduced: unsure.
                if self.visual_col(raw.0) + 1 < pos.map_or(0, |p| p.start.column) {
                    self.unsure.set(true);
                }
            }
            _ => {}
        }
        // A setext heading right after definitions starts where they start (micromark).
        if !kids.is_empty() {
            for i in 1..kids.len() {
                let is_setext = kids[i].0["type"] == "heading" && self.src.get(kids[i].1 .0) != Some(&b'#');
                if !is_setext {
                    continue;
                }
                let mut j = i;
                while j > 0 && kids[j - 1].0["type"] == "definition" && !self.blank_between(kids[j - 1].1 .1, kids[j].1 .0) {
                    j -= 1;
                }
                if j < i {
                    let start = kids[j].1 .0;
                    kids[i].1 .0 = start;
                    kids[i].0["position"]["start"]["offset"] = json!(self.map.at(self.base + start));
                }
            }
        }
        o.insert("type".into(), json!(kind));
        o.insert("position".into(), span_json((sp.0 + self.base, sp.1 + self.base), line + self.line_base, self.map));
        if !kids.is_empty() || node.children().is_some() {
            o.insert("children".into(), Value::Array(kids.into_iter().map(|(v, _)| v).collect()));
        }
        (Value::Object(o), sp)
    }
}

/// Documents larger than this are parsed in parallel parts (markdown-rs parses about
/// 1 MB per second).
const PARALLEL_MIN: usize = 128 * 1024;

/// The block tree of a whole document, as mdast-shaped JSON (see the module comment).
pub fn block_tree(src: &str) -> Value {
    let parts = (std::thread::available_parallelism().map_or(1, |n| n.get())).clamp(1, 8);
    if src.len() < PARALLEL_MIN || parts == 1 {
        return tree_of(src, &split_points(src, usize::MAX));
    }
    tree_of(src, &split_points(src, src.len() / parts))
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

/// Parse the parts between the cut points (in parallel) and join their top-level blocks.
fn tree_of(src: &str, cuts: &[usize]) -> Value {
    let map = Utf16Map::new(src);
    let mut bounds = vec![0usize];
    bounds.extend_from_slice(cuts);
    bounds.push(src.len());
    let lines_before: Vec<usize> = bounds.iter().map(|&b| line_breaks(&src.as_bytes()[..b])).collect();
    let results: Vec<Option<(Vec<Value>, bool)>> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..bounds.len() - 1)
            .map(|i| {
                let (a, b) = (bounds[i], bounds[i + 1]);
                let chunk = &src[a..b];
                let map = &map;
                let line_base = lines_before[i];
                scope.spawn(move || {
                    let root = markdown::to_mdast(chunk, &options(i == 0)).ok()?;
                    let conv = Conv { src: chunk.as_bytes(), base: a, line_base, map, unsure: std::cell::Cell::new(false) };
                    let (tree, _) = conv.node(&root);
                    let kids = match tree.get("children") {
                        Some(Value::Array(k)) => k.clone(),
                        _ => vec![],
                    };
                    Some((kids, conv.unsure.get()))
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().ok().flatten()).collect()
    });
    let mut children = Vec::new();
    let mut unsure = false;
    for r in results {
        let Some((kids, u)) = r else { return Value::Null };
        children.extend(kids);
        unsure |= u;
    }
    let mut tree = json!({
        "type": "root",
        "position": { "start": { "line": 1, "offset": 0 }, "end": { "offset": map.at(src.len()) } },
        "children": children,
    });
    if unsure {
        tree["unsure"] = json!(true);
    }
    tree
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
        let whole = tree_of(&big, &[]);
        let parts = tree_of(&big, &cuts);
        assert!(whole == parts, "parts differ from the whole for the concatenated corpus");
        // Each document on its own, between headings that are cut points when the
        // document leaves nothing open, so no earlier document can hide a mistake.
        let mut checked = 0;
        for d in &docs {
            let one = format!("# a\n\n{d}\n\n# b\n\ntext\n\n# c\n");
            let cuts = split_points(&one, 1);
            checked += cuts.len();
            assert!(tree_of(&one, &[]) == tree_of(&one, &cuts), "parts differ for {d:?}");
        }
        assert!(checked > 1000, "only {checked} cut points over the single documents");
        // And the public entry point, which cuts large documents.
        assert_eq!(block_tree(&big), whole);
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

// ---- compact encoding (Q-027) ---------------------------------------------------------
//
// The JSON block tree of a 1 MB document is about 9 MB; sending it and parsing it in the
// frontend cost more than parsing in Rust saved on fast machines. The tree goes as
// little-endian `u32` words instead, decoded by `src/md/rustblocks.ts` (`decodeTree`):
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

const TYPES: [&str; 21] = [
    "root", "paragraph", "heading", "thematicBreak", "blockquote", "list", "listItem", "code", "math", "yaml", "toml", "html", "table", "tableRow",
    "tableCell", "footnoteDefinition", "definition", "text", "break", "link", "unknown",
];
const NONE: u32 = u32::MAX;

struct Enc {
    words: Vec<u32>,
    strings: Vec<u16>,
    nodes: u32,
}

impl Enc {
    fn string(&mut self, v: &Value) {
        match v.as_str() {
            Some(s) => {
                let start = self.strings.len() as u32;
                self.strings.extend(s.encode_utf16());
                self.words.push(start);
                self.words.push(self.strings.len() as u32 - start);
            }
            None => {
                self.words.push(NONE);
                self.words.push(0);
            }
        }
    }

    fn node(&mut self, n: &Value) {
        self.nodes += 1;
        let ty = n["type"].as_str().unwrap_or("unknown");
        let id = TYPES.iter().position(|t| *t == ty).unwrap_or(TYPES.len() - 1);
        let pos = &n["position"];
        let num = |v: &Value| v.as_u64().map_or(0, |x| x as u32);
        let kids = n["children"].as_array();
        self.words.extend([
            id as u32,
            num(&pos["start"]["offset"]),
            num(&pos["end"]["offset"]),
            num(&pos["start"]["line"]),
            kids.map_or(0, |k| k.len() as u32),
        ]);
        match ty {
            "heading" => self.words.push(num(&n["depth"])),
            "list" => {
                self.words.push(u32::from(n["ordered"].as_bool() == Some(true)));
                self.words.push(n["start"].as_u64().map_or(NONE, |x| x as u32));
                self.words.push(u32::from(n["spread"].as_bool() == Some(true)));
            }
            "listItem" => self.words.push(match n["checked"].as_bool() {
                Some(false) => 0,
                Some(true) => 1,
                None => 2,
            }),
            "code" => {
                self.string(&n["value"]);
                self.string(&n["lang"]);
                self.string(&n["meta"]);
            }
            "math" => {
                self.string(&n["value"]);
                self.string(&n["meta"]);
            }
            "yaml" | "toml" | "html" | "text" => self.string(&n["value"]),
            "table" => {
                let align = n["align"].as_array().cloned().unwrap_or_default();
                self.words.push(align.len() as u32);
                for a in align {
                    self.words.push(match a.as_str() {
                        Some("left") => 1,
                        Some("right") => 2,
                        Some("center") => 3,
                        _ => 0,
                    });
                }
            }
            "footnoteDefinition" => {
                self.string(&n["identifier"]);
                self.string(&n["label"]);
            }
            "definition" => {
                self.string(&n["identifier"]);
                self.string(&n["label"]);
                self.string(&n["url"]);
                self.string(&n["title"]);
            }
            "link" => self.string(&n["url"]),
            _ => {}
        }
        if let Some(kids) = kids {
            for k in kids {
                self.node(k);
            }
        }
    }
}

/// The compact encoding of a block tree (see above); empty for no tree.
pub fn encode_tree(tree: &Value) -> Vec<u8> {
    if tree.is_null() {
        return Vec::new();
    }
    let mut e = Enc { words: Vec::with_capacity(1 << 16), strings: Vec::new(), nodes: 0 };
    e.node(tree);
    let mut out = Vec::with_capacity(16 + e.words.len() * 4 + e.strings.len() * 2);
    out.extend_from_slice(b"SBT1");
    out.extend_from_slice(&(tree.get("unsure").is_some() as u32).to_le_bytes());
    out.extend_from_slice(&e.nodes.to_le_bytes());
    out.extend_from_slice(&(e.strings.len() as u32).to_le_bytes());
    for w in &e.words {
        out.extend_from_slice(&w.to_le_bytes());
    }
    for u in &e.strings {
        out.extend_from_slice(&u.to_le_bytes());
    }
    out
}

/// A reply of a JSON header followed by a block tree (one IPC message, Q-026/Q-027):
/// the header's length as `u32`, the header (UTF-8 JSON), then the encoded tree.
pub fn reply_with_tree(header: &Value, tree: &Value) -> Vec<u8> {
    let head = serde_json::to_vec(header).unwrap_or_default();
    let body = encode_tree(tree);
    let mut out = Vec::with_capacity(4 + head.len() + body.len());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(&body);
    out
}
