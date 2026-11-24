// Spell check marks (spec 13). The words come from the rendered text only: text that
// carries a `md-plain` presentation mark (10.3) is plain prose; code, math, URLs and link
// destinations, HTML tags, emoji shortcodes, markers, front matter, and code blocks have
// none. Checking happens in Rust (system dictionaries), 300 ms after typing stops, for
// changed blocks only. Marks are inline decorations; the text is never changed.

import type { Node } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { PRES_META } from "./pres";
import { flushDomFirst } from "./domflush";

export interface SpellConfig {
  enabled: boolean;
  /** dictionary language tag, or null when none is available */
  lang: string | null;
}

export interface SpellHooks {
  /** Indices of the misspelled words. */
  check(lang: string, words: string[]): Promise<number[]>;
  /** The configuration a new document state starts with (loading a file makes one). */
  config(): SpellConfig;
}

export interface Word {
  from: number;
  to: number;
  word: string;
}

interface SpellState {
  config: SpellConfig;
  decos: DecorationSet;
  /** ranges (in the current document) whose blocks need checking */
  dirty: [number, number][];
  /** words ignored in this document for this session */
  ignored: Set<string>;
  /** the word being typed: not marked until the cursor leaves it */
  typing: { from: number; to: number } | null;
  /** counts text changes (not presentation-mark updates): results for an older text are dropped */
  textVersion: number;
}

export const spellKey = new PluginKey<SpellState>("scrim-spell");
const SPELL_META = "scrim-spell";

type Meta =
  | { type: "config"; config: SpellConfig }
  | { type: "result"; textVersion: number; ranges: [number, number][]; done: [number, number][]; bad: Word[] }
  | { type: "ignore"; word: string }
  | { type: "recheck" };

/** Word characters: letters, marks, digits, apostrophes inside a word. */
const WORD = /[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*/gu;

/** Whether a token is checked (13, "What is checked"). */
export function checkable(word: string): boolean {
  if (/[\p{N}_]/u.test(word)) return false; // words with digits
  if (!/\p{L}/u.test(word)) return false;
  if (word.length <= 5 && word === word.toUpperCase() && word !== word.toLowerCase()) return false; // acronyms
  return true;
}

/** Whether a text node is plain prose (not a URL shown as link text). */
function plainProse(marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[]): boolean {
  let plain = false;
  for (const m of marks) {
    if (m.type.name !== "pres") continue;
    const attrs = (m.attrs.attrs ?? {}) as Record<string, string>;
    if (attrs["md-inline"] === "autolink") return false;
    if (String(m.attrs.cls).split(" ").includes("md-plain")) plain = true;
  }
  return plain;
}

/** The checkable words of a textblock at `pos`. */
export function blockWords(node: Node, pos: number): Word[] {
  const out: Word[] = [];
  let run = "";
  let runStart = -1;
  const flush = () => {
    if (!run) return;
    for (const m of run.matchAll(WORD)) {
      if (checkable(m[0])) out.push({ from: runStart + m.index!, to: runStart + m.index! + m[0].length, word: m[0] });
    }
    run = "";
    runStart = -1;
  };
  node.forEach((child, offset) => {
    if (child.isText && plainProse(child.marks)) {
      if (runStart < 0) runStart = pos + 1 + offset;
      run += child.text;
    } else flush();
  });
  flush();
  return out;
}

/** Time per spell-check run for collecting words (Q-027 follow-up). */
const SLICE_MS = 8;

/** The parts of `ranges` outside every range of `cut` (empty parts dropped). */
export function subtract(ranges: [number, number][], cut: [number, number][]): [number, number][] {
  let out = ranges;
  for (const [c, d] of cut) {
    const next: [number, number][] = [];
    for (const [a, b] of out) {
      if (d <= a || c >= b) next.push([a, b]);
      else {
        if (a < c) next.push([a, c]);
        if (d < b) next.push([d, b]);
      }
    }
    out = next;
  }
  return out.filter(([a, b]) => b > a);
}

function proseBlocksIn(doc: Node, from: number, to: number, f: (node: Node, pos: number) => void) {
  const lo = Math.max(0, Math.min(from, doc.content.size));
  const hi = Math.max(lo, Math.min(to, doc.content.size));
  doc.nodesBetween(lo, hi, (node, pos) => {
    if (node.isTextblock) {
      if (!node.type.spec.code) f(node, pos);
      return false;
    }
    return true;
  });
}

/** The word around `pos` (any word, for the typing rule). */
function wordAround(state: EditorState, pos: number): { from: number; to: number } | null {
  const $p = state.doc.resolve(pos);
  if (!$p.parent.isTextblock) return null;
  const text = $p.parent.textBetween(0, $p.parent.content.size, undefined, "￼");
  const at = $p.parentOffset;
  for (const m of text.matchAll(WORD)) {
    if (m.index! <= at && at <= m.index! + m[0].length) return { from: $p.start() + m.index!, to: $p.start() + m.index! + m[0].length };
  }
  return null;
}

function changedRanges(tr: Transaction): [number, number][] {
  const out: [number, number][] = [];
  tr.mapping.maps.forEach((map, i) => {
    map.forEach((_a, _b, from, to) => {
      let f = from;
      let t = to;
      for (const later of tr.mapping.maps.slice(i + 1)) {
        f = later.map(f, -1);
        t = later.map(t, 1);
      }
      out.push([f, t]);
    });
  });
  return out;
}

export function createSpellPlugin(hooks: SpellHooks): Plugin<SpellState> {
  return new Plugin<SpellState>({
    key: spellKey,
    state: {
      init: (_c, state) => ({
        config: hooks.config(),
        decos: DecorationSet.empty,
        dirty: [[0, state.doc.content.size]],
        ignored: new Set(),
        typing: null,
        textVersion: 0,
      }),
      apply(tr, value, _old, state): SpellState {
        const meta = tr.getMeta(SPELL_META) as Meta | undefined;
        let { config, decos, dirty, ignored, typing, textVersion } = value;
        decos = decos.map(tr.mapping, tr.doc);
        dirty = dirty.map(([a, b]) => [tr.mapping.map(a, -1), tr.mapping.map(b, 1)] as [number, number]).filter(([a, b]) => b >= a);
        if (tr.docChanged) {
          const pres = !!tr.getMeta(PRES_META);
          const ranges = changedRanges(tr);
          // Changed blocks: drop their marks until they are checked again.
          for (const [a, b] of ranges) {
            proseBlocksIn(tr.doc, a, b, (node, pos) => {
              if (!pres) decos = decos.remove(decos.find(pos, pos + node.nodeSize));
              dirty.push([pos, pos + node.nodeSize]);
            });
          }
          if (!pres) {
            textVersion++;
            typing = tr.selection.empty ? wordAround(state, tr.selection.head) : null;
          }
        }
        if (typing) {
          typing = { from: tr.mapping.map(typing.from, -1), to: tr.mapping.map(typing.to, 1) };
          const h = state.selection.head;
          if (!state.selection.empty || h < typing.from || h > typing.to) {
            // The cursor left the word: check its block now.
            dirty.push([typing.from, typing.to]);
            typing = null;
          }
        }
        if (meta?.type === "config") {
          config = meta.config;
          decos = DecorationSet.empty;
          dirty = [[0, state.doc.content.size]];
        } else if (meta?.type === "ignore") {
          ignored = new Set(ignored).add(meta.word);
          decos = decos.remove(decos.find(undefined, undefined, (spec) => spec.word === meta.word));
        } else if (meta?.type === "recheck") {
          decos = DecorationSet.empty;
          dirty = [[0, state.doc.content.size]];
        } else if (meta?.type === "result" && meta.textVersion === textVersion) {
          for (const [a, b] of meta.ranges) decos = decos.remove(decos.find(a, b));
          const add = meta.bad
            .filter((w) => !ignored.has(w.word))
            .map((w) => Decoration.inline(w.from, w.to, { class: "md-spell-error" }, { word: w.word }));
          decos = decos.add(state.doc, add);
          // Ranges checked are clean unless changed since (they were mapped above).
          dirty = subtract(dirty, meta.done);
        }
        if (!config.enabled || !config.lang) decos = DecorationSet.empty;
        return { config, decos, dirty, ignored, typing, textVersion };
      },
    },
    props: {
      decorations(state) {
        const st = spellKey.getState(state);
        if (!st || !st.config.enabled) return null;
        if (!st.typing) return st.decos;
        const t = st.typing;
        return st.decos.remove(st.decos.find(t.from, t.to));
      },
    },
    view(view) {
      let timer = 0;
      let running = false;
      /** The last run checked only part of what is dirty: the next one starts at once,
       * unless the text changed since (typing keeps the 300 ms pause). */
      let more = false;
      let ranAt = -1;
      const run = async () => {
        timer = 0;
        const st = spellKey.getState(view.state);
        if (!st || !st.config.enabled || !st.config.lang || !st.dirty.length || view.isDestroyed) return;
        if (running) {
          timer = window.setTimeout(run, 300);
          return;
        }
        running = true;
        const state = view.state;
        const words: Word[] = [];
        const ranges: [number, number][] = [];
        const seen = new Set<number>();
        /** What this run checked of the dirty ranges (blocks found in them go in `ranges`). */
        const done: [number, number][] = [];
        // At most SLICE_MS of blocks per run (a whole 10,000-line document took one 60 ms
        // task); the rest stays dirty and the next run follows at once (Q-028 follow-up).
        const end = performance.now() + SLICE_MS;
        let partial = false;
        for (const [a, b] of st.dirty) {
          let stopAt: number | null = null;
          proseBlocksIn(state.doc, a, b, (node, pos) => {
            if (stopAt !== null || seen.has(pos)) return;
            if (words.length && performance.now() > end) {
              stopAt = pos;
              return;
            }
            seen.add(pos);
            ranges.push([pos, pos + node.nodeSize]);
            words.push(...blockWords(node, pos));
          });
          done.push([a, stopAt ?? b]);
          if (stopAt !== null) {
            partial = true;
            break;
          }
        }
        more = partial;
        ranAt = st.textVersion;
        const unique = [...new Set(words.map((w) => w.word))];
        try {
          const bad = new Set((unique.length ? await hooks.check(st.config.lang, unique) : []).map((i) => unique[i]));
          if (!view.isDestroyed) {
            flushDomFirst(view);
            const meta: Meta = { type: "result", textVersion: st.textVersion, ranges, done: [...done, ...ranges], bad: words.filter((w) => bad.has(w.word)) };
            view.dispatch(view.state.tr.setMeta(SPELL_META, meta).setMeta("addToHistory", false));
          }
        } catch {
          /* no dictionary for this language: no marks */
        } finally {
          running = false;
        }
      };
      return {
        update(v) {
          const st = spellKey.getState(v.state);
          if (!st?.config.enabled || !st.dirty.length) return;
          clearTimeout(timer);
          timer = window.setTimeout(run, more && st.textVersion === ranAt ? 0 : 300);
        },
        destroy() {
          clearTimeout(timer);
        },
      };
    },
  });
}

export function setSpellConfig(view: EditorView, config: SpellConfig) {
  view.dispatch(view.state.tr.setMeta(SPELL_META, { type: "config", config } satisfies Meta).setMeta("addToHistory", false));
}

export function recheckSpelling(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(SPELL_META, { type: "recheck" } satisfies Meta).setMeta("addToHistory", false));
}

export function ignoreWord(view: EditorView, word: string) {
  view.dispatch(view.state.tr.setMeta(SPELL_META, { type: "ignore", word } satisfies Meta).setMeta("addToHistory", false));
}

/** The marked word at `pos`, if any. */
export function misspelledAt(state: EditorState, pos: number): Word | null {
  const st = spellKey.getState(state);
  if (!st) return null;
  const d = st.decos.find(pos, pos).find((x) => x.from <= pos && pos <= x.to);
  return d ? { from: d.from, to: d.to, word: (d.spec as { word: string }).word } : null;
}
