//! Colors are packed into a single 32-bit integer so a cell never needs an
//! allocation.
//!
//! ```text
//! 0                       -> "terminal default"
//! 0x1000000 | 0xRRGGBB    -> truecolor
//! 0x2000000 | index       -> explicit 256-colour palette index
//! ```

/// A packed terminal color. `Color::DEFAULT` means "whatever the terminal uses".
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub struct Color(u32);

const RGB_FLAG: u32 = 0x100_0000;
const IDX_FLAG: u32 = 0x200_0000;

impl Color {
    /// The terminal's own foreground/background. Never emitted as an SGR color.
    pub const DEFAULT: Color = Color(0);

    /// Truecolor from 0-255 components. Values outside the range wrap, matching
    /// the reference implementation's `& 255`.
    pub const fn rgb(r: u8, g: u8, b: u8) -> Color {
        Color(RGB_FLAG | ((r as u32) << 16) | ((g as u32) << 8) | b as u32)
    }

    /// `Color::hex_str("#00d7ff")` or `Color::hex_str("#0df")`.
    ///
    /// Anything unparseable becomes black rather than an error: a color is
    /// cosmetic, and a theme that fails to load is worse than one that is wrong.
    pub fn hex_str(value: &str) -> Color {
        let s = value.trim().trim_start_matches('#');
        let expanded;
        let digits = if s.len() == 3 {
            expanded = s.chars().flat_map(|c| [c, c]).collect::<String>();
            expanded.as_str()
        } else {
            s
        };
        Color(RGB_FLAG | (u32::from_str_radix(digits, 16).unwrap_or(0) & 0xff_ffff))
    }

    /// `Color::hex(0x00d7ff)`. Const, so themes can be built at compile time.
    pub const fn hex(value: u32) -> Color {
        Color(RGB_FLAG | (value & 0xff_ffff))
    }

    /// An explicit xterm-256 palette entry. Rarely needed; truecolor is
    /// quantized for you when the terminal cannot do better.
    pub const fn ansi256(index: u8) -> Color {
        Color(IDX_FLAG | index as u32)
    }

    /// The packed representation, for serialisation and conformance tests.
    pub const fn raw(self) -> u32 {
        self.0
    }

    /// Rebuild from a packed value. Used when decoding a saved buffer.
    pub const fn from_raw(raw: u32) -> Color {
        Color(raw)
    }

    pub const fn is_default(self) -> bool {
        self.0 == 0
    }

    const fn is_indexed(self) -> bool {
        self.0 & IDX_FLAG != 0
    }

    pub const fn red(self) -> u8 {
        ((self.0 >> 16) & 255) as u8
    }

    pub const fn green(self) -> u8 {
        ((self.0 >> 8) & 255) as u8
    }

    pub const fn blue(self) -> u8 {
        (self.0 & 255) as u8
    }

    /// Mix towards `other`. `t` of 0 returns `self`, 1 returns `other`.
    /// Software alpha — terminals have none.
    pub fn mix(self, other: Color, t: f64) -> Color {
        if self.is_default() || other.is_default() {
            return if t < 0.5 { self } else { other };
        }
        let k = t.clamp(0.0, 1.0);
        let lerp = |a: u8, b: u8| round_half_up(a as f64 + (b as f64 - a as f64) * k) as u8;
        Color::rgb(
            lerp(self.red(), other.red()),
            lerp(self.green(), other.green()),
            lerp(self.blue(), other.blue()),
        )
    }

    /// Blend over a background at `a` (0-1). Used for subtle fills and shadows.
    pub fn alpha(self, background: Color, a: f64) -> Color {
        background.mix(self, a)
    }

    pub fn lighten(self, amount: f64) -> Color {
        self.mix(Color::rgb(255, 255, 255), amount)
    }

    pub fn darken(self, amount: f64) -> Color {
        self.mix(Color::rgb(0, 0, 0), amount)
    }

    /// Relative luminance, 0-1.
    pub fn luminance(self) -> f64 {
        fn channel(v: u8) -> f64 {
            let x = v as f64 / 255.0;
            if x <= 0.03928 {
                x / 12.92
            } else {
                ((x + 0.055) / 1.055).powf(2.4)
            }
        }
        0.2126 * channel(self.red()) + 0.7152 * channel(self.green()) + 0.0722 * channel(self.blue())
    }

    /// WCAG contrast ratio against another color (1-21).
    pub fn contrast(self, other: Color) -> f64 {
        let a = self.luminance();
        let b = other.luminance();
        (a.max(b) + 0.05) / (a.min(b) + 0.05)
    }

    /// Desaturate towards grey — powers `monochrome` mode.
    pub fn grayscale(self) -> Color {
        if self.is_default() {
            return self;
        }
        let v = round_half_up(
            0.299 * self.red() as f64 + 0.587 * self.green() as f64 + 0.114 * self.blue() as f64,
        ) as u8;
        Color::rgb(v, v, v)
    }

    /// Quantize to the xterm-256 palette, for terminals without truecolor.
    pub fn to_256(self) -> u8 {
        if self.is_indexed() {
            return (self.0 & 255) as u8;
        }
        let (r, g, b) = (self.red(), self.green(), self.blue());
        // The grey ramp often beats the cube for desaturated colors.
        if (r as i32 - g as i32).abs() < 8 && (g as i32 - b as i32).abs() < 8 {
            if r < 8 {
                return 16;
            }
            if r > 248 {
                return 231;
            }
            return 232 + round_half_up((r as f64 - 8.0) / 247.0 * 24.0) as u8;
        }
        16 + 36 * nearest_cube_index(r) + 6 * nearest_cube_index(g) + nearest_cube_index(b)
    }

    /// Quantize to the 16-color palette, for last-resort terminals.
    pub fn to_16(self) -> u8 {
        if self.is_indexed() {
            let i = (self.0 & 255) as u8;
            return if i < 16 { i } else { Color::from_256(i).to_16() };
        }
        let (r, g, b) = (self.red() as i32, self.green() as i32, self.blue() as i32);
        let mut best = 7u8;
        let mut best_d = i32::MAX;
        for (i, &(br, bg, bb)) in BASE16.iter().enumerate() {
            let d = (r - br as i32).pow(2) + (g - bg as i32).pow(2) + (b - bb as i32).pow(2);
            if d < best_d {
                best_d = d;
                best = i as u8;
            }
        }
        best
    }

    /// Convert a 256-palette index back to truecolor.
    pub fn from_256(index: u8) -> Color {
        if index < 16 {
            let (r, g, b) = BASE16[index as usize];
            return Color::rgb(r, g, b);
        }
        if index >= 232 {
            let v = 8 + (index as u32 - 232) * 10;
            return Color::rgb(v as u8, v as u8, v as u8);
        }
        let n = (index - 16) as usize;
        Color::rgb(CUBE[(n / 36) % 6], CUBE[(n / 6) % 6], CUBE[n % 6])
    }
}

/// JavaScript's `Math.round` rounds half *up*, including for negatives
/// (`Math.round(-0.5) === -0`), where Rust's `f64::round` rounds half away from
/// zero. Every quantization in this file has to agree with the reference
/// implementation cell for cell, so the tie-break is spelled out rather than
/// inherited.
#[inline]
pub(crate) fn round_half_up(v: f64) -> f64 {
    (v + 0.5).floor()
}

const CUBE: [u8; 6] = [0, 95, 135, 175, 215, 255];

fn nearest_cube_index(v: u8) -> u8 {
    let mut best = 0u8;
    let mut best_d = i32::MAX;
    for (i, &c) in CUBE.iter().enumerate() {
        let d = (c as i32 - v as i32).abs();
        if d < best_d {
            best_d = d;
            best = i as u8;
        }
    }
    best
}

const BASE16: [(u8, u8, u8); 16] = [
    (0, 0, 0), (205, 49, 49), (13, 188, 121), (229, 229, 16),
    (36, 114, 200), (188, 63, 188), (17, 168, 205), (229, 229, 229),
    (102, 102, 102), (241, 76, 76), (35, 209, 139), (245, 245, 67),
    (59, 142, 234), (214, 112, 214), (41, 184, 219), (255, 255, 255),
];

/// A multi-stop gradient sampler. `sample(0.0)` is the first stop, `1.0` the last.
///
/// ```
/// use hqtui::color::{Color, Gradient};
/// let heat = Gradient::new(&[Color::hex(0x00d7ff), Color::hex(0xff5f5f)]);
/// let warm = heat.sample(0.75);
/// ```
#[derive(Clone, Debug, Default)]
pub struct Gradient {
    stops: Vec<Color>,
}

impl Gradient {
    pub fn new(stops: &[Color]) -> Gradient {
        Gradient { stops: stops.to_vec() }
    }

    pub fn sample(&self, t: f64) -> Color {
        match self.stops.len() {
            0 => Color::DEFAULT,
            1 => self.stops[0],
            n => {
                // Ordered so NaN falls through to 0 rather than indexing wild.
                let k = if t > 1.0 {
                    1.0
                } else if t > 0.0 {
                    t
                } else {
                    0.0
                };
                let pos = k * (n - 1) as f64;
                let i = (pos.floor() as usize).min(n - 2);
                self.stops[i].mix(self.stops[i + 1], pos - i as f64)
            }
        }
    }

    /// Sample `n` evenly spaced colors.
    pub fn steps(&self, n: usize) -> Vec<Color> {
        (0..n)
            .map(|i| self.sample(if n == 1 { 0.0 } else { i as f64 / (n - 1) as f64 }))
            .collect()
    }
}
