//! The builder. Every container collects its children first, then solves the
//! layout once and draws — which is why `Size::Fr` works without a retained
//! tree.
//!
//! # What differs from the TypeScript reference, and why
//!
//! There, a widget takes an `onPress` callback that mutates whatever the
//! closure captured. That is natural in JavaScript and fights Rust's ownership
//! rules the whole way down, so interaction is inverted instead: a control is
//! given an `id`, and the app reports what happened to it.
//!
//! ```no_run
//! # use hqtui::prelude::*;
//! # use hqtui::widgets::ButtonOptions;
//! # let mut app = App::new().unwrap();
//! # let mut count = 0;
//! let label = format!("count: {count}");
//! app.draw(|f| {
//!     f.ui.panel(Panel::new().title("Counter"), |p| {
//!         p.text(&label);
//!         p.button(ButtonOptions::new("Add"), "add");
//!     });
//! }).unwrap();
//!
//! if app.pressed("add") { count += 1; }
//! ```
//!
//! Everything below that — layout, widgets, colors, glyphs — behaves
//! identically, and the conformance suite checks it cell by cell.

use std::cell::RefCell;
use std::rc::Rc;

use crate::buffer::Style;
use crate::capabilities::Capabilities;
use crate::color::Color;
use crate::graphics::BrailleCanvas;
use crate::layout::{stack_with_gaps, Constraint, Direction, Padding, Rect, Size};
use crate::surface::{BorderStyle, BoxOptions, Surface};
use crate::theme::Theme;
use crate::unicode::{string_width, wrap, Align};
use crate::widgets as w;

/// A rectangle the mouse can reach, tagged with the id the app reports.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HitRegion {
    pub id: String,
    pub rect: Rect,
    /// Rows of header the widget draws above its body, so a click on row 0 of a
    /// table is understood as the header rather than the first row.
    pub header_rows: usize,
}

/// What a control reported this frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Interaction {
    Clicked { id: String, x: usize, y: usize },
    Scrolled { id: String, delta: i32 },
    Hovered { id: String, x: usize, y: usize },
    /// Enter or Space on the focused control.
    Activated { id: String },
}

impl Interaction {
    pub fn id(&self) -> &str {
        match self {
            Interaction::Clicked { id, .. }
            | Interaction::Scrolled { id, .. }
            | Interaction::Hovered { id, .. }
            | Interaction::Activated { id } => id,
        }
    }
}

/// Something drawn above the whole screen, after the tree has been laid out.
///
/// The reference stores a closure here. These are owned values instead, because
/// a closure would need a lifetime on `Ctx` and therefore on every container in
/// the tree. The three built-in overlays are all the reference has, and anything
/// custom can be drawn last in the tree or through
/// [`Container::draw`](Container::draw).
#[derive(Clone, Debug)]
pub enum Overlay {
    Modal(w::ModalOptions),
    CommandPalette(w::CommandPaletteOptions),
    Tooltip(w::TooltipOptions),
}

impl Overlay {
    pub fn draw(self, root: &Surface) {
        match self {
            Overlay::Modal(o) => {
                w::draw_modal(root, &o);
            }
            Overlay::CommandPalette(o) => w::draw_command_palette(root, &o),
            Overlay::Tooltip(o) => w::draw_tooltip(root, &o),
        }
    }
}

/// Per-frame services the builder needs from the app. Shared by every container
/// in the tree, which is what lets a nested panel register a hit region.
pub struct Ctx {
    pub theme: Rc<Theme>,
    pub capabilities: Rc<Capabilities>,
    pub width: usize,
    pub height: usize,
    /// Frames drawn since start.
    pub frame: u64,
    /// Milliseconds since the app started.
    pub elapsed: u64,
    /// Which focusable control currently has focus.
    pub focus_index: usize,
    /// Merge the borders of adjacent panels into shared lines, the way CSS
    /// collapses table borders. Off unless the app asks for it, because it
    /// changes every layout that has two panels side by side.
    pub collapse_borders: bool,
    state: RefCell<FrameState>,
}

#[derive(Default)]
struct FrameState {
    focus_cursor: usize,
    focus_ids: Vec<String>,
    hits: Vec<HitRegion>,
    overlays: Vec<Overlay>,
}

impl Ctx {
    pub fn new(theme: Rc<Theme>, capabilities: Rc<Capabilities>, width: usize, height: usize) -> Ctx {
        Ctx {
            theme,
            capabilities,
            width,
            height,
            frame: 0,
            elapsed: 0,
            focus_index: 0,
            collapse_borders: false,
            state: RefCell::new(FrameState::default()),
        }
    }

    /// Claim the next focus slot. Returns whether this control has focus.
    pub fn register_focus(&self, id: &str) -> bool {
        let mut state = self.state.borrow_mut();
        let index = state.focus_cursor;
        state.focus_cursor += 1;
        state.focus_ids.push(id.to_string());
        index == self.focus_index
    }

    pub fn hit(&self, id: &str, rect: Rect, header_rows: usize) {
        self.state
            .borrow_mut()
            .hits
            .push(HitRegion { id: id.to_string(), rect, header_rows });
    }

    pub fn hits(&self) -> Vec<HitRegion> {
        self.state.borrow().hits.clone()
    }

    pub fn focus_ids(&self) -> Vec<String> {
        self.state.borrow().focus_ids.clone()
    }

    pub fn focus_count(&self) -> usize {
        self.state.borrow().focus_cursor
    }

    pub fn overlay(&self, overlay: Overlay) {
        self.state.borrow_mut().overlays.push(overlay);
    }

    /// Takes the overlays, in the order they were registered. The app draws
    /// them over the root once the tree has been flushed.
    pub fn take_overlays(&self) -> Vec<Overlay> {
        std::mem::take(&mut self.state.borrow_mut().overlays)
    }
}

// ------------------------------------------------------------------- options

/// Sizing and padding shared by every container.
#[derive(Clone, Debug, Default)]
pub struct Layout {
    /// Size along the parent's main axis.
    pub size: Option<Size>,
    pub min: Option<usize>,
    pub max: Option<usize>,
    pub gap: usize,
    pub padding: Padding,
    pub background: Option<Color>,
}

macro_rules! layout_builders {
    ($t:ty) => {
        impl $t {
            pub fn size(mut self, s: impl Into<Size>) -> Self {
                self.layout.size = Some(s.into());
                self
            }
            pub fn min(mut self, n: usize) -> Self {
                self.layout.min = Some(n);
                self
            }
            pub fn max(mut self, n: usize) -> Self {
                self.layout.max = Some(n);
                self
            }
            pub fn gap(mut self, n: usize) -> Self {
                self.layout.gap = n;
                self
            }
            pub fn padding(mut self, p: impl Into<Padding>) -> Self {
                self.layout.padding = p.into();
                self
            }
            pub fn background(mut self, c: Color) -> Self {
                self.layout.background = Some(c);
                self
            }
        }
    };
}

#[derive(Clone, Debug, Default)]
pub struct Row {
    pub layout: Layout,
}

impl Row {
    pub fn new() -> Row {
        Row::default()
    }
}
layout_builders!(Row);

#[derive(Clone, Debug, Default)]
pub struct Column {
    pub layout: Layout,
}

impl Column {
    pub fn new() -> Column {
        Column::default()
    }
}
layout_builders!(Column);

/// A bordered panel. The callback receives its interior as a column.
#[derive(Clone, Debug, Default)]
pub struct Panel {
    pub layout: Layout,
    pub title: Option<String>,
    pub title_align: Option<Align>,
    pub title_color: Option<Color>,
    pub subtitle: Option<String>,
    pub subtitle_color: Option<Color>,
    pub footer: Option<String>,
    pub border: Option<BorderStyle>,
    pub border_color: Option<Color>,
    /// Draws the focused border color and joins the Tab order.
    pub focus_id: Option<String>,
    pub focused: Option<bool>,
    /// Interior padding. Defaults to one column either side, as panels do.
    pub inner_padding: Option<Padding>,
}

impl Panel {
    pub fn new() -> Panel {
        Panel::default()
    }

    pub fn title(mut self, t: impl Into<String>) -> Panel {
        self.title = Some(t.into());
        self
    }

    pub fn subtitle(mut self, t: impl Into<String>) -> Panel {
        self.subtitle = Some(t.into());
        self
    }

    pub fn footer(mut self, t: impl Into<String>) -> Panel {
        self.footer = Some(t.into());
        self
    }

    pub fn border(mut self, b: BorderStyle) -> Panel {
        self.border = Some(b);
        self
    }

    pub fn focusable(mut self, id: impl Into<String>) -> Panel {
        self.focus_id = Some(id.into());
        self
    }

    pub fn focused(mut self, f: bool) -> Panel {
        self.focused = Some(f);
        self
    }
}
layout_builders!(Panel);

/// A CSS-ish grid. Children are placed in order and may span cells.
#[derive(Clone, Debug, Default)]
pub struct GridSpec {
    pub layout: Layout,
    pub columns: Vec<Size>,
    pub rows: Vec<Size>,
}

impl GridSpec {
    pub fn new() -> GridSpec {
        GridSpec::default()
    }

    pub fn columns<I, S>(mut self, sizes: I) -> GridSpec
    where
        I: IntoIterator<Item = S>,
        S: Into<Size>,
    {
        self.columns = sizes.into_iter().map(Into::into).collect();
        self
    }

    pub fn rows<I, S>(mut self, sizes: I) -> GridSpec
    where
        I: IntoIterator<Item = S>,
        S: Into<Size>,
    {
        self.rows = sizes.into_iter().map(Into::into).collect();
        self
    }

    /// `n` equal columns.
    pub fn column_count(mut self, n: usize) -> GridSpec {
        self.columns = vec![Size::Fr(1.0); n.max(1)];
        self
    }

    pub fn row_count(mut self, n: usize) -> GridSpec {
        self.rows = vec![Size::Fr(1.0); n.max(1)];
        self
    }
}
layout_builders!(GridSpec);

#[derive(Clone, Copy, Debug, Default)]
pub struct Span {
    pub cols: usize,
    pub rows: usize,
}

impl Span {
    pub fn new(cols: usize, rows: usize) -> Span {
        Span { cols, rows }
    }
}

// ----------------------------------------------------------------- container

type DrawFn<'a> = Box<dyn FnOnce(Surface) + 'a>;

struct Child<'a> {
    constraint: Constraint,
    draw: DrawFn<'a>,
    /// True when this child draws a border of its own. Only bordered siblings
    /// collapse into each other: a table pressed against a panel edge should
    /// not grow junctions out of its rows.
    bordered: bool,
}

pub struct Container<'a> {
    surface: Surface,
    ctx: Rc<Ctx>,
    direction: Direction,
    gap: usize,
    inner: Surface,
    children: Vec<Child<'a>>,
}

impl<'a> Container<'a> {
    pub fn new(surface: Surface, ctx: Rc<Ctx>, direction: Direction, layout: &Layout) -> Container<'a> {
        let inner = surface.inset(layout.padding);
        if let Some(bg) = layout.background {
            surface.fill(&Style::new().with_bg(bg));
        }
        Container { surface, ctx, direction, gap: layout.gap, inner, children: Vec::new() }
    }

    pub fn theme(&self) -> &Theme {
        &self.surface.theme
    }

    pub fn capabilities(&self) -> &Capabilities {
        &self.ctx.capabilities
    }

    pub fn width(&self) -> usize {
        self.inner.width()
    }

    pub fn height(&self) -> usize {
        self.inner.height()
    }

    /// Width available to a child laid out along the main axis.
    fn cross_width(&self) -> usize {
        match self.direction {
            Direction::Column => self.inner.width(),
            Direction::Row => self.inner.height(),
        }
    }

    fn add(&mut self, constraint: Constraint, draw: impl FnOnce(Surface) + 'a) -> &mut Self {
        self.children.push(Child { constraint, draw: Box::new(draw), bordered: false });
        self
    }

    /// As `add`, for a child that draws its own border.
    fn add_bordered(
        &mut self,
        constraint: Constraint,
        bordered: bool,
        draw: impl FnOnce(Surface) + 'a,
    ) -> &mut Self {
        self.children.push(Child { constraint, draw: Box::new(draw), bordered });
        self
    }

    /// The gap at each seam. Ordinarily one number repeated, but where
    /// collapsing is on and two bordered siblings meet with no gap between
    /// them, the seam is minus one so their borders land in the same column
    /// and merge.
    fn seams(&self) -> Vec<isize> {
        let plain = vec![self.gap as isize; self.children.len().saturating_sub(1)];
        if !self.ctx.collapse_borders || self.gap != 0 || self.children.len() < 2 {
            return plain;
        }
        (0..self.children.len() - 1)
            .map(|i| {
                if self.children[i].bordered && self.children[i + 1].bordered {
                    -1
                } else {
                    self.gap as isize
                }
            })
            .collect()
    }

    /// The constraint for a child that declared a `Layout`.
    fn constraint_of(&self, layout: &Layout, fallback: Size, intrinsic: Option<usize>) -> Constraint {
        let size = match layout.size {
            Some(s) => s,
            // Intrinsic sizes describe height. Along a row, a widget takes the
            // space it is given.
            None if self.direction == Direction::Row => Size::Fill,
            None => fallback,
        };
        Constraint { size: Some(size), min: layout.min, max: layout.max, intrinsic }
    }

    /// A leaf widget's constraint: its natural height down a column, the whole
    /// track across a row.
    fn leaf(&self, intrinsic: usize) -> Constraint {
        match self.direction {
            Direction::Row => Constraint { size: Some(Size::Fill), ..Default::default() },
            Direction::Column => Constraint {
                size: Some(Size::Auto),
                intrinsic: Some(intrinsic),
                ..Default::default()
            },
        }
    }

    fn filling(&self) -> Constraint {
        Constraint { size: Some(Size::Fill), ..Default::default() }
    }

    /// Solve and draw. The app calls this for you; parents call it for children.
    pub fn flush(&mut self) {
        if self.children.is_empty() || self.inner.rect.is_empty() {
            return;
        }
        let constraints: Vec<Constraint> = self.children.iter().map(|c| c.constraint).collect();
        let seams = self.seams();
        let rects = stack_with_gaps(self.inner.rect, &constraints, self.direction, &seams);
        for (child, rect) in std::mem::take(&mut self.children).into_iter().zip(rects) {
            if rect.is_empty() {
                continue;
            }
            (child.draw)(self.inner.region(rect));
        }
    }

    // ------------------------------------------------------------ layout

    /// A horizontal container. Children default to equal shares.
    pub fn row(&mut self, options: Row, build: impl FnOnce(&mut Container<'a>) + 'a) -> &mut Self {
        let ctx = self.ctx.clone();
        let constraint = self.constraint_of(&options.layout, Size::Fill, None);
        self.add(constraint, move |surface| {
            let mut container = Container::new(surface, ctx, Direction::Row, &options.layout);
            build(&mut container);
            container.flush();
        })
    }

    /// A vertical container.
    pub fn column(&mut self, options: Column, build: impl FnOnce(&mut Container<'a>) + 'a) -> &mut Self {
        let ctx = self.ctx.clone();
        let constraint = self.constraint_of(&options.layout, Size::Fill, None);
        self.add(constraint, move |surface| {
            let mut container = Container::new(surface, ctx, Direction::Column, &options.layout);
            build(&mut container);
            container.flush();
        })
    }

    /// A bordered panel. The callback receives its interior as a column.
    pub fn panel(&mut self, options: Panel, build: impl FnOnce(&mut Container<'a>) + 'a) -> &mut Self {
        let ctx = self.ctx.clone();
        let focused = match (&options.focus_id, options.focused) {
            (_, Some(f)) => f,
            (Some(id), None) => ctx.register_focus(id),
            (None, None) => false,
        };
        let constraint = self.constraint_of(&options.layout, Size::Fill, None);
        let bordered = options.border.unwrap_or(BorderStyle::Rounded) != BorderStyle::None;
        let collapse = self.ctx.collapse_borders;
        self.add_bordered(constraint, bordered, move |surface| {
            let theme = surface.theme.clone();
            let interior = surface.draw_box(&BoxOptions {
                title: options.title.clone(),
                title_align: options.title_align,
                title_color: options.title_color,
                subtitle: options.subtitle.clone(),
                subtitle_color: options.subtitle_color,
                footer: options.footer.clone(),
                border: Some(options.border.unwrap_or(BorderStyle::Rounded)),
                border_color: Some(options.border_color.unwrap_or(if focused {
                    theme.border_focused
                } else {
                    theme.border
                })),
                bg: options.layout.background,
                collapse,
                ..Default::default()
            });
            let inner_layout = Layout {
                gap: options.layout.gap,
                padding: options.inner_padding.unwrap_or(Padding::Axes(0, 1)),
                ..Default::default()
            };
            let mut container =
                Container::new(interior, ctx, Direction::Column, &inner_layout);
            build(&mut container);
            container.flush();
        })
    }

    /// A panel without a border — a grouping box that costs no rows.
    pub fn boxed(&mut self, options: Panel, build: impl FnOnce(&mut Container<'a>) + 'a) -> &mut Self {
        let mut o = options;
        o.border = Some(o.border.unwrap_or(BorderStyle::None));
        self.panel(o, build)
    }

    /// A CSS-ish grid, filled row-major with optional spans.
    pub fn grid(&mut self, options: GridSpec, build: impl FnOnce(&mut Grid<'a>) + 'a) -> &mut Self {
        let ctx = self.ctx.clone();
        let constraint = self.constraint_of(&options.layout, Size::Fill, None);
        self.add(constraint, move |surface| {
            let mut grid = Grid::new(surface, ctx, options);
            build(&mut grid);
            grid.flush();
        })
    }

    /// A child of an explicit size, for the cases the defaults do not cover.
    pub fn sized(
        &mut self,
        size: impl Into<Size>,
        build: impl FnOnce(&mut Container<'a>) + 'a,
    ) -> &mut Self {
        let ctx = self.ctx.clone();
        let direction = self.direction;
        let constraint = Constraint { size: Some(size.into()), ..Default::default() };
        self.add(constraint, move |surface| {
            let mut container =
                Container::new(surface, ctx, direction, &Layout::default());
            build(&mut container);
            container.flush();
        })
    }

    /// Blank space.
    pub fn spacer(&mut self, size: impl Into<Size>) -> &mut Self {
        let constraint = Constraint { size: Some(size.into()), ..Default::default() };
        self.add(constraint, |_| {})
    }

    /// A horizontal rule, optionally labelled.
    pub fn divider(&mut self, options: w::DividerOptions) -> &mut Self {
        let constraint = self.leaf(1);
        self.add(constraint, move |s| w::draw_divider(&s, &options))
    }

    // -------------------------------------------------------------- text

    pub fn text(&mut self, content: &str) -> &mut Self {
        self.styled_text(content, w::TextStyle::new())
    }

    pub fn styled_text(&mut self, content: &str, style: w::TextStyle) -> &mut Self {
        let lines = if style.wrap {
            wrap(content, self.cross_width()).len()
        } else {
            content.split('\n').count()
        };
        let constraint = self.leaf(lines);
        let owned = content.to_string();
        self.add(constraint, move |s| w::draw_text(&s, &owned, &style))
    }

    /// Muted secondary text.
    pub fn label(&mut self, content: &str) -> &mut Self {
        let fg = self.theme().muted;
        self.styled_text(content, w::TextStyle::new().fg(fg))
    }

    /// Bold heading in the theme's title color.
    pub fn heading(&mut self, content: &str) -> &mut Self {
        let fg = self.theme().title;
        self.styled_text(content, w::TextStyle::new().fg(fg).bold())
    }

    pub fn badge(&mut self, options: w::BadgeOptions) -> &mut Self {
        let constraint = self.leaf(1);
        self.add(constraint, move |s| {
            w::draw_badge(&s, &options);
        })
    }

    /// Aligned label/value pairs.
    pub fn key_values(&mut self, options: w::KeyValueOptions) -> &mut Self {
        let constraint = self.leaf(options.rows.len());
        self.add(constraint, move |s| w::draw_key_values(&s, &options))
    }

    // -------------------------------------------------------------- data

    /// `id` registers the widget's rect so the wheel and clicks reach it; pass
    /// `""` for a table nothing interacts with.
    pub fn table(&mut self, options: w::TableOptions, id: &str) -> &mut Self {
        let intrinsic = options.rows.len() + if options.header { 1 } else { 0 };
        let constraint = self.constraint_of(&Layout::default(), Size::Fill, Some(intrinsic));
        let ctx = self.ctx.clone();
        let id = id.to_string();
        let header_rows = if options.header { 1 } else { 0 };
        self.add(constraint, move |s| {
            w::draw_table(&s, &options);
            if !id.is_empty() {
                ctx.hit(&id, s.hit_rect(), header_rows);
            }
        })
    }

    pub fn list(&mut self, options: w::ListOptions, id: &str) -> &mut Self {
        let constraint = self.filling();
        let ctx = self.ctx.clone();
        let id = id.to_string();
        self.add(constraint, move |s| {
            w::draw_list(&s, &options);
            if !id.is_empty() {
                ctx.hit(&id, s.hit_rect(), 0);
            }
        })
    }

    /// A scrollbar over state you own, for anything that scrolls and is not a
    /// table: wrapped prose, a canvas, a `draw` of your own. A vertical bar
    /// fills the space it is given; a horizontal one is a single row.
    pub fn scrollbar(&mut self, options: w::ScrollbarOptions, id: &str) -> &mut Self {
        let constraint =
            if options.orientation.is_vertical() { self.filling() } else { self.leaf(1) };
        let ctx = self.ctx.clone();
        let id = id.to_string();
        self.add(constraint, move |s| {
            w::draw_scrollbar_widget(&s, &options);
            if !id.is_empty() {
                ctx.hit(&id, s.hit_rect(), 0);
            }
        })
    }

    pub fn tree(&mut self, options: w::TreeOptions, id: &str) -> &mut Self {
        let constraint = self.filling();
        let ctx = self.ctx.clone();
        let id = id.to_string();
        self.add(constraint, move |s| {
            w::draw_tree(&s, &options);
            if !id.is_empty() {
                ctx.hit(&id, s.hit_rect(), 0);
            }
        })
    }

    pub fn log(&mut self, options: w::LogOptions, id: &str) -> &mut Self {
        let constraint = self.filling();
        let ctx = self.ctx.clone();
        let id = id.to_string();
        self.add(constraint, move |s| {
            w::draw_log(&s, &options);
            if !id.is_empty() {
                ctx.hit(&id, s.hit_rect(), 0);
            }
        })
    }

    // ----------------------------------------------------------- metrics

    /// `label ████████░░░ 42%`
    pub fn meter(&mut self, options: w::MeterOptions) -> &mut Self {
        let constraint = self.leaf(1);
        self.add(constraint, move |s| w::draw_meter(&s, &options))
    }

    /// A stack or grid of meters.
    pub fn meters(&mut self, options: w::MetersOptions) -> &mut Self {
        let columns = options.columns.unwrap_or(1).max(1);
        let rows = options.items.len().div_ceil(columns);
        let constraint = self.leaf(rows);
        self.add(constraint, move |s| w::draw_meters(&s, &options))
    }

    pub fn progress(&mut self, options: w::ProgressOptions) -> &mut Self {
        let constraint = self.leaf(1);
        self.add(constraint, move |s| w::draw_progress(&s, &options))
    }

    /// Braille line/area graph. Fills the space it is given.
    pub fn graph(&mut self, options: w::GraphOptions) -> &mut Self {
        let constraint = self.filling();
        self.add(constraint, move |s| w::draw_graph(&s, &options))
    }

    /// A chart of arbitrary (x, y) data, with a domain on both axes.
    ///
    /// `graph` plots a history buffer, one sample per column. Use this when the
    /// data has its own x values: two series of different lengths then line up,
    /// and a point lands where its x says it does.
    pub fn chart(&mut self, options: w::ChartOptions) -> &mut Self {
        let constraint = self.filling();
        self.add(constraint, move |s| w::draw_chart(&s, &options))
    }

    /// Reset a region so an overlay can own it.
    ///
    /// Anything drawn into a region without clearing it first shows whatever
    /// was underneath through the cells it does not touch.
    pub fn clear(&mut self, options: w::ClearOptions) -> &mut Self {
        let constraint = self.filling();
        self.add(constraint, move |s| w::draw_clear(&s, &options))
    }

    /// Flood a region with one repeated symbol and style.
    pub fn fill(&mut self, options: w::FillOptions) -> &mut Self {
        let constraint = self.filling();
        self.add(constraint, move |s| w::draw_fill(&s, &options))
    }

    /// A month as a grid, with per-day styling.
    ///
    /// Sized to the month it shows: a month spans four, five or six week rows
    /// depending on where its first day falls, and reserving five leaves some
    /// months a row short and others a blank row long.
    pub fn calendar(&mut self, options: w::CalendarOptions) -> &mut Self {
        let height = w::calendar_height(&options);
        let constraint = self.leaf(height);
        self.add(constraint, move |s| w::draw_calendar(&s, &options))
    }

    /// A canvas drawn in your own coordinates rather than in pixels.
    ///
    /// `canvas` hands you the pixel grid and leaves the unit conversion to you,
    /// which means a drawing written for one panel size is wrong in the next.
    /// This takes bounds and shapes placed inside them, and y goes up.
    pub fn shapes(&mut self, options: crate::graphics::CanvasOptions) -> &mut Self {
        let constraint = self.filling();
        self.add(constraint, move |s| crate::graphics::draw_canvas(&s, &options))
    }

    /// A world map, and the country under whatever gets clicked.
    ///
    /// The click is answered by turning the cell back into degrees and testing
    /// it against the outlines, so the answer is the country actually under the
    /// cursor. Bounding boxes would be cheaper and wrong: Russia's covers most
    /// of the northern hemisphere and Chile's covers Argentina.
    pub fn world_map(&mut self, options: w::WorldMapOptions, id: &str) -> &mut Self {
        let constraint = self.filling();
        let ctx = self.ctx.clone();
        let id = id.to_string();
        self.add(constraint, move |s| {
            w::draw_world_map(&s, &options);
            if !id.is_empty() {
                ctx.hit(&id, s.hit_rect(), 0);
            }
        })
    }

    pub fn sparkline(&mut self, options: w::SparklineWidgetOptions) -> &mut Self {
        let constraint = self.leaf(1);
        self.add(constraint, move |s| w::draw_sparkline(&s, &options))
    }

    pub fn histogram(&mut self, options: w::ColumnsOptions) -> &mut Self {
        let constraint = self.filling();
        self.add(constraint, move |s| w::draw_columns(&s, &options))
    }

    /// A semicircular dial. Wants at least 9x5.
    pub fn gauge(&mut self, options: w::GaugeOptions) -> &mut Self {
        let constraint = self.filling();
        self.add(constraint, move |s| w::draw_gauge(&s, &options))
    }

    pub fn donut(&mut self, options: w::DonutOptions) -> &mut Self {
        let constraint = self.filling();
        self.add(constraint, move |s| w::draw_donut(&s, &options))
    }

    /// Segmented temperature-style bar.
    pub fn heat_bar(&mut self, options: w::HeatBarOptions) -> &mut Self {
        let constraint = self.leaf(1);
        self.add(constraint, move |s| w::draw_heat_bar(&s, &options))
    }

    // ------------------------------------------------------------ inputs

    /// A button. It joins the Tab order and reports under `id`.
    pub fn button(&mut self, options: w::ButtonOptions, id: &str) -> &mut Self {
        let ctx = self.ctx.clone();
        let focused = if options.focused { true } else { ctx.register_focus(id) };
        let constraint = self.leaf(1);
        let id = id.to_string();
        self.add(constraint, move |s| {
            w::draw_button(&s, &w::ButtonOptions { focused, ..options });
            ctx.hit(&id, s.hit_rect(), 0);
        })
    }

    pub fn checkbox(&mut self, options: w::CheckboxOptions, id: &str) -> &mut Self {
        let ctx = self.ctx.clone();
        let focused = if options.focused { true } else { ctx.register_focus(id) };
        let constraint = self.leaf(1);
        let id = id.to_string();
        self.add(constraint, move |s| {
            w::draw_checkbox(&s, &w::CheckboxOptions { focused, ..options });
            ctx.hit(&id, s.hit_rect(), 0);
        })
    }

    pub fn select(&mut self, options: w::SelectOptions, id: &str) -> &mut Self {
        let ctx = self.ctx.clone();
        let focused = if options.focused { true } else { ctx.register_focus(id) };
        let intrinsic = if options.open { options.options.len() + 1 } else { 1 };
        let constraint = self.leaf(intrinsic);
        let id = id.to_string();
        self.add(constraint, move |s| {
            w::draw_select(&s, &w::SelectOptions { focused, ..options });
            ctx.hit(&id, s.hit_rect(), 0);
        })
    }

    pub fn text_input(&mut self, options: w::TextInputOptions, id: &str) -> &mut Self {
        let ctx = self.ctx.clone();
        let focused = if options.focused { true } else { ctx.register_focus(id) };
        let constraint = self.leaf(1);
        let id = id.to_string();
        self.add(constraint, move |s| {
            w::draw_text_input(&s, &w::TextInputOptions { focused, ..options });
            ctx.hit(&id, s.hit_rect(), 0);
        })
    }

    /// Each tab registers its own hit region as `<id>:<index>`, so a click
    /// reports which tab was hit without the caller doing coordinate maths.
    pub fn tabs(&mut self, options: w::TabsOptions, id: &str) -> &mut Self {
        let ctx = self.ctx.clone();
        let constraint = self.leaf(1);
        let id = id.to_string();
        self.add(constraint, move |s| {
            w::draw_tabs(&s, &options);
            if !id.is_empty() {
                let r = s.hit_rect();
                let mut x = 0isize;
                for (i, tab) in options.tabs.iter().enumerate() {
                    let width = string_width(tab) + 4;
                    ctx.hit(
                        &format!("{id}:{i}"),
                        Rect { x: r.x + x, y: r.y, width, height: 1 },
                        0,
                    );
                    x += width as isize;
                }
            }
        })
    }

    pub fn status_bar(&mut self, options: w::StatusBarOptions) -> &mut Self {
        let constraint = self.leaf(1);
        self.add(constraint, move |s| w::draw_status_bar(&s, &options))
    }

    // ---------------------------------------------------------- overlays

    /// A centred dialog drawn above everything else this frame.
    pub fn modal(&mut self, options: w::ModalOptions) -> &mut Self {
        self.ctx.overlay(Overlay::Modal(options));
        self
    }

    pub fn command_palette(&mut self, options: w::CommandPaletteOptions) -> &mut Self {
        self.ctx.overlay(Overlay::CommandPalette(options));
        self
    }

    pub fn tooltip(&mut self, options: w::TooltipOptions) -> &mut Self {
        self.ctx.overlay(Overlay::Tooltip(options));
        self
    }

    // -------------------------------------------------- escape hatches

    /// Draw straight onto the framebuffer region. Nothing is off limits.
    pub fn draw(&mut self, fn_: impl FnOnce(&Surface) + 'a) -> &mut Self {
        let constraint = self.filling();
        self.add(constraint, move |s| fn_(&s))
    }

    /// A Braille pixel canvas sized to the region, blitted when you are done.
    pub fn canvas(
        &mut self,
        color: Option<Color>,
        fn_: impl FnOnce(&mut BrailleCanvas) + 'a,
    ) -> &mut Self {
        let constraint = self.filling();
        self.add(constraint, move |s| {
            let mut canvas = BrailleCanvas::new(s.width(), s.height());
            fn_(&mut canvas);
            let color = color.unwrap_or(s.theme.accent);
            for row in 0..canvas.rows {
                for col in 0..canvas.cols {
                    let value = canvas.cell(col, row);
                    if value != 0 {
                        s.char(col as isize, row as isize, value, &Style::new().with_fg(color));
                    }
                }
            }
        })
    }

    /// Run `build` only when the condition holds.
    pub fn when(&mut self, condition: bool, build: impl FnOnce(&mut Container<'a>)) -> &mut Self {
        if condition {
            build(self);
        }
        self
    }
}

// ---------------------------------------------------------------------- grid

struct Cell<'a> {
    span: Span,
    draw: DrawFn<'a>,
}

/// Grid placement with spans. Cells are filled row-major.
pub struct Grid<'a> {
    surface: Surface,
    ctx: Rc<Ctx>,
    spec: GridSpec,
    cells: Vec<Cell<'a>>,
}

impl<'a> Grid<'a> {
    fn new(surface: Surface, ctx: Rc<Ctx>, spec: GridSpec) -> Grid<'a> {
        let surface = surface.inset(spec.layout.padding);
        Grid { surface, ctx, spec, cells: Vec::new() }
    }

    fn track(spec: &[Size], fallback: usize) -> Vec<Size> {
        if spec.is_empty() {
            vec![Size::Fr(1.0); fallback.max(1)]
        } else {
            spec.to_vec()
        }
    }

    fn push(&mut self, span: Span, draw: impl FnOnce(Surface) + 'a) -> &mut Self {
        self.cells.push(Cell { span, draw: Box::new(draw) });
        self
    }

    /// A panel occupying the next free cell, or several with a span.
    pub fn panel(
        &mut self,
        options: Panel,
        span: Span,
        build: impl FnOnce(&mut Container<'a>) + 'a,
    ) -> &mut Self {
        let ctx = self.ctx.clone();
        self.push(span, move |surface| {
            let mut container =
                Container::new(surface, ctx, Direction::Column, &Layout::default());
            container.panel(options, build);
            container.flush();
        })
    }

    pub fn cell(
        &mut self,
        span: Span,
        build: impl FnOnce(&mut Container<'a>) + 'a,
    ) -> &mut Self {
        let ctx = self.ctx.clone();
        self.push(span, move |surface| {
            let mut container =
                Container::new(surface, ctx, Direction::Column, &Layout::default());
            build(&mut container);
            container.flush();
        })
    }

    pub fn flush(&mut self) {
        if self.cells.is_empty() || self.surface.rect.is_empty() {
            return;
        }
        let gap = self.spec.layout.gap;
        let column_spec = Grid::track(&self.spec.columns, self.cells.len().min(3));
        let row_count = if self.spec.rows.is_empty() {
            self.cells.len().div_ceil(column_spec.len())
        } else {
            self.spec.rows.len()
        };
        let row_spec = Grid::track(&self.spec.rows, row_count);

        let col_widths = crate::layout::solve(
            self.surface.width(),
            &column_spec.iter().map(|s| Constraint::new(*s)).collect::<Vec<_>>(),
            gap,
        );
        let row_heights = crate::layout::solve(
            self.surface.height(),
            &row_spec.iter().map(|s| Constraint::new(*s)).collect::<Vec<_>>(),
            gap,
        );

        let mut occupied: Vec<(usize, usize)> = Vec::new();
        let mut cursor = 0usize;

        for cell in std::mem::take(&mut self.cells) {
            // Clamp to the grid. A span wider than the track count can never
            // satisfy `col + col_span <= col_widths.len()`, so the placement
            // loop below used to burn the shared cursor to exhaustion —
            // dropping this cell and every one after it. A responsive layout
            // collapsing to one column made a full-width span blank the grid.
            let col_span = cell.span.cols.max(1).min(col_widths.len());
            let row_span = cell.span.rows.max(1).min(row_heights.len());

            // The cursor is shared across cells, so a cell that cannot be
            // placed must hand it back — otherwise it burns the cursor to
            // exhaustion and every later cell disappears too. Placement is
            // resolved before drawing so the search can loop while the draw,
            // which consumes the cell, happens exactly once.
            let search_from = cursor;
            let mut placement: Option<Rect> = None;
            while cursor < col_widths.len() * row_heights.len() + col_widths.len() {
                let col = cursor % col_widths.len();
                let row = cursor / col_widths.len();
                if row >= row_heights.len() {
                    break;
                }
                let mut free = col + col_span <= col_widths.len();
                if free {
                    'outer: for r in row..row + row_span {
                        for c in col..col + col_span {
                            if occupied.contains(&(c, r)) {
                                free = false;
                                break 'outer;
                            }
                        }
                    }
                }
                if !free {
                    cursor += 1;
                    continue;
                }
                for r in row..row + row_span {
                    for c in col..col + col_span {
                        occupied.push((c, r));
                    }
                }

                let mut x = self.surface.rect.x;
                for c in 0..col {
                    x += (col_widths[c] + gap) as isize;
                }
                let mut y = self.surface.rect.y;
                for r in 0..row {
                    y += (row_heights[r] + gap) as isize;
                }
                let mut width = 0usize;
                for c in col..(col + col_span).min(col_widths.len()) {
                    width += col_widths[c] + gap;
                }
                let mut height = 0usize;
                for r in row..(row + row_span).min(row_heights.len()) {
                    height += row_heights[r] + gap;
                }

                placement = Some(Rect {
                    x,
                    y,
                    width: width.saturating_sub(gap),
                    height: height.saturating_sub(gap),
                });
                cursor += 1;
                break;
            }

            match placement {
                Some(rect) => {
                    if !rect.is_empty() {
                        (cell.draw)(self.surface.region(rect));
                    }
                }
                None => cursor = search_from,
            }
        }
    }
}
