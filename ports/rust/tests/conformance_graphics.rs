//! Conformance for the drawing layer: the Braille canvas, the block-element
//! ramps, and `Surface::draw_box`, which every panel in the library goes
//! through.

mod common;

use common::{align, assert_buffer, fixture, rect, scene};

use hqtui::graphics::{horizontal_glyph, shade_glyph, vertical_glyph, BrailleCanvas, FillMode};
use hqtui::surface::{BorderStyle, BoxOptions};

#[test]
fn braille_matches_reference() {
    for case in fixture("braille").arr() {
        let name = case.get("name").str();
        let mut canvas = BrailleCanvas::new(case.get("cols").usize(), case.get("rows").usize());

        for op in case.get("ops").arr() {
            let f = |k: &str| op.get(k).f64();
            let points = || -> Vec<(f64, f64)> {
                op.get("points").arr().iter().map(|p| (p.at(0).f64(), p.at(1).f64())).collect()
            };
            match op.get("op").str() {
                "pixel" => canvas.pixel(f("x"), f("y")),
                "unset" => canvas.unset(f("x"), f("y")),
                "line" => canvas.line(f("x0"), f("y0"), f("x1"), f("y1")),
                "hline" => canvas.hline(f("y"), f("x0"), f("x1")),
                "vline" => canvas.vline(f("x"), f("y0"), f("y1")),
                "rect" => canvas.rect(f("x0"), f("y0"), f("x1"), f("y1")),
                "fillRect" => canvas.fill_rect(f("x0"), f("y0"), f("x1"), f("y1")),
                "circle" => canvas.circle(f("cx"), f("cy"), f("r")),
                "polyline" => canvas.polyline(&points()),
                "fillUnder" => canvas.fill_under(&points(), f("baseline")),
                other => panic!("unknown braille op {other:?}"),
            }
        }

        let want: Vec<u32> = case.get("cells").arr().iter().map(|v| v.u32()).collect();
        let mut got = Vec::with_capacity(want.len());
        for row in 0..canvas.rows {
            for col in 0..canvas.cols {
                got.push(canvas.cell(col, row));
            }
        }
        assert_eq!(got, want, "{name}: cells");

        let want_lines: Vec<&str> = case.get("lines").arr().iter().map(|v| v.str()).collect();
        assert_eq!(canvas.to_lines(), want_lines, "{name}: lines");
    }
}

#[test]
fn blocks_match_reference() {
    let f = fixture("blocks");
    for c in f.get("verticalGlyph").arr() {
        assert_eq!(
            vertical_glyph(c.get("ratio").f64(), FillMode::parse(c.get("mode").str())),
            c.get("out").str(),
            "verticalGlyph({}, {})",
            c.get("ratio").f64(),
            c.get("mode").str()
        );
    }
    for c in f.get("horizontalGlyph").arr() {
        assert_eq!(
            horizontal_glyph(c.get("ratio").f64(), FillMode::parse(c.get("mode").str())),
            c.get("out").str(),
            "horizontalGlyph({}, {})",
            c.get("ratio").f64(),
            c.get("mode").str()
        );
    }
    for c in f.get("shadeGlyph").arr() {
        assert_eq!(
            shade_glyph(c.get("ratio").f64(), c.get("unicode").bool()),
            c.get("out").str(),
            "shadeGlyph({}, {})",
            c.get("ratio").f64(),
            c.get("unicode").bool()
        );
    }
}

#[test]
fn surface_box_matches_reference() {
    for case in fixture("surface").arr() {
        let name = case.get("name").str();
        let (buffer, surface) = scene(
            case.get("width").usize(),
            case.get("height").usize(),
            case.get("theme").str(),
        );

        let spec = case.get("box");
        let mut options = BoxOptions::new();
        if let Some(t) = spec.opt("title") {
            options.title = Some(t.str().to_string());
        }
        if let Some(t) = spec.opt("subtitle") {
            options.subtitle = Some(t.str().to_string());
        }
        if let Some(t) = spec.opt("footer") {
            options.footer = Some(t.str().to_string());
        }
        if let Some(b) = spec.opt("border") {
            options.border = Some(BorderStyle::parse(b.str()));
        }
        if let Some(a) = spec.opt("titleAlign") {
            options.title_align = Some(align(a));
        }

        let inner = surface.draw_box(&options);
        assert_eq!(inner.rect, rect(case.get("innerRect")), "{name}: inner rect");
        assert_buffer(&buffer.borrow(), case.get("result"), name);
    }
}
