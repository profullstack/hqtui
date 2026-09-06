//! Replays the shared conformance fixtures, which are generated from the
//! TypeScript reference implementation. A failure here means this port and the
//! reference disagree about something observable — which is a bug in one of
//! them, never an acceptable difference.
//!
//! Regenerate the fixtures with `bun ports/conformance/generate.ts`.

mod common;

use common::{align, apply_ops, assert_buffer, color, constraint, fixture, padding, rect};

use hqtui::ansi;
use hqtui::buffer::FrameBuffer;
use hqtui::capabilities::ColorDepth;
use hqtui::color::{Color, Gradient};
use hqtui::diff::{Encoder, EncoderOptions};
use hqtui::layout::{self, Constraint, Direction, Rect};
use hqtui::theme;
use hqtui::unicode;

fn approx(a: f64, b: f64, what: &str) {
    assert!(
        (a - b).abs() < 1e-9 || (a.is_nan() && b.is_nan()),
        "{what}: {a} != {b}"
    );
}

// --------------------------------------------------------------------- color

#[test]
fn color_matches_reference() {
    let f = fixture("color");

    for c in f.get("hex").arr() {
        assert_eq!(
            Color::hex_str(c.get("input").str()).raw(),
            c.get("color").u32(),
            "hex({:?})",
            c.get("input").str()
        );
    }
    for c in f.get("hexNumber").arr() {
        assert_eq!(Color::hex(c.get("input").u32()).raw(), c.get("color").u32());
    }
    for c in f.get("rgb").arr() {
        // The reference masks components with `& 255`; the port takes u8, so
        // the fixture's out-of-range values are masked here the same way.
        let r = (c.get("r").i64() & 255) as u8;
        let g = (c.get("g").i64() & 255) as u8;
        let b = (c.get("b").i64() & 255) as u8;
        assert_eq!(Color::rgb(r, g, b).raw(), c.get("color").u32());
    }
    for c in f.get("ansi256").arr() {
        assert_eq!(Color::ansi256(c.get("index").u32() as u8).raw(), c.get("color").u32());
    }
    assert_eq!(Color::DEFAULT.raw(), f.get("defaultColor").u32());

    for c in f.get("mix").arr().iter().chain(f.get("mixDefault").arr()) {
        let out = color(c.get("a")).mix(color(c.get("b")), c.get("t").f64());
        assert_eq!(out.raw(), c.get("out").u32(), "mix {c:?}");
    }
    for c in f.get("alpha").arr() {
        let out = color(c.get("fg")).alpha(color(c.get("bg")), c.get("a").f64());
        assert_eq!(out.raw(), c.get("out").u32());
    }
    for c in f.get("lighten").arr() {
        assert_eq!(color(c.get("c")).lighten(c.get("amount").f64()).raw(), c.get("out").u32());
    }
    for c in f.get("darken").arr() {
        assert_eq!(color(c.get("c")).darken(c.get("amount").f64()).raw(), c.get("out").u32());
    }
    for c in f.get("luminance").arr() {
        approx(color(c.get("c")).luminance(), c.get("out").f64(), "luminance");
    }
    for c in f.get("contrast").arr() {
        approx(color(c.get("a")).contrast(color(c.get("b"))), c.get("out").f64(), "contrast");
    }
    for c in f.get("grayscale").arr() {
        assert_eq!(color(c.get("c")).grayscale().raw(), c.get("out").u32());
    }
    assert_eq!(Color::DEFAULT.grayscale().raw(), f.get("grayscaleDefault").u32());

    for c in f.get("to256").arr() {
        assert_eq!(color(c.get("c")).to_256() as u32, c.get("out").u32(), "to256");
    }
    for c in f.get("to16").arr() {
        assert_eq!(color(c.get("c")).to_16() as u32, c.get("out").u32(), "to16");
    }
    for c in f.get("from256").arr() {
        assert_eq!(
            Color::from_256(c.get("index").u32() as u8).raw(),
            c.get("out").u32(),
            "from256({})",
            c.get("index").u32()
        );
    }

    let g = f.get("gradient");
    let stops: Vec<Color> = g.get("stops").arr().iter().map(color).collect();
    let gradient = Gradient::new(&stops);
    for s in g.get("samples").arr() {
        assert_eq!(gradient.sample(s.get("t").f64()).raw(), s.get("out").u32(), "gradient sample");
    }
    let steps = gradient.steps(g.get("steps").arr().len());
    for (i, want) in g.get("steps").arr().iter().enumerate() {
        assert_eq!(steps[i].raw(), want.u32(), "gradient step {i}");
    }
    assert_eq!(
        Gradient::new(&[Color::hex(0xff0000)]).sample(0.5).raw(),
        g.get("single").u32()
    );
    assert_eq!(Gradient::new(&[]).sample(0.5).raw(), g.get("empty").u32());
}

// ------------------------------------------------------------------- unicode

#[test]
fn unicode_matches_reference() {
    let f = fixture("unicode");

    for c in f.get("charWidth").arr() {
        assert_eq!(
            unicode::char_width(c.get("cp").u32()),
            c.get("width").usize(),
            "charWidth(U+{:04X})",
            c.get("cp").u32()
        );
    }
    for c in f.get("stringWidth").arr() {
        assert_eq!(
            unicode::string_width(c.get("s").str()),
            c.get("width").usize(),
            "stringWidth({:?})",
            c.get("s").str()
        );
    }
    for c in f.get("truncate").arr() {
        assert_eq!(
            unicode::truncate(c.get("s").str(), c.get("max").usize()),
            c.get("out").str(),
            "truncate({:?}, {})",
            c.get("s").str(),
            c.get("max").usize()
        );
    }
    for c in f.get("truncateCustomEllipsis").arr() {
        assert_eq!(
            unicode::truncate_with(
                c.get("s").str(),
                c.get("max").usize(),
                c.get("ellipsis").str()
            ),
            c.get("out").str()
        );
    }
    for c in f.get("fit").arr() {
        assert_eq!(
            unicode::fit(c.get("s").str(), c.get("w").usize(), align(c.get("align"))),
            c.get("out").str(),
            "fit({:?}, {}, {:?})",
            c.get("s").str(),
            c.get("w").usize(),
            c.get("align").str()
        );
    }
    for c in f.get("wrap").arr() {
        let want: Vec<&str> = c.get("out").arr().iter().map(|v| v.str()).collect();
        assert_eq!(
            unicode::wrap(c.get("s").str(), c.get("width").usize()),
            want,
            "wrap({:?}, {})",
            c.get("s").str(),
            c.get("width").usize()
        );
    }
    for c in f.get("stripUnsafe").arr() {
        assert_eq!(unicode::strip_unsafe(c.get("s").str()), c.get("out").str());
    }
    for c in f.get("graphemes").arr() {
        let cells = unicode::graphemes(c.get("s").str());
        let want = c.get("cells").arr();
        assert_eq!(cells.len(), want.len(), "grapheme count for {:?}", c.get("s").str());
        for (i, w) in want.iter().enumerate() {
            assert_eq!(cells[i].width, w.get("width").usize(), "grapheme {i} width");
            assert_eq!(
                cells[i].value >= unicode::CLUSTER_BASE,
                w.get("cluster").bool(),
                "grapheme {i} clustered"
            );
            assert_eq!(
                unicode::cell_text(cells[i].value),
                w.get("text").str(),
                "grapheme {i} text"
            );
        }
    }

    assert_eq!(unicode::CLUSTER_BASE, f.get("constants").get("clusterBase").u32());
    assert_eq!(unicode::CONTINUATION, f.get("constants").get("continuation").u32());
}

// ---------------------------------------------------------------------- ansi

#[test]
fn ansi_matches_reference() {
    let f = fixture("ansi");
    for c in f.get("stripAnsi").arr() {
        assert_eq!(
            ansi::strip_ansi(c.get("s").str()),
            c.get("out").str(),
            "stripAnsi({:?})",
            c.get("s").str()
        );
    }
    for c in f.get("moveTo").arr() {
        assert_eq!(ansi::move_to(c.get("x").usize(), c.get("y").usize()), c.get("out").str());
    }
    for c in f.get("setTitle").arr() {
        assert_eq!(ansi::set_title(c.get("title").str()), c.get("out").str());
    }
}

// -------------------------------------------------------------------- layout

#[test]
fn layout_matches_reference() {
    let f = fixture("layout");

    for c in f.get("solve").arr() {
        let items: Vec<Constraint> = c.get("items").arr().iter().map(constraint).collect();
        let want: Vec<usize> = c.get("out").arr().iter().map(|v| v.usize()).collect();
        assert_eq!(
            layout::solve(c.get("total").usize(), &items, c.get("gap").usize()),
            want,
            "solve(total={}, gap={})",
            c.get("total").usize(),
            c.get("gap").usize()
        );
    }

    for c in f.get("stack").arr() {
        let items: Vec<Constraint> = c.get("items").arr().iter().map(constraint).collect();
        let direction = if c.get("direction").str() == "row" {
            Direction::Row
        } else {
            Direction::Column
        };
        let got = layout::stack(rect(c.get("rect")), &items, direction, c.get("gap").usize());
        let want: Vec<Rect> = c.get("out").arr().iter().map(rect).collect();
        assert_eq!(got, want, "stack {:?}", c.get("direction").str());
    }

    for c in f.get("inset").arr() {
        assert_eq!(rect(c.get("rect")).inset(padding(c.get("padding"))), rect(c.get("out")));
    }

    for c in f.get("intersect").arr() {
        assert_eq!(rect(c.get("a")).intersect(rect(c.get("b"))), rect(c.get("out")));
    }
}

// -------------------------------------------------------------------- buffer

#[test]
fn buffer_matches_reference() {
    for case in fixture("buffer").arr() {
        let name = case.get("name").str();
        let mut buffer =
            FrameBuffer::new(case.get("width").usize(), case.get("height").usize());
        apply_ops(&mut buffer, case.get("ops").arr());
        assert_buffer(&buffer, case.get("result"), name);
    }
}

// ---------------------------------------------------------------------- diff

#[test]
fn diff_matches_reference() {
    for case in fixture("diff").arr() {
        let name = case.get("name").str();
        let (w, h) = (case.get("width").usize(), case.get("height").usize());
        let mut prev = FrameBuffer::new(w, h);
        let mut next = FrameBuffer::new(w, h);
        apply_ops(&mut prev, case.get("before").arr());
        apply_ops(&mut next, case.get("after").arr());

        let mut encoder = Encoder::new(EncoderOptions {
            colors: ColorDepth::parse(case.get("colors").str()),
            monochrome: case.opt("monochrome").map(|m| m.bool()).unwrap_or(false),
        });
        let got = encoder.encode(&prev, &next, case.get("full").bool());
        let want = case.get("result");

        assert_eq!(got.output, want.get("output").str(), "{name}: output");
        assert_eq!(got.changed_cells, want.get("changedCells").usize(), "{name}: changedCells");
        assert_eq!(got.dirty_rows, want.get("dirtyRows").usize(), "{name}: dirtyRows");
    }
}

// --------------------------------------------------------------------- theme

#[test]
fn theme_matches_reference() {
    let f = fixture("theme");

    for entry in f.get("themes").arr() {
        let key = entry.get("key").str();
        let want = entry.get("theme");
        let t = theme::resolve_theme(key);
        assert_eq!(t.name, want.get("name").str(), "{key}: name");
        assert_eq!(t.dark, want.get("dark").bool(), "{key}: dark");

        let check = |field: &str, got: Color| {
            assert_eq!(got.raw(), want.get(field).u32(), "{key}: {field}");
        };
        check("background", t.background);
        check("surface", t.surface);
        check("foreground", t.foreground);
        check("muted", t.muted);
        check("primary", t.primary);
        check("secondary", t.secondary);
        check("accent", t.accent);
        check("success", t.success);
        check("warning", t.warning);
        check("danger", t.danger);
        check("info", t.info);
        check("border", t.border);
        check("borderFocused", t.border_focused);
        check("title", t.title);
        check("selection", t.selection);
        check("selectionText", t.selection_text);
        check("cursor", t.cursor);

        let graph: Vec<u32> = t.graph.iter().map(|c| c.raw()).collect();
        let want_graph: Vec<u32> = want.get("graph").arr().iter().map(|v| v.u32()).collect();
        assert_eq!(graph, want_graph, "{key}: graph");
        let heat: Vec<u32> = t.heat.iter().map(|c| c.raw()).collect();
        let want_heat: Vec<u32> = want.get("heat").arr().iter().map(|v| v.u32()).collect();
        assert_eq!(heat, want_heat, "{key}: heat");
    }

    for c in f.get("resolve").arr() {
        assert_eq!(
            theme::resolve_theme(c.get("name").str()).name,
            c.get("resolved").str(),
            "resolve({:?})",
            c.get("name").str()
        );
    }
    for c in f.get("elevate").arr() {
        let t = theme::resolve_theme(c.get("theme").str());
        assert_eq!(
            theme::elevate(&t, c.get("amount").f64()).raw(),
            c.get("out").u32(),
            "elevate({})",
            c.get("theme").str()
        );
    }
    for c in f.get("heatColor").arr() {
        let t = theme::resolve_theme(c.get("theme").str());
        assert_eq!(
            theme::heat_color(&t, c.get("ratio").f64()).raw(),
            c.get("out").u32(),
            "heatColor({})",
            c.get("theme").str()
        );
    }
    for c in f.get("seriesColor").arr() {
        let t = theme::resolve_theme(c.get("theme").str());
        assert_eq!(
            theme::series_color(&t, c.get("index").i64()).raw(),
            c.get("out").u32(),
            "seriesColor({})",
            c.get("theme").str()
        );
    }
}
