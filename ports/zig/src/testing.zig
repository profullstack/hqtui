//! Render a view to an in-memory screen. No TTY, no escape codes, no timers —
//! which is what makes TUI code written with this library actually testable.
//!
//! ```zig
//! var screen = try testing.renderToScreen(allocator, 80, 24, "dark", ui.Body.plain(view));
//! defer screen.deinit();
//! try std.testing.expect(screen.contains("72%"));
//! ```
//!
//! A `RenderedScreen` owns an arena holding the framebuffer and everything the
//! frame allocated, so a test frees one thing rather than tracking a tree.

const std = @import("std");

const buffer_mod = @import("buffer.zig");
const capabilities_mod = @import("capabilities.zig");
const color_mod = @import("color.zig");
const diff = @import("diff.zig");
const surface_mod = @import("surface.zig");
const theme_mod = @import("theme.zig");
const ui = @import("ui.zig");
const unicode = @import("unicode.zig");

const Attrs = buffer_mod.Attrs;
const Capabilities = capabilities_mod.Capabilities;
const Color = color_mod.Color;
const FrameBuffer = buffer_mod.FrameBuffer;
const Surface = surface_mod.Surface;
const Theme = theme_mod.Theme;

pub const CellSnapshot = struct {
    /// The cell's text. Empty for the right half of a wide glyph.
    text: []const u8,
    fg: Color,
    bg: Color,
    attrs: Attrs,
};

pub const RenderedScreen = struct {
    width: usize,
    height: usize,
    buffer: FrameBuffer,
    theme: Theme,
    capabilities: Capabilities,
    /// Mouse regions the view registered, in draw order. Lets a test assert
    /// that a widget is actually reachable by the wheel or a click, which is
    /// otherwise only observable by running a real terminal.
    regions: []const ui.HitRegion,
    /// Focusable control ids, in registration order.
    focus_ids: []const []const u8,

    arena: *std.heap.ArenaAllocator,

    pub fn deinit(self: *RenderedScreen) void {
        const parent = self.arena.child_allocator;
        self.arena.deinit();
        parent.destroy(self.arena);
        self.* = undefined;
    }

    /// The arena the frame was rendered in. Anything it returns lives until
    /// `deinit`, so a test never has to free a row of text.
    pub fn allocator(self: RenderedScreen) std.mem.Allocator {
        return self.arena.allocator();
    }

    /// Plain text, one line per row, trailing spaces trimmed.
    pub fn text(self: RenderedScreen) ![]const u8 {
        return self.buffer.toText(self.allocator());
    }

    /// One row of plain text, trailing spaces trimmed.
    pub fn line(self: RenderedScreen, y: usize) ![]const u8 {
        const row = try self.buffer.rowTextAlloc(self.allocator(), y);
        return std.mem.trimEnd(u8, row, " ");
    }

    /// Everything, with ANSI colors — paste into a terminal to see it.
    pub fn ansi(self: RenderedScreen) ![]const u8 {
        const alloc = self.allocator();
        var empty = try FrameBuffer.init(alloc, self.width, self.height);
        defer empty.deinit();
        var encoder = diff.Encoder.init(alloc, .{ .colors = .truecolor });
        defer encoder.deinit();
        const result = try encoder.encode(&empty, &self.buffer, true);
        return alloc.dupe(u8, result.output);
    }

    pub fn cell(self: RenderedScreen, x: usize, y: usize) CellSnapshot {
        const i = self.buffer.index(x, y);
        const value = self.buffer.chars[i];
        // `cellText` borrows from the cluster table for a cluster and writes
        // into `buf` for a bare codepoint, so the scratch buffer has to outlive
        // the call — it is copied into the arena rather than returned by
        // pointer into a dead stack frame.
        var scratch: [4]u8 = undefined;
        const shown: []const u8 = if (value == unicode.continuation)
            ""
        else if (value == 0)
            " "
        else
            self.allocator().dupe(u8, unicode.cellText(value, &scratch)) catch " ";
        return .{
            .text = shown,
            .fg = self.buffer.fg[i],
            .bg = self.buffer.bg[i],
            .attrs = self.buffer.attrs[i],
        };
    }

    /// Column and row of the first occurrence, or null.
    pub fn find(self: RenderedScreen, needle: []const u8) ?struct { x: usize, y: usize } {
        const alloc = self.allocator();
        for (0..self.height) |y| {
            const row = self.buffer.rowTextAlloc(alloc, y) catch return null;
            const byte = std.mem.indexOf(u8, row, needle) orelse continue;
            // Report the column, not the byte offset: a row with a wide glyph
            // in it has more bytes than cells.
            const x = std.unicode.utf8CountCodepoints(row[0..byte]) catch byte;
            return .{ .x = x, .y = y };
        }
        return null;
    }

    pub fn contains(self: RenderedScreen, needle: []const u8) bool {
        return self.find(needle) != null;
    }
};

/// Force a capability rather than detecting it, exactly as `capabilities` does.
pub const Overrides = capabilities_mod.Overrides;

/// Render a view to an in-memory screen.
pub fn renderToScreen(
    parent: std.mem.Allocator,
    width: usize,
    height: usize,
    theme_name: []const u8,
    view: ui.Body,
) !RenderedScreen {
    return renderWith(parent, width, height, theme_name, 0, .{}, view);
}

/// The full form: pick the frame number and override capabilities.
pub fn renderWith(
    parent: std.mem.Allocator,
    width: usize,
    height: usize,
    theme_name: []const u8,
    frame: u64,
    overrides: Overrides,
    view: ui.Body,
) !RenderedScreen {
    return renderWithCollapse(parent, width, height, theme_name, frame, overrides, false, view);
}

/// Render with adjacent panel borders merged, as `App.Options.collapse_borders`
/// does for a running app. The caller owns the result.
pub fn renderCollapsedToText(
    parent: std.mem.Allocator,
    width: usize,
    height: usize,
    theme_name: []const u8,
    view: ui.Body,
) ![]u8 {
    var screen = try renderWithCollapse(parent, width, height, theme_name, 0, .{}, true, view);
    defer screen.deinit();
    return parent.dupe(u8, try screen.text());
}

/// As `renderToScreen`, with adjacent panel borders merged. The parity
/// fixtures cover both modes because collapsing changes the layout, not only
/// the glyphs.
pub fn renderCollapsedToScreen(
    parent: std.mem.Allocator,
    width: usize,
    height: usize,
    theme_name: []const u8,
    view: ui.Body,
) !RenderedScreen {
    return renderWithCollapse(parent, width, height, theme_name, 0, .{}, true, view);
}

fn renderWithCollapse(
    parent: std.mem.Allocator,
    width: usize,
    height: usize,
    theme_name: []const u8,
    frame: u64,
    overrides: Overrides,
    collapse_borders: bool,
    view: ui.Body,
) !RenderedScreen {
    const arena = try parent.create(std.heap.ArenaAllocator);
    errdefer parent.destroy(arena);
    arena.* = .init(parent);
    errdefer arena.deinit();
    const alloc = arena.allocator();

    const resolved = try alloc.create(Theme);
    resolved.* = theme_mod.resolve(theme_name);
    const caps = try alloc.create(Capabilities);
    caps.* = headlessCapabilities(overrides);

    var buffer = try FrameBuffer.init(alloc, width, height);
    buffer.clear(resolved.background, resolved.foreground);

    var ctx = ui.Ctx.init(alloc, resolved, caps, width, height);
    ctx.collapse_borders = collapse_borders;
    ctx.frame = frame;

    const root = Surface.root(&buffer, resolved);
    var container = ui.Container.init(root, &ctx, .column, .{});
    if (view.call) |f| try f(view.ctx, &container);
    try container.flush();
    for (ctx.overlays.items) |overlay| try overlay.draw(alloc, root);

    return .{
        .width = width,
        .height = height,
        .buffer = buffer,
        .theme = resolved.*,
        .capabilities = caps.*,
        .regions = ctx.hits.items,
        .focus_ids = ctx.focus_ids.items,
        .arena = arena,
    };
}

/// A headless render should look like a capable terminal, not like whatever is
/// running the test suite — otherwise a plot silently degrades to ASCII in CI.
fn headlessCapabilities(overrides: Overrides) Capabilities {
    const merged: Overrides = .{
        .tty = overrides.tty orelse true,
        .colors = overrides.colors orelse .truecolor,
        .unicode = overrides.unicode orelse true,
        .braille = overrides.braille orelse true,
        .mouse = overrides.mouse,
        .synchronized_output = overrides.synchronized_output,
    };
    return capabilities_mod.detect(merged, capabilities_mod.Env.empty, true);
}

/// Shorthand: render and return plain text. Ideal for snapshot tests. The
/// caller owns the result.
pub fn renderToText(
    parent: std.mem.Allocator,
    width: usize,
    height: usize,
    theme_name: []const u8,
    view: ui.Body,
) ![]u8 {
    var screen = try renderToScreen(parent, width, height, theme_name, view);
    defer screen.deinit();
    return parent.dupe(u8, try screen.text());
}

/// Render with ANSI colors, e.g. to write a demo screenshot to a file. The
/// caller owns the result.
pub fn renderToAnsi(
    parent: std.mem.Allocator,
    width: usize,
    height: usize,
    theme_name: []const u8,
    view: ui.Body,
) ![]u8 {
    var screen = try renderToScreen(parent, width, height, theme_name, view);
    defer screen.deinit();
    return parent.dupe(u8, try screen.ansi());
}

// --------------------------------------------------------------------- html

pub const HtmlOptions = struct {
    font_size: f64 = 14,
    padding: f64 = 16,
    class_name: []const u8 = "hqtui-screen",
    /// The default stack is ordered by box-drawing and Braille coverage.
    font_family: []const u8 = "ui-monospace,SFMono-Regular,Menlo,DejaVu Sans Mono," ++
        "Liberation Mono,Consolas,Segoe UI Symbol,monospace",
};

fn escapeHtml(out: *std.ArrayList(u8), alloc: std.mem.Allocator, text: []const u8) !void {
    for (text) |c| switch (c) {
        '&' => try out.appendSlice(alloc, "&amp;"),
        '<' => try out.appendSlice(alloc, "&lt;"),
        '>' => try out.appendSlice(alloc, "&gt;"),
        else => try out.append(alloc, c),
    };
}

fn escapeAttr(out: *std.ArrayList(u8), alloc: std.mem.Allocator, text: []const u8) !void {
    for (text) |c| switch (c) {
        '&' => try out.appendSlice(alloc, "&amp;"),
        '<' => try out.appendSlice(alloc, "&lt;"),
        '>' => try out.appendSlice(alloc, "&gt;"),
        '"' => try out.appendSlice(alloc, "&quot;"),
        '\'' => try out.appendSlice(alloc, "&#39;"),
        else => try out.append(alloc, c),
    };
}

fn writeCssColor(
    out: *std.ArrayList(u8),
    alloc: std.mem.Allocator,
    value: Color,
    fallback: []const u8,
) !void {
    if (value.isDefault()) {
        try out.appendSlice(alloc, fallback);
        return;
    }
    try out.print(alloc, "#{x:0>6}", .{value.raw() & 0xff_ffff});
}

/// Render to standalone HTML — a real screenshot of the UI, no terminal needed.
/// The caller owns the result.
pub fn renderToHtml(
    alloc: std.mem.Allocator,
    screen: RenderedScreen,
    options: HtmlOptions,
) ![]u8 {
    var bg_fallback: std.ArrayList(u8) = .empty;
    defer bg_fallback.deinit(alloc);
    try writeCssColor(&bg_fallback, alloc, screen.theme.background, "#000");

    var fg_fallback: std.ArrayList(u8) = .empty;
    defer fg_fallback.deinit(alloc);
    try writeCssColor(&fg_fallback, alloc, screen.theme.foreground, "#fff");

    var body: std.ArrayList(u8) = .empty;
    defer body.deinit(alloc);

    var run: std.ArrayList(u8) = .empty;
    defer run.deinit(alloc);

    var open = false;
    var run_fg: Color = .default;
    var run_bg: Color = .default;
    var run_attrs: Attrs = Attrs.none;

    for (0..screen.height) |y| {
        if (y > 0) try body.append(alloc, '\n');
        for (0..screen.width) |x| {
            const i = screen.buffer.index(x, y);
            const value = screen.buffer.chars[i];
            if (value == unicode.continuation) continue;

            const fg = screen.buffer.fg[i];
            const bg = screen.buffer.bg[i];
            const attrs = screen.buffer.attrs[i];
            const same = open and fg.raw() == run_fg.raw() and
                bg.raw() == run_bg.raw() and attrs.eql(run_attrs);
            if (!same) {
                if (open) try flushRun(
                    &body,
                    &run,
                    alloc,
                    run_fg,
                    run_bg,
                    run_attrs,
                    fg_fallback.items,
                    bg_fallback.items,
                );
                run_fg = fg;
                run_bg = bg;
                run_attrs = attrs;
                open = true;
            }
            var scratch: [4]u8 = undefined;
            const shown = if (value == 0) " " else unicode.cellText(value, &scratch);
            try run.appendSlice(alloc, shown);
        }
        if (open) {
            try flushRun(
                &body,
                &run,
                alloc,
                run_fg,
                run_bg,
                run_attrs,
                fg_fallback.items,
                bg_fallback.items,
            );
            open = false;
        }
    }

    // Every one of these is spliced into an attribute, so none may be trusted.
    // Numbers are bounded, and a font stack is reduced to the characters a font
    // stack can legitimately contain — escaping alone still lets `;` open a new
    // CSS property.
    const font_size = boundedNumber(options.font_size, 14);
    const padding = boundedNumber(options.padding, 16);

    var font: std.ArrayList(u8) = .empty;
    defer font.deinit(alloc);
    for (options.font_family) |c| {
        const keep = std.ascii.isAlphanumeric(c) or
            std.mem.indexOfScalar(u8, " ,._'-", c) != null;
        if (keep) try font.append(alloc, c);
    }

    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(alloc);

    // One <pre> with newline-separated rows: wrapping each row in its own
    // element gives the browser licence to lay out lines independently, which
    // pulls box-drawing rules apart. A single text flow tiles the grid exactly.
    // line-height must be tight for the same reason.
    try out.appendSlice(alloc, "<pre class=\"");
    try escapeAttr(&out, alloc, options.class_name);
    try out.appendSlice(alloc, "\" style=\"background:");
    try out.appendSlice(alloc, bg_fallback.items);
    try out.appendSlice(alloc, ";color:");
    try out.appendSlice(alloc, fg_fallback.items);
    try out.print(alloc, ";padding:{d}px;font-size:{d}px;line-height:{d:.2}px;font-family:", .{
        padding,
        font_size,
        font_size * 1.18,
    });
    try escapeAttr(&out, alloc, font.items);
    try out.appendSlice(
        alloc,
        ";margin:0;overflow-x:auto;border-radius:8px;white-space:pre;" ++
            "font-variant-ligatures:none;-webkit-font-smoothing:antialiased\">",
    );
    try out.appendSlice(alloc, body.items);
    try out.appendSlice(alloc, "</pre>");
    return out.toOwnedSlice(alloc);
}

fn boundedNumber(value: f64, fallback: f64) f64 {
    if (std.math.isFinite(value) and value > 0 and value <= 1000) return value;
    return fallback;
}

fn flushRun(
    body: *std.ArrayList(u8),
    run: *std.ArrayList(u8),
    alloc: std.mem.Allocator,
    fg: Color,
    bg: Color,
    attrs: Attrs,
    fg_fallback: []const u8,
    bg_fallback: []const u8,
) !void {
    if (run.items.len == 0) return;
    try body.appendSlice(alloc, "<span style=\"color:");
    try writeCssColor(body, alloc, fg, fg_fallback);
    try body.appendSlice(alloc, ";background:");
    try writeCssColor(body, alloc, bg, bg_fallback);
    if (attrs.bold) try body.appendSlice(alloc, ";font-weight:700");
    if (attrs.dim) try body.appendSlice(alloc, ";opacity:.65");
    if (attrs.italic) try body.appendSlice(alloc, ";font-style:italic");
    if (attrs.underline) try body.appendSlice(alloc, ";text-decoration:underline");
    try body.appendSlice(alloc, "\">");
    try escapeHtml(body, alloc, run.items);
    try body.appendSlice(alloc, "</span>");
    run.clearRetainingCapacity();
}
