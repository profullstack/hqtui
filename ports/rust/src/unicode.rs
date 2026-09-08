//! Terminal text is a grid of columns, not a string. Getting width wrong
//! corrupts every cell to the right of the mistake, so width lives behind this
//! one module.
//!
//! One difference from the TypeScript reference is worth stating plainly: a
//! Rust `&str` is always valid UTF-8, so the unpaired-surrogate handling the
//! reference needs cannot arise here. Everything else — the width tables, the
//! cluster rules, the unsafe-codepoint policy — is identical, and the
//! conformance suite checks it.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

/// A cell's contents: a bare codepoint, or an index into the cluster table.
pub type Cell = u32;

/// Values at or above this are indices into the cluster table, not codepoints.
pub const CLUSTER_BASE: u32 = 0x11_0000;
/// Written into the cell after a double-width character. Never drawn.
pub const CONTINUATION: u32 = 0xffff_ffff;
/// What an unrepresentable codepoint is shown as: one column, cannot fuse.
pub const REPLACEMENT: u32 = 0xfffd;

/// C0, DEL and C1. A cell holding one of these would be written straight back
/// out by the encoder, so untrusted text could steer the terminal instead of
/// filling a cell.
pub const fn is_control(cp: u32) -> bool {
    cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)
}

/// Bidi overrides, embeddings and isolates: the Trojan Source set
/// (CVE-2021-42574). They emit no glyph but reorder everything around them, so
/// `user<RLO>nimda` reads as `user admin` in a log pane. Directional *marks*
/// (LRM/RLM) and real RTL script are left alone — those render honestly.
pub const fn is_bidi_control(cp: u32) -> bool {
    (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)
}

/// Anything that must never occupy a cell: it steers rather than draws.
///
/// This runs per cell on the write path and per codepoint on the measure path,
/// so it is one small branch ladder rather than two calls. Printable ASCII —
/// overwhelmingly the common case — exits on the second comparison.
pub const fn is_unsafe_codepoint(cp: u32) -> bool {
    if cp < 0x20 {
        return true;
    }
    if cp < 0x7f {
        return false;
    }
    if cp <= 0x9f {
        return true;
    }
    if cp < 0x202a || cp > 0x2069 {
        return false;
    }
    cp <= 0x202e || cp >= 0x2066
}

/// Strip everything that steers the terminal rather than drawing.
pub fn strip_unsafe(text: &str) -> String {
    text.chars().filter(|c| !is_unsafe_codepoint(*c as u32)).collect()
}

/// A cell may hold at most this many codepoints. Real ZWJ emoji top out around
/// ten; anything longer is a byte-amplification bomb, because the cell still
/// claims one column while painting hundreds.
const MAX_CLUSTER_CODEPOINTS: usize = 16;

/// Distinct clusters are interned for the life of the process — a cell holds an
/// index into this table, so entries can never be evicted while a framebuffer
/// might still reference them. Untrusted text must therefore not be able to
/// grow it without bound.
///
/// Past this many, `intern_cluster` degrades to the base codepoint: the
/// combining marks or emoji joins are dropped, but the cell keeps the correct
/// width, so the grid stays in step with the screen.
const MAX_CLUSTERS: usize = 32768;

#[derive(Default)]
struct ClusterTable {
    texts: Vec<String>,
    ids: HashMap<String, u32>,
}

fn clusters() -> &'static RwLock<ClusterTable> {
    static TABLE: OnceLock<RwLock<ClusterTable>> = OnceLock::new();
    TABLE.get_or_init(|| RwLock::new(ClusterTable::default()))
}

/// Intern a multi-codepoint grapheme (emoji, combining sequence) into one cell
/// value. Unsafe codepoints are stripped here as well as in `graphemes`, so no
/// caller — including one outside this module — can smuggle one into a cell.
pub fn intern_cluster(text: &str) -> Cell {
    let safe = strip_unsafe(text);
    let safe = if safe.is_empty() { " ".to_string() } else { safe };

    if let Some(id) = clusters().read().unwrap().ids.get(&safe) {
        return *id;
    }
    let mut table = clusters().write().unwrap();
    // Another thread may have interned it between the two locks.
    if let Some(id) = table.ids.get(&safe) {
        return *id;
    }
    if table.texts.len() >= MAX_CLUSTERS {
        // Degrade to the base character rather than grow the table for ever.
        let first = safe.chars().next().map(|c| c as u32).unwrap_or(32);
        return if char_width(first) > 0 { first } else { 32 };
    }
    let id = CLUSTER_BASE + table.texts.len() as u32;
    table.texts.push(safe.clone());
    table.ids.insert(safe, id);
    id
}

pub fn cluster_text(value: Cell) -> String {
    clusters()
        .read()
        .unwrap()
        .texts
        .get((value - CLUSTER_BASE) as usize)
        .cloned()
        .unwrap_or_else(|| " ".to_string())
}

/// Render a cell value back to the text the terminal should receive.
pub fn cell_text(value: Cell) -> String {
    if value >= CLUSTER_BASE && value != CONTINUATION {
        return cluster_text(value);
    }
    if value == 0 || value == CONTINUATION {
        return " ".to_string();
    }
    char::from_u32(value).map(String::from).unwrap_or_else(|| " ".to_string())
}

type Range = (u32, u32);

// Zero-width: combining marks, variation selectors, ZWJ, most format controls.
const ZERO_WIDTH: &[Range] = &[
    (0x0300, 0x036f), (0x0483, 0x0489), (0x0591, 0x05bd), (0x0610, 0x061a),
    (0x064b, 0x065f), (0x0670, 0x0670), (0x06d6, 0x06dc), (0x0730, 0x074a),
    (0x07a6, 0x07b0), (0x0816, 0x0819), (0x08e3, 0x0903), (0x093a, 0x093c),
    (0x0951, 0x0957), (0x0e31, 0x0e31), (0x0e34, 0x0e3a), (0x0eb1, 0x0eb1),
    (0x1ab0, 0x1aff), (0x1dc0, 0x1dff), (0x200b, 0x200f), (0x2028, 0x202e),
    (0x2060, 0x2064), (0x2066, 0x2069), (0x20d0, 0x20f0), (0xfe00, 0xfe0f),
    (0xfe20, 0xfe2f),
    (0xfeff, 0xfeff), (0xe0100, 0xe01ef),
];

// Double-width: East Asian Wide/Fullwidth plus the emoji blocks terminals widen.
const WIDE: &[Range] = &[
    (0x1100, 0x115f), (0x2e80, 0x303e), (0x3041, 0x33ff), (0x3400, 0x4dbf),
    (0x4e00, 0x9fff), (0xa000, 0xa4cf), (0xa960, 0xa97f), (0xac00, 0xd7a3),
    (0xf900, 0xfaff), (0xfe10, 0xfe19), (0xfe30, 0xfe6f), (0xff00, 0xff60),
    (0xffe0, 0xffe6), (0x1f004, 0x1f004), (0x1f0cf, 0x1f0cf), (0x1f18e, 0x1f18e),
    (0x1f191, 0x1f19a), (0x1f200, 0x1f320), (0x1f32d, 0x1f335), (0x1f337, 0x1f37c),
    (0x1f37e, 0x1f393), (0x1f3a0, 0x1f3ca), (0x1f3cf, 0x1f3d3), (0x1f3e0, 0x1f3f0),
    (0x1f3f4, 0x1f3f4), (0x1f3f8, 0x1f43e), (0x1f440, 0x1f440), (0x1f442, 0x1f4fc),
    (0x1f4ff, 0x1f53d), (0x1f54b, 0x1f54e), (0x1f550, 0x1f567), (0x1f57a, 0x1f57a),
    (0x1f595, 0x1f596), (0x1f5a4, 0x1f5a4), (0x1f5fb, 0x1f64f), (0x1f680, 0x1f6c5),
    (0x1f6cc, 0x1f6cc), (0x1f6d0, 0x1f6d2), (0x1f6eb, 0x1f6ec), (0x1f910, 0x1f9ff),
    (0x20000, 0x2fffd), (0x30000, 0x3fffd),
];

// Extended_Pictographic, approximated to the ranges terminals actually join.
// ZWJ only glues emoji together; joining it to arbitrary text is how one cell
// ends up painting hundreds of columns.
const PICTOGRAPHIC: &[Range] = &[
    (0x00a9, 0x00a9), (0x00ae, 0x00ae), (0x203c, 0x203c), (0x2049, 0x2049),
    (0x2122, 0x2122), (0x2139, 0x2139), (0x2194, 0x21aa), (0x231a, 0x23fa),
    (0x24c2, 0x24c2), (0x25aa, 0x25fe), (0x2600, 0x27bf), (0x2934, 0x2935),
    (0x2b00, 0x2bff), (0x3030, 0x3030), (0x303d, 0x303d), (0x3297, 0x3299),
    (0x1f000, 0x1faff), (0x1fc00, 0x1fffd),
];

fn in_ranges(cp: u32, ranges: &[Range]) -> bool {
    let mut lo = 0i64;
    let mut hi = ranges.len() as i64 - 1;
    while lo <= hi {
        let mid = ((lo + hi) / 2) as usize;
        let (a, b) = ranges[mid];
        if cp < a {
            hi = mid as i64 - 1;
        } else if cp > b {
            lo = mid as i64 + 1;
        } else {
            return true;
        }
    }
    false
}

/// Columns a single codepoint occupies: 0, 1, or 2.
pub fn char_width(cp: u32) -> usize {
    if cp == 0 {
        return 0;
    }
    if cp < 32 || (cp >= 0x7f && cp < 0xa0) {
        return 0;
    }
    if cp < 0x300 {
        return 1;
    }
    if in_ranges(cp, ZERO_WIDTH) {
        return 0;
    }
    if in_ranges(cp, WIDE) {
        return 2;
    }
    1
}

/// Columns a cell value occupies (handles interned clusters).
pub fn cell_width(value: Cell) -> usize {
    if value == CONTINUATION {
        return 0;
    }
    if value >= CLUSTER_BASE {
        let text = cluster_text(value);
        let first = text.chars().next().map(|c| c as u32).unwrap_or(32);
        return if char_width(first) == 2 { 2 } else { 1 };
    }
    char_width(value)
}

const ZWJ: u32 = 0x200d;

/// One terminal cell's worth of text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Grapheme {
    /// Cell value: a bare codepoint, or an interned cluster id.
    pub value: Cell,
    pub width: usize,
}

/// Split text into terminal cells. Combining marks, variation selectors and
/// ZWJ sequences attach to the base character instead of stealing a column.
pub fn graphemes(text: &str) -> Vec<Grapheme> {
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < text.len() {
        let cp = match text[i..].chars().next() {
            Some(c) => c,
            None => break,
        };
        let mut size = cp.len_utf8();
        let width = char_width(cp as u32);

        // An unsafe codepoint never reaches a cell: it would otherwise be
        // absorbed into the previous grapheme exactly like a combining mark and
        // re-emitted verbatim — escape injection. Every unsafe codepoint is
        // zero-width, so testing the width first means printable text never
        // pays for this check.
        if width == 0 && is_unsafe_codepoint(cp as u32) {
            i += size;
            continue;
        }

        // A cell paints one column but may hold several codepoints; cap how
        // many, so no input makes a single cell emit an unbounded run of glyphs.
        let mut cluster_end: Option<usize> = None;
        let mut parts = 1usize;
        loop {
            if parts >= MAX_CLUSTER_CODEPOINTS {
                break;
            }
            let next = match text[i + size..].chars().next() {
                Some(c) => c,
                None => break,
            };
            let nsize = next.len_utf8();
            if next as u32 == ZWJ {
                let after = match text[i + size + nsize..].chars().next() {
                    Some(c) => c,
                    None => break,
                };
                // ZWJ joins emoji, and nothing else. Joining it to arbitrary
                // text lets one cell claim a single column while painting
                // hundreds of them.
                if !in_ranges(cp as u32, PICTOGRAPHIC) || !in_ranges(after as u32, PICTOGRAPHIC) {
                    break;
                }
                size += nsize + after.len_utf8();
                cluster_end = Some(i + size);
                parts += 2;
                continue;
            }
            if char_width(next as u32) != 0 {
                break;
            }
            // Leave anything unsafe to the outer loop, which drops it.
            if is_unsafe_codepoint(next as u32) {
                break;
            }
            size += nsize;
            cluster_end = Some(i + size);
            parts += 1;
        }

        if width == 0 {
            // A zero-width base: a combining mark with nothing to combine with,
            // or a stray ZWJ. It paints no column, so handing it one would walk
            // the cursor ahead of the screen. Drop it, and anything it absorbed.
        } else if let Some(end) = cluster_end {
            out.push(Grapheme { value: intern_cluster(&text[i..end]), width });
        } else {
            out.push(Grapheme { value: cp as u32, width });
        }
        i += size;
    }
    out
}

/// Display width of a string in terminal columns.
pub fn string_width(text: &str) -> usize {
    graphemes(text).iter().map(|g| g.width).sum()
}

/// Truncate to `max` columns, appending an ellipsis when it does not fit.
/// `text` with its first `columns` display columns removed.
///
/// For scrolling a line sideways. Slicing by bytes would cut inside a grapheme
/// and corrupt it, and a scroll that lands in the middle of a wide character
/// cannot draw half of it -- what is left of that character is a space, which
/// is what a terminal shows when a double-width cell is clipped.
pub fn drop_columns(text: &str, columns: usize) -> String {
    if columns == 0 {
        return text.to_string();
    }
    let mut out = String::new();
    let mut skipped = 0usize;
    for g in graphemes(text) {
        if skipped >= columns {
            out.push_str(&cell_text(g.value));
            continue;
        }
        skipped += g.width;
        // A wide character straddling the cut leaves its trailing half behind.
        if skipped > columns {
            out.push_str(&" ".repeat(skipped - columns));
        }
    }
    out
}

pub fn truncate(text: &str, max: usize) -> String {
    truncate_with(text, max, "…")
}

pub fn truncate_with(text: &str, max: usize, ellipsis: &str) -> String {
    if max == 0 {
        return String::new();
    }
    if string_width(text) <= max {
        return text.to_string();
    }
    let limit = max.saturating_sub(string_width(ellipsis));
    let mut out = String::new();
    let mut w = 0usize;
    for g in graphemes(text) {
        if w + g.width > limit {
            break;
        }
        out.push_str(&cell_text(g.value));
        w += g.width;
    }
    out.push_str(ellipsis);
    out
}

/// Horizontal placement within a fixed width.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Align {
    #[default]
    Left,
    Center,
    Right,
}

/// Pad or truncate to exactly `width` columns.
pub fn fit(text: &str, width: usize, align: Align) -> String {
    let t = truncate(text, width);
    let pad = width.saturating_sub(string_width(&t));
    if pad == 0 {
        return t;
    }
    match align {
        Align::Right => format!("{}{}", " ".repeat(pad), t),
        Align::Center => {
            let l = pad / 2;
            format!("{}{}{}", " ".repeat(l), t, " ".repeat(pad - l))
        }
        Align::Left => format!("{}{}", t, " ".repeat(pad)),
    }
}

/// Greedy word wrap at `width` columns.
pub fn wrap(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return Vec::new();
    }
    let mut lines = Vec::new();
    for paragraph in text.split('\n') {
        let mut line = String::new();
        let mut line_w = 0usize;
        for word in split_keeping_whitespace(paragraph) {
            if word.is_empty() {
                continue;
            }
            let w = string_width(word);
            if line_w + w > width && line_w > 0 {
                lines.push(line.trim_end().to_string());
                line = String::new();
                line_w = 0;
                if word.chars().all(char::is_whitespace) {
                    continue;
                }
            }
            if w > width {
                // A single word longer than the line: hard-split it.
                for g in graphemes(word) {
                    if line_w + g.width > width {
                        lines.push(line.clone());
                        line = String::new();
                        line_w = 0;
                    }
                    line.push_str(&cell_text(g.value));
                    line_w += g.width;
                }
                continue;
            }
            line.push_str(word);
            line_w += w;
        }
        lines.push(line.trim_end().to_string());
    }
    lines
}

/// `String.prototype.split(/(\s+)/)`: the separators are kept as their own
/// entries, which is what makes the wrap above preserve interior spacing.
fn split_keeping_whitespace(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut in_space: Option<bool> = None;
    for (i, c) in text.char_indices() {
        let space = c.is_whitespace();
        match in_space {
            None => in_space = Some(space),
            Some(prev) if prev != space => {
                out.push(&text[start..i]);
                start = i;
                in_space = Some(space);
            }
            _ => {}
        }
    }
    if start < text.len() || text.is_empty() {
        out.push(&text[start..]);
    }
    out
}
