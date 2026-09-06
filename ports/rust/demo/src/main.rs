mod collect;
mod sensors;
mod traffic;
mod components;
mod dashboard;
mod model;
mod showcase;
mod telemetry;
#[cfg(test)]
mod tests;
mod view;

use hqtui::{
    prelude::*,
    testing::{render_to_html, render_to_screen, HtmlOptions},
    AppOptions,
};
use model::*;
use std::{
    io::{self, IsTerminal},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

#[derive(Debug)]
struct Options {
    sim: bool,
    real: bool,
    snapshot: bool,
    help: bool,
    version: bool,
    seed: u32,
    fps: u32,
    interval: f64,
    width: usize,
    height: usize,
    ticks: usize,
    theme: usize,
    screen: usize,
    format: String,
}
fn options(args: Vec<String>) -> Result<Options, String> {
    let mut o = Options {
        sim: false,
        real: false,
        snapshot: false,
        help: false,
        version: false,
        seed: 1337,
        fps: 30,
        interval: 1.,
        width: 160,
        height: 50,
        ticks: 0,
        theme: 0,
        screen: 0,
        format: "text".into(),
    };
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--sim" => o.sim = true,
            "--real" => o.real = true,
            "--snapshot" => o.snapshot = true,
            "--help" | "-h" => o.help = true,
            "--version" => o.version = true,
            _ => {
                let value = args
                    .next()
                    .ok_or_else(|| format!("missing value for {arg}"))?;
                let invalid = || format!("invalid {arg}: {value}");
                match arg.as_str() {
                    "--seed" => o.seed = value.parse().map_err(|_| invalid())?,
                    "--fps" => o.fps = value.parse().map_err(|_| invalid())?,
                    "--interval" => o.interval = value.parse().map_err(|_| invalid())?,
                    "--width" => o.width = value.parse().map_err(|_| invalid())?,
                    "--height" => o.height = value.parse().map_err(|_| invalid())?,
                    "--ticks" => o.ticks = value.parse().map_err(|_| invalid())?,
                    "--theme" => {
                        o.theme = THEMES
                            .iter()
                            .position(|v| *v == value)
                            .ok_or_else(invalid)?
                    }
                    "--screen" => {
                        o.screen = SCREENS
                            .iter()
                            .position(|v| *v == value)
                            .ok_or_else(invalid)?
                    }
                    "--format" => o.format = value,
                    _ => return Err(format!("unknown option {arg}")),
                }
            }
        }
    }
    if o.help || o.version {
        return Ok(o);
    }
    if (o.sim && o.real)
        || !(1..=120).contains(&o.fps)
        || !o.interval.is_finite()
        || !(0.05..=60.).contains(&o.interval)
        || !(1..=500).contains(&o.width)
        || !(1..=200).contains(&o.height)
        || o.ticks > 10000
        || !["text", "ansi", "html"].contains(&o.format.as_str())
    {
        return Err("invalid options; use --help for supported values".into());
    }
    Ok(o)
}
fn interact(app: &App, s: &mut State) {
    if s.overlay() {
        return;
    }
    for base in [0, 5] {
        for i in 0..if base == 0 { 10 } else { 5 } {
            if app.pressed(&format!("tabs{base}:{i}")) {
                s.screen = base + i
            }
        }
    }
    for i in 0..THEMES.len() {
        if app.pressed(&format!("theme:{i}")) {
            s.theme = i
        }
    }
    if app.pressed("check") {
        s.checked = !s.checked
    }
    if app.pressed("toggle") {
        s.toggle = !s.toggle
    }
    if app.pressed("select") {
        s.select_open = !s.select_open
    }
    if app.pressed("palette") {
        s.palette = true
    }
    for name in ["Primary", "Success", "Warning", "Danger", "Ghost"] {
        if app.pressed(&format!("button:{name}")) {
            s.modal = true
        }
    }
    let mut panes = s.panes.borrow_mut();
    for (id, p) in panes.iter_mut() {
        let delta = app.scrolled(id);
        if delta != 0 {
            p.move_by(delta as i64);
            s.focused.insert(s.screen, id.clone());
        }
        if let Some(row) = app.clicked_row(id) {
            p.selected = (p.offset + row).min(p.total.saturating_sub(1));
            s.focused.insert(s.screen, id.clone());
        }
    }
}
fn run() -> Result<(), String> {
    let o = options(std::env::args().skip(1).collect())?;
    if o.help {
        println!("hqtui-demo-rust — native read-only reference demo\n--sim | --real  --seed N  --fps 1–120  --interval 0.05–60\n--screen {}\n--theme {}\n--snapshot --width 1–500 --height 1–200 --format text|ansi|html --ticks 0–10000\n--help --version",SCREENS.join("|"),THEMES.join("|"));
        return Ok(());
    }
    if o.version {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if !o.snapshot && (!io::stdin().is_terminal() || !io::stdout().is_terminal()) {
        return Err(
            "An interactive terminal is required. Use --snapshot for headless output.".into(),
        );
    }
    let real = o.real || (!o.sim && !o.snapshot);
    let mut s = State::new(real, o.seed);
    s.screen = o.screen;
    s.theme = o.theme;
    let mut source = if real {
        let mut c = collect::Collector::new();
        c.refresh();
        s.sample = c.sample.clone();
        s.missing = c.missing.clone();
        Some(c)
    } else {
        None
    };
    if !real {
        for _ in 0..o.ticks {
            s.simulate()
        }
    }
    if o.snapshot {
        let frame = render_to_screen(o.width, o.height, THEMES[s.theme], |ui| {
            view::render(ui, &s)
        });
        println!(
            "{}",
            match o.format.as_str() {
                "ansi" => frame.ansi(),
                "html" => render_to_html(&frame, &HtmlOptions::default()),
                _ => frame.text(),
            }
        );
        return Ok(());
    }
    let mut app = App::with_options(AppOptions {
        theme: Some(THEMES[s.theme].into()),
        fps: o.fps,
        quit_keys: vec![],
        focus_navigation: false,
        ..Default::default()
    })
    .map_err(|e| e.to_string())?;
    let (tx, rx) = mpsc::channel();
    let mut busy = false;
    let mut next = Instant::now();
    let mut last_frame = Instant::now();
    while app.running() {
        for event in app.poll().map_err(|e| e.to_string())? {
            match event {
                InputEvent::Key(k) => {
                    if s.key(&k.key, k.char.as_deref().unwrap_or("")) {
                        app.quit()
                    }
                }
                InputEvent::Mouse(m) => {
                    s.last_mouse =
                        format!("{} {},{} wheel={}", m.action.as_str(), m.x, m.y, m.scroll)
                }
                InputEvent::Paste(p) => {
                    if s.editing {
                        append(&mut s.input, &p.text)
                    } else if s.filtering {
                        append(&mut s.filter, &p.text)
                    } else if s.palette {
                        append(&mut s.query, &p.text)
                    }
                }
                _ => {}
            }
        }
        if !app.running() {
            break;
        }
        interact(&app, &mut s);
        if let Ok(c) = rx.try_recv() {
            let c: collect::Collector = c;
            if !s.paused {
                s.sample = c.sample.clone();
                s.missing = c.missing.clone()
            }
            source = Some(c);
            busy = false
        }
        if !s.paused && !busy && Instant::now() >= next {
            if real {
                let mut c = source.take().expect("one collector at a time");
                let tx = tx.clone();
                thread::spawn(move || {
                    c.refresh();
                    let _ = tx.send(c);
                });
                busy = true;
                next = Instant::now() + Duration::from_secs_f64(o.interval)
            } else {
                s.simulate();
                next = Instant::now() + Duration::from_millis(100)
            }
        }
        if app.theme.name != THEMES[s.theme] {
            app.set_theme(THEMES[s.theme]);
        }
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            % 86400;
        s.clock = format!(
            "{:02}:{:02}:{:02}",
            seconds / 3600,
            seconds % 3600 / 60,
            seconds % 60
        );
        let stats = app
            .draw(|f| view::render(&mut f.ui, &s))
            .map_err(|e| e.to_string())?;
        s.render_ms = stats.render.as_secs_f64() * 1000.;
        s.changed_cells = stats.changed_cells;
        s.bytes = stats.bytes;
        let now = Instant::now();
        s.fps = 1. / now.duration_since(last_frame).as_secs_f64().max(0.001);
        last_frame = now;
    }
    app.restore();
    if busy {
        let _ = rx.recv_timeout(Duration::from_secs(8));
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(2)
    }
}
