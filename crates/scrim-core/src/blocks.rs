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
fn options() -> ParseOptions {
    ParseOptions {
        constructs: Constructs {
            // flow and containers
            block_quote: true,
            code_fenced: true,
            code_indented: true,
            definition: true,
            frontmatter: true,
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
    src: &'a [u8],
    map: Utf16Map,
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
                    kids[i].0["position"]["start"]["offset"] = json!(self.map.at(start));
                }
            }
        }
        o.insert("type".into(), json!(kind));
        o.insert("position".into(), span_json(sp, line, &self.map));
        if !kids.is_empty() || node.children().is_some() {
            o.insert("children".into(), Value::Array(kids.into_iter().map(|(v, _)| v).collect()));
        }
        (Value::Object(o), sp)
    }
}

/// The block tree of a whole document, as mdast-shaped JSON (see the module comment).
pub fn block_tree(src: &str) -> Value {
    match markdown::to_mdast(src, &options()) {
        Ok(root) => {
            let conv = Conv { src: src.as_bytes(), map: Utf16Map::new(src), unsure: std::cell::Cell::new(false) };
            let (mut tree, _) = conv.node(&root);
            if conv.unsure.get() {
                tree["unsure"] = json!(true);
            }
            tree
        }
        // Only MDX can fail to parse, and it is off.
        Err(_) => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
