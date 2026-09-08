//! Render a view to an in-memory screen. No TTY, no escape codes, no timers —
//! which is what makes TUI code written with this library actually testable.
//!
//! ```
//! use hqtui::testing::render_to_screen;
//! use hqtui::ui::Panel;
//!
//! let screen = render_to_screen(80, 24, "dark", |ui| {
//!     ui.panel(Panel::new().title("CPU"), |p| { p.text("72%"); });
//! });
//! assert!(screen.contains("72%"));
//! ```

use std::cell::RefCell;
use std::rc::Rc;

use crate::buffer::{Attrs, FrameBuffer};
use crate::capabilities::{detect_capabilities_in, Capabilities, CapabilityOverrides, ColorDepth};
use crate::color::Color;
use crate::diff::{Encoder, EncoderOptions};
use crate::layout::Direction;
use crate::surface::Surface;
use crate::theme::{resolve_theme, Theme};
use crate::ui::{Container, Ctx, HitRegion, Layout};
use crate::unicode::{cell_text, CONTINUATION};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CellSnapshot {
    pub char: String,
    pub fg: Color,
    pub bg: Color,
    pub attrs: Attrs,
}

pub struct RenderedScreen {
    pub width: usize,
    pub height: usize,
    pub buffer: FrameBuffer,
    pub theme: Rc<Theme>,
    /// Mouse regions the view registered, in draw order. Lets a test assert
    /// that a widget is actually reachable by the wheel or a click, which is
    /// otherwise only observable by running a real terminal.
    pub regions: Vec<HitRegion>,
    /// Focusable control ids, in registration order.
    pub focus_ids: Vec<String>,
}

impl RenderedScreen {
    /// Plain text, one line per row, trailing spaces trimmed.
    pub fn text(&self) -> String {
        self.buffer.to_text()
    }

    /// One row of plain text.
    pub fn line(&self, y: usize) -> String {
        self.buffer.row_text(y).trim_end().to_string()
    }

    /// Everything, with ANSI colors — paste into a terminal to see it.
    pub fn ansi(&self) -> String {
        let empty = FrameBuffer::new(self.width, self.height);
        Encoder::new(EncoderOptions { colors: Some(ColorDepth::TrueColor), monochrome: false })
            .encode(&empty, &self.buffer, true)
            .output
    }

    pub fn cell(&self, x: usize, y: usize) -> CellSnapshot {
        let i = self.buffer.index(x, y);
        let value = self.buffer.chars[i];
        CellSnapshot {
            char: if value == CONTINUATION {
                String::new()
            } else if value == 0 {
                " ".to_string()
            } else {
                cell_text(value)
            },
            fg: self.buffer.fg[i],
            bg: self.buffer.bg[i],
            attrs: self.buffer.attrs[i],
        }
    }

    /// Row and column of the first occurrence, or `None`.
    pub fn find(&self, needle: &str) -> Option<(usize, usize)> {
        for y in 0..self.height {
            let row = self.buffer.row_text(y);
            if let Some(byte) = row.find(needle) {
                // Report the column, not the byte offset: a row with a wide
                // glyph in it has more bytes than cells.
                let x = row[..byte].chars().count();
                return Some((x, y));
            }
        }
        None
    }

    pub fn contains(&self, needle: &str) -> bool {
        (0..self.height).any(|y| self.buffer.row_text(y).contains(needle))
    }
}

/// Render a view to an in-memory screen.
pub fn render_to_screen<'v>(
    width: usize,
    height: usize,
    theme: &str,
    view: impl FnOnce(&mut Container<'v>),
) -> RenderedScreen {
    render_with(width, height, theme, 0, CapabilityOverrides::default(), view)
}

thread_local! {
    /// Set for the duration of `render_collapsed`. A thread local rather than
    /// another argument on five render functions, because collapsing is a
    /// property of a whole screen and tests are the only caller that needs to
    /// change it per render.
    static COLLAPSE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Render with adjacent panel borders merged, as `AppOptions::collapse_borders`
/// does for a running app.
pub fn render_collapsed_to_text<'v>(
    width: usize,
    height: usize,
    theme: &str,
    view: impl FnOnce(&mut Container<'v>),
) -> String {
    render_collapsed_to_screen(width, height, theme, view).text()
}

/// The same, returning the whole screen. Cell-level parity against the
/// TypeScript reference needs the buffer, not the text.
pub fn render_collapsed_to_screen<'v>(
    width: usize,
    height: usize,
    theme: &str,
    view: impl FnOnce(&mut Container<'v>),
) -> RenderedScreen {
    COLLAPSE.with(|flag| flag.set(true));
    let out = render_to_screen(width, height, theme, view);
    COLLAPSE.with(|flag| flag.set(false));
    out
}

/// The full form: pick the frame number and override capabilities.
pub fn render_with<'v>(
    width: usize,
    height: usize,
    theme_name: &str,
    frame: u64,
    overrides: CapabilityOverrides,
    view: impl FnOnce(&mut Container<'v>),
) -> RenderedScreen {
    let theme = Rc::new(resolve_theme(theme_name));
    let capabilities = Rc::new(headless_capabilities(overrides));

    let buffer = Rc::new(RefCell::new(FrameBuffer::new(width, height)));
    buffer.borrow_mut().clear(theme.background, theme.foreground);

    let mut ctx = Ctx::new(theme.clone(), capabilities, width, height);
    ctx.frame = frame;
    ctx.collapse_borders = COLLAPSE.with(|flag| flag.get());
    let ctx = Rc::new(ctx);

    let root = Surface::root(buffer.clone(), theme.clone());
    let mut container =
        Container::new(root.clone(), ctx.clone(), Direction::Column, &Layout::default());
    view(&mut container);
    container.flush();
    for overlay in ctx.take_overlays() {
        overlay.draw(&root);
    }

    let regions = ctx.hits();
    let focus_ids = ctx.focus_ids();
    let buffer = Rc::try_unwrap(buffer)
        .map(RefCell::into_inner)
        .unwrap_or_else(|rc| rc.borrow().clone());

    RenderedScreen { width, height, buffer, theme, regions, focus_ids }
}

/// A headless render should look like a capable terminal, not like whatever is
/// running the test suite — otherwise a plot silently degrades to ASCII in CI.
fn headless_capabilities(overrides: CapabilityOverrides) -> Capabilities {
    let merged = CapabilityOverrides {
        tty: Some(overrides.tty.unwrap_or(true)),
        colors: Some(overrides.colors.unwrap_or(ColorDepth::TrueColor)),
        unicode: Some(overrides.unicode.unwrap_or(true)),
        braille: Some(overrides.braille.unwrap_or(true)),
        mouse: overrides.mouse,
        synchronized_output: overrides.synchronized_output,
    };
    detect_capabilities_in(&merged, &Default::default(), true)
}

/// Shorthand: render and return plain text. Ideal for snapshot tests.
pub fn render_to_text<'v>(
    width: usize,
    height: usize,
    theme: &str,
    view: impl FnOnce(&mut Container<'v>),
) -> String {
    render_to_screen(width, height, theme, view).text()
}

/// Render with ANSI colors, e.g. to write a demo screenshot to a file.
pub fn render_to_ansi<'v>(
    width: usize,
    height: usize,
    theme: &str,
    view: impl FnOnce(&mut Container<'v>),
) -> String {
    render_to_screen(width, height, theme, view).ansi()
}

fn escape_html(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            other => other.to_string(),
        })
        .collect()
}

fn escape_attr(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&#39;".to_string(),
            other => other.to_string(),
        })
        .collect()
}

fn css_color(color: Color, fallback: &str) -> String {
    if color.is_default() {
        return fallback.to_string();
    }
    format!("#{:06x}", color.raw() & 0xff_ffff)
}

#[derive(Clone, Debug)]
pub struct HtmlOptions {
    pub font_size: f64,
    pub padding: f64,
    pub class_name: String,
    /// The default stack is ordered by box-drawing and Braille coverage.
    pub font_family: String,
}

impl Default for HtmlOptions {
    fn default() -> HtmlOptions {
        HtmlOptions {
            font_size: 14.0,
            padding: 16.0,
            class_name: "hqtui-screen".into(),
            font_family: "ui-monospace,SFMono-Regular,Menlo,'DejaVu Sans Mono','Liberation Mono',Consolas,'Segoe UI Symbol',monospace".into(),
        }
    }
}

/// Render to standalone HTML — a real screenshot of the UI, no terminal needed.
pub fn render_to_html(screen: &RenderedScreen, options: &HtmlOptions) -> String {
    let theme = &screen.theme;
    let bg_fallback = css_color(theme.background, "#000");
    let fg_fallback = css_color(theme.foreground, "#fff");
    let buffer = &screen.buffer;
    let mut rows: Vec<String> = Vec::new();

    for y in 0..screen.height {
        let mut row = String::new();
        let mut run = String::new();
        let mut run_fg: Option<Color> = None;
        let mut run_bg: Option<Color> = None;
        let mut run_attrs: Option<Attrs> = None;

        let flush = |row: &mut String,
                     run: &mut String,
                     fg: Option<Color>,
                     bg: Option<Color>,
                     attrs: Option<Attrs>| {
            if run.is_empty() {
                return;
            }
            let attrs = attrs.unwrap_or(Attrs::NONE);
            let mut style = format!(
                "color:{};background:{}",
                css_color(fg.unwrap_or(Color::DEFAULT), &fg_fallback),
                css_color(bg.unwrap_or(Color::DEFAULT), &bg_fallback)
            );
            if attrs.contains(Attrs::BOLD) {
                style.push_str(";font-weight:700");
            }
            if attrs.contains(Attrs::DIM) {
                style.push_str(";opacity:.65");
            }
            if attrs.contains(Attrs::ITALIC) {
                style.push_str(";font-style:italic");
            }
            if attrs.contains(Attrs::UNDERLINE) {
                style.push_str(";text-decoration:underline");
            }
            row.push_str(&format!("<span style=\"{style}\">{}</span>", escape_html(run)));
            run.clear();
        };

        for x in 0..screen.width {
            let i = buffer.index(x, y);
            if buffer.chars[i] == CONTINUATION {
                continue;
            }
            let fg = buffer.fg[i];
            let bg = buffer.bg[i];
            let attrs = buffer.attrs[i];
            if Some(fg) != run_fg || Some(bg) != run_bg || Some(attrs) != run_attrs {
                flush(&mut row, &mut run, run_fg, run_bg, run_attrs);
                run_fg = Some(fg);
                run_bg = Some(bg);
                run_attrs = Some(attrs);
            }
            let value = buffer.chars[i];
            run.push_str(&if value == 0 { " ".to_string() } else { cell_text(value) });
        }
        flush(&mut row, &mut run, run_fg, run_bg, run_attrs);
        rows.push(row);
    }

    // Every one of these is spliced into an attribute, so none may be trusted.
    // Numbers are bounded, and a font stack is reduced to the characters a font
    // stack can legitimately contain — escaping alone still lets `;` open a new
    // CSS property.
    let number = |value: f64, fallback: f64| -> f64 {
        if value.is_finite() && value > 0.0 && value <= 1000.0 {
            value
        } else {
            fallback
        }
    };
    let font_size = number(options.font_size, 14.0);
    let padding = number(options.padding, 16.0);
    let font: String = options
        .font_family
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || " ,._'-".contains(*c))
        .collect();

    // One <pre> with newline-separated rows: wrapping each row in its own
    // element gives the browser licence to lay out lines independently, which
    // pulls box-drawing rules apart. A single text flow tiles the grid exactly.
    // line-height must be tight for the same reason.
    format!(
        "<pre class=\"{}\" style=\"background:{bg_fallback};color:{fg_fallback};\
padding:{padding}px;font-size:{font_size}px;line-height:{:.2}px;font-family:{};\
margin:0;overflow-x:auto;border-radius:8px;white-space:pre;font-variant-ligatures:none;\
-webkit-font-smoothing:antialiased\">{}</pre>",
        escape_attr(&options.class_name),
        font_size * 1.18,
        escape_attr(&font),
        rows.join("\n")
    )
}
