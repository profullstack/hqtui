//! Decodes raw terminal bytes into normalized events. Applications should never
//! see an escape sequence — only `"ctrl+c"`, `"up"`, or a printable character.
//!
//! [`InputParser::parse`] takes `&str` because a sequence can be split across
//! reads and the parser has to hold the remainder. Splitting a *multi-byte
//! character* across reads is the terminal's problem, not the parser's:
//! [`Terminal`](crate::terminal::Terminal) buffers partial UTF-8 before it gets
//! here.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyEvent {
    /// Normalized name: `"a"`, `"up"`, `"enter"`, `"f5"`, `"escape"`, `"space"`.
    pub name: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    /// The printable character, when there is one.
    pub char: Option<String>,
    /// Full form including modifiers, e.g. `"ctrl+c"` — what you usually match on.
    pub key: String,
    pub raw: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MouseAction {
    Press,
    Release,
    Move,
    Drag,
    Scroll,
}

impl MouseAction {
    pub fn as_str(self) -> &'static str {
        match self {
            MouseAction::Press => "press",
            MouseAction::Release => "release",
            MouseAction::Move => "move",
            MouseAction::Drag => "drag",
            MouseAction::Scroll => "scroll",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MouseButton {
    Left,
    Middle,
    Right,
    None,
}

impl MouseButton {
    pub fn as_str(self) -> &'static str {
        match self {
            MouseButton::Left => "left",
            MouseButton::Middle => "middle",
            MouseButton::Right => "right",
            MouseButton::None => "none",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MouseEvent {
    pub action: MouseAction,
    pub button: MouseButton,
    /// Zero-based cell coordinates.
    pub x: usize,
    pub y: usize,
    /// -1 up, 1 down; 0 when this is not a scroll.
    pub scroll: i32,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PasteEvent {
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FocusEvent {
    pub focused: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InputEvent {
    Key(KeyEvent),
    Mouse(MouseEvent),
    Paste(PasteEvent),
    Focus(FocusEvent),
}

impl InputEvent {
    pub fn as_key(&self) -> Option<&KeyEvent> {
        match self {
            InputEvent::Key(k) => Some(k),
            _ => None,
        }
    }

    pub fn as_mouse(&self) -> Option<&MouseEvent> {
        match self {
            InputEvent::Mouse(m) => Some(m),
            _ => None,
        }
    }
}

/// The escape sequences that map to a named key, without their leading ESC.
const SPECIAL: &[(&str, &str)] = &[
    ("[A", "up"), ("[B", "down"), ("[C", "right"), ("[D", "left"),
    ("[H", "home"), ("[F", "end"), ("[Z", "shift+tab"),
    ("OA", "up"), ("OB", "down"), ("OC", "right"), ("OD", "left"),
    ("OH", "home"), ("OF", "end"),
    ("OP", "f1"), ("OQ", "f2"), ("OR", "f3"), ("OS", "f4"),
    ("[1~", "home"), ("[2~", "insert"), ("[3~", "delete"), ("[4~", "end"),
    ("[5~", "pageup"), ("[6~", "pagedown"), ("[7~", "home"), ("[8~", "end"),
    ("[11~", "f1"), ("[12~", "f2"), ("[13~", "f3"), ("[14~", "f4"), ("[15~", "f5"),
    ("[17~", "f6"), ("[18~", "f7"), ("[19~", "f8"), ("[20~", "f9"), ("[21~", "f10"),
    ("[23~", "f11"), ("[24~", "f12"),
];

fn special_lookup(seq: &str) -> Option<&'static str> {
    SPECIAL.iter().find(|(k, _)| *k == seq).map(|(_, v)| *v)
}

/// Longest match first, so `[1~` never loses to a shorter prefix.
fn special_sorted() -> Vec<(&'static str, &'static str)> {
    let mut v: Vec<(&'static str, &'static str)> = SPECIAL.to_vec();
    v.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    v
}

#[derive(Clone, Copy, Debug, Default)]
struct Modifiers {
    shift: bool,
    alt: bool,
    ctrl: bool,
}

/// xterm modifier parameter: 1 + bitfield(shift=1, alt=2, ctrl=4).
fn decode_modifiers(param: u32) -> Modifiers {
    let bits = param.saturating_sub(1);
    Modifiers { shift: bits & 1 != 0, alt: bits & 2 != 0, ctrl: bits & 4 != 0 }
}

fn key_event(name: &str, mods: Modifiers, ch: Option<&str>, raw: &str) -> KeyEvent {
    let mut parts: Vec<&str> = Vec::new();
    if mods.ctrl {
        parts.push("ctrl");
    }
    if mods.alt {
        parts.push("alt");
    }
    // The reference tests `name.length`, which counts UTF-16 units. It only
    // matters for named keys, which are all ASCII, but matching it exactly
    // costs nothing.
    if mods.shift && name.encode_utf16().count() > 1 {
        parts.push("shift");
    }
    parts.push(name);
    KeyEvent {
        name: name.to_string(),
        ctrl: mods.ctrl,
        alt: mods.alt,
        shift: mods.shift,
        char: ch.map(String::from),
        key: parts.join("+"),
        raw: raw.to_string(),
    }
}

const PASTE_END: &str = "\x1b[201~";
const PASTE_START: &str = "\x1b[200~";

/// Length of the longest suffix of `text` that is a proper prefix of `marker`.
fn partial_suffix(text: &str, marker: &str) -> usize {
    let max = text.len().min(marker.len() - 1);
    for n in (1..=max).rev() {
        if text.is_char_boundary(text.len() - n) && text.ends_with(&marker[..n]) {
            return n;
        }
    }
    0
}

/// Feed it chunks, get events. Stateful, so a sequence split across two reads —
/// routine over SSH — still decodes correctly.
#[derive(Default)]
pub struct InputParser {
    pending: String,
    paste_buffer: Option<String>,
    /// Bytes held back mid-paste because they could be the start of the end
    /// marker. Kept separate from `pending` so they do not look like an
    /// unterminated escape and trip the Escape-key timeout.
    paste_tail: String,
}

impl InputParser {
    pub fn new() -> InputParser {
        InputParser::default()
    }

    /// True when bytes are buffered awaiting the rest of a sequence.
    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    /// Resolve buffered bytes that turned out to be complete after all. A lone
    /// ESC is ambiguous — it only becomes the Escape key once no more bytes
    /// follow — so the terminal calls this on a short timeout.
    pub fn flush(&mut self) -> Vec<InputEvent> {
        // `paste_tail` is deliberately left alone. Folding it into the paste
        // content here destroyed a partial end marker whenever the Escape
        // timeout fired between the two reads carrying it: the rest of the
        // marker then arrived alone, never matched, and the paste could never
        // end — the exact wedge this holdback exists to prevent.
        if self.pending.is_empty() {
            return Vec::new();
        }
        let data = std::mem::take(&mut self.pending);
        if data == "\x1b" {
            return vec![InputEvent::Key(key_event("escape", Modifiers::default(), None, "\x1b"))];
        }
        // An incomplete sequence that never completed: emit ESC and re-parse.
        let mut events =
            vec![InputEvent::Key(key_event("escape", Modifiers::default(), None, "\x1b"))];
        events.extend(self.parse(&data[1..]));
        events
    }

    pub fn parse(&mut self, chunk: &str) -> Vec<InputEvent> {
        let mut events: Vec<InputEvent> = Vec::new();
        let mut data = String::with_capacity(self.pending.len() + self.paste_tail.len() + chunk.len());
        data.push_str(&std::mem::take(&mut self.paste_tail));
        data.push_str(&std::mem::take(&mut self.pending));
        data.push_str(chunk);

        // The reference prepends `pasteTail` to `pending + chunk`; with only one
        // of the two ever set at a time, the order above is the same string.
        let mut rest: &str = &data;

        while !rest.is_empty() {
            if self.paste_buffer.is_some() {
                match rest.find(PASTE_END) {
                    None => {
                        // The end marker can straddle two reads, which is
                        // routine over SSH. Swallowing a partial one here used
                        // to lose it for good: the paste never ended, and every
                        // later keystroke — Ctrl+C included — went into the
                        // buffer instead of being dispatched.
                        let keep = partial_suffix(rest, PASTE_END);
                        let split = rest.len() - keep;
                        self.paste_buffer.as_mut().unwrap().push_str(&rest[..split]);
                        self.paste_tail = rest[split..].to_string();
                        break;
                    }
                    Some(end) => {
                        let mut buffer = self.paste_buffer.take().unwrap();
                        buffer.push_str(&rest[..end]);
                        events.push(InputEvent::Paste(PasteEvent { text: buffer }));
                        rest = &rest[end + PASTE_END.len()..];
                        continue;
                    }
                }
            }

            if !rest.starts_with('\x1b') {
                let consumed = parse_plain(rest, &mut events);
                rest = &rest[consumed..];
                continue;
            }

            // Lone ESC at the end of a chunk: could be the start of a sequence.
            if rest.len() == 1 {
                self.pending = rest.to_string();
                break;
            }

            match self.parse_escape(rest, &mut events) {
                None => {
                    self.pending = rest.to_string(); // incomplete; wait for more
                    break;
                }
                Some(consumed) => rest = &rest[consumed..],
            }
        }
        events
    }

    /// `None` means the sequence is incomplete and more bytes are needed.
    fn parse_escape(&mut self, data: &str, events: &mut Vec<InputEvent>) -> Option<usize> {
        if data.starts_with(PASTE_START) {
            self.paste_buffer = Some(String::new());
            return Some(PASTE_START.len());
        }
        if data.starts_with("\x1b[I") {
            events.push(InputEvent::Focus(FocusEvent { focused: true }));
            return Some(3);
        }
        if data.starts_with("\x1b[O") {
            events.push(InputEvent::Focus(FocusEvent { focused: false }));
            return Some(3);
        }

        // SGR mouse: ESC [ < b ; x ; y (M press | m release)
        if let Some((code, col, row, pressed, len)) = parse_sgr_mouse(data) {
            events.push(InputEvent::Mouse(decode_mouse(code, col, row, pressed)));
            return Some(len);
        }
        if is_partial_mouse(data) {
            return None;
        }

        // CSI with modifier parameters: ESC [ 1 ; 5 A  → ctrl+up
        if let Some((param, final_byte, len)) = parse_modified_csi(data) {
            let base = special_lookup(&format!("[{final_byte}"))
                .or_else(|| special_lookup(&format!("O{final_byte}")));
            if let Some(base) = base {
                events.push(InputEvent::Key(key_event(
                    base,
                    decode_modifiers(param),
                    None,
                    &data[..len],
                )));
                return Some(len);
            }
        }
        if let Some((key_param, mod_param, len)) = parse_modified_tilde(data) {
            if let Some(base) = special_lookup(&format!("[{key_param}~")) {
                events.push(InputEvent::Key(key_event(
                    base,
                    decode_modifiers(mod_param),
                    None,
                    &data[..len],
                )));
                return Some(len);
            }
        }

        // Plain special keys, longest match first.
        for (seq, name) in special_sorted() {
            let full = format!("\x1b{seq}");
            if data.starts_with(&full) {
                if name == "shift+tab" {
                    events.push(InputEvent::Key(key_event(
                        "tab",
                        Modifiers { shift: true, ..Default::default() },
                        None,
                        &full,
                    )));
                } else {
                    events.push(InputEvent::Key(key_event(
                        name,
                        Modifiers::default(),
                        None,
                        &full,
                    )));
                }
                return Some(full.len());
            }
        }

        // Possibly-incomplete CSI/SS3 sequence.
        if is_partial_csi(data) {
            return None;
        }

        // Alt+key.
        let second = data[1..].chars().next();
        if let Some(c) = second {
            if c != '[' && c != 'O' {
                let mut sub: Vec<InputEvent> = Vec::new();
                let consumed = parse_plain(&data[1..], &mut sub);
                if let Some(InputEvent::Key(first)) = sub.first() {
                    events.push(InputEvent::Key(key_event(
                        &first.name,
                        Modifiers { ctrl: first.ctrl, alt: true, shift: first.shift },
                        first.char.as_deref(),
                        &format!("\x1b{}", first.raw),
                    )));
                    return Some(consumed + 1);
                }
            }
        }

        events.push(InputEvent::Key(key_event("escape", Modifiers::default(), None, "\x1b")));
        Some(1)
    }
}

/// Returns the number of bytes consumed.
fn parse_plain(data: &str, events: &mut Vec<InputEvent>) -> usize {
    let c = match data.chars().next() {
        Some(c) => c,
        None => return 0,
    };
    let size = c.len_utf8();
    let ch = &data[..size];
    let cp = c as u32;
    let none = Modifiers::default();

    if cp == 13 || cp == 10 {
        events.push(InputEvent::Key(key_event("enter", none, None, ch)));
    } else if cp == 9 {
        events.push(InputEvent::Key(key_event("tab", none, None, ch)));
    } else if cp == 127 || cp == 8 {
        events.push(InputEvent::Key(key_event("backspace", none, None, ch)));
    } else if cp == 32 {
        events.push(InputEvent::Key(key_event("space", none, Some(" "), ch)));
    } else if cp < 32 {
        // Ctrl+letter arrives as the control code itself.
        let letter = char::from_u32(cp + 96).unwrap_or('?').to_string();
        events.push(InputEvent::Key(key_event(
            &letter,
            Modifiers { ctrl: true, ..Default::default() },
            None,
            ch,
        )));
    } else {
        events.push(InputEvent::Key(key_event(ch, none, Some(ch), ch)));
    }
    size
}

fn decode_mouse(code: u32, col: u32, row: u32, pressed: bool) -> MouseEvent {
    let shift = code & 4 != 0;
    let alt = code & 8 != 0;
    let ctrl = code & 16 != 0;
    let motion = code & 32 != 0;
    let is_scroll = code & 64 != 0;
    let button_bits = code & 3;

    let button_of = |bits: u32| match bits {
        0 => MouseButton::Left,
        1 => MouseButton::Middle,
        2 => MouseButton::Right,
        _ => MouseButton::None,
    };

    let (action, button, scroll) = if is_scroll {
        (MouseAction::Scroll, MouseButton::None, if button_bits == 0 { -1 } else { 1 })
    } else if motion {
        (
            if button_bits == 3 { MouseAction::Move } else { MouseAction::Drag },
            button_of(button_bits),
            0,
        )
    } else {
        (
            if pressed { MouseAction::Press } else { MouseAction::Release },
            button_of(button_bits),
            0,
        )
    };

    MouseEvent {
        action,
        button,
        x: col.saturating_sub(1) as usize,
        y: row.saturating_sub(1) as usize,
        scroll,
        ctrl,
        alt,
        shift,
    }
}

/// `^\x1b\[<(\d+);(\d+);(\d+)([Mm])`
fn parse_sgr_mouse(data: &str) -> Option<(u32, u32, u32, bool, usize)> {
    let rest = data.strip_prefix("\x1b[<")?;
    let mut i = 0usize;
    let bytes = rest.as_bytes();
    let number = |i: &mut usize| -> Option<u32> {
        let start = *i;
        while *i < bytes.len() && bytes[*i].is_ascii_digit() {
            *i += 1;
        }
        if *i == start {
            return None;
        }
        rest[start..*i].parse().ok()
    };
    let a = number(&mut i)?;
    if bytes.get(i) != Some(&b';') {
        return None;
    }
    i += 1;
    let b = number(&mut i)?;
    if bytes.get(i) != Some(&b';') {
        return None;
    }
    i += 1;
    let c = number(&mut i)?;
    let final_byte = *bytes.get(i)?;
    if final_byte != b'M' && final_byte != b'm' {
        return None;
    }
    i += 1;
    Some((a, b, c, final_byte == b'M', 3 + i))
}

/// `^\x1b\[<[\d;]*$` — a mouse report cut off mid-sequence.
fn is_partial_mouse(data: &str) -> bool {
    match data.strip_prefix("\x1b[<") {
        Some(rest) => rest.bytes().all(|b| b.is_ascii_digit() || b == b';'),
        None => false,
    }
}

/// `^\x1b\[1;(\d+)([A-HPQRS])`
fn parse_modified_csi(data: &str) -> Option<(u32, char, usize)> {
    let rest = data.strip_prefix("\x1b[1;")?;
    let bytes = rest.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 {
        return None;
    }
    let param: u32 = rest[..i].parse().ok()?;
    let final_byte = *bytes.get(i)? as char;
    if !matches!(final_byte, 'A'..='H' | 'P' | 'Q' | 'R' | 'S') {
        return None;
    }
    Some((param, final_byte, 4 + i + 1))
}

/// `^\x1b\[(\d+);(\d+)~`
fn parse_modified_tilde(data: &str) -> Option<(u32, u32, usize)> {
    let rest = data.strip_prefix("\x1b[")?;
    let bytes = rest.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 {
        return None;
    }
    let key: u32 = rest[..i].parse().ok()?;
    if bytes.get(i) != Some(&b';') {
        return None;
    }
    i += 1;
    let start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == start {
        return None;
    }
    let modifier: u32 = rest[start..i].parse().ok()?;
    if bytes.get(i) != Some(&b'~') {
        return None;
    }
    Some((key, modifier, 2 + i + 1))
}

/// `^\x1b(\[|O)[\d;<]*$` — a CSI or SS3 sequence with no final byte yet.
fn is_partial_csi(data: &str) -> bool {
    let rest = match data.strip_prefix("\x1b[").or_else(|| data.strip_prefix("\x1bO")) {
        Some(r) => r,
        None => return false,
    };
    rest.bytes().all(|b| b.is_ascii_digit() || b == b';' || b == b'<')
}

/// Does this event match a binding like `"ctrl+c"`, `"q"`, or `"f10"`?
pub fn match_key(event: &KeyEvent, binding: &str) -> bool {
    let b = binding.trim().to_lowercase();
    if event.key.to_lowercase() == b {
        return true;
    }
    // A bare name matches whatever the shift state. Rejecting shift here was
    // justified by Tab focus firing both ways at once, which was simply wrong —
    // `App` reads the name directly and never calls this — and it silently
    // stopped every shifted named key (shift+up, shift+home, shift+f1, …) from
    // matching its own name. Bind "shift+tab" to distinguish; `key` carries it.
    event.name.to_lowercase() == b && !event.ctrl && !event.alt
}
