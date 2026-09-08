//! Dense data widgets: tables, lists, trees, tailing logs and the scrollbar
//! they share.
//!
//! The reference implementation is generic over a row type and reads cells with
//! a key or a `render` callback. Rust takes the cells already stringified —
//! `TableRow::new(["1", "systemd", "0.1"])` — which keeps the widget free of
//! type parameters and puts the formatting where the data lives.

use crate::buffer::{Attrs, Style};
use crate::color::Color;
use crate::layout::{solve, Constraint, Size};
use crate::surface::{Surface, TextOptions};
use crate::widgets::scrollbar::draw_scrollbar;
use crate::theme::elevate;
use crate::unicode::{fit, string_width, truncate, Align};

#[derive(Clone, Debug, Default)]
pub struct TableColumn {
    pub title: Option<String>,
    pub width: Option<Size>,
    pub min: Option<usize>,
    pub max: Option<usize>,
    pub align: Align,
    pub color: Option<Color>,
}

impl TableColumn {
    pub fn new(title: impl Into<String>) -> TableColumn {
        TableColumn { title: Some(title.into()), ..Default::default() }
    }

    pub fn align(mut self, a: Align) -> TableColumn {
        self.align = a;
        self
    }

    pub fn width(mut self, w: impl Into<Size>) -> TableColumn {
        self.width = Some(w.into());
        self
    }

    pub fn color(mut self, c: Color) -> TableColumn {
        self.color = Some(c);
        self
    }
}

#[derive(Clone, Debug, Default)]
pub struct TableRow {
    pub cells: Vec<String>,
    /// Colors the whole row, unless the column or the cell says otherwise.
    pub color: Option<Color>,
    /// Per-cell colors, standing in for the reference's per-column color
    /// function. Where an entry exists for a column it wins outright, including
    /// when it is `None` — which is what that callback returning `undefined`
    /// does there.
    pub cell_colors: Vec<Option<Color>>,
}

impl TableRow {
    pub fn new<I, S>(cells: I) -> TableRow
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        TableRow {
            cells: cells.into_iter().map(Into::into).collect(),
            ..Default::default()
        }
    }

    pub fn color(mut self, c: Color) -> TableRow {
        self.color = Some(c);
        self
    }
}

#[derive(Clone, Debug)]
pub struct TableOptions {
    pub rows: Vec<TableRow>,
    pub columns: Vec<TableColumn>,
    pub header: bool,
    pub header_color: Option<Color>,
    /// Index of the highlighted row, or `None`.
    pub selected: Option<usize>,
    /// First visible row; combine with `selected` for scrolling lists.
    pub offset: Option<usize>,
    /// Scroll so `selected` stays visible. Only the table knows how many rows
    /// fit, so working the offset out here saves every caller from tracking
    /// heights.
    pub follow_selection: bool,
    pub zebra: bool,
    pub gap: usize,
    pub background: Option<Color>,
    /// Show a scrollbar in the last column when rows overflow.
    pub scrollbar: bool,
}

impl Default for TableOptions {
    fn default() -> TableOptions {
        TableOptions {
            rows: Vec::new(),
            columns: Vec::new(),
            header: true,
            header_color: None,
            selected: None,
            offset: None,
            follow_selection: false,
            zebra: false,
            gap: 1,
            background: None,
            scrollbar: false,
        }
    }
}

/// Where the visible window should start: the caller's offset, nudged just far
/// enough to keep the selected row on screen, and clamped to the list.
pub fn resolve_offset(
    offset: Option<usize>,
    selected: Option<usize>,
    capacity: usize,
    total: usize,
    follow: bool,
) -> usize {
    let max_offset = total.saturating_sub(capacity);
    let mut start = offset.unwrap_or(0).min(max_offset);
    if follow && capacity > 0 {
        if let Some(sel) = selected {
            if sel < start {
                start = sel;
            } else if sel >= start + capacity {
                start = sel - capacity + 1;
            }
        }
    }
    start.min(max_offset)
}

/// A dense, column-aligned table with optional selection and scrollbar.
pub fn draw_table(surface: &Surface, options: &TableOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let gap = options.gap;
    let header_rows = if options.header { 1 } else { 0 };
    let body_width = surface.width().saturating_sub(if options.scrollbar { 1 } else { 0 });

    let constraints: Vec<Constraint> = options
        .columns
        .iter()
        .enumerate()
        .map(|(ci, c)| Constraint {
            size: Some(c.width.unwrap_or(Size::Auto)),
            min: Some(c.min.unwrap_or(1)),
            max: c.max,
            intrinsic: Some(if c.width.is_none() {
                // The reference samples the first 200 rows, which is what keeps
                // an auto column cheap on a long table.
                let widest = options
                    .rows
                    .iter()
                    .take(200)
                    .map(|r| string_width(r.cells.get(ci).map(String::as_str).unwrap_or("")))
                    .max()
                    .unwrap_or(0);
                string_width(c.title.as_deref().unwrap_or("")).max(widest)
            } else {
                0
            }),
        })
        .collect();
    let widths = solve(body_width, &constraints, gap);

    if options.header {
        let mut x = 0isize;
        for (i, column) in options.columns.iter().enumerate() {
            let w = widths[i];
            if w == 0 {
                continue;
            }
            surface.text(
                x,
                0,
                &fit(&truncate(column.title.as_deref().unwrap_or(""), w), w, column.align),
                &TextOptions {
                    fg: Some(options.header_color.unwrap_or(theme.muted)),
                    bg: options.background,
                    attrs: Some(Attrs::BOLD),
                    ..Default::default()
                },
            );
            x += (w + gap) as isize;
        }
    }

    let capacity = surface.height().saturating_sub(header_rows);
    let offset = resolve_offset(
        options.offset,
        options.selected,
        capacity,
        options.rows.len(),
        options.follow_selection,
    );
    let zebra_bg = if options.zebra { Some(elevate(&theme, 0.04)) } else { None };

    for i in 0..capacity {
        let row_index = offset + i;
        let row = match options.rows.get(row_index) {
            Some(r) => r,
            None => break,
        };
        let y = (i + header_rows) as isize;
        let selected = options.selected == Some(row_index);
        let row_bg = if selected {
            Some(theme.selection)
        } else if options.zebra && row_index % 2 == 1 {
            zebra_bg
        } else {
            options.background
        };

        if let Some(bg) = row_bg {
            surface.fill_rect(0, y, body_width, 1, &Style::new().with_bg(bg), 32);
        }

        let mut x = 0isize;
        for (ci, column) in options.columns.iter().enumerate() {
            let w = widths[ci];
            if w == 0 {
                continue;
            }
            let text = row.cells.get(ci).map(String::as_str).unwrap_or("");
            let fg = if selected {
                Some(theme.selection_text)
            } else if ci < row.cell_colors.len() {
                row.cell_colors[ci]
            } else if column.color.is_some() {
                column.color
            } else {
                row.color
            };
            surface.text(
                x,
                y,
                &fit(&truncate(text, w), w, column.align),
                &TextOptions {
                    fg: Some(fg.unwrap_or(theme.foreground)),
                    bg: row_bg,
                    attrs: Some(if selected { Attrs::BOLD } else { Attrs::NONE }),
                    ..Default::default()
                },
            );
            x += (w + gap) as isize;
        }
    }

    if options.scrollbar && options.rows.len() > capacity && capacity > 0 {
        draw_scrollbar(
            surface,
            surface.width() as isize - 1,
            header_rows as isize,
            capacity,
            options.rows.len(),
            offset,
        );
    }
}

#[derive(Clone, Debug, Default)]
pub struct ListItem {
    pub label: String,
    pub color: Option<Color>,
    pub badge: Option<String>,
}

impl ListItem {
    pub fn new(label: impl Into<String>) -> ListItem {
        ListItem { label: label.into(), ..Default::default() }
    }

    pub fn color(mut self, c: Color) -> ListItem {
        self.color = Some(c);
        self
    }
}

impl From<&str> for ListItem {
    fn from(s: &str) -> ListItem {
        ListItem::new(s)
    }
}

impl From<String> for ListItem {
    fn from(s: String) -> ListItem {
        ListItem::new(s)
    }
}

#[derive(Clone, Debug, Default)]
pub struct ListOptions {
    pub items: Vec<ListItem>,
    pub selected: Option<usize>,
    pub offset: Option<usize>,
    /// Scroll so `selected` stays visible.
    pub follow_selection: bool,
    pub background: Option<Color>,
    pub bullet: Option<String>,
    pub scrollbar: bool,
}

pub fn draw_list(surface: &Surface, options: &ListOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let width = surface.width().saturating_sub(if options.scrollbar { 1 } else { 0 });
    let offset = resolve_offset(
        options.offset,
        options.selected,
        surface.height(),
        options.items.len(),
        options.follow_selection,
    );
    for i in 0..surface.height() {
        let index = offset + i;
        let item = match options.items.get(index) {
            Some(it) => it,
            None => break,
        };
        let selected = options.selected == Some(index);
        let bullet = options.bullet.as_ref().map(|b| format!("{b} ")).unwrap_or_default();
        let label = format!("{bullet}{}", item.label);
        if selected {
            surface.fill_rect(
                0,
                i as isize,
                width,
                1,
                &Style::new().with_bg(theme.selection),
                32,
            );
        }
        surface.text(
            0,
            i as isize,
            &fit(&truncate(&label, width), width, Align::Left),
            &TextOptions {
                fg: Some(if selected {
                    theme.selection_text
                } else {
                    item.color.unwrap_or(theme.foreground)
                }),
                bg: if selected { Some(theme.selection) } else { options.background },
                attrs: Some(if selected { Attrs::BOLD } else { Attrs::NONE }),
                ..Default::default()
            },
        );
    }
    if options.scrollbar && options.items.len() > surface.height() {
        draw_scrollbar(
            surface,
            surface.width() as isize - 1,
            0,
            surface.height(),
            options.items.len(),
            offset,
        );
    }
}

#[derive(Clone, Debug, Default)]
pub struct TreeValue {
    pub text: String,
    pub width: usize,
    pub color: Option<Color>,
    pub align: Option<Align>,
}

#[derive(Clone, Debug, Default)]
pub struct TreeNode {
    pub label: String,
    pub color: Option<Color>,
    /// Right-aligned columns, e.g. CPU% and MEM% in a process tree.
    pub values: Vec<TreeValue>,
    pub children: Vec<TreeNode>,
    /// `None` and `Some(true)` both expand; only `Some(false)` collapses.
    pub expanded: Option<bool>,
}

impl TreeNode {
    pub fn new(label: impl Into<String>) -> TreeNode {
        TreeNode { label: label.into(), ..Default::default() }
    }

    pub fn child(mut self, node: TreeNode) -> TreeNode {
        self.children.push(node);
        self
    }
}

#[derive(Clone, Debug, Default)]
pub struct TreeOptions {
    pub nodes: Vec<TreeNode>,
    pub selected: Option<usize>,
    pub offset: Option<usize>,
    pub follow_selection: bool,
    pub background: Option<Color>,
    /// Draw the ├─ └─ connectors. Defaults on.
    pub guides: Option<bool>,
    pub guide_color: Option<Color>,
}

struct FlatNode<'a> {
    node: &'a TreeNode,
    depth: usize,
    last: Vec<bool>,
}

fn flatten<'a>(nodes: &'a [TreeNode], depth: usize, trail: &[bool], out: &mut Vec<FlatNode<'a>>) {
    for (i, node) in nodes.iter().enumerate() {
        let last = i == nodes.len() - 1;
        let mut here = trail.to_vec();
        here.push(last);
        out.push(FlatNode { node, depth, last: here.clone() });
        if !node.children.is_empty() && node.expanded != Some(false) {
            flatten(&node.children, depth + 1, &here, out);
        }
    }
}

/// An indented tree with box-drawing connectors, like `pstree`.
pub fn draw_tree(surface: &Surface, options: &TreeOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let mut flat: Vec<FlatNode> = Vec::new();
    flatten(&options.nodes, 0, &[], &mut flat);

    let offset = resolve_offset(
        options.offset,
        options.selected,
        surface.height(),
        flat.len(),
        options.follow_selection,
    );
    let guides = options.guides != Some(false);
    let guide_color = options.guide_color.unwrap_or_else(|| theme.border.mix(theme.foreground, 0.15));

    for i in 0..surface.height() {
        let index = offset + i;
        let entry = match flat.get(index) {
            Some(e) => e,
            None => break,
        };
        let y = i as isize;
        let selected = options.selected == Some(index);
        let bg = if selected { Some(theme.selection) } else { options.background };
        if selected {
            surface.fill_rect(0, y, surface.width(), 1, &Style::new().with_bg(theme.selection), 32);
        }

        let mut prefix = String::new();
        if guides {
            for d in 0..entry.depth {
                prefix.push_str(if entry.last[d] { "   " } else { "│  " });
            }
            prefix.push_str(if entry.last[entry.depth] { "└─ " } else { "├─ " });
        } else {
            prefix = "  ".repeat(entry.depth);
        }

        let values_width: usize = entry.node.values.iter().map(|v| v.width + 1).sum();
        let label_width = surface.width().saturating_sub(values_width);
        surface.text(
            0,
            y,
            &truncate(&prefix, label_width),
            &TextOptions { fg: Some(guide_color), bg, ..Default::default() },
        );
        let px = string_width(&prefix).min(label_width);
        surface.text(
            px as isize,
            y,
            &truncate(&entry.node.label, label_width.saturating_sub(px)),
            &TextOptions {
                fg: Some(if selected {
                    theme.selection_text
                } else {
                    entry.node.color.unwrap_or(theme.foreground)
                }),
                bg,
                attrs: Some(if selected { Attrs::BOLD } else { Attrs::NONE }),
                ..Default::default()
            },
        );

        let mut vx = label_width;
        for value in &entry.node.values {
            surface.text(
                vx as isize,
                y,
                &fit(
                    &truncate(&value.text, value.width),
                    value.width,
                    value.align.unwrap_or(Align::Right),
                ),
                &TextOptions {
                    fg: Some(if selected {
                        theme.selection_text
                    } else {
                        value.color.unwrap_or(theme.foreground)
                    }),
                    bg,
                    ..Default::default()
                },
            );
            vx += value.width + 1;
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct LogEntry {
    pub time: Option<String>,
    pub level: Option<String>,
    pub message: String,
    pub meta: Option<String>,
    pub color: Option<Color>,
}

impl LogEntry {
    pub fn new(message: impl Into<String>) -> LogEntry {
        LogEntry { message: message.into(), ..Default::default() }
    }

    pub fn at(mut self, time: impl Into<String>) -> LogEntry {
        self.time = Some(time.into());
        self
    }

    pub fn level(mut self, level: impl Into<String>) -> LogEntry {
        self.level = Some(level.into());
        self
    }
}

#[derive(Clone, Debug, Default)]
pub struct LogOptions {
    pub entries: Vec<LogEntry>,
    /// Pin to the newest entry. Defaults on; set `Some(false)` to scroll.
    pub follow: Option<bool>,
    pub offset: Option<usize>,
    /// Lines to scroll back from the newest entry. The natural control for a
    /// tailing log: only the widget knows how many rows fit, so an absolute
    /// offset makes small scrolls near the bottom clamp to nothing.
    pub from_end: Option<usize>,
    pub scrollbar: bool,
    pub background: Option<Color>,
    pub level_colors: Vec<(String, Color)>,
    pub time_color: Option<Color>,
    pub meta_color: Option<Color>,
}

/// A tailing log view with colored levels. Newest at the bottom.
pub fn draw_log(surface: &Surface, options: &LogOptions) {
    if surface.is_empty() {
        return;
    }
    let theme = surface.theme.clone();
    let level_color = |name: &str| -> Color {
        let upper = name.to_uppercase();
        if let Some((_, c)) = options.level_colors.iter().find(|(k, _)| *k == upper) {
            return *c;
        }
        match upper.as_str() {
            "ERROR" | "FATAL" => theme.danger,
            "WARN" => theme.warning,
            "INFO" => theme.success,
            "DEBUG" | "TRACE" => theme.muted,
            _ => theme.foreground,
        }
    };

    let entries = &options.entries;
    let follow = options.follow != Some(false);
    let width = surface.width().saturating_sub(if options.scrollbar { 1 } else { 0 });
    let from_end = options.from_end.unwrap_or(0);
    let max_start = entries.len().saturating_sub(surface.height());
    let start = if follow || from_end > 0 {
        max_start.min(
            entries.len().saturating_sub(surface.height()).saturating_sub(from_end),
        )
    } else {
        resolve_offset(options.offset, None, surface.height(), entries.len(), false)
    };

    for i in 0..surface.height() {
        let entry = match entries.get(start + i) {
            Some(e) => e,
            None => break,
        };
        let y = i as isize;
        let mut x = 0isize;
        if let Some(time) = &entry.time {
            x += surface.text(
                x,
                y,
                &format!("{time} "),
                &TextOptions {
                    fg: Some(options.time_color.unwrap_or(theme.muted)),
                    bg: options.background,
                    ..Default::default()
                },
            ) as isize;
        }
        if let Some(level) = &entry.level {
            x += surface.text(
                x,
                y,
                &fit(&level.to_uppercase(), 5, Align::Left),
                &TextOptions {
                    fg: Some(level_color(level)),
                    bg: options.background,
                    attrs: Some(Attrs::BOLD),
                    ..Default::default()
                },
            ) as isize;
            x += surface.text(
                x,
                y,
                " ",
                &TextOptions { bg: options.background, ..Default::default() },
            ) as isize;
        }
        let meta_width = entry.meta.as_ref().map(|m| string_width(m) + 1).unwrap_or(0);
        let msg_width = (width as isize - x - meta_width as isize).max(0) as usize;
        surface.text(
            x,
            y,
            &truncate(&entry.message, msg_width),
            &TextOptions {
                fg: Some(entry.color.unwrap_or(theme.foreground)),
                bg: options.background,
                ..Default::default()
            },
        );
        if let Some(meta) = &entry.meta {
            if meta_width < width {
                surface.text(
                    (width - meta_width + 1) as isize,
                    y,
                    meta,
                    &TextOptions {
                        fg: Some(options.meta_color.unwrap_or(theme.muted)),
                        bg: options.background,
                        ..Default::default()
                    },
                );
            }
        }
    }
}
