//! The builder. Every container collects its children first, then solves the
//! layout once and draws — which is why `Size.fr` works without a retained tree.
//!
//! # What differs from the TypeScript reference, and why
//!
//! Two things, and both come from Zig having no closures.
//!
//! * **A nested container takes a `Body`, not a lambda.** `Body.with(&state,
//!   func)` pairs your own context pointer with a plain function; `Body.plain`
//!   is the no-context form. The reference writes `p => { ... }`.
//!
//! * **Interaction is inverted.** There, a widget takes an `onPress` callback
//!   that mutates whatever the closure captured. Here a control is given an
//!   `id` and the app reports what happened to it:
//!
//! ```zig
//! const Scene = struct {
//!     count: u32,
//!     fn view(self: *@This(), ui: *Container) !void {
//!         try ui.panel(.{ .title = "Counter" }, Body.with(self, body));
//!     }
//!     fn body(self: *@This(), p: *Container) !void {
//!         try p.text(try p.fmt("count: {d}", .{self.count}), .{});
//!         try p.button(.{ .label = "Add" }, "add");
//!     }
//! };
//! // ... later, after the frame:
//! if (app.pressed("add")) scene.count += 1;
//! ```
//!
//! # Lifetimes
//!
//! A child is drawn after the function that declared it has returned, so
//! anything it points at has to outlive the frame, not the call. Slices into
//! app state and string literals are fine; a stack buffer is not. `fmt` and
//! `dupe` copy into the frame arena when you need to build a string on the fly.
//!
//! Everything below the builder — layout, widgets, colors, glyphs — behaves
//! identically to the reference, and the conformance suite checks it cell by
//! cell.

const std = @import("std");

const buffer_mod = @import("buffer.zig");
const capabilities_mod = @import("capabilities.zig");
const color_mod = @import("color.zig");
const graphics = @import("graphics.zig");
const layout_mod = @import("layout.zig");
const surface_mod = @import("surface.zig");
const theme_mod = @import("theme.zig");
const unicode = @import("unicode.zig");
const w = @import("widgets.zig");

const Align = unicode.Align;
const BorderStyle = surface_mod.BorderStyle;
const BrailleCanvas = graphics.BrailleCanvas;
const Capabilities = capabilities_mod.Capabilities;
const Color = color_mod.Color;
const Constraint = layout_mod.Constraint;
const Direction = layout_mod.Direction;
const Padding = layout_mod.Padding;
const Rect = layout_mod.Rect;
const Size = layout_mod.Size;
const Style = buffer_mod.Style;
const Surface = surface_mod.Surface;
const Theme = theme_mod.Theme;

/// A rectangle the mouse can reach, tagged with the id the app reports.
pub const HitRegion = struct {
    id: []const u8,
    rect: Rect,
    /// Rows of header the widget draws above its body, so a click on row 0 of a
    /// table is understood as the header rather than the first row.
    header_rows: usize = 0,
};

/// What a control reported this frame.
pub const Interaction = union(enum) {
    clicked: struct { id: []const u8, x: usize, y: usize },
    scrolled: struct { id: []const u8, delta: i32 },
    hovered: struct { id: []const u8, x: usize, y: usize },
    /// Enter or Space on the focused control.
    activated: struct { id: []const u8 },

    pub fn id(self: Interaction) []const u8 {
        return switch (self) {
            inline else => |v| v.id,
        };
    }
};

/// Something drawn above the whole screen, after the tree has been laid out.
///
/// The reference stores a closure here. These are owned values instead: the
/// three built-ins are all the reference has, and anything custom can be drawn
/// last in the tree or through `Container.draw`.
pub const Overlay = union(enum) {
    modal: w.ModalOptions,
    command_palette: w.CommandPaletteOptions,
    tooltip: w.TooltipOptions,

    pub fn draw(self: Overlay, allocator: std.mem.Allocator, root: Surface) !void {
        switch (self) {
            .modal => |o| _ = try w.drawModal(allocator, root, o),
            .command_palette => |o| w.drawCommandPalette(root, o),
            .tooltip => |o| w.drawTooltip(root, o),
        }
    }
};

/// Per-frame services the builder needs from the app. Shared by every container
/// in the tree, which is what lets a nested panel register a hit region.
///
/// `allocator` is the frame arena: everything it hands out is freed in one go
/// when the frame ends, so nothing in the builder has to track a lifetime.
pub const Ctx = struct {
    allocator: std.mem.Allocator,
    theme: *const Theme,
    capabilities: *const Capabilities,
    width: usize,
    height: usize,
    /// Frames drawn since start.
    frame: u64 = 0,
    /// Milliseconds since the app started.
    elapsed: u64 = 0,
    /// Which focusable control currently has focus.
    focus_index: usize = 0,
    /// Merge the borders of adjacent panels into shared lines, the way CSS
    /// collapses table borders. Off unless the app asks for it, because it
    /// changes every layout that has two panels side by side.
    collapse_borders: bool = false,

    focus_cursor: usize = 0,
    focus_ids: std.ArrayList([]const u8) = .empty,
    hits: std.ArrayList(HitRegion) = .empty,
    overlays: std.ArrayList(Overlay) = .empty,

    pub fn init(
        allocator: std.mem.Allocator,
        theme: *const Theme,
        caps: *const Capabilities,
        width: usize,
        height: usize,
    ) Ctx {
        return .{
            .allocator = allocator,
            .theme = theme,
            .capabilities = caps,
            .width = width,
            .height = height,
        };
    }

    /// Claim the next focus slot. Returns whether this control has focus.
    pub fn registerFocus(self: *Ctx, id: []const u8) bool {
        const index = self.focus_cursor;
        self.focus_cursor += 1;
        self.focus_ids.append(self.allocator, id) catch {};
        return index == self.focus_index;
    }

    pub fn hit(self: *Ctx, id: []const u8, rect: Rect, header_rows: usize) void {
        self.hits.append(
            self.allocator,
            .{ .id = id, .rect = rect, .header_rows = header_rows },
        ) catch {};
    }

    pub fn focusCount(self: Ctx) usize {
        return self.focus_cursor;
    }

    pub fn overlay(self: *Ctx, value: Overlay) void {
        self.overlays.append(self.allocator, value) catch {};
    }
};

// ------------------------------------------------------------------- options

/// Sizing and padding shared by every container.
pub const Layout = struct {
    /// Size along the parent's main axis.
    size: ?Size = null,
    min: ?usize = null,
    max: ?usize = null,
    gap: usize = 0,
    padding: Padding = .{},
    background: ?Color = null,
};

pub const RowOptions = struct { layout: Layout = .{} };
pub const ColumnOptions = struct { layout: Layout = .{} };

/// A bordered panel. The body receives its interior as a column.
pub const PanelOptions = struct {
    layout: Layout = .{},
    /// Empty rather than optional, matching `BoxOptions` and every other widget
    /// in the port: there is no difference between an absent title and a blank
    /// one, and one less `?` shows up at every call site.
    title: []const u8 = "",
    title_align: Align = .left,
    title_color: ?Color = null,
    subtitle: []const u8 = "",
    subtitle_color: ?Color = null,
    footer: []const u8 = "",
    border: ?BorderStyle = null,
    border_color: ?Color = null,
    /// Draws the focused border color and joins the Tab order.
    focus_id: ?[]const u8 = null,
    focused: ?bool = null,
    /// Interior padding. Defaults to one column either side, as panels do.
    inner_padding: ?Padding = null,
};

/// A CSS-ish grid. Children are placed in order and may span cells.
pub const GridOptions = struct {
    layout: Layout = .{},
    columns: []const Size = &.{},
    rows: []const Size = &.{},
    /// `n` equal columns, when `columns` is not given.
    column_count: usize = 0,
    row_count: usize = 0,
};

/// How many grid cells a child covers. Zero means one.
pub const Span = struct {
    cols: usize = 0,
    rows: usize = 0,
};

// ---------------------------------------------------------------- callbacks

/// A nested container's contents.
///
/// Zig has no closures, so the context travels beside the function instead of
/// inside it. `Body.with(&state, func)` is the usual form; `Body.plain(func)`
/// when there is nothing to capture.
pub const Body = struct {
    ctx: ?*anyopaque = null,
    call: ?*const fn (?*anyopaque, *Container) anyerror!void = null,

    pub const none: Body = .{};

    pub fn with(ctx: anytype, comptime f: fn (@TypeOf(ctx), *Container) anyerror!void) Body {
        comptime std.debug.assert(@typeInfo(@TypeOf(ctx)) == .pointer);
        const Shim = struct {
            fn call(erased: ?*anyopaque, container: *Container) anyerror!void {
                try f(@ptrCast(@alignCast(erased)), container);
            }
        };
        return .{ .ctx = @constCast(@ptrCast(ctx)), .call = Shim.call };
    }

    pub fn plain(comptime f: fn (*Container) anyerror!void) Body {
        const Shim = struct {
            fn call(_: ?*anyopaque, container: *Container) anyerror!void {
                try f(container);
            }
        };
        return .{ .call = Shim.call };
    }

    fn run(self: Body, container: *Container) anyerror!void {
        if (self.call) |f| try f(self.ctx, container);
    }
};

/// A grid's contents. Same shape as `Body`, but the callback places cells.
pub const GridBody = struct {
    ctx: ?*anyopaque = null,
    call: ?*const fn (?*anyopaque, *Grid) anyerror!void = null,

    pub const none: GridBody = .{};

    pub fn with(ctx: anytype, comptime f: fn (@TypeOf(ctx), *Grid) anyerror!void) GridBody {
        comptime std.debug.assert(@typeInfo(@TypeOf(ctx)) == .pointer);
        const Shim = struct {
            fn call(erased: ?*anyopaque, grid: *Grid) anyerror!void {
                try f(@ptrCast(@alignCast(erased)), grid);
            }
        };
        return .{ .ctx = @constCast(@ptrCast(ctx)), .call = Shim.call };
    }

    pub fn plain(comptime f: fn (*Grid) anyerror!void) GridBody {
        const Shim = struct {
            fn call(_: ?*anyopaque, grid: *Grid) anyerror!void {
                try f(grid);
            }
        };
        return .{ .call = Shim.call };
    }

    fn run(self: GridBody, grid: *Grid) anyerror!void {
        if (self.call) |f| try f(self.ctx, grid);
    }
};

/// Free-form drawing onto a solved region.
pub const DrawBody = struct {
    ctx: ?*anyopaque = null,
    call: ?*const fn (?*anyopaque, Surface) anyerror!void = null,

    pub fn with(ctx: anytype, comptime f: fn (@TypeOf(ctx), Surface) anyerror!void) DrawBody {
        comptime std.debug.assert(@typeInfo(@TypeOf(ctx)) == .pointer);
        const Shim = struct {
            fn call(erased: ?*anyopaque, s: Surface) anyerror!void {
                try f(@ptrCast(@alignCast(erased)), s);
            }
        };
        return .{ .ctx = @constCast(@ptrCast(ctx)), .call = Shim.call };
    }

    pub fn plain(comptime f: fn (Surface) anyerror!void) DrawBody {
        const Shim = struct {
            fn call(_: ?*anyopaque, s: Surface) anyerror!void {
                try f(s);
            }
        };
        return .{ .call = Shim.call };
    }
};

/// Braille pixel drawing onto a canvas sized to the region.
pub const CanvasBody = struct {
    ctx: ?*anyopaque = null,
    call: ?*const fn (?*anyopaque, *BrailleCanvas) anyerror!void = null,

    pub fn with(
        ctx: anytype,
        comptime f: fn (@TypeOf(ctx), *BrailleCanvas) anyerror!void,
    ) CanvasBody {
        comptime std.debug.assert(@typeInfo(@TypeOf(ctx)) == .pointer);
        const Shim = struct {
            fn call(erased: ?*anyopaque, canvas: *BrailleCanvas) anyerror!void {
                try f(@ptrCast(@alignCast(erased)), canvas);
            }
        };
        return .{ .ctx = @constCast(@ptrCast(ctx)), .call = Shim.call };
    }

    pub fn plain(comptime f: fn (*BrailleCanvas) anyerror!void) CanvasBody {
        const Shim = struct {
            fn call(_: ?*anyopaque, canvas: *BrailleCanvas) anyerror!void {
                try f(canvas);
            }
        };
        return .{ .call = Shim.call };
    }
};

// -------------------------------------------------------------------- nodes

/// Everything a container can hold, resolved once the layout is solved.
///
/// The other ports box a closure per child. A tagged union costs no allocation
/// and no indirection, and the set of widgets is closed anyway — `draw` is the
/// escape hatch for anything outside it.
const Node = union(enum) {
    spacer,
    nested: struct { direction: Direction, layout: Layout, body: Body },
    panel: struct { options: PanelOptions, focused: bool, body: Body },
    grid: struct { options: GridOptions, body: GridBody },

    text: struct { content: []const u8, style: w.TextStyle },
    badge: w.BadgeOptions,
    divider: w.DividerOptions,
    key_values: w.KeyValueOptions,
    status_bar: w.StatusBarOptions,

    meter: w.MeterOptions,
    meters: w.MetersOptions,
    progress: w.ProgressOptions,
    graph: w.GraphOptions,
    sparkline: w.SparklineWidgetOptions,
    histogram: w.ColumnsOptions,
    gauge: w.GaugeOptions,
    donut: w.DonutOptions,
    heat_bar: w.HeatBarOptions,

    table: struct { options: w.TableOptions, id: []const u8 },
    list: struct { options: w.ListOptions, id: []const u8 },
    scrollbar: struct { options: w.ScrollbarOptions, id: []const u8 },
    tree: struct { options: w.TreeOptions, id: []const u8 },
    log: struct { options: w.LogOptions, id: []const u8 },

    button: struct { options: w.ButtonOptions, id: []const u8 },
    checkbox: struct { options: w.CheckboxOptions, id: []const u8 },
    select: struct { options: w.SelectOptions, id: []const u8 },
    text_input: struct { options: w.TextInputOptions, id: []const u8 },
    tabs: struct { options: w.TabsOptions, id: []const u8 },

    free: DrawBody,
    canvas: struct { color: ?Color, body: CanvasBody },
};

const Child = struct {
    constraint: Constraint,
    node: Node,
    /// True when this child draws a border of its own. Only bordered siblings
    /// collapse into each other: a table pressed against a panel edge should
    /// not grow junctions out of its rows.
    bordered: bool = false,
};

/// Draw one resolved child onto the surface the solver gave it.
fn drawNode(ctx: *Ctx, s: Surface, node: Node) anyerror!void {
    const allocator = ctx.allocator;
    switch (node) {
        .spacer => {},

        .nested => |n| {
            var container = Container.init(s, ctx, n.direction, n.layout);
            defer container.deinit();
            try n.body.run(&container);
            try container.flush();
        },

        .panel => |n| {
            const o = n.options;
            const border_color = o.border_color orelse
                (if (n.focused) s.theme.border_focused else s.theme.border);
            const interior = s.box(.{
                .title = o.title,
                .title_align = o.title_align,
                .title_color = o.title_color,
                .subtitle = o.subtitle,
                .subtitle_color = o.subtitle_color,
                .footer = o.footer,
                .border = o.border orelse .rounded,
                .border_color = border_color,
                .bg = o.layout.background,
                .collapse = ctx.collapse_borders,
            });
            const inner: Layout = .{
                .gap = o.layout.gap,
                .padding = o.inner_padding orelse Padding.axes(0, 1),
            };
            var container = Container.init(interior, ctx, .column, inner);
            defer container.deinit();
            try n.body.run(&container);
            try container.flush();
        },

        .grid => |n| {
            var grid = Grid.init(s, ctx, n.options);
            defer grid.deinit();
            try n.body.run(&grid);
            try grid.flush();
        },

        .text => |n| try w.drawText(allocator, s, n.content, n.style),
        .badge => |o| _ = w.drawBadge(s, o),
        .divider => |o| w.drawDivider(s, o),
        .key_values => |o| w.drawKeyValues(s, o),
        .status_bar => |o| w.drawStatusBar(s, o),

        .meter => |o| w.drawMeter(s, o),
        .meters => |o| w.drawMeters(s, o),
        .progress => |o| w.drawProgress(s, o),
        .graph => |o| try w.drawGraph(allocator, s, o),
        .sparkline => |o| w.drawSparkline(s, o),
        .histogram => |o| w.drawColumns(s, o),
        .gauge => |o| try w.drawGauge(allocator, s, o),
        .donut => |o| try w.drawDonut(allocator, s, o),
        .heat_bar => |o| w.drawHeatBar(s, o),

        .table => |n| {
            try w.drawTable(allocator, s, n.options);
            if (n.id.len > 0) {
                ctx.hit(n.id, s.hitRect(), if (n.options.header) 1 else 0);
            }
        },
        .list => |n| {
            w.drawList(s, n.options);
            if (n.id.len > 0) ctx.hit(n.id, s.hitRect(), 0);
        },
        .scrollbar => |n| {
            w.drawScrollbarWidget(s, n.options);
            if (n.id.len > 0) ctx.hit(n.id, s.hitRect(), 0);
        },
        .tree => |n| {
            try w.drawTree(allocator, s, n.options);
            if (n.id.len > 0) ctx.hit(n.id, s.hitRect(), 0);
        },
        .log => |n| {
            w.drawLog(s, n.options);
            if (n.id.len > 0) ctx.hit(n.id, s.hitRect(), 0);
        },

        .button => |n| {
            _ = w.drawButton(s, n.options);
            if (n.id.len > 0) ctx.hit(n.id, s.hitRect(), 0);
        },
        .checkbox => |n| {
            _ = w.drawCheckbox(s, n.options);
            if (n.id.len > 0) ctx.hit(n.id, s.hitRect(), 0);
        },
        .select => |n| {
            w.drawSelect(s, n.options);
            if (n.id.len > 0) ctx.hit(n.id, s.hitRect(), 0);
        },
        .text_input => |n| {
            w.drawTextInput(s, n.options);
            if (n.id.len > 0) ctx.hit(n.id, s.hitRect(), 0);
        },
        .tabs => |n| {
            w.drawTabs(s, n.options);
            if (n.id.len == 0) return;
            // Each tab registers its own region as `<id>:<index>`, so a click
            // reports which tab was hit without the caller doing coordinate
            // arithmetic.
            const r = s.hitRect();
            var x: isize = 0;
            for (n.options.tabs, 0..) |tab, i| {
                const width = unicode.stringWidth(tab) + 4;
                const tab_id = try std.fmt.allocPrint(allocator, "{s}:{d}", .{ n.id, i });
                ctx.hit(tab_id, .{ .x = r.x + x, .y = r.y, .width = width, .height = 1 }, 0);
                x += @intCast(width);
            }
        },

        .free => |body| {
            if (body.call) |f| try f(body.ctx, s);
        },
        .canvas => |n| {
            var canvas = try BrailleCanvas.init(allocator, s.width(), s.height());
            defer canvas.deinit();
            if (n.body.call) |f| try f(n.body.ctx, &canvas);
            const tint = n.color orelse s.theme.accent;
            const style: Style = .{ .fg = tint };
            for (0..canvas.rows) |row| {
                for (0..canvas.cols) |col| {
                    const value = canvas.cell(col, row);
                    if (value != 0) {
                        s.char(@intCast(col), @intCast(row), value, style);
                    }
                }
            }
        },
    }
}

// ----------------------------------------------------------------- container

pub const Container = struct {
    surface: Surface,
    ctx: *Ctx,
    direction: Direction,
    gap: usize,
    inner: Surface,
    children: std.ArrayList(Child) = .empty,

    pub fn init(s: Surface, ctx: *Ctx, direction: Direction, l: Layout) Container {
        if (l.background) |bg| s.fill(.{ .bg = bg });
        return .{
            .surface = s,
            .ctx = ctx,
            .direction = direction,
            .gap = l.gap,
            .inner = s.inset(l.padding),
        };
    }

    pub fn deinit(self: *Container) void {
        self.children.deinit(self.ctx.allocator);
        self.* = undefined;
    }

    pub fn theme(self: Container) *const Theme {
        return self.surface.theme;
    }

    pub fn capabilities(self: Container) *const Capabilities {
        return self.ctx.capabilities;
    }

    pub fn width(self: Container) usize {
        return self.inner.width();
    }

    pub fn height(self: Container) usize {
        return self.inner.height();
    }

    /// Copy a string into the frame arena, so a child may safely point at it.
    pub fn dupe(self: *Container, text_: []const u8) ![]const u8 {
        return self.ctx.allocator.dupe(u8, text_);
    }

    /// Format into the frame arena. The usual way to put a number on screen.
    pub fn fmt(self: *Container, comptime pattern: []const u8, args: anytype) ![]const u8 {
        return std.fmt.allocPrint(self.ctx.allocator, pattern, args);
    }

    /// Width available to a child laid out across the main axis.
    fn crossWidth(self: Container) usize {
        return switch (self.direction) {
            .column => self.inner.width(),
            .row => self.inner.height(),
        };
    }

    /// The gap at each seam. Ordinarily one number repeated, but where
    /// collapsing is on and two bordered siblings meet with no gap between
    /// them, the seam is minus one so their borders land in the same column
    /// and merge. The caller owns the slice.
    fn seams(self: *Container, allocator: std.mem.Allocator) ![]isize {
        const out = try allocator.alloc(isize, self.children.items.len -| 1);
        @memset(out, @intCast(self.gap));
        if (!self.ctx.collapse_borders or self.gap != 0) return out;
        for (out, 0..) |*seam, i| {
            if (self.children.items[i].bordered and self.children.items[i + 1].bordered) {
                seam.* = -1;
            }
        }
        return out;
    }

    fn addBordered(self: *Container, constraint: Constraint, node: Node, bordered: bool) !void {
        try self.children.append(self.ctx.allocator, .{ .constraint = constraint, .node = node, .bordered = bordered });
    }

    fn add(self: *Container, constraint: Constraint, node: Node) !void {
        try self.children.append(self.ctx.allocator, .{ .constraint = constraint, .node = node });
    }

    /// The constraint for a child that declared a `Layout`.
    fn constraintOf(self: Container, l: Layout, fallback: Size, intrinsic: ?usize) Constraint {
        const size: Size = l.size orelse switch (self.direction) {
            // Intrinsic sizes describe height. Along a row, a widget takes the
            // space it is given.
            .row => .fill,
            .column => fallback,
        };
        return .{ .size = size, .min = l.min, .max = l.max, .intrinsic = intrinsic };
    }

    /// A leaf widget's constraint: its natural height down a column, the whole
    /// track across a row.
    fn leaf(self: Container, intrinsic: usize) Constraint {
        return switch (self.direction) {
            .row => .{ .size = .fill },
            .column => .{ .size = .auto, .intrinsic = intrinsic },
        };
    }

    fn filling(self: Container) Constraint {
        _ = self;
        return .{ .size = .fill };
    }

    /// Solve and draw. The app calls this for you; parents call it for children.
    pub fn flush(self: *Container) !void {
        if (self.children.items.len == 0 or self.inner.rect.isEmpty()) return;

        const allocator = self.ctx.allocator;
        const constraints = try allocator.alloc(Constraint, self.children.items.len);
        defer allocator.free(constraints);
        for (self.children.items, 0..) |c, i| constraints[i] = c.constraint;

        const seam_gaps = try self.seams(allocator);
        defer allocator.free(seam_gaps);
        const rects = try layout_mod.stackWithGaps(
            allocator,
            self.inner.rect,
            constraints,
            self.direction,
            seam_gaps,
        );
        defer allocator.free(rects);

        // Taken before drawing: a child that builds more children must not
        // append into the list being iterated.
        const children = try self.children.toOwnedSlice(allocator);
        defer allocator.free(children);

        for (children, rects) |child, rect| {
            if (rect.isEmpty()) continue;
            try drawNode(self.ctx, self.inner.region(rect), child.node);
        }
    }

    // ------------------------------------------------------------ layout

    /// A horizontal container. Children default to equal shares.
    pub fn row(self: *Container, options: RowOptions, body: Body) !void {
        try self.add(
            self.constraintOf(options.layout, .fill, null),
            .{ .nested = .{ .direction = .row, .layout = options.layout, .body = body } },
        );
    }

    /// A vertical container.
    pub fn column(self: *Container, options: ColumnOptions, body: Body) !void {
        try self.add(
            self.constraintOf(options.layout, .fill, null),
            .{ .nested = .{ .direction = .column, .layout = options.layout, .body = body } },
        );
    }

    /// A bordered panel. The body receives its interior as a column.
    pub fn panel(self: *Container, options: PanelOptions, body: Body) !void {
        // Focus is claimed while building, not while drawing, so the Tab order
        // follows declaration order rather than the solver's.
        const focused = if (options.focused) |f|
            f
        else if (options.focus_id) |id|
            self.ctx.registerFocus(id)
        else
            false;
        try self.addBordered(
            self.constraintOf(options.layout, .fill, null),
            .{ .panel = .{ .options = options, .focused = focused, .body = body } },
            (options.border orelse .rounded) != .none,
        );
    }

    /// A panel without a border — a grouping box that costs no rows.
    pub fn boxed(self: *Container, options: PanelOptions, body: Body) !void {
        var o = options;
        if (o.border == null) o.border = .none;
        try self.panel(o, body);
    }

    /// A CSS-ish grid, filled row-major with optional spans.
    pub fn grid(self: *Container, options: GridOptions, body: GridBody) !void {
        try self.add(
            self.constraintOf(options.layout, .fill, null),
            .{ .grid = .{ .options = options, .body = body } },
        );
    }

    /// A child of an explicit size, for the cases the defaults do not cover.
    pub fn sized(self: *Container, size: Size, body: Body) !void {
        try self.add(
            .{ .size = size },
            .{ .nested = .{ .direction = self.direction, .layout = .{}, .body = body } },
        );
    }

    /// Blank space.
    pub fn spacer(self: *Container, size: Size) !void {
        try self.add(.{ .size = size }, .spacer);
    }

    /// A horizontal rule, optionally labelled.
    pub fn divider(self: *Container, options: w.DividerOptions) !void {
        try self.add(self.leaf(1), .{ .divider = options });
    }

    // -------------------------------------------------------------- text

    pub fn text(self: *Container, content: []const u8, style: w.TextStyle) !void {
        const lines = if (style.wrap) blk: {
            const wrapped = try unicode.wrap(self.ctx.allocator, content, self.crossWidth());
            defer unicode.freeWrapped(self.ctx.allocator, wrapped);
            break :blk wrapped.len;
        } else std.mem.count(u8, content, "\n") + 1;
        try self.add(self.leaf(lines), .{ .text = .{ .content = content, .style = style } });
    }

    /// Muted secondary text.
    pub fn label(self: *Container, content: []const u8) !void {
        try self.text(content, .{ .fg = self.theme().muted });
    }

    /// Bold heading in the theme's title color.
    pub fn heading(self: *Container, content: []const u8) !void {
        try self.text(content, .{ .fg = self.theme().title, .bold = true });
    }

    pub fn badge(self: *Container, options: w.BadgeOptions) !void {
        try self.add(self.leaf(1), .{ .badge = options });
    }

    /// Aligned label/value pairs.
    pub fn keyValues(self: *Container, options: w.KeyValueOptions) !void {
        try self.add(self.leaf(options.rows.len), .{ .key_values = options });
    }

    pub fn statusBar(self: *Container, options: w.StatusBarOptions) !void {
        try self.add(self.leaf(1), .{ .status_bar = options });
    }

    // -------------------------------------------------------------- data

    /// `id` registers the widget's rect so the wheel and clicks reach it; pass
    /// `""` for a table nothing interacts with.
    pub fn table(self: *Container, options: w.TableOptions, id: []const u8) !void {
        const intrinsic = options.rows.len + @as(usize, if (options.header) 1 else 0);
        try self.add(
            self.constraintOf(.{}, .fill, intrinsic),
            .{ .table = .{ .options = options, .id = id } },
        );
    }

    pub fn list(self: *Container, options: w.ListOptions, id: []const u8) !void {
        try self.add(self.filling(), .{ .list = .{ .options = options, .id = id } });
    }

    /// A scrollbar over state you own, for anything that scrolls and is not a
    /// table: wrapped prose, a canvas, a `draw` of your own. A vertical bar
    /// fills the space it is given; a horizontal one is a single row.
    pub fn scrollbar(self: *Container, options: w.ScrollbarOptions, id: []const u8) !void {
        const size = if (options.orientation.isVertical()) self.filling() else self.leaf(1);
        try self.add(size, .{ .scrollbar = .{ .options = options, .id = id } });
    }

    pub fn tree(self: *Container, options: w.TreeOptions, id: []const u8) !void {
        try self.add(self.filling(), .{ .tree = .{ .options = options, .id = id } });
    }

    pub fn log(self: *Container, options: w.LogOptions, id: []const u8) !void {
        try self.add(self.filling(), .{ .log = .{ .options = options, .id = id } });
    }

    // ----------------------------------------------------------- metrics

    /// `label ████████░░░ 42%`
    pub fn meter(self: *Container, options: w.MeterOptions) !void {
        try self.add(self.leaf(1), .{ .meter = options });
    }

    /// A stack or grid of meters.
    pub fn meters(self: *Container, options: w.MetersOptions) !void {
        const columns = @max(1, options.columns);
        const rows = (options.items.len + columns - 1) / columns;
        try self.add(self.leaf(rows), .{ .meters = options });
    }

    pub fn progress(self: *Container, options: w.ProgressOptions) !void {
        try self.add(self.leaf(1), .{ .progress = options });
    }

    /// Braille line/area graph. Fills the space it is given.
    pub fn graph(self: *Container, options: w.GraphOptions) !void {
        try self.add(self.filling(), .{ .graph = options });
    }

    pub fn sparkline(self: *Container, options: w.SparklineWidgetOptions) !void {
        try self.add(self.leaf(1), .{ .sparkline = options });
    }

    pub fn histogram(self: *Container, options: w.ColumnsOptions) !void {
        try self.add(self.filling(), .{ .histogram = options });
    }

    /// A semicircular dial. Wants at least 9x5.
    pub fn gauge(self: *Container, options: w.GaugeOptions) !void {
        try self.add(self.filling(), .{ .gauge = options });
    }

    pub fn donut(self: *Container, options: w.DonutOptions) !void {
        try self.add(self.filling(), .{ .donut = options });
    }

    /// Segmented temperature-style bar.
    pub fn heatBar(self: *Container, options: w.HeatBarOptions) !void {
        try self.add(self.leaf(1), .{ .heat_bar = options });
    }

    // ------------------------------------------------------------ inputs

    /// A button. It joins the Tab order and reports under `id`.
    pub fn button(self: *Container, options: w.ButtonOptions, id: []const u8) !void {
        var o = options;
        if (!o.focused) o.focused = self.ctx.registerFocus(id);
        try self.add(self.leaf(1), .{ .button = .{ .options = o, .id = id } });
    }

    pub fn checkbox(self: *Container, options: w.CheckboxOptions, id: []const u8) !void {
        var o = options;
        if (!o.focused) o.focused = self.ctx.registerFocus(id);
        try self.add(self.leaf(1), .{ .checkbox = .{ .options = o, .id = id } });
    }

    pub fn select(self: *Container, options: w.SelectOptions, id: []const u8) !void {
        var o = options;
        if (!o.focused) o.focused = self.ctx.registerFocus(id);
        const intrinsic: usize = if (o.open) o.options.len + 1 else 1;
        try self.add(self.leaf(intrinsic), .{ .select = .{ .options = o, .id = id } });
    }

    pub fn textInput(self: *Container, options: w.TextInputOptions, id: []const u8) !void {
        var o = options;
        if (!o.focused) o.focused = self.ctx.registerFocus(id);
        try self.add(self.leaf(1), .{ .text_input = .{ .options = o, .id = id } });
    }

    pub fn tabs(self: *Container, options: w.TabsOptions, id: []const u8) !void {
        try self.add(self.leaf(1), .{ .tabs = .{ .options = options, .id = id } });
    }

    // ---------------------------------------------------------- overlays

    /// A centred dialog drawn above everything else this frame.
    pub fn modal(self: *Container, options: w.ModalOptions) void {
        self.ctx.overlay(.{ .modal = options });
    }

    pub fn commandPalette(self: *Container, options: w.CommandPaletteOptions) void {
        self.ctx.overlay(.{ .command_palette = options });
    }

    pub fn tooltip(self: *Container, options: w.TooltipOptions) void {
        self.ctx.overlay(.{ .tooltip = options });
    }

    // -------------------------------------------------- escape hatches

    /// Draw straight onto the framebuffer region. Nothing is off limits.
    pub fn draw(self: *Container, body: DrawBody) !void {
        try self.add(self.filling(), .{ .free = body });
    }

    /// A Braille pixel canvas sized to the region, blitted when you are done.
    pub fn canvas(self: *Container, tint: ?Color, body: CanvasBody) !void {
        try self.add(self.filling(), .{ .canvas = .{ .color = tint, .body = body } });
    }
};

// ---------------------------------------------------------------------- grid

const Cell = struct {
    span: Span,
    node: Node,
};

/// Grid placement with spans. Cells are filled row-major.
pub const Grid = struct {
    surface: Surface,
    ctx: *Ctx,
    spec: GridOptions,
    cells: std.ArrayList(Cell) = .empty,

    pub fn init(s: Surface, ctx: *Ctx, spec: GridOptions) Grid {
        return .{ .surface = s.inset(spec.layout.padding), .ctx = ctx, .spec = spec };
    }

    pub fn deinit(self: *Grid) void {
        self.cells.deinit(self.ctx.allocator);
        self.* = undefined;
    }

    pub fn width(self: Grid) usize {
        return self.surface.width();
    }

    pub fn height(self: Grid) usize {
        return self.surface.height();
    }

    fn push(self: *Grid, span: Span, node: Node) !void {
        try self.cells.append(self.ctx.allocator, .{ .span = span, .node = node });
    }

    /// A panel occupying the next free cell, or several with a span.
    pub fn panel(self: *Grid, options: PanelOptions, span: Span, body: Body) !void {
        const focused = if (options.focused) |f|
            f
        else if (options.focus_id) |id|
            self.ctx.registerFocus(id)
        else
            false;
        try self.push(span, .{ .panel = .{
            .options = options,
            .focused = focused,
            .body = body,
        } });
    }

    /// A bare cell: a column the body fills however it likes.
    pub fn cell(self: *Grid, span: Span, body: Body) !void {
        try self.push(span, .{ .nested = .{
            .direction = .column,
            .layout = .{},
            .body = body,
        } });
    }

    fn track(allocator: std.mem.Allocator, spec: []const Size, fallback: usize) ![]Size {
        if (spec.len > 0) return allocator.dupe(Size, spec);
        const n = @max(1, fallback);
        const out = try allocator.alloc(Size, n);
        for (out) |*s| s.* = .{ .fr = 1 };
        return out;
    }

    pub fn flush(self: *Grid) !void {
        if (self.cells.items.len == 0 or self.surface.rect.isEmpty()) return;

        const allocator = self.ctx.allocator;
        const gap = self.spec.layout.gap;

        const column_spec = try track(
            allocator,
            self.spec.columns,
            if (self.spec.column_count > 0)
                self.spec.column_count
            else
                @min(self.cells.items.len, 3),
        );
        defer allocator.free(column_spec);

        const row_fallback = if (self.spec.row_count > 0)
            self.spec.row_count
        else
            (self.cells.items.len + column_spec.len - 1) / column_spec.len;
        const row_spec = try track(allocator, self.spec.rows, row_fallback);
        defer allocator.free(row_spec);

        const col_constraints = try allocator.alloc(Constraint, column_spec.len);
        defer allocator.free(col_constraints);
        for (column_spec, 0..) |s, i| col_constraints[i] = .{ .size = s };

        const row_constraints = try allocator.alloc(Constraint, row_spec.len);
        defer allocator.free(row_constraints);
        for (row_spec, 0..) |s, i| row_constraints[i] = .{ .size = s };

        const col_widths = try layout_mod.solve(
            allocator,
            self.surface.width(),
            col_constraints,
            gap,
        );
        defer allocator.free(col_widths);
        const row_heights = try layout_mod.solve(
            allocator,
            self.surface.height(),
            row_constraints,
            gap,
        );
        defer allocator.free(row_heights);

        const slots = col_widths.len * row_heights.len;
        const occupied = try allocator.alloc(bool, slots);
        defer allocator.free(occupied);
        @memset(occupied, false);

        const cells = try self.cells.toOwnedSlice(allocator);
        defer allocator.free(cells);

        var cursor: usize = 0;
        for (cells) |item| {
            // Clamp to the grid. A span wider than the track count can never
            // satisfy `col + col_span <= col_widths.len`, so the placement loop
            // below used to burn the shared cursor to exhaustion — dropping
            // this cell and every one after it. A responsive layout collapsing
            // to one column made a full-width span blank the grid.
            const col_span = @min(@max(1, item.span.cols), col_widths.len);
            const row_span = @min(@max(1, item.span.rows), row_heights.len);

            // The cursor is shared across cells, so a cell that cannot be
            // placed must hand it back. Placement is resolved before drawing so
            // the search can loop while the draw happens exactly once.
            const search_from = cursor;
            var placement: ?Rect = null;

            while (cursor < slots + col_widths.len) {
                const col = cursor % col_widths.len;
                const row = cursor / col_widths.len;
                if (row >= row_heights.len) break;

                var free = col + col_span <= col_widths.len and
                    row + row_span <= row_heights.len;
                if (free) {
                    outer: for (row..row + row_span) |r| {
                        for (col..col + col_span) |c| {
                            if (occupied[r * col_widths.len + c]) {
                                free = false;
                                break :outer;
                            }
                        }
                    }
                }
                if (!free) {
                    cursor += 1;
                    continue;
                }
                for (row..row + row_span) |r| {
                    for (col..col + col_span) |c| {
                        occupied[r * col_widths.len + c] = true;
                    }
                }

                var x = self.surface.rect.x;
                for (col_widths[0..col]) |cw| x += @intCast(cw + gap);
                var y = self.surface.rect.y;
                for (row_heights[0..row]) |rh| y += @intCast(rh + gap);

                var cell_width: usize = 0;
                for (col_widths[col..@min(col + col_span, col_widths.len)]) |cw| {
                    cell_width += cw + gap;
                }
                var cell_height: usize = 0;
                for (row_heights[row..@min(row + row_span, row_heights.len)]) |rh| {
                    cell_height += rh + gap;
                }

                placement = .{
                    .x = x,
                    .y = y,
                    .width = cell_width -| gap,
                    .height = cell_height -| gap,
                };
                cursor += 1;
                break;
            }

            if (placement) |rect| {
                if (!rect.isEmpty()) {
                    try drawNode(self.ctx, self.surface.region(rect), item.node);
                }
            } else {
                cursor = search_from;
            }
        }
    }
};
