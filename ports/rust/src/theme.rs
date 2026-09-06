//! A theme is flat and small on purpose: every token here is one a widget
//! actually reaches for. Anything deeper is computed, not configured.

use crate::color::{Color, Gradient};

#[derive(Clone, Debug, PartialEq)]
pub struct Theme {
    pub name: String,
    /// True for palettes designed against a dark terminal background.
    pub dark: bool,

    pub background: Color,
    /// Panel interiors, lifted slightly off the page.
    pub surface: Color,
    pub foreground: Color,
    pub muted: Color,

    pub primary: Color,
    pub secondary: Color,
    pub accent: Color,

    pub success: Color,
    pub warning: Color,
    pub danger: Color,
    pub info: Color,

    pub border: Color,
    pub border_focused: Color,
    pub title: Color,

    pub selection: Color,
    pub selection_text: Color,
    pub cursor: Color,

    /// Series colors for multi-line graphs, in draw order.
    pub graph: Vec<Color>,
    /// Low-to-high ramp for gauges, meters and heat bars.
    pub heat: Vec<Color>,
}

impl Default for Theme {
    fn default() -> Theme {
        dark()
    }
}

pub fn dark() -> Theme {
    Theme {
        name: "dark".into(),
        dark: true,
        background: Color::hex(0x05070a),
        surface: Color::hex(0x0a0e14),
        foreground: Color::hex(0xc6d0db),
        muted: Color::hex(0x5a6b7d),
        primary: Color::hex(0x58a6ff),
        secondary: Color::hex(0xbd93f9),
        accent: Color::hex(0x56d4dd),
        success: Color::hex(0x5fff87),
        warning: Color::hex(0xffd75f),
        danger: Color::hex(0xff6b6b),
        info: Color::hex(0x56d4dd),
        border: Color::hex(0x243040),
        border_focused: Color::hex(0x56d4dd),
        title: Color::hex(0x7ee2ff),
        selection: Color::hex(0x1d3a52),
        selection_text: Color::hex(0xe6f2ff),
        cursor: Color::hex(0x56d4dd),
        graph: vec![
            Color::hex(0x58a6ff), Color::hex(0x5fff87), Color::hex(0xff79c6),
            Color::hex(0xffd75f), Color::hex(0x56d4dd), Color::hex(0xffa657),
        ],
        heat: vec![
            Color::hex(0x5fff87), Color::hex(0xa8ff60), Color::hex(0xffd75f),
            Color::hex(0xffa657), Color::hex(0xff6b6b),
        ],
    }
}

pub fn dracula() -> Theme {
    Theme {
        name: "dracula".into(),
        background: Color::hex(0x191a21),
        surface: Color::hex(0x21222c),
        foreground: Color::hex(0xf8f8f2),
        muted: Color::hex(0x6272a4),
        primary: Color::hex(0xbd93f9),
        secondary: Color::hex(0xff79c6),
        accent: Color::hex(0x8be9fd),
        success: Color::hex(0x50fa7b),
        warning: Color::hex(0xf1fa8c),
        danger: Color::hex(0xff5555),
        info: Color::hex(0x8be9fd),
        border: Color::hex(0x44475a),
        border_focused: Color::hex(0xbd93f9),
        title: Color::hex(0xff79c6),
        selection: Color::hex(0x44475a),
        selection_text: Color::hex(0xf8f8f2),
        graph: vec![
            Color::hex(0xbd93f9), Color::hex(0x50fa7b), Color::hex(0xff79c6),
            Color::hex(0xf1fa8c), Color::hex(0x8be9fd), Color::hex(0xffb86c),
        ],
        heat: vec![
            Color::hex(0x50fa7b), Color::hex(0xf1fa8c), Color::hex(0xffb86c), Color::hex(0xff5555),
        ],
        ..dark()
    }
}

pub fn nord() -> Theme {
    Theme {
        name: "nord".into(),
        background: Color::hex(0x2e3440),
        surface: Color::hex(0x333b4a),
        foreground: Color::hex(0xe5e9f0),
        muted: Color::hex(0x7b88a1),
        primary: Color::hex(0x88c0d0),
        secondary: Color::hex(0xb48ead),
        accent: Color::hex(0x8fbcbb),
        success: Color::hex(0xa3be8c),
        warning: Color::hex(0xebcb8b),
        danger: Color::hex(0xbf616a),
        info: Color::hex(0x81a1c1),
        border: Color::hex(0x434c5e),
        border_focused: Color::hex(0x88c0d0),
        title: Color::hex(0x8fbcbb),
        selection: Color::hex(0x434c5e),
        selection_text: Color::hex(0xeceff4),
        graph: vec![
            Color::hex(0x88c0d0), Color::hex(0xa3be8c), Color::hex(0xb48ead),
            Color::hex(0xebcb8b), Color::hex(0x81a1c1), Color::hex(0xd08770),
        ],
        heat: vec![
            Color::hex(0xa3be8c), Color::hex(0xebcb8b), Color::hex(0xd08770), Color::hex(0xbf616a),
        ],
        ..dark()
    }
}

pub fn tokyo_night() -> Theme {
    Theme {
        name: "tokyo-night".into(),
        background: Color::hex(0x1a1b26),
        surface: Color::hex(0x1f2335),
        foreground: Color::hex(0xc0caf5),
        muted: Color::hex(0x565f89),
        primary: Color::hex(0x7aa2f7),
        secondary: Color::hex(0xbb9af7),
        accent: Color::hex(0x7dcfff),
        success: Color::hex(0x9ece6a),
        warning: Color::hex(0xe0af68),
        danger: Color::hex(0xf7768e),
        info: Color::hex(0x7dcfff),
        border: Color::hex(0x2f3549),
        border_focused: Color::hex(0x7aa2f7),
        title: Color::hex(0x7dcfff),
        selection: Color::hex(0x283457),
        selection_text: Color::hex(0xc0caf5),
        graph: vec![
            Color::hex(0x7aa2f7), Color::hex(0x9ece6a), Color::hex(0xbb9af7),
            Color::hex(0xe0af68), Color::hex(0x7dcfff), Color::hex(0xff9e64),
        ],
        heat: vec![
            Color::hex(0x9ece6a), Color::hex(0xe0af68), Color::hex(0xff9e64), Color::hex(0xf7768e),
        ],
        ..dark()
    }
}

pub fn gruvbox() -> Theme {
    Theme {
        name: "gruvbox".into(),
        background: Color::hex(0x1d2021),
        surface: Color::hex(0x282828),
        foreground: Color::hex(0xebdbb2),
        muted: Color::hex(0x928374),
        primary: Color::hex(0x83a598),
        secondary: Color::hex(0xd3869b),
        accent: Color::hex(0x8ec07c),
        success: Color::hex(0xb8bb26),
        warning: Color::hex(0xfabd2f),
        danger: Color::hex(0xfb4934),
        info: Color::hex(0x83a598),
        border: Color::hex(0x3c3836),
        border_focused: Color::hex(0xfabd2f),
        title: Color::hex(0xfabd2f),
        selection: Color::hex(0x3c3836),
        selection_text: Color::hex(0xfbf1c7),
        graph: vec![
            Color::hex(0x83a598), Color::hex(0xb8bb26), Color::hex(0xd3869b),
            Color::hex(0xfabd2f), Color::hex(0x8ec07c), Color::hex(0xfe8019),
        ],
        heat: vec![
            Color::hex(0xb8bb26), Color::hex(0xfabd2f), Color::hex(0xfe8019), Color::hex(0xfb4934),
        ],
        ..dark()
    }
}

pub fn matrix() -> Theme {
    Theme {
        name: "matrix".into(),
        background: Color::hex(0x000000),
        surface: Color::hex(0x020a02),
        foreground: Color::hex(0x9dff9d),
        muted: Color::hex(0x2f6b2f),
        primary: Color::hex(0x00ff41),
        secondary: Color::hex(0x00c853),
        accent: Color::hex(0x7cff7c),
        success: Color::hex(0x00ff41),
        warning: Color::hex(0xd4ff00),
        danger: Color::hex(0xff3b30),
        info: Color::hex(0x00e5b0),
        border: Color::hex(0x12401f),
        border_focused: Color::hex(0x00ff41),
        title: Color::hex(0x00ff41),
        selection: Color::hex(0x0d2f14),
        selection_text: Color::hex(0xc9ffc9),
        graph: vec![
            Color::hex(0x00ff41), Color::hex(0x00c853), Color::hex(0x7cff7c),
            Color::hex(0x00e5b0), Color::hex(0xd4ff00), Color::hex(0x2f9e44),
        ],
        heat: vec![
            Color::hex(0x0f7a2e), Color::hex(0x00c853), Color::hex(0x00ff41), Color::hex(0xd4ff00),
        ],
        ..dark()
    }
}

pub fn monochrome() -> Theme {
    Theme {
        name: "monochrome".into(),
        background: Color::hex(0x000000),
        surface: Color::hex(0x0b0b0b),
        foreground: Color::hex(0xd0d0d0),
        muted: Color::hex(0x6e6e6e),
        primary: Color::hex(0xffffff),
        secondary: Color::hex(0xc0c0c0),
        accent: Color::hex(0xe0e0e0),
        success: Color::hex(0xe8e8e8),
        warning: Color::hex(0xb8b8b8),
        danger: Color::hex(0xffffff),
        info: Color::hex(0xa0a0a0),
        border: Color::hex(0x3a3a3a),
        border_focused: Color::hex(0xd0d0d0),
        title: Color::hex(0xffffff),
        selection: Color::hex(0x303030),
        selection_text: Color::hex(0xffffff),
        graph: vec![
            Color::hex(0xffffff), Color::hex(0xc8c8c8), Color::hex(0x909090),
            Color::hex(0x686868), Color::hex(0xb0b0b0), Color::hex(0x808080),
        ],
        heat: vec![
            Color::hex(0x585858), Color::hex(0x909090), Color::hex(0xc8c8c8), Color::hex(0xffffff),
        ],
        ..dark()
    }
}

pub fn high_contrast() -> Theme {
    Theme {
        name: "high-contrast".into(),
        background: Color::hex(0x000000),
        surface: Color::hex(0x000000),
        foreground: Color::hex(0xffffff),
        muted: Color::hex(0xc0c0c0),
        primary: Color::hex(0x00ffff),
        secondary: Color::hex(0xff00ff),
        accent: Color::hex(0xffff00),
        success: Color::hex(0x00ff00),
        warning: Color::hex(0xffff00),
        danger: Color::hex(0xff0000),
        info: Color::hex(0x00ffff),
        border: Color::hex(0xffffff),
        border_focused: Color::hex(0xffff00),
        title: Color::hex(0xffffff),
        selection: Color::hex(0xffffff),
        selection_text: Color::hex(0x000000),
        graph: vec![
            Color::hex(0x00ffff), Color::hex(0x00ff00), Color::hex(0xff00ff),
            Color::hex(0xffff00), Color::hex(0xffffff), Color::hex(0xff8000),
        ],
        heat: vec![
            Color::hex(0x00ff00), Color::hex(0xffff00), Color::hex(0xff8000), Color::hex(0xff0000),
        ],
        ..dark()
    }
}

pub fn light() -> Theme {
    Theme {
        name: "light".into(),
        dark: false,
        background: Color::hex(0xfbfcfd),
        surface: Color::hex(0xffffff),
        foreground: Color::hex(0x1c2530),
        muted: Color::hex(0x6b7a8c),
        primary: Color::hex(0x0b62d0),
        secondary: Color::hex(0x7c3aed),
        accent: Color::hex(0x0e7490),
        success: Color::hex(0x128a3f),
        warning: Color::hex(0xa86a00),
        danger: Color::hex(0xc62828),
        info: Color::hex(0x0e7490),
        border: Color::hex(0xd3dbe4),
        border_focused: Color::hex(0x0b62d0),
        title: Color::hex(0x0b3d78),
        selection: Color::hex(0xd6e6fb),
        selection_text: Color::hex(0x0b2545),
        cursor: Color::hex(0x0b62d0),
        graph: vec![
            Color::hex(0x0b62d0), Color::hex(0x128a3f), Color::hex(0xa3348a),
            Color::hex(0xa86a00), Color::hex(0x0e7490), Color::hex(0xc2410c),
        ],
        heat: vec![
            Color::hex(0x128a3f), Color::hex(0x7aa300), Color::hex(0xa86a00),
            Color::hex(0xc2410c), Color::hex(0xc62828),
        ],
    }
}

/// Every built-in theme, in the reference implementation's order. The key is
/// the name callers pass to [`resolve_theme`]; both `tokyoNight` and
/// `tokyo-night` reach the same palette.
pub fn theme_list() -> Vec<(&'static str, Theme)> {
    vec![
        ("dark", dark()),
        ("dracula", dracula()),
        ("nord", nord()),
        ("tokyoNight", tokyo_night()),
        ("gruvbox", gruvbox()),
        ("matrix", matrix()),
        ("monochrome", monochrome()),
        ("highContrast", high_contrast()),
        ("light", light()),
    ]
}

/// Look a theme up by key or by its own `name`. Unknown names fall back to
/// dark, because a mistyped theme should not stop an app from starting.
pub fn resolve_theme(name: &str) -> Theme {
    let list = theme_list();
    if let Some((_, t)) = list.iter().find(|(key, _)| *key == name) {
        return t.clone();
    }
    if let Some((_, t)) = list.iter().find(|(_, t)| t.name == name) {
        return t.clone();
    }
    dark()
}

/// A slightly lifted or dropped shade of the surface, for zebra rows and tracks.
pub fn elevate(theme: &Theme, amount: f64) -> Color {
    theme.surface.mix(
        if theme.dark { Color::hex(0xffffff) } else { Color::hex(0x000000) },
        amount,
    )
}

/// Color a 0-1 ratio along the theme's heat ramp: green when idle, red when hot.
pub fn heat_color(theme: &Theme, ratio: f64) -> Color {
    Gradient::new(&theme.heat).sample(ratio)
}

/// The nth series color, wrapping around. Negative indices wrap from the end.
pub fn series_color(theme: &Theme, index: i64) -> Color {
    let n = theme.graph.len() as i64;
    if n == 0 {
        return Color::DEFAULT;
    }
    theme.graph[(((index % n) + n) % n) as usize]
}
