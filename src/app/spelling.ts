// Spell check in the window (spec 13): which dictionary applies, the editor's marks,
// suggestions, the personal dictionary.

import { invoke } from "@tauri-apps/api/core";
import type { EditorView } from "prosemirror-view";
import { ignoreWord, misspelledAt, recheckSpelling, setSpellConfig, type SpellConfig, type Word } from "../editor/spell";

type Setting = <T>(key: string, fallback: T) => T;

export interface SpellInfo {
  available: boolean;
  languages: string[];
  auto: string | null;
  hint: string | null;
}

/** A requested language matched to an available one: exactly, else by primary language. */
export function matchLanguage(langs: string[], want: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/_/g, "-");
  const w = norm(want);
  return langs.find((l) => norm(l) === w) ?? langs.find((l) => norm(l).split("-")[0] === w.split("-")[0]) ?? null;
}

export class Spelling {
  info: SpellInfo = { available: false, languages: [], auto: null, hint: null };
  /** front matter `lang` of the document */
  private docLang: string | null = null;
  private current: SpellConfig = { enabled: false, lang: null };
  onChange: (() => void)[] = [];

  constructor(
    private view: () => EditorView,
    private setting: Setting,
  ) {}

  async init() {
    this.info = await invoke<SpellInfo>("spell_info").catch(() => this.info);
    this.apply();
  }

  /** The configuration documents start with (a new editor state). */
  config(): SpellConfig {
    return this.current;
  }

  /** The language in effect: front matter `lang`, else the setting, else Auto (13). */
  language(): string | null {
    const langs = this.info.languages;
    if (this.docLang) {
      const m = matchLanguage(langs, this.docLang);
      if (m) return m;
    }
    const pick = this.setting("spellLanguage", "auto");
    if (pick && pick !== "auto") {
      const m = matchLanguage(langs, pick);
      if (m) return m;
    }
    return this.info.auto;
  }

  enabled(): boolean {
    return this.setting("spellCheck", true);
  }

  setDocumentLanguage(lang: string | null) {
    if (lang === this.docLang) return;
    this.docLang = lang;
    this.apply();
  }

  /** Settings or dictionaries changed: re-derive and, if different, re-check. */
  apply() {
    const next: SpellConfig = { enabled: this.enabled() && this.info.available, lang: this.language() };
    if (next.enabled === this.current.enabled && next.lang === this.current.lang) {
      for (const f of this.onChange) f();
      return;
    }
    this.current = next;
    setSpellConfig(this.view(), next);
    for (const f of this.onChange) f();
  }

  check(lang: string, words: string[]): Promise<number[]> {
    return invoke<number[]>("spell_check", { lang, words });
  }

  wordAt(pos: number): Word | null {
    return misspelledAt(this.view().state, pos);
  }

  suggestions(word: string): Promise<string[]> {
    const lang = this.current.lang;
    return lang ? invoke<string[]>("spell_suggest", { lang, word }).catch(() => []) : Promise.resolve([]);
  }

  /** Replace a marked word with a suggestion: one undo step. */
  replace(w: Word, text: string) {
    const view = this.view();
    view.dispatch(view.state.tr.insertText(text, w.from, w.to).scrollIntoView());
    view.focus();
  }

  async addToDictionary(word: string) {
    await invoke("spell_add", { word });
    recheckSpelling(this.view());
  }

  ignore(word: string) {
    ignoreWord(this.view(), word);
  }

  openPersonalDictionary() {
    void invoke("spell_open_personal");
  }

  /** The personal dictionary may have been edited outside Scrim. */
  async reloadPersonal() {
    await invoke("spell_reload_personal");
    recheckSpelling(this.view());
  }
}
