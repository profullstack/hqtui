//! Icons for terminals: `icon("mail")` is the best glyph this terminal can draw.
//!
//! The built-in pack is OpenIcon (<https://logicsrc.com/openicon>), on by
//! default, generated into `icons_data.rs` from the same set as the
//! TypeScript reference, so an icon is the same glyph in every port. Which of
//! its three glyphs you get: [`set_icon_mode`] if the app chose;
//! `OPENICON_GLYPHS` or `HQTUI_ICONS`; `NERD_FONT=1` for Nerd Font glyphs;
//! otherwise Unicode where the terminal draws it and ASCII where it does not.
//! A Nerd Font is never assumed: it cannot be detected from inside the terminal.

use std::sync::RwLock;

use crate::capabilities::{detect_unicode, process_env, Env};
use crate::icons_data::{OPENICON_ALIASES, OPENICON_GLYPHS};
pub use crate::icons_data::OPENICON_VERSION;

/// One of an icon's three glyph families.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IconMode {
    Nerd,
    Unicode,
    Ascii,
}

impl IconMode {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "nerd" => Some(Self::Nerd),
            "unicode" => Some(Self::Unicode),
            "ascii" => Some(Self::Ascii),
            _ => None,
        }
    }
}

/// The three spellings of one icon; `nerd` is empty when Nerd Fonts has none.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IconGlyphs {
    pub nerd: &'static str,
    pub unicode: &'static str,
    pub ascii: &'static str,
}

static CHOSEN: RwLock<Option<IconMode>> = RwLock::new(None);

/// Pin the glyph family for the whole app, or `None` to detect again.
pub fn set_icon_mode(mode: Option<IconMode>) {
    *CHOSEN.write().unwrap_or_else(|e| e.into_inner()) = mode;
}

/// The glyph family an environment gets, in the order in this module's docs.
pub fn icon_mode_in(env: &Env) -> IconMode {
    if let Some(mode) = *CHOSEN.read().unwrap_or_else(|e| e.into_inner()) {
        return mode;
    }
    let named = env
        .get("OPENICON_GLYPHS")
        .filter(|v| !v.is_empty())
        .or_else(|| env.get("HQTUI_ICONS"))
        .map(String::as_str)
        .unwrap_or("");
    if let Some(mode) = IconMode::parse(named) {
        return mode;
    }
    if env.get("NERD_FONT").map(String::as_str) == Some("1") || env.get("NERD_FONTS").map(String::as_str) == Some("1") {
        return IconMode::Nerd;
    }
    if detect_unicode(env) {
        IconMode::Unicode
    } else {
        IconMode::Ascii
    }
}

/// An icon's glyphs by key or alias.
pub fn icon_glyphs(name: &str) -> Option<IconGlyphs> {
    let key = match OPENICON_GLYPHS.binary_search_by(|row| row.0.cmp(name)) {
        Ok(_) => name,
        Err(_) => {
            let i = OPENICON_ALIASES.binary_search_by(|row| row.0.cmp(name)).ok()?;
            OPENICON_ALIASES[i].1
        }
    };
    let i = OPENICON_GLYPHS.binary_search_by(|row| row.0.cmp(key)).ok()?;
    let (_, nerd, unicode, ascii) = OPENICON_GLYPHS[i];
    Some(IconGlyphs { nerd, unicode, ascii })
}

/// An icon's glyph in a given mode. Unknown names return `""`.
pub fn icon_in(name: &str, mode: IconMode) -> &'static str {
    let Some(g) = icon_glyphs(name) else { return "" };
    match mode {
        IconMode::Nerd if !g.nerd.is_empty() => g.nerd,
        IconMode::Nerd | IconMode::Unicode => g.unicode,
        IconMode::Ascii => g.ascii,
    }
}

/// The best glyph for an icon in this process's terminal.
pub fn icon(name: &str) -> &'static str {
    icon_in(name, icon_mode_in(&process_env()))
}

/// Every key in the built-in pack, sorted.
pub fn icon_names() -> impl Iterator<Item = &'static str> {
    OPENICON_GLYPHS.iter().map(|row| row.0)
}

#[cfg(test)]
mod tests {
    // The same cases as packages/hqtui/test/icons.test.ts.
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Env {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn modes_and_aliases() {
        assert_eq!(icon_in("mail", IconMode::Nerd), "\u{f01f0}");
        assert_eq!(icon_in("mail", IconMode::Unicode), "✉");
        assert_eq!(icon_in("mail", IconMode::Ascii), "@");
        assert_eq!(icon_in("email", IconMode::Ascii), "@");
        assert_eq!(icon_in("twitter", IconMode::Ascii), "x");
        assert_eq!(icon_in("no-such-icon", IconMode::Unicode), "");
    }

    #[test]
    fn nerd_falls_back_to_unicode() {
        let row = OPENICON_GLYPHS.iter().find(|r| r.1.is_empty()).expect("an icon without a Nerd glyph");
        assert_eq!(icon_in(row.0, IconMode::Nerd), row.2);
    }

    #[test]
    fn mode_order() {
        assert_eq!(icon_mode_in(&env(&[("OPENICON_GLYPHS", "ascii"), ("NERD_FONT", "1"), ("LANG", "en_US.UTF-8")])), IconMode::Ascii);
        assert_eq!(icon_mode_in(&env(&[("HQTUI_ICONS", "nerd")])), IconMode::Nerd);
        assert_eq!(icon_mode_in(&env(&[("NERD_FONT", "1")])), IconMode::Nerd);
        assert_eq!(icon_mode_in(&env(&[("LANG", "en_US.UTF-8"), ("TERM", "xterm-256color")])), IconMode::Unicode);
        assert_eq!(icon_mode_in(&env(&[("TERM", "dumb")])), IconMode::Ascii);
    }

    #[test]
    fn tables_are_sorted_for_binary_search() {
        assert!(OPENICON_GLYPHS.windows(2).all(|w| w[0].0 < w[1].0));
        assert!(OPENICON_ALIASES.windows(2).all(|w| w[0].0 < w[1].0));
        assert!(icon_names().count() >= 300);
    }
}
