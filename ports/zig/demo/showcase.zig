//! Native translations of the reference's five widget/rendering showcases.
const r = @import("reference.zig");
const h = r.h;
const m = r.m;
const std = r.std;
const C = r.C;
const P = r.P;
pub fn render(s: *m.State, p: *P) !void {
    const c = try r.root(s, p);
    switch (s.screen) {
        5 => try components(c, p),
        6 => try graphics(c, p),
        7 => try themes(c, p),
        8 => try input(c, p),
        9 => try stress(c, p),
        else => {},
    }
}
fn wave(p: *P, phase: f64, freq: f64) ![]f64 {
    const values = try p.ctx.allocator.alloc(f64, 240);
    for (values, 0..) |*v, i| v.* = @sin(@as(f64, @floatFromInt(i)) / freq + phase) * 50 + 50;
    return values;
}
fn graphics(c: *C, p: *P) !void {
    try c.row(p, .{ .fr = 1 }, 1, graphicsColumns);
}
fn graphicsColumns(c: *C, p: *P) !void {
    try c.col(p, .fill, c.panelGap(), graphicsLeft);
    try c.col(p, .fill, c.panelGap(), graphicsRight);
}
fn graphicsLeft(c: *C, p: *P) !void {
    for ([_][]const u8{ "Braille (2×4 pixels per cell)", "Block elements", "ASCII fallback" }, 0..) |title, i| {
        const d = try c.sub(p, c.v, i);
        try d.panel(p, .{ .title = title }, modeGraph);
    }
}
fn modeGraph(c: *C, p: *P) !void {
    const t = p.theme().*;
    var o: h.graphics.PlotOptions = .{ .min = 0, .max = 100 };
    switch (c.index) {
        0 => {
            o.fill = true;
            o.color = t.accent;
            o.grid = true;
        },
        1 => {
            o.mode = .block;
            o.colors = t.heat;
        },
        else => {
            o.mode = .ascii;
            o.color = t.foreground;
        },
    }
    try p.graph(.{ .values = try wave(p, c.n("time") / 3, 9), .plot = o });
}
fn graphicsRight(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Multi-series" }, multiSeries);
    try c.panel(p, .{ .title = "Gradients" }, gradients);
    try c.panel(p, .{ .title = "Raw Braille canvas" }, canvasPanel);
}
fn multiSeries(c: *C, p: *P) !void {
    const t = p.theme().*;
    const time = c.n("time");
    const series = try p.ctx.allocator.alloc(h.graphics.Series, 3);
    series[0] = .{ .values = try wave(p, time / 3, 9), .color = t.primary, .label = "alpha" };
    series[1] = .{ .values = try wave(p, time / 3 + 2, 5), .color = t.success, .label = "beta" };
    series[2] = .{ .values = try wave(p, time / 2, 17), .color = t.secondary, .label = "gamma" };
    try p.graph(.{ .series = series, .axis = true, .legend = true, .plot = .{ .min = 0, .max = 100 } });
}
fn gradients(c: *C, p: *P) !void {
    try p.draw(h.ui.DrawBody.with(c, gradientDraw));
}
fn gradientDraw(_: *C, s: h.Surface) !void {
    const ramp = h.color.Gradient.init(s.theme.heat);
    for (0..s.height()) |y| {
        for (0..s.width()) |x| {
            const value = if (s.width() > 1) @as(f64, @floatFromInt(x)) / @as(f64, @floatFromInt(s.width() - 1)) else 0;
            s.char(@intCast(x), @intCast(y), '█', .{ .fg = ramp.sample(value) });
        }
    }
}
fn canvasPanel(c: *C, p: *P) !void {
    try p.canvas(p.theme().accent, h.ui.CanvasBody.with(c, canvasDraw));
}
fn canvasDraw(c: *C, canvas: *h.graphics.BrailleCanvas) !void {
    const cx = @as(f64, @floatFromInt(canvas.width)) / 2;
    const cy = @as(f64, @floatFromInt(canvas.height)) / 2;
    const radius = @min(cx, cy) - 2;
    canvas.circle(cx, cy, radius);
    for (0..12) |i| {
        const angle = @as(f64, @floatFromInt(i)) / 12 * std.math.pi * 2 + c.n("time") / 4;
        canvas.line(cx, cy, cx + @cos(angle) * radius, cy + @sin(angle) * radius * 0.9);
    }
}
fn themes(c: *C, p: *P) !void {
    try p.label(try p.fmt("Theme {d}/9: {s}   ←/→ or F2 to change", .{ c.s.theme + 1, p.theme().name }));
    try p.spacer(.{ .cells = 1 });
    try p.grid(.{ .column_count = 3, .row_count = 3, .layout = .{ .gap = 1 } }, h.GridBody.with(c, themeGrid));
}
fn themeGrid(c: *C, g: *h.Grid) !void {
    for (m.themes, 0..) |name, i| {
        const e = h.theme.resolve(name);
        const d = try g.ctx.allocator.create(C);
        d.* = .{ .s = c.s, .v = c.v, .index = i };
        try g.panel(.{ .title = e.name, .border_color = if (i == c.s.theme) e.border_focused else e.border, .layout = .{ .background = e.background } }, .{}, h.Body.with(d, themePanel));
    }
}
fn themePanel(c: *C, p: *P) !void {
    const e = h.theme.resolve(m.themes[c.index]);
    try c.row(p, .{ .cells = 1 }, 1, themeBadges);
    try p.meter(.{ .value = 0.72, .label = "cpu", .background = e.background });
    try p.graph(.{ .values = try m.numbers(p.ctx.allocator, c.at("cpu.history")), .plot = .{ .min = 0, .max = 100, .fill = true, .color = e.graph[0], .background = e.background } });
    try p.sized(.{ .cells = 1 }, h.Body.with(c, themeRamp));
}
fn themeBadges(c: *C, p: *P) !void {
    const e = h.theme.resolve(m.themes[c.index]);
    for ([_][]const u8{ "primary", "ok", "warn", "err" }, [_]r.Color{ e.primary, e.success, e.warning, e.danger }, [_]usize{ 10, 5, 7, 6 }) |label, color, width| {
        const B = struct {
            label: []const u8,
            color: r.Color,
            fn draw(b: *@This(), q: *P) !void {
                try q.badge(.{ .text = b.label, .color = b.color });
            }
        };
        const b = try p.ctx.allocator.create(B);
        b.* = .{ .label = label, .color = color };
        try p.sized(.{ .cells = @intCast(width) }, h.Body.with(b, B.draw));
    }
    try p.spacer(.fill);
}
fn themeRamp(c: *C, p: *P) !void {
    try p.draw(h.ui.DrawBody.with(c, themeRampDraw));
}
fn themeRampDraw(c: *C, s: h.Surface) !void {
    const e = h.theme.resolve(m.themes[c.index]);
    for (e.graph, 0..) |color, ci| {
        for (0..3) |x| s.char(@intCast(ci * 4 + x), 0, '█', .{ .fg = color, .bg = e.background });
    }
}
fn input(c: *C, p: *P) !void {
    try c.row(p, .{ .fr = 1 }, c.panelGap(), inputColumns);
}
fn inputColumns(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Last Events" }, lastEvents);
    try c.panel(p, .{ .title = "Try it" }, tryInput);
}
fn lastEvents(c: *C, p: *P) !void {
    const t = p.theme().*;
    try r.keys(p, &.{ r.kv("Key", if (c.s.last_key.len > 0) c.s.last_key.slice() else "—", t.accent), r.kv("Mouse", if (c.s.last_mouse.len > 0) c.s.last_mouse.slice() else "—", t.primary) }, true);
    try p.spacer(.{ .cells = 1 });
    try p.divider(.{ .label = "history" });
    const count = @min(20, c.s.key_count);
    const items = try p.ctx.allocator.alloc(h.widgets.ListItem, count);
    for (items, 0..) |*item, i| {
        const index = c.s.key_count - 1 - i;
        item.* = .{ .label = c.s.key_log[index][0..c.s.key_lens[index]] };
    }
    try p.list(.{ .items = items }, "input.history");
}
fn tryInput(c: *C, p: *P) !void {
    try r.tx(p, "Press any key — modifiers are normalized.", p.theme().foreground);
    try p.label("Arrows, Function keys, Ctrl/Alt/Shift combinations,");
    try p.label("paste, focus, mouse move, click, drag and scroll.");
    try p.spacer(.{ .cells = 1 });
    try p.divider(.{ .label = "focusable controls" });
    try p.spacer(.{ .cells = 1 });
    try c.row(p, .{ .cells = 1 }, 2, inputButtons);
    try p.spacer(.{ .cells = 1 });
    try p.label("Tab / Shift+Tab moves focus. Enter activates.");
    try p.spacer(.fill);
    try r.keys(p, &.{ r.kv("Mouse tracking", "on", null), r.kv("Bracketed paste", "on", null), r.kv("Focus events", "on", null) }, true);
}
fn inputButtons(c: *C, p: *P) !void {
    for (0..3) |i| {
        const d = try c.sub(p, c.v, i);
        try p.sized(.{ .cells = 12 }, h.Body.with(d, inputButton));
    }
    try p.spacer(.fill);
}
fn inputButton(c: *C, p: *P) !void {
    switch (c.index) {
        0 => try p.button(.{ .label = "Button A", .width = 12 }, "input.a"),
        1 => try p.button(.{ .label = "Button B", .width = 12, .variant = .success }, "input.b"),
        else => try p.checkbox(.{ .label = "Check", .checked = c.s.checked }, "check"),
    }
}
fn stress(c: *C, p: *P) !void {
    try c.row(p, .{ .cells = 3 }, c.panelGap(), stressStats);
    try c.panel(p, .{ .title = "Full-screen churn" }, churn);
}
fn stressStats(c: *C, p: *P) !void {
    for ([_][]const u8{ "Render", "Changed cells", "Bytes/frame", "FPS" }, 0..) |title, i| {
        const d = try c.sub(p, c.v, i);
        try d.panel(p, .{ .title = title }, stressStat);
    }
}
fn stressStat(c: *C, p: *P) !void {
    const t = p.theme().*;
    const text = switch (c.index) {
        0 => try p.fmt("{d:.2} ms/frame", .{c.s.render_ms}),
        1 => try p.fmt("{d}", .{c.s.changed_cells}),
        2 => try p.fmt("{d}", .{c.s.output_bytes}),
        else => try p.fmt("{d:.1}", .{c.s.fps}),
    };
    try r.tx(p, text, ([_]r.Color{ t.success, t.warning, t.primary, t.accent })[c.index]);
}
fn churn(c: *C, p: *P) !void {
    try p.draw(h.ui.DrawBody.with(c, churnDraw));
}
fn churnDraw(c: *C, s: h.Surface) !void {
    const ramp = h.color.Gradient.init(s.theme.graph);
    const chars = [_]u21{ '▖', '▗', '▘', '▙', '▚', '▛', '▜', '▝', '▞', '▟', '█', '▓', '▒', '░' };
    const time = c.n("time");
    for (0..s.height()) |y| {
        for (0..s.width()) |x| {
            const v = (@sin(@as(f64, @floatFromInt(x)) / 6 + time) + @cos(@as(f64, @floatFromInt(y)) / 4 - time)) / 2;
            const n = (v + 1) / 2;
            const i: usize = @intFromFloat(@floor(n * @as(f64, @floatFromInt(chars.len - 1))));
            s.char(@intCast(x), @intCast(y), chars[i], .{ .fg = ramp.sample(n) });
        }
    }
}
fn components(c: *C, p: *P) !void {
    try c.row(p, .{ .fr = 1 }, 1, componentColumns);
}
fn componentColumns(c: *C, p: *P) !void {
    try c.col(p, .fill, c.panelGap(), componentLeft);
    try c.col(p, .fill, c.panelGap(), componentRight);
}
fn componentLeft(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Buttons & Inputs", .layout = .{ .size = .{ .cells = 13 } } }, controls);
    try c.panel(p, .{ .title = "Table Widget" }, files);
    try c.panel(p, .{ .title = "Log Viewer", .layout = .{ .size = .{ .cells = 11 } } }, logs);
}
fn controls(c: *C, p: *P) !void {
    try c.row(p, .{ .cells = 1 }, 1, buttons);
    try p.spacer(.{ .cells = 1 });
    try c.row(p, .{ .cells = 1 }, 2, inputs);
    try p.spacer(.{ .cells = 1 });
    try p.textInput(.{ .label = "Search", .value = c.s.input.slice(), .placeholder = "type to filter…", .focused = c.s.editing }, "input");
    try p.spacer(.{ .cells = 1 });
    try p.meter(.{ .label = "Slider", .value = c.s.slider, .style = .smooth, .heat = false, .color = p.theme().primary });
    try p.progress(.{ .label = "Progress", .value = 37, .max = 120, .show_count = true });
}
fn buttons(c: *C, p: *P) !void {
    for (0..4) |i| {
        const d = try c.sub(p, c.v, i);
        try p.sized(.{ .cells = if (i == 3) 10 else 11 }, h.Body.with(d, button));
    }
    try p.spacer(.fill);
}
fn button(c: *C, p: *P) !void {
    const name = ([_][]const u8{ "Primary", "Success", "Warning", "Danger" })[c.index];
    try p.button(.{ .label = name, .width = if (c.index == 3) 10 else 11, .variant = ([_]h.widgets.ButtonVariant{ .primary, .success, .warning, .danger })[c.index] }, try p.fmt("button:{s}", .{name}));
}
fn inputs(c: *C, p: *P) !void {
    for ([_]i64{ 20, 12, 14 }, 0..) |width, i| {
        const d = try c.sub(p, c.v, i);
        try p.sized(.{ .cells = width }, h.Body.with(d, inputControl));
    }
    try p.spacer(.fill);
}
fn inputControl(c: *C, p: *P) !void {
    const options = &[_][]const u8{ "Dark", "Dracula", "Nord", "Tokyo Night" };
    switch (c.index) {
        0 => try p.select(.{ .value = options[c.s.select_index % 4], .width = 20, .open = c.s.select_open, .options = options, .selected_index = c.s.select_index }, "select"),
        1 => try p.checkbox(.{ .label = "Toggle", .checked = c.s.toggle, .variant = .toggle }, "toggle"),
        else => try p.checkbox(.{ .label = "Checkbox", .checked = c.s.checked }, "check"),
    }
}
fn files(c: *C, p: *P) !void {
    const t = p.theme().*;
    // Static widget examples need no JSON parsing or per-row allocations.
    const rows = &[_]h.widgets.TableRow{
        .{ .cells = &.{ "src", "4.2 KB", "dir", "2m ago" } },            .{ .cells = &.{ "test", "1.1 KB", "dir", "5m ago" } },
        .{ .cells = &.{ "package.json", "1.2 KB", "file", "10m ago" } }, .{ .cells = &.{ "README.md", "3.4 KB", "file", "1h ago" } },
        .{ .cells = &.{ "bun.lockb", "12 KB", "file", "1h ago" } },
    };
    const pane = &c.s.panes[40];
    pane.total = rows.len;
    pane.move(0);
    pane.offset = h.widgets.resolveOffset(pane.offset, pane.selected, p.height() -| 1, rows.len, true);
    const columns = try p.ctx.allocator.dupe(h.widgets.TableColumn, &.{
        .{ .title = "Name", .min = 10, .color = t.primary }, .{ .title = "Size", .width = .{ .cells = 9 }, .alignment = .right },
        .{ .title = "Type", .width = .{ .cells = 6 } },      .{ .title = "Modified", .width = .{ .cells = 10 }, .alignment = .right, .color = t.muted },
    });
    try p.table(.{ .rows = rows, .columns = columns, .selected = pane.selected, .offset = pane.offset, .follow_selection = true, .zebra = true }, "pane:40");
}
fn logs(c: *C, p: *P) !void {
    try r.log(c, p, 1);
}
fn componentRight(c: *C, p: *P) !void {
    try c.panel(p, .{ .title = "Process Tree", .layout = .{ .size = .{ .cells = 13 } } }, tree);
    try c.panel(p, .{ .title = "Sparklines & Gauges", .layout = .{ .size = .{ .cells = 12 } } }, gauges);
    try c.panel(p, .{ .title = "Lists & Badges" }, lists);
}
const Tree = h.widgets.TreeNode;
const TV = h.widgets.TreeValue;
fn tv(comptime cpu: []const u8, comptime mem: []const u8) []const TV {
    return &.{ .{ .text = cpu, .width = 6 }, .{ .text = mem, .width = 6 } };
}
const nodes = &[_]Tree{.{ .label = "systemd", .values = tv("1.3", "0.1"), .children = &.{ .{ .label = "bash", .values = tv("0.1", "0.2") }, .{ .label = "bun", .values = tv("32.8", "4.2"), .children = &.{ .{ .label = "bun:worker", .values = tv("12.4", "1.8") }, .{ .label = "bun:worker", .values = tv("8.7", "1.3") } } }, .{ .label = "node", .values = tv("18.1", "2.1"), .children = &.{.{ .label = "node:worker", .values = tv("6.1", "0.8") }} }, .{ .label = "postgres", .values = tv("6.7", "1.8") } } }};
fn treeHeader(_: *C, p: *P) !void {
    try p.text("Name", .{ .fg = p.theme().muted, .bold = true });
    try p.text("CPU%   MEM%", .{ .fg = p.theme().muted, .bold = true, .alignment = .right });
}
fn tree(c: *C, p: *P) !void {
    try c.row(p, .{ .cells = 1 }, 0, treeHeader);
    const pane = &c.s.panes[42];
    pane.total = 8;
    pane.move(0);
    try p.tree(.{ .nodes = nodes, .selected = pane.selected, .offset = pane.offset, .follow_selection = true }, "pane:42");
}
fn gauges(c: *C, p: *P) !void {
    const t = p.theme().*;
    try p.sparkline(.{ .label = "CPU ", .values = try m.numbers(p.ctx.allocator, c.at("cpu.history")), .text = try r.pct(p, c.n("cpu.total")), .color = t.success });
    try p.sparkline(.{ .label = "Mem ", .values = try m.numbers(p.ctx.allocator, c.at("memory.history")), .text = try r.pct(p, c.n("memory.used") / @max(1, c.n("memory.total"))), .color = t.warning });
    try p.sparkline(.{ .label = "Net ", .values = try m.numbers(p.ctx.allocator, c.at("network.downHistory")), .text = try p.fmt("{s}/s", .{try r.bytes(p, c.n("network.downRate"), 2)}), .color = t.primary });
    try p.spacer(.{ .cells = 1 });
    try c.row(p, .{ .fr = 1 }, 2, dials);
}
fn dials(c: *C, p: *P) !void {
    const t = p.theme().*;
    try p.gauge(.{ .value = c.n("cpu.total"), .label = try r.pct(p, c.n("cpu.total")) });
    const segments = try p.ctx.allocator.alloc(h.graphics.DonutSegment, 2);
    segments[0] = .{ .value = c.n("memory.used"), .color = t.primary, .label = "Used" };
    segments[1] = .{ .value = c.n("memory.available"), .color = t.warning, .label = "Free" };
    try p.donut(.{ .segments = segments });
}
fn lists(c: *C, p: *P) !void {
    try c.row(p, .{ .cells = 1 }, 1, badges);
    try p.spacer(.{ .cells = 1 });
    const pane = &c.s.panes[43];
    pane.total = 4;
    pane.move(0);
    const items = try p.ctx.allocator.dupe(h.widgets.ListItem, &.{ .{ .label = "apps/demo", .color = p.theme().primary }, .{ .label = "packages/hqtui" }, .{ .label = "apps/web" }, .{ .label = "docs" } });
    try p.list(.{ .items = items, .selected = pane.selected, .offset = pane.offset, .follow_selection = true, .bullet = "▸", .scrollbar = true }, "pane:43");
}
fn badges(c: *C, p: *P) !void {
    for ([_]i64{ 10, 8, 10 }, 0..) |width, i| {
        const d = try c.sub(p, c.v, i);
        try p.sized(.{ .cells = width }, h.Body.with(d, badge));
    }
    try p.spacer(.fill);
}
fn badge(c: *C, p: *P) !void {
    const t = p.theme().*;
    try p.badge(.{ .text = ([_][]const u8{ "active", "idle", "failed" })[c.index], .color = ([_]r.Color{ t.success, t.warning, t.danger })[c.index], .variant = ([_]h.widgets.BadgeVariant{ .filled, .subtle, .outline })[c.index] });
}
