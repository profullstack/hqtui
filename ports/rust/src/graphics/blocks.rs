//! Sub-cell glyph ramps. Every one degrades to ASCII when Unicode is off.

use crate::color::round_half_up;

/// Left-to-right eighths: ▏▎▍▌▋▊▉█ — horizontal bars and meters.
pub const HORIZONTAL_EIGHTHS: [&str; 9] = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
/// Bottom-up eighths: ▁▂▃▄▅▆▇█ — sparklines and column charts.
pub const VERTICAL_EIGHTHS: [&str; 9] = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
/// Quadrants indexed by a 4-bit mask: 1=TL, 2=TR, 4=BL, 8=BR.
pub const QUADRANTS: [&str; 16] = [
    " ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█",
];
pub const SHADES: [&str; 4] = ["░", "▒", "▓", "█"];
pub const ASCII_RAMP: [&str; 10] = [" ", ".", ":", "-", "=", "+", "*", "#", "%", "@"];

pub const HALF_UPPER: &str = "▀";
pub const HALF_LOWER: &str = "▄";
pub const FULL_BLOCK: &str = "█";

/// How sub-cell detail is drawn. Braille is sharpest; the rest are the graceful
/// degradations for terminals or fonts that cannot manage it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum FillMode {
    #[default]
    Braille,
    Block,
    Half,
    Quadrant,
    Ascii,
}

impl FillMode {
    pub fn parse(name: &str) -> FillMode {
        match name {
            "block" => FillMode::Block,
            "half" => FillMode::Half,
            "quadrant" => FillMode::Quadrant,
            "ascii" => FillMode::Ascii,
            _ => FillMode::Braille,
        }
    }
}

fn clamp01(ratio: f64) -> f64 {
    if ratio <= 0.0 {
        0.0
    } else if ratio >= 1.0 {
        1.0
    } else {
        ratio
    }
}

/// Pick the glyph for a 0-1 fill of one cell, bottom-up.
pub fn vertical_glyph(ratio: f64, mode: FillMode) -> &'static str {
    let r = clamp01(ratio);
    match mode {
        FillMode::Ascii => {
            if r == 0.0 {
                " "
            } else if r < 0.4 {
                "."
            } else if r < 0.7 {
                "="
            } else {
                "#"
            }
        }
        FillMode::Half => {
            if r == 0.0 {
                " "
            } else if r < 0.5 {
                "▄"
            } else {
                "█"
            }
        }
        _ => {
            let i = round_half_up(r * 8.0) as usize;
            if i == 0 {
                " "
            } else {
                VERTICAL_EIGHTHS[i]
            }
        }
    }
}

/// Pick the glyph for a 0-1 fill of one cell, left to right.
pub fn horizontal_glyph(ratio: f64, mode: FillMode) -> &'static str {
    let r = clamp01(ratio);
    if mode == FillMode::Ascii {
        return if r == 0.0 {
            " "
        } else if r < 0.5 {
            "-"
        } else {
            "#"
        };
    }
    let i = round_half_up(r * 8.0) as usize;
    if i == 0 {
        " "
    } else {
        HORIZONTAL_EIGHTHS[i]
    }
}

/// Map a 0-1 value onto a shade block, for heatmaps and dim fills.
pub fn shade_glyph(ratio: f64, unicode: bool) -> &'static str {
    let r = clamp01(ratio);
    if !unicode {
        return ASCII_RAMP[round_half_up(r * (ASCII_RAMP.len() - 1) as f64) as usize];
    }
    if r == 0.0 {
        return " ";
    }
    SHADES[((r * SHADES.len() as f64).floor() as usize).min(SHADES.len() - 1)]
}

/// Braille when the terminal supports it, blocks when it does not.
pub fn best_mode(unicode: bool, braille: bool) -> FillMode {
    if braille {
        FillMode::Braille
    } else if unicode {
        FillMode::Block
    } else {
        FillMode::Ascii
    }
}
