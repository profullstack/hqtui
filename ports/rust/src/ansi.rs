//! Raw VT/ANSI control sequences. Nothing above this layer writes an escape by
//! hand.

use crate::unicode::strip_unsafe;

pub const ESC: &str = "\x1b";
pub const CSI: &str = "\x1b[";

pub const RESET: &str = "\x1b[0m";

pub const ALTERNATE_SCREEN_ON: &str = "\x1b[?1049h";
pub const ALTERNATE_SCREEN_OFF: &str = "\x1b[?1049l";

pub const CURSOR_HIDE: &str = "\x1b[?25l";
pub const CURSOR_SHOW: &str = "\x1b[?25h";
pub const CURSOR_HOME: &str = "\x1b[H";
pub const CURSOR_SAVE: &str = "\x1b7";
pub const CURSOR_RESTORE: &str = "\x1b8";

pub const CLEAR_SCREEN: &str = "\x1b[2J";
pub const CLEAR_SCROLLBACK: &str = "\x1b[3J";
pub const CLEAR_LINE: &str = "\x1b[2K";
pub const CLEAR_TO_END: &str = "\x1b[0J";

/// 1000 = clicks, 1002 = drag, 1003 = any motion, 1006 = SGR extended coords.
pub const MOUSE_ON: &str = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h";
pub const MOUSE_OFF: &str = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

pub const BRACKETED_PASTE_ON: &str = "\x1b[?2004h";
pub const BRACKETED_PASTE_OFF: &str = "\x1b[?2004l";

pub const FOCUS_ON: &str = "\x1b[?1004h";
pub const FOCUS_OFF: &str = "\x1b[?1004l";

/// Atomic frame: the terminal shows nothing until `END_SYNC`. Kills tearing.
pub const BEGIN_SYNC: &str = "\x1b[?2026h";
pub const END_SYNC: &str = "\x1b[?2026l";

pub const SOFT_RESET: &str = "\x1b[!p";

pub const FG_DEFAULT: &str = "\x1b[39m";
pub const BG_DEFAULT: &str = "\x1b[49m";

pub fn move_to(x: usize, y: usize) -> String {
    format!("\x1b[{};{}H", y + 1, x + 1)
}

pub fn move_right(n: usize) -> String {
    if n == 1 {
        "\x1b[C".to_string()
    } else {
        format!("\x1b[{}C", n)
    }
}

pub fn move_to_column(x: usize) -> String {
    format!("\x1b[{}G", x + 1)
}

/// The title is interpolated into an OSC sequence, so anything that could end
/// or restart it has to go. `strip_unsafe` is the same policy the grid uses.
pub fn set_title(title: &str) -> String {
    format!("\x1b]0;{}\x07", strip_unsafe(title))
}

pub fn fg_true(r: u8, g: u8, b: u8) -> String {
    format!("\x1b[38;2;{};{};{}m", r, g, b)
}

pub fn bg_true(r: u8, g: u8, b: u8) -> String {
    format!("\x1b[48;2;{};{};{}m", r, g, b)
}

pub fn fg_256(i: u8) -> String {
    format!("\x1b[38;5;{}m", i)
}

pub fn bg_256(i: u8) -> String {
    format!("\x1b[48;5;{}m", i)
}

pub fn fg_16(i: u8) -> String {
    if i < 8 {
        format!("\x1b[{}m", 30 + i as u32)
    } else {
        format!("\x1b[{}m", 90 + i as u32 - 8)
    }
}

pub fn bg_16(i: u8) -> String {
    if i < 8 {
        format!("\x1b[{}m", 40 + i as u32)
    } else {
        format!("\x1b[{}m", 100 + i as u32 - 8)
    }
}

/// Strip escape sequences — used by the headless renderer and by tests, and
/// exported for apps that want to sanitise text themselves.
///
/// Two things the obvious approach misses, both of which leave a live sequence
/// behind: CSI may carry intermediate bytes (0x20-0x2f) before its final byte,
/// as in `ESC [ 0 SP q`; and every sequence has an 8-bit C1 form where a single
/// byte replaces `ESC x`. After the structured pass, anything still holding a
/// control or bidi override is removed outright, so the result cannot steer a
/// terminal even if a form was missed.
pub fn strip_ansi(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut out = String::new();
    let mut i = 0usize;

    while i < n {
        let c = chars[i];

        // CSI: ESC [ … or the C1 form, U+009B.
        let csi_start = if c == '\u{1b}' && i + 1 < n && chars[i + 1] == '[' {
            Some(i + 2)
        } else if c == '\u{9b}' {
            Some(i + 1)
        } else {
            None
        };
        if let Some(start) = csi_start {
            let mut j = start;
            while j < n && matches!(chars[j], '0'..='9' | ';' | '?' | '<' | '=' | '>') {
                j += 1;
            }
            while j < n && ('\u{20}'..='\u{2f}').contains(&chars[j]) {
                j += 1;
            }
            // Without a final byte this is not a sequence yet; fall through and
            // let the unsafe pass below drop the bare ESC.
            if j < n && ('\u{40}'..='\u{7e}').contains(&chars[j]) {
                i = j + 1;
                continue;
            }
        }

        // OSC: ESC ] … terminated by BEL, ST, C1 ST, or end of string.
        let osc_start = if c == '\u{1b}' && i + 1 < n && chars[i + 1] == ']' {
            Some(i + 2)
        } else if c == '\u{9d}' {
            Some(i + 1)
        } else {
            None
        };
        if let Some(start) = osc_start {
            i = scan_to_terminator(&chars, start, true);
            continue;
        }

        // DCS: ESC P … terminated by ST, C1 ST, or end of string.
        let dcs_start = if c == '\u{1b}' && i + 1 < n && chars[i + 1] == 'P' {
            Some(i + 2)
        } else if c == '\u{90}' {
            Some(i + 1)
        } else {
            None
        };
        if let Some(start) = dcs_start {
            i = scan_to_terminator(&chars, start, false);
            continue;
        }

        // Any other two-character escape: ESC followed by 0x40-0x5A or 0x5C-0x5F.
        if c == '\u{1b}' && i + 1 < n {
            let next = chars[i + 1];
            if ('\u{40}'..='\u{5a}').contains(&next) || ('\u{5c}'..='\u{5f}').contains(&next) {
                i += 2;
                continue;
            }
        }

        out.push(c);
        i += 1;
    }

    // The grid's unsafe set minus tab, newline and carriage return. This works
    // on text, not cells, and multi-line callers rely on those three; the
    // framebuffer refuses them separately, which is the right layer for it.
    out.chars().filter(|&c| !is_text_unsafe(c)).collect()
}

fn scan_to_terminator(chars: &[char], from: usize, bel_terminates: bool) -> usize {
    let n = chars.len();
    let mut j = from;
    while j < n {
        let c = chars[j];
        if bel_terminates && c == '\u{7}' {
            return j + 1;
        }
        if c == '\u{9c}' {
            return j + 1;
        }
        if c == '\u{1b}' && j + 1 < n && chars[j + 1] == '\\' {
            return j + 2;
        }
        j += 1;
    }
    n
}

fn is_text_unsafe(c: char) -> bool {
    let cp = c as u32;
    (cp <= 0x08)
        || cp == 0x0b
        || cp == 0x0c
        || (0x0e..=0x1f).contains(&cp)
        || (0x7f..=0x9f).contains(&cp)
        || (0x202a..=0x202e).contains(&cp)
        || (0x2066..=0x2069).contains(&cp)
}
