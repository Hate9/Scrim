//! Spell check with the system's dictionaries (spec 13). No dictionary is bundled or
//! downloaded.
//!
//! `SpellProvider` has one implementation per platform: Hunspell-format dictionaries
//! from the standard locations, read with `spellbook` (pure Rust) on Linux; the Windows
//! Spell Checking API on Windows. The frontend decides what is a word worth checking
//! (13, "What is checked") and sends batches; checking runs on a blocking worker thread.
//! The personal dictionary (`<config>/dictionary.txt`) is Scrim's own, shared by all
//! languages, and applied here on every platform.

use std::collections::HashSet;
#[cfg(not(windows))]
use std::collections::HashMap;
#[cfg(not(windows))]
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

pub const UNAVAILABLE_HINT: &str = "Install hunspell dictionaries for your language with your package manager (for example `hunspell-en_us`)";

pub trait SpellProvider: Send + Sync {
    /// Available languages as BCP 47 tags (`en-US`).
    fn languages(&self) -> Vec<String>;
    /// Indices of the misspelled words.
    fn check(&self, lang: &str, words: &[String]) -> Result<Vec<usize>, String>;
    fn suggest(&self, lang: &str, word: &str) -> Result<Vec<String>, String>;
    /// The system's locale as a BCP 47 tag, for "Auto".
    fn system_locale(&self) -> Option<String>;
}

/// `en_US` → `en-US`.
#[cfg(not(windows))]
pub fn tag(stem: &str) -> String {
    stem.replace('_', "-")
}

/// "Auto" (13): the dictionary matching the locale, then the first English one, then the
/// first available.
pub fn auto_language(langs: &[String], locale: Option<&str>) -> Option<String> {
    let norm = |s: &str| s.to_ascii_lowercase().replace('_', "-");
    if let Some(loc) = locale {
        let loc = norm(loc.split(['.', '@']).next().unwrap_or(loc));
        if let Some(l) = langs.iter().find(|l| norm(l) == loc) {
            return Some(l.clone());
        }
        let primary = loc.split('-').next().unwrap_or("");
        if let Some(l) = langs.iter().find(|l| norm(l).split('-').next() == Some(primary)) {
            return Some(l.clone());
        }
    }
    langs.iter().find(|l| norm(l).starts_with("en")).or(langs.first()).cloned()
}

// ---- Linux: Hunspell dictionaries -----------------------------------------------------

#[cfg(not(windows))]
pub struct HunspellProvider {
    found: HashMap<String, (PathBuf, PathBuf)>,
    loaded: Mutex<HashMap<String, Arc<spellbook::Dictionary>>>,
}

/// Standard Hunspell locations (13), `$DICPATH` first.
#[cfg(not(windows))]
pub fn dictionary_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(p) = std::env::var_os("DICPATH") {
        dirs.extend(std::env::split_paths(&p));
    }
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join(".local/share/hunspell"));
    }
    for d in ["/usr/share/hunspell", "/usr/share/myspell", "/usr/share/myspell/dicts"] {
        dirs.push(PathBuf::from(d));
    }
    dirs
}

/// Pairs of `<lang>.dic` and `<lang>.aff` (the first location wins for a name).
#[cfg(not(windows))]
pub fn find_dictionaries(dirs: &[PathBuf]) -> HashMap<String, (PathBuf, PathBuf)> {
    let mut out = HashMap::new();
    for d in dirs {
        let Ok(rd) = std::fs::read_dir(d) else { continue };
        let mut names: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).collect();
        names.sort();
        for p in names {
            if p.extension().and_then(|e| e.to_str()) != Some("dic") {
                continue;
            }
            let aff = p.with_extension("aff");
            let Some(stem) = p.file_stem().and_then(|s| s.to_str()) else { continue };
            // Hyphenation and thesaurus files share the folder.
            if stem.starts_with("hyph_") || stem.starts_with("th_") || !aff.is_file() {
                continue;
            }
            out.entry(tag(stem)).or_insert((aff, p));
        }
    }
    out
}

/// Text of a dictionary file in the encoding its `.aff` names (`SET`).
#[cfg(not(windows))]
fn read_in(path: &Path, set: Option<&str>) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let enc = set.and_then(|s| encoding_rs::Encoding::for_label(s.trim().as_bytes())).unwrap_or(encoding_rs::UTF_8);
    Ok(enc.decode(&bytes).0.into_owned())
}

#[cfg(not(windows))]
fn aff_set(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    String::from_utf8_lossy(&bytes).lines().find_map(|l| l.strip_prefix("SET ").map(|s| s.trim().to_string()))
}

#[cfg(not(windows))]
impl HunspellProvider {
    pub fn new() -> Self {
        Self { found: find_dictionaries(&dictionary_dirs()), loaded: Mutex::new(HashMap::new()) }
    }

    fn dict(&self, lang: &str) -> Result<Arc<spellbook::Dictionary>, String> {
        if let Some(d) = self.loaded.lock().map_err(|e| e.to_string())?.get(lang) {
            return Ok(d.clone());
        }
        let (aff, dic) = self.found.get(lang).ok_or_else(|| format!("no dictionary for {lang}"))?;
        let set = aff_set(aff);
        let d = spellbook::Dictionary::new(&read_in(aff, set.as_deref())?, &read_in(dic, set.as_deref())?).map_err(|e| format!("{lang}: {e}"))?;
        let d = Arc::new(d);
        self.loaded.lock().map_err(|e| e.to_string())?.insert(lang.to_string(), d.clone());
        Ok(d)
    }
}

#[cfg(not(windows))]
impl SpellProvider for HunspellProvider {
    fn languages(&self) -> Vec<String> {
        let mut l: Vec<String> = self.found.keys().cloned().collect();
        l.sort();
        l
    }
    fn check(&self, lang: &str, words: &[String]) -> Result<Vec<usize>, String> {
        let d = self.dict(lang)?;
        Ok(words.iter().enumerate().filter(|(_, w)| !d.check(w)).map(|(i, _)| i).collect())
    }
    fn suggest(&self, lang: &str, word: &str) -> Result<Vec<String>, String> {
        let d = self.dict(lang)?;
        let mut out = Vec::new();
        d.suggest(word, &mut out);
        Ok(out)
    }
    fn system_locale(&self) -> Option<String> {
        ["LC_ALL", "LC_MESSAGES", "LANG"].iter().find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty() && v != "C" && v != "POSIX"))
    }
}

// ---- Windows: Spell Checking API ------------------------------------------------------

#[cfg(windows)]
pub struct WindowsProvider;

#[cfg(windows)]
mod win {
    use windows::core::{Interface, HSTRING, PWSTR};
    use windows::Win32::Globalization::{ISpellChecker, ISpellCheckerFactory, SpellCheckerFactory};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, IEnumString, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};

    fn factory() -> Result<ISpellCheckerFactory, String> {
        unsafe {
            // Idempotent per thread; checking runs on blocking worker threads.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            CoCreateInstance(&SpellCheckerFactory, None, CLSCTX_INPROC_SERVER).map_err(|e| e.message().to_string())
        }
    }

    fn strings(e: IEnumString) -> Vec<String> {
        let mut out = Vec::new();
        unsafe {
            loop {
                let mut item = [PWSTR::null()];
                let mut got = 0u32;
                if e.Next(&mut item, Some(&mut got)).is_err() || got == 0 {
                    break;
                }
                if let Ok(s) = item[0].to_string() {
                    out.push(s);
                }
                CoTaskMemFree(Some(item[0].0 as *const _));
            }
        }
        out
    }

    pub fn languages() -> Vec<String> {
        factory().ok().and_then(|f| unsafe { f.SupportedLanguages().ok() }).map(strings).unwrap_or_default()
    }

    fn checker(lang: &str) -> Result<ISpellChecker, String> {
        unsafe { factory()?.CreateSpellChecker(&HSTRING::from(lang)).map_err(|e| e.message().to_string()) }
    }

    pub fn misspelled(lang: &str, words: &[String]) -> Result<Vec<usize>, String> {
        let c = checker(lang)?;
        let mut out = Vec::new();
        for (i, w) in words.iter().enumerate() {
            unsafe {
                let errors = c.Check(&HSTRING::from(w.as_str())).map_err(|e| e.message().to_string())?;
                let mut first = None;
                if errors.Next(&mut first).is_ok() && first.is_some() {
                    out.push(i);
                }
            }
        }
        Ok(out)
    }

    pub fn suggest(lang: &str, word: &str) -> Result<Vec<String>, String> {
        let c = checker(lang)?;
        unsafe { c.Suggest(&HSTRING::from(word)).map(strings).map_err(|e| e.message().to_string()) }
    }

    pub fn locale() -> Option<String> {
        let mut buf = [0u16; 85];
        let n = unsafe { windows::Win32::Globalization::GetUserDefaultLocaleName(&mut buf) };
        (n > 1).then(|| String::from_utf16_lossy(&buf[..(n as usize - 1)]))
    }

    #[allow(dead_code)]
    fn _assert_interface<T: Interface>() {}
}

#[cfg(windows)]
impl SpellProvider for WindowsProvider {
    fn languages(&self) -> Vec<String> {
        win::languages()
    }
    fn check(&self, lang: &str, words: &[String]) -> Result<Vec<usize>, String> {
        win::misspelled(lang, words)
    }
    fn suggest(&self, lang: &str, word: &str) -> Result<Vec<String>, String> {
        win::suggest(lang, word)
    }
    fn system_locale(&self) -> Option<String> {
        win::locale()
    }
}

// ---- state and commands ---------------------------------------------------------------

pub struct Spell {
    provider: Arc<dyn SpellProvider>,
    personal: Mutex<Option<HashSet<String>>>,
}

impl Default for Spell {
    fn default() -> Self {
        #[cfg(windows)]
        let provider: Arc<dyn SpellProvider> = Arc::new(WindowsProvider);
        #[cfg(not(windows))]
        let provider: Arc<dyn SpellProvider> = Arc::new(HunspellProvider::new());
        Self { provider, personal: Mutex::new(None) }
    }
}

fn personal_path(state: &AppState) -> PathBuf {
    state.config_dir.join("dictionary.txt")
}

impl Spell {
    fn personal(&self, state: &AppState) -> HashSet<String> {
        let mut p = self.personal.lock().unwrap_or_else(|e| e.into_inner());
        p.get_or_insert_with(|| {
            std::fs::read_to_string(personal_path(state)).map(|t| t.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect()).unwrap_or_default()
        })
        .clone()
    }
    /// The file may be edited outside Scrim (Open Personal Dictionary): read it again.
    pub fn reload_personal(&self) {
        *self.personal.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellInfo {
    pub available: bool,
    pub languages: Vec<String>,
    /// what "Auto" means on this system
    pub auto: Option<String>,
    pub hint: Option<String>,
}

/// Debug builds only: L-3 hides every dictionary with this file in the config folder.
fn test_no_dictionaries(state: &AppState) -> bool {
    cfg!(debug_assertions) && state.config_dir.join("test-no-dictionaries").exists()
}

#[tauri::command]
pub async fn spell_info(spell: State<'_, Spell>, state: State<'_, AppState>) -> Result<SpellInfo, String> {
    let provider = spell.provider.clone();
    let none = test_no_dictionaries(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let languages = if none { Vec::new() } else { provider.languages() };
        let auto = auto_language(&languages, provider.system_locale().as_deref());
        SpellInfo {
            available: !languages.is_empty(),
            hint: languages.is_empty().then(|| if cfg!(windows) { "Add a language with spelling support in Windows Settings → Time & language".to_string() } else { UNAVAILABLE_HINT.to_string() }),
            languages,
            auto,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Indices of the misspelled words (words in the personal dictionary never are).
#[tauri::command]
pub async fn spell_check(spell: State<'_, Spell>, state: State<'_, AppState>, lang: String, words: Vec<String>) -> Result<Vec<usize>, String> {
    let personal = spell.personal(&state);
    let provider = spell.provider.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let wrong = provider.check(&lang, &words)?;
        Ok(wrong.into_iter().filter(|&i| !in_personal(&personal, &words[i])).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn in_personal(personal: &HashSet<String>, word: &str) -> bool {
    personal.contains(word) || personal.contains(&word.to_lowercase())
}

/// Up to six suggestions (13, "Context menu").
#[tauri::command]
pub async fn spell_suggest(spell: State<'_, Spell>, lang: String, word: String) -> Result<Vec<String>, String> {
    let provider = spell.provider.clone();
    tauri::async_runtime::spawn_blocking(move || provider.suggest(&lang, &word).map(|mut s| {
        s.truncate(6);
        s
    }))
    .await
    .map_err(|e| e.to_string())?
}

/// Add to Dictionary: appended to `<config>/dictionary.txt`.
#[tauri::command]
pub fn spell_add(spell: State<'_, Spell>, state: State<'_, AppState>, word: String) -> Result<(), String> {
    let word = word.trim().to_string();
    if word.is_empty() || word.contains(['\n', '\r']) {
        return Err("not a word".into());
    }
    let path = personal_path(&state);
    let mut text = std::fs::read_to_string(&path).unwrap_or_default();
    if text.lines().any(|l| l.trim() == word) {
        return Ok(());
    }
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&word);
    text.push('\n');
    scrim_core::save::save(&path, text.as_bytes()).map_err(|e| e.to_string())?;
    spell.reload_personal();
    Ok(())
}

/// Edit → Spell Check ▸ Open Personal Dictionary: the system's text editor, detached.
#[tauri::command]
pub fn spell_open_personal(app: tauri::AppHandle, spell: State<'_, Spell>, state: State<'_, AppState>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = personal_path(&state);
    if !path.exists() {
        std::fs::write(&path, "").map_err(|e| e.to_string())?;
    }
    spell.reload_personal();
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Re-read the personal dictionary (after it was edited outside Scrim).
#[tauri::command]
pub fn spell_reload_personal(spell: State<'_, Spell>) {
    spell.reload_personal();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_and_match() {
        let langs = vec!["de-DE".to_string(), "en-GB".to_string(), "en-US".to_string()];
        assert_eq!(auto_language(&langs, Some("de_DE.UTF-8")).as_deref(), Some("de-DE"));
        assert_eq!(auto_language(&langs, Some("de_AT.UTF-8")).as_deref(), Some("de-DE"));
        assert_eq!(auto_language(&langs, Some("fr_FR.UTF-8")).as_deref(), Some("en-GB"));
        assert_eq!(auto_language(&["fr-FR".to_string()], None).as_deref(), Some("fr-FR"));
        assert_eq!(auto_language(&[], None), None);
    }

    #[cfg(not(windows))]
    #[test]
    fn hunspell_dictionaries() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("xx_XX.aff"), "SET UTF-8\nTRY esianrt\n").unwrap();
        std::fs::write(d.path().join("xx_XX.dic"), "3\nthe\nword\nhello\n").unwrap();
        std::fs::write(d.path().join("hyph_xx_XX.dic"), "x").unwrap();
        let found = find_dictionaries(&[d.path().to_path_buf()]);
        assert_eq!(found.keys().collect::<Vec<_>>(), vec!["xx-XX"]);
        let p = HunspellProvider { found, loaded: Mutex::new(HashMap::new()) };
        let words: Vec<String> = ["the", "teh", "hello"].iter().map(|s| s.to_string()).collect();
        assert_eq!(p.check("xx-XX", &words).unwrap(), vec![1]);
        assert!(p.suggest("xx-XX", "teh").unwrap().contains(&"the".to_string()));
    }
}
