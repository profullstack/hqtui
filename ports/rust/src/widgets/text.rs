//! Text, badges, label/value pairs, dividers and the function-key bar.

use crate::buffer::{Attrs, Style};
use crate::color::Color;
use crate::surface::{Surface, TextOptions};
use crate::theme::elevate;
use crate::unicode::{drop_columns, fit, string_width, truncate, wrap, Align};

#[derive(Clone, Debug, Default)]
pub struct TextStyle {
    pub fg: Option<Color>,
    pub bg: Option<Color>,
    pub attrs: Option<Attrs>,
    pub align: Option<Align>,
    pub wrap: bool,
    pub bold: bool,
    pub dim: bool,
    pub italic: bool,
    pub underline: bool,
    /// First line to show, counted after wrapping.
    ///
    /// After wrapping is the only place this can be correct: the caller does
    /// not know how many lines their text became, and pre-slicing the string
    /// means re-deciding every time the width changes.
    pub scroll: usize,
    /// Columns to shift the text left by, for lines wider than the surface.
    pub scroll_x: usize,
}

impl TextStyle {
    pub fn new() -> TextStyle {
        TextStyle::default()
    }

    pub fn fg(mut self, c: Color) -> TextStyle {
        self.fg = Some(c);
        self
    }

    pub fn bg(mut self, c: Color) -> TextStyle {
        self.bg = Some(c);
        self
    }

    pub fn align(mut self, a: Align) -> TextStyle {
        self.align = Some(a);
        self
    }

    pub fn wrapped(mut self) -> TextStyle {
        self.wrap = true;
        self
    }

    pub fn bold(mut self) -> TextStyle {
        self.bold = true;
        self
    }

    pub fn dim(mut self) -> TextStyle {
        self.dim = true;
        self
    }

    pub fn italic(mut self) -> TextStyle {
        self.italic = true;
        self
    }

    pub fn underline(mut self) -> TextStyle {
        self.underline = true;
        self
    }

    fn resolved_attrs(&self) -> Attrs {
        let mut a = self.attrs.unwrap_or(Attrs::NONE);
        if self.bold {
            a |= Attrs::BOLD;
        }
        if self.dim {
            a |= Attrs::DIM;
        }
        if self.italic {
            a |= Attrs::ITALIC;
        }
        if self.underline {
            a |= Attrs::UNDERLINE;
        }
        a
    }
}

pub fn draw_text(surface: &Surface, content: &str, options: &TextStyle) {
    if surface.is_empty() {
        return;
    }
    let style = Style {
        fg: Some(options.fg.unwrap_or(surface.theme.foreground)),
        bg: options.bg,
        attrs: Some(options.resolved_attrs()),
    };
    let lines: Vec<String> = if options.wrap {
        wrap(content, surface.width())
    } else {
        content.split('\n').map(String::from).collect()
    };
    let align = options.align.unwrap_or(Align::Left);
    let visible = if options.scroll < lines.len() { &lines[options.scroll..] } else { &[][..] };
    for (i, line) in visible.iter().enumerate().take(surface.height()) {
        let shifted;
        let line = if options.scroll_x > 0 {
            shifted = drop_columns(line, options.scroll_x);
            &shifted
        } else {
            line
        };
        let padded = fit(&truncate(line, surface.width()), surface.width(), align);
        surface.text(0, i as isize, &padded, &TextOptions::from(style));
    }
}

/// Filled reads as a chip; outline keeps the panel quiet.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum BadgeVariant {
    #[default]
    Filled,
    Outline,
    Subtle,
}

#[derive(Clone, Debug, Default)]
pub struct BadgeOptions {
    pub text: String,
    pub color: Option<Color>,
    pub variant: BadgeVariant,
    pub align: Option<Align>,
}

impl BadgeOptions {
    pub fn new(text: impl Into<String>) -> BadgeOptions {
        BadgeOptions { text: text.into(), ..Default::default() }
    }

    pub fn color(mut self, c: Color) -> BadgeOptions {
        self.color = Some(c);
        self
    }

    pub fn variant(mut self, v: BadgeVariant) -> BadgeOptions {
        self.variant = v;
        self
    }
}

/// Returns the width drawn, so callers can advance a cursor past it.
pub fn draw_badge(surface: &Surface, options: &BadgeOptions) -> usize {
    if surface.is_empty() {
        return 0;
    }
    let theme = surface.theme.clone();
    let color = options.color.unwrap_or(theme.primary);
    let label = format!(" {} ", options.text);
    let style = match options.variant {
        BadgeVariant::Filled => Style {
            fg: Some(if theme.dark { theme.background } else { theme.surface }),
            bg: Some(color),
            attrs: Some(Attrs::BOLD),
        },
        BadgeVariant::Subtle => Style {
            fg: Some(color),
            bg: Some(theme.surface.mix(color, 0.18)),
            attrs: None,
        },
        BadgeVariant::Outline => Style { fg: Some(color), bg: None, attrs: Some(Attrs::BOLD) },
    };
    let width = string_width(&label).min(surface.width());
    let x = match options.align.unwrap_or(Align::Left) {
        Align::Right => surface.width() as isize - width as isize,
        Align::Center => (surface.width() as isize - width as isize) / 2,
        Align::Left => 0,
    };
    surface.text(x.max(0), 0, &truncate(&label, surface.width()), &TextOptions::from(style));
    width
}

#[derive(Clone, Debug, Default)]
pub struct KeyValueRow {
    pub label: String,
    pub value: String,
    pub color: Option<Color>,
    pub label_color: Option<Color>,
}

impl KeyValueRow {
    pub fn new(label: impl Into<String>, value: impl Into<String>) -> KeyValueRow {
        KeyValueRow { label: label.into(), value: value.into(), ..Default::default() }
    }

    pub fn color(mut self, c: Color) -> KeyValueRow {
        self.color = Some(c);
        self
    }
}

#[derive(Clone, Debug, Default)]
pub struct KeyValueOptions {
    pub rows: Vec<KeyValueRow>,
    /// Columns reserved for labels. Defaults to the widest label.
    pub label_width: Option<usize>,
    pub gap: Option<usize>,
    /// Push values to the right edge instead of next to the label. Default on.
    pub spread: Option<bool>,
    pub label_color: Option<Color>,
    pub value_color: Option<Color>,
    pub background: Option<Color>,
}

/// Aligned label/value pairs — the backbone of every "System" panel.
pub fn draw_key_values(surface: &Surface, options: &KeyValueOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let gap = options.gap.unwrap_or(1);
    let label_width = options.label_width.unwrap_or_else(|| {
        let widest = options.rows.iter().map(|r| string_width(&r.label)).max().unwrap_or(0);
        (widest + 1).min((4).max((surface.width() as f64 * 0.6).floor() as usize))
    });

    for (i, row) in options.rows.iter().enumerate().take(surface.height()) {
        surface.text(
            0,
            i as isize,
            &fit(&truncate(&row.label, label_width), label_width, Align::Left),
            &TextOptions {
                fg: Some(row.label_color.or(options.label_color).unwrap_or(theme.muted)),
                bg: options.background,
                ..Default::default()
            },
        );
        let vx = label_width + gap;
        let vw = surface.width().saturating_sub(vx);
        if vw == 0 {
            continue;
        }
        let value = truncate(&row.value, vw);
        let shown = if options.spread == Some(false) {
            value
        } else {
            fit(&value, vw, Align::Right)
        };
        surface.text(
            vx as isize,
            i as isize,
            &shown,
            &TextOptions {
                fg: Some(row.color.or(options.value_color).unwrap_or(theme.foreground)),
                bg: options.background,
                ..Default::default()
            },
        );
    }
}

#[derive(Clone, Debug, Default)]
pub struct DividerOptions {
    pub label: Option<String>,
    pub color: Option<Color>,
    pub char: Option<char>,
    pub align: Option<Align>,
}

pub fn draw_divider(surface: &Surface, options: &DividerOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let color = options.color.unwrap_or(theme.border);
    let ch = options.char.unwrap_or('─');
    surface.hline(0, 0, surface.width(), ch, &Style::new().with_fg(color));
    if let Some(label) = &options.label {
        let text = format!(" {label} ");
        let w = string_width(&text);
        let x = match options.align.unwrap_or(Align::Left) {
            Align::Left => 1isize,
            Align::Right => surface.width() as isize - w as isize - 1,
            Align::Center => (surface.width() as isize - w as isize) / 2,
        };
        surface.text(
            x.max(0),
            0,
            &truncate(&text, surface.width()),
            &TextOptions::new().fg(theme.muted),
        );
    }
}

#[derive(Clone, Debug, Default)]
pub struct StatusItem {
    pub key: Option<String>,
    pub label: String,
    pub color: Option<Color>,
    /// Highlight this entry, e.g. the active tab or a live indicator.
    pub active: bool,
}

impl StatusItem {
    pub fn new(label: impl Into<String>) -> StatusItem {
        StatusItem { label: label.into(), ..Default::default() }
    }

    pub fn key(mut self, key: impl Into<String>) -> StatusItem {
        self.key = Some(key.into());
        self
    }

    pub fn active(mut self) -> StatusItem {
        self.active = true;
        self
    }
}

/// Reverse-video the key caps, like a function-key bar, or leave them plain.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum KeyStyle {
    #[default]
    Caps,
    Plain,
}

#[derive(Clone, Debug, Default)]
pub struct StatusBarOptions {
    pub items: Vec<StatusItem>,
    pub right: Vec<StatusItem>,
    pub background: Option<Color>,
    pub key_color: Option<Color>,
    pub key_style: KeyStyle,
}

/// The F1/F2/F10 bar along the bottom of every serious TUI.
pub fn draw_status_bar(surface: &Surface, options: &StatusBarOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let bg = options.background.unwrap_or_else(|| elevate(&theme, 0.04));
    surface.fill(&Style::new().with_bg(bg));

    let draw_items = |items: &[StatusItem], start_x: isize| -> isize {
        let mut cx = start_x;
        for item in items {
            if cx >= surface.width() as isize {
                break;
            }
            if let Some(key) = &item.key {
                let cap_style = match options.key_style {
                    KeyStyle::Plain => Style {
                        fg: Some(options.key_color.unwrap_or(theme.accent)),
                        bg: Some(bg),
                        attrs: Some(Attrs::BOLD),
                    },
                    KeyStyle::Caps => Style {
                        fg: Some(if theme.dark { theme.background } else { theme.surface }),
                        bg: Some(options.key_color.unwrap_or(theme.accent)),
                        attrs: Some(Attrs::BOLD),
                    },
                };
                cx += surface.text(cx, 0, key, &TextOptions::from(cap_style)) as isize;
                cx += surface.text(cx, 0, " ", &TextOptions::new().bg(bg)) as isize;
            }
            cx += surface.text(
                cx,
                0,
                &item.label,
                &TextOptions {
                    fg: Some(if item.active {
                        theme.foreground
                    } else {
                        item.color.unwrap_or(theme.muted)
                    }),
                    bg: Some(bg),
                    attrs: Some(if item.active { Attrs::BOLD } else { Attrs::NONE }),
                    ..Default::default()
                },
            ) as isize;
            cx += surface.text(cx, 0, "  ", &TextOptions::new().bg(bg)) as isize;
        }
        cx
    };

    let x = draw_items(&options.items, 1);

    if !options.right.is_empty() {
        let width: usize = options
            .right
            .iter()
            .map(|i| {
                string_width(&i.label)
                    + i.key.as_ref().map(|k| string_width(k) + 1).unwrap_or(0)
                    + 2
            })
            .sum();
        let from = x.max(surface.width() as isize - width as isize - 1);
        draw_items(&options.right, from);
    }
}
