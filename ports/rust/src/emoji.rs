//! Emoji for terminals: `emoji("fire")` is 🔥 where the terminal draws emoji
//! and `[fire]` where it cannot.
//!
//! The built-in pack is OpenEmoji (<https://logicsrc.com/openemoji>), on by
//! default, generated into `emoji_data.rs` from the same set as the
//! TypeScript reference. A name can be the shortcode with or without `oe_` and
//! colons, the CLDR name, a common alias (`thumbsup`, `+1`, `heart`) or the
//! emoji itself. Which you get: [`set_emoji_mode`] if the app chose;
//! `HQTUI_EMOJI=emoji|text`; otherwise emoji where the terminal draws Unicode
//! and is not the Linux console, and text elsewhere. Text is an emoticon where
//! one fits (`:)` `<3` `:D`) and the name in brackets elsewhere.
//! `string_width` counts every emoji here as two columns.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use crate::capabilities::{detect_unicode, process_env, Env};
use crate::emoji_data::{
    OPENEMOJI_ALIASES, OPENEMOJI_EMOTICONS, OPENEMOJI_GROUPS, OPENEMOJI_ROWS, OPENEMOJI_TONED,
};
pub use crate::emoji_data::{OPENEMOJI_UNICODE, OPENEMOJI_VERSION};

/// The emoji, or its text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmojiMode {
    Emoji,
    Text,
}

/// Everything the built-in pack knows about one emoji.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmojiInfo {
    /// Fully-qualified codepoints, lowercase hex, hyphen-joined.
    pub key: String,
    pub char: String,
    /// The CLDR short name.
    pub name: String,
    /// The set's shortcode, `oe_` included.
    pub shortcode: String,
    pub group: String,
    pub keywords: Vec<String>,
    /// The toneless emoji a skin-tone variant belongs to; empty otherwise.
    pub base: String,
}

const TONES: [&str; 5] = ["1f3fb", "1f3fc", "1f3fd", "1f3fe", "1f3ff"];
const TONE_NAMES: [&str; 5] = ["light", "medium-light", "medium", "medium-dark", "dark"];

/// The shortcode a name reduces to; rows store theirs only when it differs.
pub fn emoji_slug(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut gap = false;
    for c in name.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            if gap && !out.is_empty() {
                out.push('_');
            }
            gap = false;
            out.push(c);
        } else {
            gap = true;
        }
    }
    out
}

fn char_of(key: &str) -> String {
    key.split('-')
        .filter_map(|h| u32::from_str_radix(h, 16).ok().and_then(char::from_u32))
        .collect()
}

struct Table {
    by_key: HashMap<String, EmojiInfo>,
    by_name: HashMap<String, String>,
    by_char: HashMap<String, String>,
    sorted: Vec<String>,
}

fn table() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut by_key = HashMap::with_capacity(OPENEMOJI_ROWS.len() + OPENEMOJI_TONED.len());
        for &(key, short, name, group, keywords) in OPENEMOJI_ROWS {
            let short = if short.is_empty() { emoji_slug(name) } else { short.to_string() };
            by_key.insert(
                key.to_string(),
                EmojiInfo {
                    key: key.to_string(),
                    char: char_of(key),
                    name: name.to_string(),
                    shortcode: format!("oe_{short}"),
                    group: OPENEMOJI_GROUPS.get(group).copied().unwrap_or("").to_string(),
                    keywords: keywords.split_whitespace().map(String::from).collect(),
                    base: String::new(),
                },
            );
        }
        for &(key, base_key) in OPENEMOJI_TONED {
            let Some(base) = by_key.get(base_key).cloned() else { continue };
            let tones: Vec<usize> =
                key.split('-').filter_map(|cp| TONES.iter().position(|t| *t == cp)).collect();
            let names: Vec<String> = tones.iter().map(|t| format!("{} skin tone", TONE_NAMES[*t])).collect();
            let codes: Vec<String> = tones.iter().map(|t| format!("t{}", t + 1)).collect();
            let sep = if base.name.contains(':') { ", " } else { ": " };
            by_key.insert(
                key.to_string(),
                EmojiInfo {
                    key: key.to_string(),
                    char: char_of(key),
                    name: format!("{}{}{}", base.name, sep, names.join(", ")),
                    shortcode: format!("{}_{}", base.shortcode, codes.join("_")),
                    group: base.group.clone(),
                    keywords: base.keywords.clone(),
                    base: base_key.to_string(),
                },
            );
        }
        let mut sorted: Vec<String> = by_key.keys().cloned().collect();
        sorted.sort();
        let mut by_name = HashMap::with_capacity(by_key.len() * 3);
        let mut by_char = HashMap::with_capacity(by_key.len() * 2);
        for key in &sorted {
            let e = &by_key[key];
            by_name.insert(e.shortcode.clone(), key.clone());
            by_name.insert(e.shortcode[3..].to_string(), key.clone());
            by_name.insert(e.name.to_lowercase(), key.clone());
            by_char.insert(e.char.clone(), key.clone());
            by_char.insert(e.char.replace('\u{fe0f}', ""), key.clone());
        }
        for &(alias, key) in OPENEMOJI_ALIASES {
            by_name.entry(alias.to_string()).or_insert_with(|| key.to_string());
        }
        Table { by_key, by_name, by_char, sorted }
    })
}

/// Everything known about an emoji, by any name it answers to.
pub fn emoji_info(name: &str) -> Option<EmojiInfo> {
    let t = table();
    let trimmed = name.trim();
    let bare = trimmed.trim_matches(':').to_lowercase();
    let underscored: String = bare
        .split(|c: char| c.is_whitespace() || c == '-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("_");
    let key = t
        .by_name
        .get(&bare)
        .or_else(|| t.by_name.get(&underscored))
        .or_else(|| t.by_char.get(trimmed))
        .or_else(|| t.by_char.get(&trimmed.replace('\u{fe0f}', "")))
        .cloned()
        .or_else(|| t.by_key.contains_key(&bare).then(|| bare.clone()))?;
    t.by_key.get(&key).cloned()
}

static CHOSEN: RwLock<Option<EmojiMode>> = RwLock::new(None);

/// Pin emoji or text for the whole app, or `None` to detect again.
pub fn set_emoji_mode(mode: Option<EmojiMode>) {
    *CHOSEN.write().unwrap_or_else(|e| e.into_inner()) = mode;
}

/// What an environment gets, in the order in this module's docs.
pub fn emoji_mode_in(env: &Env) -> EmojiMode {
    if let Some(mode) = *CHOSEN.read().unwrap_or_else(|e| e.into_inner()) {
        return mode;
    }
    match env.get("HQTUI_EMOJI").map(String::as_str) {
        Some("emoji") => return EmojiMode::Emoji,
        Some("text") => return EmojiMode::Text,
        _ => {}
    }
    // The Linux virtual console speaks UTF-8 but its font has no emoji.
    if env.get("TERM").map(String::as_str) == Some("linux") {
        return EmojiMode::Text;
    }
    if detect_unicode(env) {
        EmojiMode::Emoji
    } else {
        EmojiMode::Text
    }
}

fn emoticon(key: &str) -> Option<&'static str> {
    OPENEMOJI_EMOTICONS
        .binary_search_by(|row| row.0.cmp(key))
        .ok()
        .map(|i| OPENEMOJI_EMOTICONS[i].1)
}

/// An emoji as text: an emoticon, or its name in brackets.
pub fn emoji_text(name: &str) -> String {
    let Some(e) = emoji_info(name) else { return String::new() };
    emoticon(&e.key)
        .or_else(|| emoticon(&e.base))
        .map(String::from)
        .unwrap_or_else(|| format!("[{}]", e.name))
}

/// An emoji in a given mode. Unknown names return `""`.
pub fn emoji_in(name: &str, mode: EmojiMode) -> String {
    match emoji_info(name) {
        None => String::new(),
        Some(e) if mode == EmojiMode::Emoji => e.char,
        Some(e) => emoji_text(&e.key),
    }
}

/// The emoji, or its text, in this process's terminal.
pub fn emoji(name: &str) -> String {
    emoji_in(name, emoji_mode_in(&process_env()))
}

/// Replace every `:name:` in text; anything between colons that is not an emoji stays.
pub fn emojify_in(text: &str, mode: EmojiMode) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(':') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let end = after.find(':');
        let candidate = end.map(|e| &after[..e]).filter(|name| {
            !name.is_empty()
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '+' || c == '-')
        });
        match candidate.map(|name| (name, emoji_in(name, mode))) {
            Some((name, found)) if !found.is_empty() => {
                out.push_str(&found);
                rest = &after[name.len() + 1..];
            }
            _ => {
                out.push(':');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Replace every `:name:` in text for this process's terminal.
pub fn emojify(text: &str) -> String {
    emojify_in(text, emoji_mode_in(&process_env()))
}

/// Emoji matching every word of the query, best first.
pub fn emoji_search(query: &str, limit: usize) -> Vec<EmojiInfo> {
    let t = table();
    let q = query.trim().trim_matches(':').to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let words: Vec<&str> = q.split(|c: char| c.is_whitespace() || c == '_').filter(|w| !w.is_empty()).collect();
    let exact = emoji_info(&q).map(|e| e.key);
    let mut hits: Vec<(usize, usize, &EmojiInfo)> = Vec::new();
    for key in &t.sorted {
        let e = &t.by_key[key];
        if !e.base.is_empty() {
            continue;
        }
        let hay = format!("{} {} {}", e.name, e.shortcode, e.keywords.join(" ")).to_lowercase();
        if !words.iter().all(|w| hay.contains(w)) {
            continue;
        }
        let name = e.name.to_lowercase();
        let score = if exact.as_deref() == Some(e.key.as_str()) {
            0
        } else if name.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| w == q) {
            1
        } else if name.starts_with(&q) {
            2
        } else if name.contains(&q) {
            3
        } else {
            4
        };
        hits.push((score, e.name.len(), e));
    }
    hits.sort_by_key(|h| (h.0, h.1));
    hits.into_iter().take(limit).map(|h| h.2.clone()).collect()
}

/// Every shortcode in the built-in pack, sorted.
pub fn emoji_names() -> Vec<String> {
    let mut names: Vec<String> = table().by_key.values().map(|e| e.shortcode.clone()).collect();
    names.sort();
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::unicode::string_width;

    #[test]
    fn built_in_and_every_name_form() {
        assert!(emoji_names().len() >= 3900);
        for name in ["fire", "oe_fire", ":oe_fire:", ":fire:", "FIRE", "🔥"] {
            assert_eq!(emoji_in(name, EmojiMode::Emoji), "🔥", "{name}");
        }
        assert_eq!(emoji_in("face with tears of joy", EmojiMode::Emoji), "😂");
        assert_eq!(emoji_in("+1", EmojiMode::Emoji), "👍");
        assert_eq!(emoji_in("heart", EmojiMode::Emoji), "❤️");
        assert_eq!(emoji_in("❤", EmojiMode::Emoji), "❤️");
        assert_eq!(emoji_in("no such emoji", EmojiMode::Emoji), "");
    }

    #[test]
    fn tones_and_text() {
        let toned = emoji_info("thumbs_up_t3").unwrap();
        assert_eq!(toned.char, "👍🏽");
        assert_eq!(toned.name, "thumbs up: medium skin tone");
        assert_eq!(emoji_info("👩🏾‍💻").unwrap().shortcode, "oe_woman_technologist_t4");
        assert_eq!(emoji_in("slightly smiling face", EmojiMode::Text), ":)");
        assert_eq!(emoji_in("thumbs_up_t3", EmojiMode::Text), "+1");
        assert_eq!(emoji_in("fire", EmojiMode::Text), "[fire]");
    }

    #[test]
    fn emojify_search_and_width() {
        assert_eq!(emojify_in("ship :rocket: :+1: at 12:30:00 :nope:", EmojiMode::Emoji), "ship 🚀 👍 at 12:30:00 :nope:");
        assert_eq!(emoji_search("fire", 5)[0].char, "🔥");
        assert!(emoji_search("japan", 20).iter().any(|e| e.char == "🇯🇵"));
        assert!(emoji_search("lol", 20).iter().any(|e| e.char == "😂"));
        for name in ["fire", "thumbs_up_t3", "flag_japan", "keycap_hash", "heart", "woman_technologist_t4"] {
            assert_eq!(string_width(&emoji_in(name, EmojiMode::Emoji)), 2, "{name}");
        }
    }

    #[test]
    fn mode_order() {
        let env = |pairs: &[(&str, &str)]| -> Env { pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect() };
        assert_eq!(emoji_mode_in(&env(&[("HQTUI_EMOJI", "text"), ("LANG", "en_US.UTF-8")])), EmojiMode::Text);
        assert_eq!(emoji_mode_in(&env(&[("LANG", "en_US.UTF-8"), ("TERM", "linux")])), EmojiMode::Text);
        assert_eq!(emoji_mode_in(&env(&[("LANG", "en_US.UTF-8"), ("TERM", "xterm-256color")])), EmojiMode::Emoji);
    }
}
