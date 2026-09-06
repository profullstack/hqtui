//! Fixture loading for the conformance suite.
//!
//! The crate has no dependencies and the tests keep it that way, so this is a
//! small read-only JSON parser rather than serde. It handles exactly what the
//! fixtures contain — including `\uXXXX` escapes and surrogate pairs, which is
//! how every emoji and escape byte in them is spelled.

#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(BTreeMap<String, Json>),
}

impl Json {
    pub fn get(&self, key: &str) -> &Json {
        match self {
            Json::Obj(map) => map.get(key).unwrap_or(&Json::Null),
            _ => &Json::Null,
        }
    }

    pub fn opt(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(map) => map.get(key).filter(|v| **v != Json::Null),
            _ => None,
        }
    }

    pub fn at(&self, index: usize) -> &Json {
        match self {
            Json::Arr(items) => items.get(index).unwrap_or(&Json::Null),
            _ => &Json::Null,
        }
    }

    pub fn arr(&self) -> &[Json] {
        match self {
            Json::Arr(items) => items,
            _ => &[],
        }
    }

    pub fn is_null(&self) -> bool {
        *self == Json::Null
    }

    pub fn f64(&self) -> f64 {
        match self {
            Json::Num(n) => *n,
            _ => panic!("expected a number, found {self:?}"),
        }
    }

    pub fn u32(&self) -> u32 {
        self.f64() as i64 as u32
    }

    pub fn u64(&self) -> u64 {
        self.f64() as u64
    }

    pub fn usize(&self) -> usize {
        self.f64() as i64 as usize
    }

    pub fn i64(&self) -> i64 {
        self.f64() as i64
    }

    pub fn str(&self) -> &str {
        match self {
            Json::Str(s) => s,
            _ => panic!("expected a string, found {self:?}"),
        }
    }

    pub fn bool(&self) -> bool {
        match self {
            Json::Bool(b) => *b,
            _ => panic!("expected a bool, found {self:?}"),
        }
    }

    /// `Number.isFinite` is false for the values JSON writes as `null`, which is
    /// how the fixtures carry NaN and the infinities.
    pub fn f64_or_nan(&self) -> f64 {
        match self {
            Json::Num(n) => *n,
            _ => f64::NAN,
        }
    }
}

pub fn fixture(name: &str) -> Json {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "conformance",
        "fixtures",
        &format!("{name}.json"),
    ]
    .iter()
    .collect();
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    parse(&text).unwrap_or_else(|e| panic!("cannot parse {}: {e}", path.display()))
}

pub fn parse(text: &str) -> Result<Json, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut p = Parser { chars: &chars, i: 0 };
    p.skip_ws();
    let value = p.value()?;
    p.skip_ws();
    if p.i != p.chars.len() {
        return Err(format!("trailing input at {}", p.i));
    }
    Ok(value)
}

struct Parser<'a> {
    chars: &'a [char],
    i: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.i).copied()
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t' | '\n' | '\r')) {
            self.i += 1;
        }
    }

    fn expect(&mut self, c: char) -> Result<(), String> {
        if self.peek() == Some(c) {
            self.i += 1;
            Ok(())
        } else {
            Err(format!("expected {c:?} at {}, found {:?}", self.i, self.peek()))
        }
    }

    fn literal(&mut self, word: &str) -> Result<(), String> {
        for c in word.chars() {
            self.expect(c)?;
        }
        Ok(())
    }

    fn value(&mut self) -> Result<Json, String> {
        match self.peek() {
            Some('{') => self.object(),
            Some('[') => self.array(),
            Some('"') => Ok(Json::Str(self.string()?)),
            Some('t') => {
                self.literal("true")?;
                Ok(Json::Bool(true))
            }
            Some('f') => {
                self.literal("false")?;
                Ok(Json::Bool(false))
            }
            Some('n') => {
                self.literal("null")?;
                Ok(Json::Null)
            }
            Some(_) => self.number(),
            None => Err("unexpected end of input".into()),
        }
    }

    fn object(&mut self) -> Result<Json, String> {
        self.expect('{')?;
        let mut map = BTreeMap::new();
        self.skip_ws();
        if self.peek() == Some('}') {
            self.i += 1;
            return Ok(Json::Obj(map));
        }
        loop {
            self.skip_ws();
            let key = self.string()?;
            self.skip_ws();
            self.expect(':')?;
            self.skip_ws();
            map.insert(key, self.value()?);
            self.skip_ws();
            match self.peek() {
                Some(',') => self.i += 1,
                Some('}') => {
                    self.i += 1;
                    return Ok(Json::Obj(map));
                }
                other => return Err(format!("expected , or }} at {}, found {other:?}", self.i)),
            }
        }
    }

    fn array(&mut self) -> Result<Json, String> {
        self.expect('[')?;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(']') {
            self.i += 1;
            return Ok(Json::Arr(items));
        }
        loop {
            self.skip_ws();
            items.push(self.value()?);
            self.skip_ws();
            match self.peek() {
                Some(',') => self.i += 1,
                Some(']') => {
                    self.i += 1;
                    return Ok(Json::Arr(items));
                }
                other => return Err(format!("expected , or ] at {}, found {other:?}", self.i)),
            }
        }
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect('"')?;
        let mut out = String::new();
        loop {
            let c = self.peek().ok_or("unterminated string")?;
            self.i += 1;
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let esc = self.peek().ok_or("unterminated escape")?;
                    self.i += 1;
                    match esc {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let hi = self.hex4()?;
                            // A surrogate pair is two escapes; anything else
                            // that lands in the surrogate range is a lone half
                            // and becomes U+FFFD, which is what a Rust string
                            // can represent.
                            if (0xd800..0xdc00).contains(&hi) {
                                if self.peek() == Some('\\')
                                    && self.chars.get(self.i + 1) == Some(&'u')
                                {
                                    self.i += 2;
                                    let lo = self.hex4()?;
                                    if (0xdc00..0xe000).contains(&lo) {
                                        let cp =
                                            0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
                                        out.push(char::from_u32(cp).unwrap_or('\u{fffd}'));
                                    } else {
                                        out.push('\u{fffd}');
                                        out.push(char::from_u32(lo).unwrap_or('\u{fffd}'));
                                    }
                                } else {
                                    out.push('\u{fffd}');
                                }
                            } else {
                                out.push(char::from_u32(hi).unwrap_or('\u{fffd}'));
                            }
                        }
                        other => return Err(format!("bad escape \\{other}")),
                    }
                }
                _ => out.push(c),
            }
        }
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let mut v = 0u32;
        for _ in 0..4 {
            let c = self.peek().ok_or("short \\u escape")?;
            self.i += 1;
            v = v * 16 + c.to_digit(16).ok_or_else(|| format!("bad hex digit {c:?}"))?;
        }
        Ok(v)
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.i;
        if self.peek() == Some('-') {
            self.i += 1;
        }
        while matches!(self.peek(), Some('0'..='9' | '.' | 'e' | 'E' | '+' | '-')) {
            self.i += 1;
        }
        let text: String = self.chars[start..self.i].iter().collect();
        text.parse::<f64>().map(Json::Num).map_err(|e| format!("bad number {text:?}: {e}"))
    }
}

/// Decode a run-length encoded plane, `[[count, value], …]`, into a flat vector.
pub fn decode_rle(plane: &Json) -> Vec<u32> {
    let mut out = Vec::new();
    for run in plane.arr() {
        let count = run.at(0).usize();
        let value = run.at(1).u32();
        out.extend(std::iter::repeat(value).take(count));
    }
    out
}

// ------------------------------------------------- shared fixture decoding

use std::cell::RefCell;
use std::rc::Rc;

use hqtui::buffer::{Attrs, FrameBuffer, Style};
use hqtui::color::Color;
use hqtui::layout::{Constraint, Padding, Rect, Size};
use hqtui::surface::{SharedBuffer, Surface};
use hqtui::theme;
use hqtui::unicode::{self, Align};

pub fn color(v: &Json) -> Color {
    Color::from_raw(v.u32())
}

pub fn rect(v: &Json) -> Rect {
    Rect {
        x: v.get("x").i64() as isize,
        y: v.get("y").i64() as isize,
        width: v.get("width").usize(),
        height: v.get("height").usize(),
    }
}

pub fn align(v: &Json) -> Align {
    match v.str() {
        "right" => Align::Right,
        "center" => Align::Center,
        _ => Align::Left,
    }
}

pub fn constraint(v: &Json) -> Constraint {
    let size = match v.opt("size") {
        Some(Json::Num(n)) => Some(Size::Cells(*n as i64)),
        Some(Json::Str(s)) => Some(Size::parse(s)),
        _ => None,
    };
    Constraint {
        size,
        min: v.opt("min").map(|m| m.usize()),
        max: v.opt("max").map(|m| m.usize()),
        intrinsic: v.opt("intrinsic").map(|m| m.usize()),
    }
}

pub fn padding(v: &Json) -> Padding {
    match v {
        Json::Num(n) => Padding::All(*n as usize),
        Json::Arr(items) if items.len() == 2 => Padding::Axes(items[0].usize(), items[1].usize()),
        Json::Arr(items) => Padding::Sides(
            items[0].usize(),
            items[1].usize(),
            items[2].usize(),
            items[3].usize(),
        ),
        other => panic!("unexpected padding {other:?}"),
    }
}

pub fn style_of(op: &Json) -> Style {
    Style {
        fg: op.opt("fg").map(color),
        bg: op.opt("bg").map(color),
        attrs: op.opt("attrs").map(|a| Attrs::from_bits(a.u32() as u16)),
    }
}

pub fn apply_ops(buffer: &mut FrameBuffer, ops: &[Json]) {
    for op in ops {
        let style = style_of(op);
        // Read lazily: `clear` carries no coordinates at all.
        let x = || op.get("x").i64() as isize;
        let y = || op.get("y").i64() as isize;
        match op.get("op").str() {
            "write" => {
                let max = op.opt("maxWidth").map(|m| m.usize()).unwrap_or(usize::MAX);
                buffer.write_capped(x(), y(), op.get("text").str(), &style, max);
            }
            "setCell" => {
                buffer.set_cell(x(), y(), op.get("value").u32(), &style);
            }
            "fillRect" => buffer.fill_rect(
                x(),
                y(),
                op.get("w").usize(),
                op.get("h").usize(),
                op.get("ch").u32(),
                &style,
            ),
            "styleRect" => {
                buffer.style_rect(x(), y(), op.get("w").usize(), op.get("h").usize(), &style)
            }
            "clear" => buffer.clear(
                op.opt("bg").map(color).unwrap_or(Color::DEFAULT),
                op.opt("fg").map(color).unwrap_or(Color::DEFAULT),
            ),
            other => panic!("unknown buffer op {other:?}"),
        }
    }
}

/// A framebuffer plus a root surface over it, cleared to the theme the way the
/// renderer does before any widget draws.
pub fn scene(width: usize, height: usize, theme_name: &str) -> (SharedBuffer, Surface) {
    let theme = Rc::new(theme::resolve_theme(theme_name));
    let buffer = Rc::new(RefCell::new(FrameBuffer::new(width, height)));
    buffer.borrow_mut().clear(theme.background, theme.foreground);
    let surface = Surface::root(buffer.clone(), theme);
    (buffer, surface)
}

/// Compare a rendered buffer against a fixture's run-length encoded planes.
pub fn assert_buffer(buffer: &FrameBuffer, want: &Json, what: &str) {
    assert_eq!(buffer.width, want.get("width").usize(), "{what}: width");
    assert_eq!(buffer.height, want.get("height").usize(), "{what}: height");

    let n = buffer.width * buffer.height;
    let chars = decode_rle(want.get("chars"));
    let fg = decode_rle(want.get("fg"));
    let bg = decode_rle(want.get("bg"));
    let attrs = decode_rle(want.get("attrs"));
    assert_eq!(chars.len(), n, "{what}: fixture cell count");

    // Text first: when a port drifts, the row text says *what* is wrong in one
    // line, where a cell index only says where.
    let want_text: Vec<&str> = want.get("text").arr().iter().map(|v| v.str()).collect();
    for y in 0..buffer.height {
        assert_eq!(buffer.row_text(y), want_text[y], "{what}: row {y}");
    }

    // A cluster's cell value indexes the interning process's own table, so the
    // fixture renumbers them by first appearance. Rebuild the same numbering
    // here, and check the cluster texts line up too.
    let want_clusters: Vec<&str> = want.get("clusters").arr().iter().map(|v| v.str()).collect();
    let mut local: Vec<u32> = Vec::new();
    let mut renumber = |value: u32| -> u32 {
        if value < unicode::CLUSTER_BASE || value == unicode::CONTINUATION {
            return value;
        }
        let index = local.iter().position(|&v| v == value).unwrap_or_else(|| {
            local.push(value);
            local.len() - 1
        });
        unicode::CLUSTER_BASE + index as u32
    };

    for i in 0..n {
        let (x, y) = (i % buffer.width, i / buffer.width);
        assert_eq!(renumber(buffer.chars[i]), chars[i], "{what}: char at {x},{y}");
        assert_eq!(buffer.fg[i].raw(), fg[i], "{what}: fg at {x},{y}");
        assert_eq!(buffer.bg[i].raw(), bg[i], "{what}: bg at {x},{y}");
        assert_eq!(buffer.attrs[i].bits() as u32, attrs[i], "{what}: attrs at {x},{y}");
    }

    assert_eq!(local.len(), want_clusters.len(), "{what}: cluster count");
    for (i, &value) in local.iter().enumerate() {
        assert_eq!(unicode::cell_text(value), want_clusters[i], "{what}: cluster {i} text");
    }
}
