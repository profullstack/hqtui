//! What the terminal can actually do. Detection is deliberately conservative:
//! we degrade colors and glyphs rather than print mojibake on someone's console.

const std = @import("std");
const builtin = @import("builtin");

pub const ColorDepth = enum {
    truecolor,
    ansi256,
    ansi16,
    none,

    pub fn parse(name: []const u8) ?ColorDepth {
        if (std.mem.eql(u8, name, "truecolor")) return .truecolor;
        if (std.mem.eql(u8, name, "ansi256")) return .ansi256;
        if (std.mem.eql(u8, name, "ansi16")) return .ansi16;
        if (std.mem.eql(u8, name, "none")) return .none;
        return null;
    }

    pub fn toString(self: ColorDepth) []const u8 {
        return @tagName(self);
    }
};

pub const Capabilities = struct {
    /// stdout is a real TTY, not a pipe or a file.
    tty: bool = true,
    colors: ColorDepth = .truecolor,
    true_color: bool = true,
    unicode: bool = true,
    braille: bool = true,
    mouse: bool = true,
    /// DEC 2026 atomic frame updates.
    synchronized_output: bool = false,
    bracketed_paste: bool = true,
    focus_events: bool = true,
    tmux: bool = false,
    screen: bool = false,
    ssh: bool = false,
    windows: bool = builtin.os.tag == .windows,
    /// Best guess at the emulator: kitty, wezterm, ghostty, iterm, alacritty,
    /// vscode, windows-terminal, xterm, unknown.
    program: []const u8 = "unknown",
};

/// Force a capability rather than detecting it. Used by tests and by apps that
/// know better than the environment does.
pub const Overrides = struct {
    colors: ?ColorDepth = null,
    unicode: ?bool = null,
    braille: ?bool = null,
    mouse: ?bool = null,
    synchronized_output: ?bool = null,
    tty: ?bool = null,
};

/// The environment, read through a callback, so detection is testable without
/// touching the real process environment.
pub const Env = struct {
    context: *const anyopaque,
    lookup: *const fn (context: *const anyopaque, key: []const u8) ?[]const u8,

    pub fn get(self: Env, key: []const u8) []const u8 {
        return self.lookup(self.context, key) orelse "";
    }

    pub fn has(self: Env, key: []const u8) bool {
        return self.get(key).len > 0;
    }

    /// An environment with nothing in it, for headless rendering.
    pub const empty: Env = .{
        .context = undefined,
        .lookup = struct {
            fn f(_: *const anyopaque, _: []const u8) ?[]const u8 {
                return null;
            }
        }.f,
    };

    /// The real process environment.
    ///
    /// Zig 0.16 has no ambient `getenv`: the environment reaches a program
    /// through `main`'s `std.process.Init` parameter and nowhere else. That is
    /// why this takes a pointer rather than reading a global, and why
    /// `Terminal` asks for one — a library that guessed here would silently
    /// detect nothing and degrade every plot to ASCII.
    ///
    /// ```zig
    /// pub fn main(init: std.process.Init) !void {
    ///     var app = try App.init(gpa, .{
    ///         .terminal = .{ .env = .fromEnviron(&init.minimal.environ) },
    ///     });
    /// }
    /// ```
    pub fn fromEnviron(environ: *const std.process.Environ) Env {
        return .{
            .context = @ptrCast(environ),
            .lookup = struct {
                fn f(context: *const anyopaque, key: []const u8) ?[]const u8 {
                    if (builtin.os.tag == .windows) return null;
                    const e: *const std.process.Environ = @ptrCast(@alignCast(context));
                    return e.getPosix(key);
                }
            }.f,
        };
    }
};

const truecolor_programs = [_][]const u8{
    "kitty", "wezterm", "ghostty", "iterm", "vscode", "windows-terminal", "konsole",
};

const sync_programs = [_][]const u8{
    "kitty", "wezterm", "ghostty", "iterm", "windows-terminal", "konsole", "alacritty",
};

fn contains(haystack: []const []const u8, needle: []const u8) bool {
    for (haystack) |h| {
        if (std.mem.eql(u8, h, needle)) return true;
    }
    return false;
}

pub fn detectProgram(env: Env) []const u8 {
    const term = env.get("TERM");
    const program = env.get("TERM_PROGRAM");
    if (env.has("KITTY_WINDOW_ID") or std.mem.eql(u8, term, "xterm-kitty")) return "kitty";
    if (env.has("WEZTERM_EXECUTABLE") or std.mem.eql(u8, program, "WezTerm")) return "wezterm";
    if (env.has("GHOSTTY_RESOURCES_DIR") or std.mem.eql(u8, term, "xterm-ghostty")) return "ghostty";
    if (std.mem.eql(u8, program, "iTerm.app")) return "iterm";
    if (env.has("ALACRITTY_WINDOW_ID") or std.mem.eql(u8, term, "alacritty")) return "alacritty";
    if (std.mem.eql(u8, program, "vscode")) return "vscode";
    if (env.has("WT_SESSION")) return "windows-terminal";
    if (std.mem.eql(u8, program, "Apple_Terminal")) return "apple-terminal";
    if (env.has("KONSOLE_VERSION")) return "konsole";
    if (std.mem.startsWith(u8, term, "xterm")) return "xterm";
    return "unknown";
}

fn detectColors(env: Env, tty: bool) ColorDepth {
    if (env.has("NO_COLOR")) return .none;
    const force = env.get("FORCE_COLOR");
    if (std.mem.eql(u8, force, "0") or std.mem.eql(u8, force, "false")) return .none;
    if (std.mem.eql(u8, force, "1")) return .ansi16;
    if (std.mem.eql(u8, force, "2")) return .ansi256;
    if (std.mem.eql(u8, force, "3")) return .truecolor;
    // Any other non-empty value — FORCE_COLOR=true is the common one — asserts
    // that color works. It is a floor, not a ceiling: returning a level here
    // would cap a truecolor terminal at 16 colors. It only waives the tty check.
    if (!tty and force.len == 0) return .none;

    const term = env.get("TERM");
    if (std.mem.eql(u8, term, "dumb")) return .none;

    var colorterm_buf: [32]u8 = undefined;
    const colorterm_raw = env.get("COLORTERM");
    if (colorterm_raw.len <= colorterm_buf.len) {
        const lower = std.ascii.lowerString(colorterm_buf[0..colorterm_raw.len], colorterm_raw);
        if (std.mem.eql(u8, lower, "truecolor") or std.mem.eql(u8, lower, "24bit")) {
            return .truecolor;
        }
    }
    if (contains(&truecolor_programs, detectProgram(env))) return .truecolor;
    if (std.mem.indexOf(u8, term, "256") != null) return .ansi256;
    return .ansi16;
}

fn detectUnicode(env: Env) bool {
    // A dumb terminal has no glyph repertoire to speak of. The Linux console is
    // not in that category — its default font draws box and block elements
    // perfectly well — so only Braille is withheld from it, below.
    if (std.mem.eql(u8, env.get("TERM"), "dumb")) return false;

    var locale = env.get("LC_ALL");
    if (locale.len == 0) locale = env.get("LC_CTYPE");
    if (locale.len == 0) locale = env.get("LANG");

    var upper_buf: [64]u8 = undefined;
    if (locale.len <= upper_buf.len) {
        const upper = std.ascii.upperString(upper_buf[0..locale.len], locale);
        if (std.mem.indexOf(u8, upper, "UTF8") != null or
            std.mem.indexOf(u8, upper, "UTF-8") != null) return true;
    }
    // Windows Terminal and modern emulators are UTF-8 regardless of locale vars.
    if (env.has("WT_SESSION") or env.has("TERM_PROGRAM") or env.has("KITTY_WINDOW_ID")) {
        return true;
    }
    if (builtin.os.tag == .windows) return env.has("WT_SESSION");
    return locale.len == 0;
}

pub fn detect(overrides: Overrides, env: Env, is_tty: bool) Capabilities {
    const tty = overrides.tty orelse is_tty;
    const term = env.get("TERM");
    const program = detectProgram(env);
    const tmux = env.has("TMUX") or
        std.mem.startsWith(u8, term, "tmux") or
        std.mem.startsWith(u8, term, "screen");
    const screen = std.mem.startsWith(u8, term, "screen") and !env.has("TMUX");
    const ssh = env.has("SSH_CLIENT") or env.has("SSH_TTY") or env.has("SSH_CONNECTION");

    const colors = overrides.colors orelse detectColors(env, tty);
    const uni = overrides.unicode orelse detectUnicode(env);

    return .{
        .tty = tty,
        .colors = colors,
        .true_color = colors == .truecolor,
        .unicode = uni,
        // The Linux console draws box and block elements but has no Braille in
        // its default font, which is the one glyph class it genuinely lacks.
        .braille = overrides.braille orelse
            (uni and !std.mem.eql(u8, program, "apple-terminal") and !std.mem.eql(u8, term, "linux")),
        .mouse = overrides.mouse orelse
            (tty and !std.mem.eql(u8, term, "dumb") and !std.mem.eql(u8, term, "linux")),
        .synchronized_output = overrides.synchronized_output orelse
            (tty and (contains(&sync_programs, program) or tmux)),
        .bracketed_paste = tty and !std.mem.eql(u8, term, "dumb"),
        .focus_events = tty and !std.mem.eql(u8, term, "dumb") and !screen,
        .tmux = tmux,
        .screen = screen,
        .ssh = ssh,
        .windows = builtin.os.tag == .windows,
        .program = program,
    };
}
