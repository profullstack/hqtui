//! Collapsed panel borders, asserted the same way the TypeScript reference
//! asserts them. The scenes are deliberately identical so the two can be
//! compared by eye, and by `cargo run --example collapse`.

use hqtui::prelude::*;
use hqtui::surface::{border_bits, border_glyph, EDGE_DOWN, EDGE_LEFT, EDGE_RIGHT, EDGE_UP};
use hqtui::testing::{render_collapsed_to_text, render_to_text};

fn two_panels(collapse: bool) -> Vec<String> {
    let view = |ui: &mut Container| {
        ui.row(Row::new().size(3), |row| {
            row.panel(Panel::new().title("A").size(8), |_| {});
            row.panel(Panel::new().title("B").size(8), |_| {});
        });
    };
    let text = if collapse {
        render_collapsed_to_text(16, 3, "dark", view)
    } else {
        render_to_text(16, 3, "dark", view)
    };
    text.lines().map(|l| l.to_string()).collect()
}

#[test]
fn off_by_default_two_panels_keep_their_own_borders() {
    let lines = two_panels(false);
    assert!(lines[0].contains("╮╭"), "{}", lines[0]);
    assert!(lines[1].contains("││"), "{}", lines[1]);
    assert!(lines[2].contains("╯╰"), "{}", lines[2]);
}

#[test]
fn collapsed_the_shared_edge_becomes_one_line_with_junctions() {
    let lines = two_panels(true);
    assert!(lines[0].contains('┬'), "{}", lines[0]);
    assert!(!lines[0].contains("╮╭"), "{}", lines[0]);
    assert!(!lines[1].contains("││"), "{}", lines[1]);
    assert!(lines[2].contains('┴'), "{}", lines[2]);
}

#[test]
fn two_fixed_panels_give_a_column_back() {
    assert_eq!(two_panels(false)[0].chars().count(), 16);
    let merged = &two_panels(true)[0];
    assert_eq!(merged.chars().count(), 15);
    assert_eq!(merged.matches('┬').count(), 1);
}

#[test]
fn stacked_panels_collapse_horizontally_too() {
    let out = render_collapsed_to_text(12, 6, "dark", |ui: &mut Container| {
        ui.column(Column::new(), |col| {
            col.panel(Panel::new().title("A").size(3), |_| {});
            col.panel(Panel::new().title("B").size(3), |_| {});
        });
    });
    assert!(out.lines().any(|l| l.contains('├') && l.contains('┤')), "{out}");
}

#[test]
fn an_explicit_gap_is_respected() {
    let out = render_collapsed_to_text(16, 3, "dark", |ui: &mut Container| {
        ui.row(Row::new().size(3).gap(1), |row| {
            row.panel(Panel::new().title("A").size(7), |_| {});
            row.panel(Panel::new().title("B").size(7), |_| {});
        });
    });
    assert!(out.lines().next().unwrap_or_default().contains("╮ ╭"), "{out}");
}

#[test]
fn only_bordered_siblings_collapse() {
    let out = render_collapsed_to_text(16, 3, "dark", |ui: &mut Container| {
        ui.row(Row::new().size(3), |row| {
            row.panel(Panel::new().title("A").size(8), |_| {});
            row.text("plain");
        });
    });
    assert!(out.contains("plain"), "{out}");
    assert!(!out.lines().next().unwrap_or_default().contains('┬'), "{out}");
}

#[test]
fn edge_bits_round_trip() {
    assert_eq!(border_bits('┬'), Some(EDGE_LEFT | EDGE_RIGHT | EDGE_DOWN));
    assert_eq!(border_bits('╯'), Some(EDGE_UP | EDGE_LEFT));
    assert_eq!(border_bits('x'), None);
    let union = border_bits('╮').unwrap() | border_bits('╭').unwrap();
    assert_eq!(border_glyph(BorderStyle::Rounded, union), Some('┬'));
}
