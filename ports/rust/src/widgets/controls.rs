//! Buttons, inputs, tabs and the overlays that sit above a whole screen.

use crate::buffer::{Attrs, Style};
use crate::color::Color;
use crate::surface::{BorderStyle, BoxOptions, Surface, TextOptions};
use crate::theme::elevate;
use crate::unicode::{fit, string_width, truncate, wrap, Align};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ButtonVariant {
    #[default]
    Primary,
    Success,
    Warning,
    Danger,
    Ghost,
}

#[derive(Clone, Debug, Default)]
pub struct ButtonOptions {
    pub label: String,
    pub focused: bool,
    pub color: Option<Color>,
    pub variant: ButtonVariant,
    pub disabled: bool,
    pub width: Option<usize>,
    pub align: Option<Align>,
}

impl ButtonOptions {
    pub fn new(label: impl Into<String>) -> ButtonOptions {
        ButtonOptions { label: label.into(), ..Default::default() }
    }

    pub fn variant(mut self, v: ButtonVariant) -> ButtonOptions {
        self.variant = v;
        self
    }

    pub fn focused(mut self, f: bool) -> ButtonOptions {
        self.focused = f;
        self
    }
}

fn variant_color(surface: &Surface, options: &ButtonOptions) -> Color {
    if let Some(c) = options.color {
        return c;
    }
    let t = &surface.theme;
    match options.variant {
        ButtonVariant::Success => t.success,
        ButtonVariant::Warning => t.warning,
        ButtonVariant::Danger => t.danger,
        ButtonVariant::Ghost => t.muted,
        ButtonVariant::Primary => t.primary,
    }
}

/// Returns the width drawn.
pub fn draw_button(surface: &Surface, options: &ButtonOptions) -> usize {
    if surface.is_empty() {
        return 0;
    }
    let theme = surface.theme.clone();
    let color = variant_color(surface, options);
    let label = format!(" {} ", options.label);
    let width = options.width.unwrap_or(string_width(&label)).min(surface.width());
    let ghost = options.variant == ButtonVariant::Ghost;
    let style = if options.disabled {
        Style { fg: Some(theme.muted), bg: Some(elevate(&theme, 0.05)), attrs: None }
    } else if options.focused {
        Style {
            fg: Some(if theme.dark { theme.background } else { theme.surface }),
            bg: Some(color),
            attrs: Some(Attrs::BOLD),
        }
    } else if ghost {
        Style { fg: Some(color), bg: None, attrs: None }
    } else {
        Style {
            fg: Some(color),
            bg: Some(theme.surface.mix(color, 0.16)),
            attrs: Some(Attrs::BOLD),
        }
    };
    surface.text(
        0,
        0,
        &fit(&truncate(&label, width), width, options.align.unwrap_or(Align::Center)),
        &TextOptions::from(style),
    );
    width
}

/// Render as a box, a switch, or a radio dot.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum CheckboxVariant {
    #[default]
    Checkbox,
    Toggle,
    Radio,
}

#[derive(Clone, Debug, Default)]
pub struct CheckboxOptions {
    pub label: Option<String>,
    pub checked: bool,
    pub focused: bool,
    pub color: Option<Color>,
    pub variant: CheckboxVariant,
}

impl CheckboxOptions {
    pub fn new(label: impl Into<String>, checked: bool) -> CheckboxOptions {
        CheckboxOptions { label: Some(label.into()), checked, ..Default::default() }
    }

    pub fn variant(mut self, v: CheckboxVariant) -> CheckboxOptions {
        self.variant = v;
        self
    }
}

/// Returns the width drawn.
pub fn draw_checkbox(surface: &Surface, options: &CheckboxOptions) -> usize {
    if surface.is_empty() {
        return 0;
    }
    let theme = surface.theme.clone();
    let color = options
        .color
        .unwrap_or(if options.checked { theme.success } else { theme.muted });
    let glyph = match (options.variant, options.checked) {
        (CheckboxVariant::Toggle, true) => "[▮ ]",
        (CheckboxVariant::Toggle, false) => "[ ▮]",
        (CheckboxVariant::Radio, true) => "(●)",
        (CheckboxVariant::Radio, false) => "( )",
        (CheckboxVariant::Checkbox, true) => "[✓]",
        (CheckboxVariant::Checkbox, false) => "[ ]",
    };
    let attrs = if options.focused { Attrs::BOLD } else { Attrs::NONE };
    let mut x = surface.text(
        0,
        0,
        glyph,
        &TextOptions { fg: Some(color), attrs: Some(attrs), ..Default::default() },
    );
    if let Some(label) = &options.label {
        x += surface.text(
            x as isize,
            0,
            &format!(" {label}"),
            &TextOptions {
                fg: Some(if options.focused { theme.foreground } else { theme.muted }),
                attrs: Some(attrs),
                ..Default::default()
            },
        );
    }
    x
}

#[derive(Clone, Debug, Default)]
pub struct SelectOptions {
    pub value: String,
    pub focused: bool,
    pub open: bool,
    pub options: Vec<String>,
    pub selected_index: Option<usize>,
    pub width: Option<usize>,
    pub color: Option<Color>,
}

impl SelectOptions {
    pub fn new(value: impl Into<String>) -> SelectOptions {
        SelectOptions { value: value.into(), ..Default::default() }
    }
}

/// A closed dropdown, or an open one with its option list underneath.
pub fn draw_select(surface: &Surface, options: &SelectOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let width = options.width.unwrap_or(surface.width()).min(surface.width());
    let color = options
        .color
        .unwrap_or(if options.focused { theme.border_focused } else { theme.border });
    let label = format!(" {}", truncate(&options.value, width.saturating_sub(4)));
    let field_bg = elevate(&theme, 0.05);
    surface.text(
        0,
        0,
        &fit(&label, width.saturating_sub(2), Align::Left),
        &TextOptions {
            fg: Some(theme.foreground),
            bg: Some(field_bg),
            attrs: Some(if options.focused { Attrs::BOLD } else { Attrs::NONE }),
            ..Default::default()
        },
    );
    surface.text(
        width as isize - 2,
        0,
        if options.open { " ▴" } else { " ▾" },
        &TextOptions { fg: Some(color), bg: Some(field_bg), ..Default::default() },
    );

    if options.open && !options.options.is_empty() {
        let height = options.options.len().min(surface.height().saturating_sub(1));
        let list_bg = elevate(&theme, 0.08);
        for i in 0..height {
            let selected = i == options.selected_index.unwrap_or(0);
            surface.text(
                0,
                i as isize + 1,
                &fit(
                    &format!(" {}", truncate(&options.options[i], width.saturating_sub(2))),
                    width,
                    Align::Left,
                ),
                &TextOptions {
                    fg: Some(if selected { theme.selection_text } else { theme.foreground }),
                    bg: Some(if selected { theme.selection } else { list_bg }),
                    ..Default::default()
                },
            );
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct TextInputOptions {
    pub value: String,
    pub placeholder: Option<String>,
    pub focused: bool,
    /// Caret index; defaults to the end of the value.
    pub cursor: Option<usize>,
    pub width: Option<usize>,
    pub label: Option<String>,
    pub password: bool,
    pub color: Option<Color>,
}

impl TextInputOptions {
    pub fn new(value: impl Into<String>) -> TextInputOptions {
        TextInputOptions { value: value.into(), ..Default::default() }
    }
}

pub fn draw_text_input(surface: &Surface, options: &TextInputOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let width = options.width.unwrap_or(surface.width()).min(surface.width());
    let label_width = options.label.as_ref().map(|l| string_width(l) + 1).unwrap_or(0);
    if let Some(label) = &options.label {
        surface.text(0, 0, label, &TextOptions::new().fg(theme.muted));
    }
    let field_width = width.saturating_sub(label_width);
    let bg = elevate(&theme, if options.focused { 0.1 } else { 0.05 });
    surface.fill_rect(label_width as isize, 0, field_width, 1, &Style::new().with_bg(bg), 32);

    // The reference counts UTF-16 units for the password mask and the default
    // caret; counting characters is the same for every value a person types and
    // is what a Rust caller would expect.
    let shown = if options.password {
        "•".repeat(options.value.chars().count())
    } else {
        options.value.clone()
    };
    let empty = shown.is_empty();
    let text = if empty { options.placeholder.clone().unwrap_or_default() } else { shown.clone() };
    surface.text(
        label_width as isize + 1,
        0,
        &truncate(&text, field_width.saturating_sub(2)),
        &TextOptions {
            fg: Some(if empty { theme.muted } else { theme.foreground }),
            bg: Some(bg),
            ..Default::default()
        },
    );

    if options.focused {
        let caret = options.cursor.unwrap_or_else(|| string_width(&shown));
        let cursor_x = (label_width + 1 + caret).min(label_width + field_width.saturating_sub(1));
        surface.style_rect(
            cursor_x as isize,
            0,
            1,
            1,
            &Style {
                fg: Some(theme.background),
                bg: Some(options.color.unwrap_or(theme.cursor)),
                attrs: None,
            },
        );
    }
}

/// Underline the active tab instead of filling it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum TabVariant {
    #[default]
    Filled,
    Underline,
}

#[derive(Clone, Debug, Default)]
pub struct TabsOptions {
    pub tabs: Vec<String>,
    pub active: usize,
    pub color: Option<Color>,
    pub align: Option<Align>,
    pub variant: TabVariant,
}

impl TabsOptions {
    pub fn new<I, S>(tabs: I, active: usize) -> TabsOptions
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        TabsOptions {
            tabs: tabs.into_iter().map(Into::into).collect(),
            active,
            ..Default::default()
        }
    }
}

pub fn draw_tabs(surface: &Surface, options: &TabsOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let color = options.color.unwrap_or(theme.accent);
    let total: usize = options.tabs.iter().map(|t| string_width(t) + 4).sum();
    let mut x = match options.align.unwrap_or(Align::Left) {
        Align::Center => ((surface.width() as isize - total as isize) / 2).max(0),
        Align::Right => (surface.width() as isize - total as isize).max(0),
        Align::Left => 0,
    };

    for (i, tab) in options.tabs.iter().enumerate() {
        let active = i == options.active;
        let label = format!("  {tab}  ");
        let style = if active {
            match options.variant {
                TabVariant::Filled => Style {
                    fg: Some(if theme.dark { theme.background } else { theme.surface }),
                    bg: Some(color),
                    attrs: Some(Attrs::BOLD),
                },
                TabVariant::Underline => Style {
                    fg: Some(color),
                    bg: None,
                    attrs: Some(Attrs::BOLD | Attrs::UNDERLINE),
                },
            }
        } else {
            Style { fg: Some(theme.muted), bg: None, attrs: None }
        };
        x += surface.text(x, 0, &label, &TextOptions::from(style)) as isize;
    }
}

#[derive(Clone, Debug, Default)]
pub struct ModalButton {
    pub label: String,
    pub variant: ButtonVariant,
    pub focused: bool,
}

impl ModalButton {
    pub fn new(label: impl Into<String>) -> ModalButton {
        ModalButton { label: label.into(), ..Default::default() }
    }

    pub fn focused(mut self) -> ModalButton {
        self.focused = true;
        self
    }
}

#[derive(Clone, Debug, Default)]
pub struct ModalOptions {
    pub title: Option<String>,
    pub message: Option<String>,
    pub width: Option<usize>,
    pub height: Option<usize>,
    /// Dim the screen behind the dialog. Defaults on.
    pub backdrop: Option<bool>,
    pub buttons: Vec<ModalButton>,
    pub color: Option<Color>,
    pub align: Option<Align>,
}

impl ModalOptions {
    pub fn new() -> ModalOptions {
        ModalOptions::default()
    }

    pub fn title(mut self, t: impl Into<String>) -> ModalOptions {
        self.title = Some(t.into());
        self
    }

    pub fn message(mut self, m: impl Into<String>) -> ModalOptions {
        self.message = Some(m.into());
        self
    }
}

/// Centres a dialog over the whole surface and returns its interior, so callers
/// can draw custom content instead of `message` if they want to.
pub fn draw_modal(root: &Surface, options: &ModalOptions) -> Surface {
    let theme = root.theme.clone();
    if options.backdrop != Some(false) {
        // Dim rather than blank: the dashboard stays legible behind the dialog.
        root.style_rect(
            0,
            0,
            root.width(),
            root.height(),
            &Style::new().with_fg(theme.foreground.mix(theme.background, 0.72)),
        );
    }

    let width = options.width.unwrap_or(48).min(root.width().saturating_sub(2));
    let message_lines = options
        .message
        .as_ref()
        .map(|m| wrap(m, width.saturating_sub(4)).len())
        .unwrap_or(0);
    let height = options
        .height
        .unwrap_or(message_lines + if options.buttons.is_empty() { 4 } else { 5 })
        .min(root.height().saturating_sub(2));
    let x = ((root.width() as isize - width as isize) / 2).max(0);
    let y = ((root.height() as isize - height as isize) / 2).max(0);

    let surface = root.sub(x, y, width, height);
    let inner = surface.draw_box(&BoxOptions {
        title: options.title.clone(),
        title_align: Some(options.align.unwrap_or(Align::Center)),
        border: Some(BorderStyle::Rounded),
        border_color: Some(options.color.unwrap_or(theme.border_focused)),
        bg: Some(elevate(&theme, 0.08)),
        ..Default::default()
    });

    if let Some(message) = &options.message {
        let lines = wrap(message, inner.width().saturating_sub(2));
        for (i, line) in lines.iter().enumerate() {
            if i + 1 >= inner.height() {
                break;
            }
            inner.text(
                1,
                i as isize + 1,
                &fit(
                    line,
                    inner.width().saturating_sub(2),
                    options.align.unwrap_or(Align::Center),
                ),
                &TextOptions::new().fg(theme.foreground),
            );
        }
    }

    if !options.buttons.is_empty() {
        let widths: Vec<usize> =
            options.buttons.iter().map(|b| string_width(&b.label) + 4).collect();
        let total: isize = widths.iter().map(|w| *w as isize + 2).sum::<isize>() - 2;
        let mut bx = ((inner.width() as isize - total) / 2).max(0);
        let by = inner.height() as isize - 2;
        for (i, button) in options.buttons.iter().enumerate() {
            draw_button(
                &inner.sub(bx, by, widths[i], 1),
                &ButtonOptions {
                    label: button.label.clone(),
                    variant: button.variant,
                    focused: button.focused,
                    width: Some(widths[i]),
                    ..Default::default()
                },
            );
            bx += widths[i] as isize + 2;
        }
    }

    inner
}

#[derive(Clone, Debug, Default)]
pub struct PaletteItem {
    pub label: String,
    pub hint: Option<String>,
}

impl PaletteItem {
    pub fn new(label: impl Into<String>) -> PaletteItem {
        PaletteItem { label: label.into(), hint: None }
    }

    pub fn hint(mut self, h: impl Into<String>) -> PaletteItem {
        self.hint = Some(h.into());
        self
    }
}

#[derive(Clone, Debug, Default)]
pub struct CommandPaletteOptions {
    pub query: String,
    pub items: Vec<PaletteItem>,
    pub selected: Option<usize>,
    pub width: Option<usize>,
    pub height: Option<usize>,
    pub placeholder: Option<String>,
}

/// Ctrl+K style palette: a query line above a filtered list.
pub fn draw_command_palette(root: &Surface, options: &CommandPaletteOptions) {
    let theme = root.theme.clone();
    let width = options.width.unwrap_or(60).min(root.width().saturating_sub(2));
    let height = options
        .height
        .unwrap_or((options.items.len() + 4).min(14))
        .min(root.height().saturating_sub(2));
    let x = ((root.width() as isize - width as isize) / 2).max(0);
    let y = ((root.height() as f64 / 5.0).floor() as isize).max(1);

    root.style_rect(
        0,
        0,
        root.width(),
        root.height(),
        &Style::new().with_fg(theme.foreground.mix(theme.background, 0.7)),
    );
    let surface = root.sub(x, y, width, height);
    let inner = surface.draw_box(&BoxOptions {
        border: Some(BorderStyle::Rounded),
        border_color: Some(theme.border_focused),
        bg: Some(elevate(&theme, 0.1)),
        title: Some("Command Palette".to_string()),
        ..Default::default()
    });

    inner.text(
        0,
        0,
        "› ",
        &TextOptions { fg: Some(theme.accent), attrs: Some(Attrs::BOLD), ..Default::default() },
    );
    let query_empty = options.query.is_empty();
    let query_text = if query_empty {
        options.placeholder.clone().unwrap_or_else(|| "Type a command…".to_string())
    } else {
        options.query.clone()
    };
    inner.text(
        2,
        0,
        &query_text,
        &TextOptions::new().fg(if query_empty { theme.muted } else { theme.foreground }),
    );
    inner.hline(0, 1, inner.width(), '─', &Style::new().with_fg(theme.border));

    let list_height = inner.height().saturating_sub(2);
    for i in 0..list_height {
        let item = match options.items.get(i) {
            Some(it) => it,
            None => break,
        };
        let selected = i == options.selected.unwrap_or(0);
        let yy = i as isize + 2;
        if selected {
            inner.fill_rect(0, yy, inner.width(), 1, &Style::new().with_bg(theme.selection), 32);
        }
        inner.text(
            1,
            yy,
            &truncate(&item.label, inner.width().saturating_sub(2)),
            &TextOptions {
                fg: Some(if selected { theme.selection_text } else { theme.foreground }),
                bg: if selected { Some(theme.selection) } else { None },
                attrs: Some(if selected { Attrs::BOLD } else { Attrs::NONE }),
                ..Default::default()
            },
        );
        if let Some(hint) = &item.hint {
            let hw = string_width(hint);
            if hw + 3 < inner.width() {
                inner.text(
                    (inner.width() - hw - 1) as isize,
                    yy,
                    hint,
                    &TextOptions {
                        fg: Some(theme.muted),
                        bg: if selected { Some(theme.selection) } else { None },
                        ..Default::default()
                    },
                );
            }
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct TooltipOptions {
    pub text: String,
    pub x: isize,
    pub y: isize,
    pub color: Option<Color>,
}

pub fn draw_tooltip(root: &Surface, options: &TooltipOptions) {
    let theme = root.theme.clone();
    let width = (string_width(&options.text) + 4).min(root.width());
    let x = options.x.min(root.width() as isize - width as isize).max(0);
    let y = options.y.min(root.height() as isize - 3).max(0);
    let surface = root.sub(x, y, width, 3);
    let inner = surface.draw_box(&BoxOptions {
        border: Some(BorderStyle::Rounded),
        border_color: Some(options.color.unwrap_or(theme.border_focused)),
        bg: Some(elevate(&theme, 0.12)),
        ..Default::default()
    });
    inner.text(
        0,
        0,
        &truncate(&options.text, inner.width()),
        &TextOptions::new().fg(theme.foreground),
    );
}
