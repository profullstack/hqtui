//! What the terminal can actually do. Detection is deliberately conservative:
//! we degrade colors and glyphs rather than print mojibake on someone's console.

use std::collections::HashMap;
use std::io::IsTerminal;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ColorDepth {
    #[default]
    TrueColor,
    Ansi256,
    Ansi16,
    None,
}

impl ColorDepth {
    pub fn as_str(self) -> &'static str {
        match self {
            ColorDepth::TrueColor => "truecolor",
            ColorDepth::Ansi256 => "ansi256",
            ColorDepth::Ansi16 => "ansi16",
            ColorDepth::None => "none",
        }
    }

    pub fn parse(s: &str) -> Option<ColorDepth> {
        match s {
            "truecolor" => Some(ColorDepth::TrueColor),
            "ansi256" => Some(ColorDepth::Ansi256),
            "ansi16" => Some(ColorDepth::Ansi16),
            "none" => Some(ColorDepth::None),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Capabilities {
    /// stdout is a real TTY, not a pipe or a file.
    pub tty: bool,
    pub colors: ColorDepth,
    pub true_color: bool,
    pub unicode: bool,
    pub braille: bool,
    pub mouse: bool,
    /// DEC 2026 atomic frame updates.
    pub synchronized_output: bool,
    pub bracketed_paste: bool,
    pub focus_events: bool,
    pub tmux: bool,
    pub screen: bool,
    pub ssh: bool,
    pub windows: bool,
    /// Best guess at the emulator: kitty, wezterm, ghostty, iterm, alacritty,
    /// vscode, windows-terminal, xterm, unknown.
    pub program: String,
}

impl Default for Capabilities {
    fn default() -> Capabilities {
        Capabilities {
            tty: true,
            colors: ColorDepth::TrueColor,
            true_color: true,
            unicode: true,
            braille: true,
            mouse: true,
            synchronized_output: false,
            bracketed_paste: true,
            focus_events: true,
            tmux: false,
            screen: false,
            ssh: false,
            windows: cfg!(windows),
            program: "unknown".to_string(),
        }
    }
}

/// Force a capability rather than detecting it. Used by tests and by apps that
/// know better than the environment does.
#[derive(Clone, Debug, Default)]
pub struct CapabilityOverrides {
    pub colors: Option<ColorDepth>,
    pub unicode: Option<bool>,
    pub braille: Option<bool>,
    pub mouse: Option<bool>,
    pub synchronized_output: Option<bool>,
    pub tty: Option<bool>,
}

/// The environment, as a map, so detection is testable without touching the
/// real process environment.
pub type Env = HashMap<String, String>;

pub fn process_env() -> Env {
    std::env::vars().collect()
}

fn get<'a>(env: &'a Env, key: &str) -> Option<&'a str> {
    env.get(key).map(String::as_str)
}

fn has(env: &Env, key: &str) -> bool {
    env.get(key).is_some_and(|v| !v.is_empty())
}

pub fn detect_program(env: &Env) -> String {
    let term = get(env, "TERM").unwrap_or("");
    let program = get(env, "TERM_PROGRAM").unwrap_or("");
    if has(env, "KITTY_WINDOW_ID") || term == "xterm-kitty" {
        return "kitty".into();
    }
    if has(env, "WEZTERM_EXECUTABLE") || program == "WezTerm" {
        return "wezterm".into();
    }
    if has(env, "GHOSTTY_RESOURCES_DIR") || term == "xterm-ghostty" {
        return "ghostty".into();
    }
    if program == "iTerm.app" {
        return "iterm".into();
    }
    if has(env, "ALACRITTY_WINDOW_ID") || term == "alacritty" {
        return "alacritty".into();
    }
    if program == "vscode" {
        return "vscode".into();
    }
    if has(env, "WT_SESSION") {
        return "windows-terminal".into();
    }
    if program == "Apple_Terminal" {
        return "apple-terminal".into();
    }
    if has(env, "KONSOLE_VERSION") {
        return "konsole".into();
    }
    if term.starts_with("xterm") {
        return "xterm".into();
    }
    "unknown".into()
}

const TRUECOLOR_PROGRAMS: &[&str] =
    &["kitty", "wezterm", "ghostty", "iterm", "vscode", "windows-terminal", "konsole"];

fn detect_colors(env: &Env, tty: bool) -> ColorDepth {
    if env.get("NO_COLOR").is_some_and(|v| !v.is_empty()) {
        return ColorDepth::None;
    }
    match get(env, "FORCE_COLOR") {
        Some("0") | Some("false") => return ColorDepth::None,
        Some("1") => return ColorDepth::Ansi16,
        Some("2") => return ColorDepth::Ansi256,
        Some("3") => return ColorDepth::TrueColor,
        _ => {}
    }
    // Any other non-empty value — `FORCE_COLOR=true` is the common one —
    // asserts that color works. It is a floor, not a ceiling: returning a level
    // here would cap a truecolor terminal at 16 colors. It only waives the tty
    // check.
    let forced = env.get("FORCE_COLOR").is_some_and(|v| !v.is_empty());
    if !tty && !forced {
        return ColorDepth::None;
    }
    let term = get(env, "TERM").unwrap_or("");
    if term == "dumb" {
        return ColorDepth::None;
    }
    let colorterm = get(env, "COLORTERM").unwrap_or("").to_ascii_lowercase();
    if colorterm == "truecolor" || colorterm == "24bit" {
        return ColorDepth::TrueColor;
    }
    if TRUECOLOR_PROGRAMS.contains(&detect_program(env).as_str()) {
        return ColorDepth::TrueColor;
    }
    if term.contains("256") {
        return ColorDepth::Ansi256;
    }
    ColorDepth::Ansi16
}

fn detect_unicode(env: &Env) -> bool {
    // A dumb terminal has no glyph repertoire to speak of. The Linux console is
    // not in that category — its default font draws box and block elements
    // perfectly well — so only Braille is withheld from it, below.
    if get(env, "TERM").unwrap_or("") == "dumb" {
        return false;
    }
    let locale = get(env, "LC_ALL")
        .filter(|v| !v.is_empty())
        .or_else(|| get(env, "LC_CTYPE").filter(|v| !v.is_empty()))
        .or_else(|| get(env, "LANG").filter(|v| !v.is_empty()))
        .unwrap_or("");
    let upper = locale.to_ascii_uppercase();
    if upper.contains("UTF8") || upper.contains("UTF-8") {
        return true;
    }
    // Windows Terminal and modern emulators are UTF-8 regardless of locale vars.
    if has(env, "WT_SESSION") || has(env, "TERM_PROGRAM") || has(env, "KITTY_WINDOW_ID") {
        return true;
    }
    if cfg!(windows) {
        has(env, "WT_SESSION")
    } else {
        locale.is_empty()
    }
}

const SYNC_PROGRAMS: &[&str] =
    &["kitty", "wezterm", "ghostty", "iterm", "windows-terminal", "konsole", "alacritty"];

pub fn detect_capabilities(overrides: &CapabilityOverrides) -> Capabilities {
    detect_capabilities_in(overrides, &process_env(), std::io::stdout().is_terminal())
}

pub fn detect_capabilities_in(
    overrides: &CapabilityOverrides,
    env: &Env,
    is_tty: bool,
) -> Capabilities {
    let tty = overrides.tty.unwrap_or(is_tty);
    let term = get(env, "TERM").unwrap_or("").to_string();
    let program = detect_program(env);
    let tmux = has(env, "TMUX") || term.starts_with("tmux") || term.starts_with("screen");
    let screen = term.starts_with("screen") && !has(env, "TMUX");
    let ssh = has(env, "SSH_CLIENT") || has(env, "SSH_TTY") || has(env, "SSH_CONNECTION");
    let colors = overrides.colors.unwrap_or_else(|| detect_colors(env, tty));
    let unicode = overrides.unicode.unwrap_or_else(|| detect_unicode(env));
    let sync_capable = SYNC_PROGRAMS.contains(&program.as_str()) || tmux;

    Capabilities {
        tty,
        colors,
        true_color: colors == ColorDepth::TrueColor,
        unicode,
        // The Linux console draws box and block elements but has no Braille in
        // its default font, which is the one glyph class it genuinely lacks.
        braille: overrides
            .braille
            .unwrap_or(unicode && program != "apple-terminal" && term != "linux"),
        mouse: overrides.mouse.unwrap_or(tty && term != "dumb" && term != "linux"),
        synchronized_output: overrides.synchronized_output.unwrap_or(tty && sync_capable),
        bracketed_paste: tty && term != "dumb",
        focus_events: tty && term != "dumb" && !screen,
        tmux,
        screen,
        ssh,
        windows: cfg!(windows),
        program,
    }
}
