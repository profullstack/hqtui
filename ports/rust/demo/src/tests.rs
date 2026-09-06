use super::*;
use serde_json::json;

#[test]
fn screens_match_typescript_cells() {
    let cases: serde_json::Value = serde_json::from_str(include_str!("../parity.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let (w, h) = (
            case["width"].as_u64().unwrap() as usize,
            case["height"].as_u64().unwrap() as usize,
        );
        let theme = case["theme"].as_str().unwrap();
        let mut s = State::new(false, 1337);
        s.sample = model::sample(false);
        s.theme = THEMES.iter().position(|v| *v == theme).unwrap();
        let screen = case["screen"].as_str().unwrap();
        let f = render_to_screen(w, h, theme, |ui| match screen {
            "dashboard" => dashboard::render(ui, &s),
            "graphics" => showcase::graphics(ui, &s),
            "themes" => showcase::themes(ui, &s),
            "input" => showcase::input(ui, &s),
            "stress" => showcase::stress(ui, &s),
            "traffic" => telemetry::traffic(ui, &s),
            "sessions" => telemetry::sessions(ui, &s),
            "network" => telemetry::network(ui, &s),
            "services" => telemetry::services(ui, &s),
            "components" => components::render(ui, &s),
            _ => panic!("unknown reference screen"),
        });
        let mut mismatch = Vec::new();
        for y in 0..h {
            let mut hash = 2166136261u32;
            for x in 0..w {
                let c = f.cell(x, y);
                for b in c
                    .char
                    .bytes()
                    .chain(std::iter::once(0))
                    .chain(c.fg.raw().to_le_bytes())
                    .chain(c.bg.raw().to_le_bytes())
                    .chain((c.attrs.bits() as u32).to_le_bytes())
                {
                    hash = (hash ^ b as u32).wrapping_mul(16777619);
                }
            }
            if hash as u64 != case["hashes"][y].as_u64().unwrap() {
                mismatch.push(y);
            }
        }
        if !mismatch.is_empty() {
            let expected = case["text"].as_str().unwrap().lines().collect::<Vec<_>>();
            for &y in &mismatch {
                eprintln!(
                    "row {y}\nTS: {}\nRS: {}",
                    expected.get(y).unwrap_or(&""),
                    f.line(y)
                );
            }
        }
        assert!(
            mismatch.is_empty(),
            "{screen} {w}x{h}/{theme}: {} differing rows",
            mismatch.len()
        );
    }
}

#[test]
fn all_screens_themes_and_sizes() {
    let mut state = State::new(false, 1337);
    for (screen, name) in SCREENS.iter().enumerate() {
        for (theme, theme_name) in THEMES.iter().enumerate() {
            state.screen = screen;
            state.theme = theme;
            let frame = render_to_screen(120, 40, theme_name, |ui| view::render(ui, &state));
            assert!(frame.contains("hqtui"), "{name}/{theme_name}");
            let title = [
                "CPU Overview",
                "Protocols",
                "Active Sessions",
                "Connections",
                "Filesystems",
                "Buttons & Inputs",
                "Braille (2×4",
                "Theme ",
                "Last Events",
                "Full-screen churn",
            ][screen];
            assert!(
                frame.contains(title),
                "{name}/{theme_name}: missing {title}"
            );
        }
        for (width, height) in [(1, 1), (20, 5), (40, 12), (80, 24), (160, 55)] {
            state.screen = screen;
            let frame = render_to_screen(width, height, "dark", |ui| view::render(ui, &state));
            assert_eq!((frame.width, frame.height), (width, height));
        }
    }
}
#[test]
fn deterministic_and_bounded() {
    let mut a = State::new(false, 42);
    let b = State::new(false, 42);
    let c = State::new(false, 43);
    assert_eq!(a.sample, b.sample);
    assert_ne!(a.sample, c.sample);
    for _ in 0..500 {
        a.simulate()
    }
    assert!(array(&a.sample["cpu"]["history"]).len() <= 240);
}
#[test]
fn overlay_priority() {
    let mut s = State::new(false, 42);
    s.key("f3", "");
    assert!(!s.key("q", "q"));
    assert_eq!(s.filter, "q");
    s.key("escape", "");
    s.key("ctrl+k", "");
    s.key("t", "themes");
    s.key("enter", "");
    assert_eq!(s.screen, 7);
    s.key("f1", "");
    assert!(!s.key("q", "q"));
    assert!(s.key("q", "q"));
}
#[test]
fn input_and_pause() {
    let mut s = State::new(false, 42);
    s.screen = 8;
    s.key("e", "e");
    s.key("q", "q");
    s.key("1", "1");
    assert_eq!(s.input, "q1");
    assert_eq!(s.screen, 8);
    s.key("escape", "");
    s.key("space", " ");
    assert!(s.paused);
}
#[test]
fn independent_panes() {
    let s = State::new(false, 42);
    let frame = render_to_screen(160, 55, "dark", |ui| view::render(ui, &s));
    let mut panes = s.panes.borrow_mut();
    panes.get_mut("dashboard.processes").unwrap().move_by(20);
    assert_eq!(panes["dashboard.logs"].selected, 0);
    assert!(frame.regions.iter().any(|r| r.id == "dashboard.logs"));
}
#[test]
fn invalid_options() {
    for args in [
        vec!["--fps", "0"],
        vec!["--interval", "NaN"],
        vec!["--width", "99999"],
        vec!["--seed", "-1"],
        vec!["--ticks", "-1"],
        vec!["--theme", "wrong"],
        vec!["--sim", "--real"],
    ] {
        assert!(
            options(args.iter().map(|s| s.to_string()).collect()).is_err(),
            "{args:?}"
        );
    }
}
#[test]
fn real_is_never_seeded() {
    let s = State::new(true, 42);
    assert_eq!(s.sample["processes"], json!([]));
    assert_eq!(s.sample["telemetry"]["sessions"], json!([]));
}
#[test]
fn counter_resets() {
    assert_eq!(collect::rate(100., Some(50.), 2.), 25.);
    assert_eq!(collect::rate(10., Some(50.), 1.), 0.);
    assert_eq!(collect::rate(100., None, 1.), 0.);
    assert_eq!(collect::rate(100., Some(0.), 0.), 0.);
}
#[test]
fn command_deadline_and_output_cap() {
    if cfg!(unix) {
        assert!(collect::command(&["sleep", "2"]).is_none());
        assert_eq!(collect::command(&["printf", "ok"]).as_deref(), Some("ok"));
    }
}
