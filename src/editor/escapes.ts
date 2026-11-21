// Parse/display invariant with automatic escapes (spec 01, "Round-trip model" item 6).
//
// After an edit, each changed paragraph's source must still parse as exactly one
// paragraph with the same lines. A line that would start another block (or, on the
// first line, a definition or code) gets a minimal backslash escape, inserted with the
// `auto_escape` mark. Automatic escapes that are no longer needed are removed again;
// backslashes the user typed are never touched.
//
// QA-LOG Q-010: deferral for input-rule triggers. Deferred escapes are applied when the
// cursor leaves and before every write or hand-off of the text (save, copy; from later
// phases autosave, draft recovery, export, and source mode, all of which take the text
// through `Editor.markdown()` or `flushEscapes`).
// Enter-triggered input rules (```, ~~~, $$, ---, ***, ___, an HTML open tag) are
// typed on a paragraph's only line and fire on Enter (3.3), so while the cursor is at
// the end of such a paragraph its escape is deferred until the cursor leaves or the
// document is saved.

import type { Node } from "prosemirror-model";
import { isHistoryTransaction } from "prosemirror-history";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { parseMdast } from "../md/mdast";
import { schema } from "../md/schema";
import { blockSource } from "./context";
import { changedRanges } from "./decorations";

const CANDIDATE = /^ {0,3}(?:[#>\-+*`~$=_<|\[:]|\d{1,9}[.)])|^[ \t]/;
const ENTER_TRIGGER = /^(?:`{3,}[^`]*|~{3,}.*|\$\$|(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\/?>.*)$/;

export interface EscapeOptions {
  inlineMath: boolean;
}

/** True when `lines` parse as exactly one paragraph spanning all of them. */
function isOneParagraph(lines: string[], opts: EscapeOptions): boolean {
  const text = lines.join("\n");
  const root = parseMdast(text, { inlineMath: opts.inlineMath, frontMatter: false });
  if (root.children.length !== 1) return false;
  const p = root.children[0];
  if (p.type !== "paragraph") return false;
  return p.position!.start.offset! <= /^[ \t]*/.exec(text)![0].length && p.position!.end.offset! >= text.trimEnd().length;
}

/** Index of the first line that breaks the paragraph, or -1. */
export function offendingLine(lines: string[], opts: EscapeOptions): number {
  if (!lines.some((l, i) => CANDIDATE.test(l) || (i === 0 && /^[ \t]/.test(l)))) {
    // Cheap pre-check: no line can start a block. (A blank line cannot occur: it would
    // have split the paragraph.)
    return -1;
  }
  for (let k = 0; k < lines.length; k++) {
    if (!isOneParagraph(lines.slice(0, k + 1), opts)) return k;
  }
  return -1;
}

/** Offset (within the line) where to insert "\", or a leading-space count to delete. */
export function escapeFor(line: string, first: boolean): { insertAt: number } | { deleteLeading: number } | null {
  const lead = /^[ \t]*/.exec(line)![0].length;
  if (first && lead > 0) return { deleteLeading: lead };
  const rest = line.slice(lead);
  if (!rest) return null;
  const ordered = /^\d{1,9}(?=[.)])/.exec(rest);
  if (ordered) return { insertAt: lead + ordered[0].length };
  return { insertAt: lead };
}

interface Line {
  text: string;
  /** offset of the line's first character in the block */
  start: number;
}

function linesOf(node: Node): Line[] {
  const src = blockSource(node);
  const out: Line[] = [];
  let start = 0;
  for (const text of src.split("\n")) {
    out.push({ text, start });
    start += text.length + 1;
  }
  return out;
}

/** Positions (absolute) of automatic escape backslashes in a block. */
function autoEscapes(node: Node, pos: number): number[] {
  const out: number[] = [];
  node.forEach((child, offset) => {
    if (child.isText && child.marks.some((m) => m.type === schema.marks.auto_escape)) {
      for (let i = 0; i < child.text!.length; i++) if (child.text![i] === "\\") out.push(pos + 1 + offset + i);
    }
  });
  return out;
}

/** Text that may still become a space-triggered input rule (3.3) once " " is typed. */
const SPACE_TRIGGER_PREFIX = /^(?:#{1,6}|>|[-*+]|\d{1,9}[.)])$/;

function deferred(state: EditorState, node: Node, pos: number): boolean {
  if (node.childCount === 0) return false;
  const src = blockSource(node);
  if (src.includes("\n")) return false;
  const { $head, empty } = state.selection;
  if (!empty || $head.parent !== node || $head.before() !== pos) return false;
  if (SPACE_TRIGGER_PREFIX.test(src.slice(0, $head.parentOffset))) return true;
  return $head.parentOffset === node.content.size && ENTER_TRIGGER.test(src);
}

/** Fix one paragraph in `tr`. Returns true if it changed anything. */
function fixParagraph(tr: Transaction, pos: number, opts: EscapeOptions, state: EditorState, force: boolean): boolean {
  let changed = false;
  for (let guard = 0; guard < 64; guard++) {
    const node = tr.doc.nodeAt(pos);
    if (!node || node.type !== schema.nodes.paragraph) return changed;
    // 1. Drop automatic escapes that are no longer needed.
    let removed = false;
    const src = blockSource(node);
    for (const at of autoEscapes(node, pos)) {
      const off = at - pos - 1;
      const without = src.slice(0, off) + src.slice(off + 1);
      if (offendingLine(without.split("\n"), opts) < 0) {
        tr.delete(at, at + 1);
        removed = changed = true;
        break;
      }
    }
    if (removed) continue;
    // 2. Escape the first line that breaks the paragraph.
    const lines = linesOf(node);
    const k = offendingLine(lines.map((l) => l.text), opts);
    if (k < 0) return changed;
    if (k === 0 && !force && lines.length === 1 && deferred(state, node, pos)) return changed;
    const fix = escapeFor(lines[k].text, k === 0);
    if (!fix) return changed;
    const at = pos + 1 + lines[k].start;
    if ("deleteLeading" in fix) tr.delete(at, at + fix.deleteLeading);
    else tr.insert(at + fix.insertAt, schema.text("\\", [schema.marks.auto_escape.create()]));
    changed = true;
  }
  return changed;
}

const RECHECK = "scrim-recheck-escapes";
/** Set on the typed space of an input rule: the transformation follows immediately. */
export const SKIP_ESCAPES = "scrim-skip-escapes";

export const escapeKey = new PluginKey<{ pending: number | null }>("scrim-escapes");

/** Transaction applying all deferred escapes, or null if there are none. */
export function flushEscapesTr(state: EditorState, opts: EscapeOptions): Transaction | null {
  const tr = state.tr;
  let changed = false;
  state.doc.descendants((node, pos) => {
    if (node.type === schema.nodes.paragraph) {
      if (fixParagraph(tr, tr.mapping.map(pos), opts, state, true)) changed = true;
      return false;
    }
    return !node.isTextblock;
  });
  return changed ? tr : null;
}

/** Apply deferred escapes now, before the text leaves the editor (Q-010). */
export function flushEscapes(view: EditorView, opts: EscapeOptions) {
  const tr = flushEscapesTr(view.state, opts);
  if (tr) view.dispatch(tr);
}

export function createEscapePlugin(opts: EscapeOptions): Plugin {
  let composing = false;
  return new Plugin({
    key: escapeKey,
    appendTransaction(trs, oldState, state) {
      // Undo/redo restore earlier states exactly; their escapes apply once the cursor
      // leaves the paragraph or on save.
      if (composing || trs.some((t) => t.getMeta(SKIP_ESCAPES) || isHistoryTransaction(t))) return null;
      const tr = state.tr;
      const blocks = new Set<number>();
      trs.forEach((t, i) => {
        if (!t.docChanged) return;
        for (const [from, to] of changedRanges(t)) {
          let a = from;
          let b = to;
          for (const later of trs.slice(i + 1)) {
            a = later.mapping.map(a, -1);
            b = later.mapping.map(b, 1);
          }
          const lo = Math.min(a, state.doc.content.size);
          const hi = Math.min(Math.max(lo, b), state.doc.content.size);
          state.doc.nodesBetween(lo, hi, (node, pos) => {
            if (node.type === schema.nodes.paragraph) blocks.add(pos);
            return !node.isTextblock;
          });
        }
      });
      if (trs.some((t) => t.getMeta(RECHECK)) && state.selection.$head.parent.type === schema.nodes.paragraph) {
        blocks.add(state.selection.$head.before());
      }
      // A deferred trigger paragraph the cursor just left.
      const $old = oldState.selection.$head;
      if (!oldState.selection.eq(state.selection) && $old.parent.type === schema.nodes.paragraph) {
        const oldPos = $old.before();
        const mapped = trs.reduce((p, t) => t.mapping.map(p), oldPos);
        const node = state.doc.nodeAt(mapped);
        if (node?.type === schema.nodes.paragraph && state.selection.$head.parent !== node) blocks.add(mapped);
      }
      if (!blocks.size) return null;
      let changed = false;
      for (const pos of [...blocks].sort((a, b) => b - a)) {
        if (fixParagraph(tr, pos, opts, state, false)) changed = true;
      }
      return changed ? tr : null;
    },
    props: {
      handleDOMEvents: {
        compositionstart() {
          composing = true;
          return false;
        },
        compositionend(view: EditorView) {
          composing = false;
          setTimeout(() => view.dispatch(view.state.tr.setMeta(RECHECK, true)), 0);
          return false;
        },
      },
    },
  });
}
