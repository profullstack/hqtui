use serde_json::{json, Value};
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};

pub const SCREENS: [&str; 10] = [
    "dashboard",
    "traffic",
    "sessions",
    "network",
    "services",
    "components",
    "graphics",
    "themes",
    "input",
    "stress",
];
pub const THEMES: [&str; 9] = [
    "dark",
    "dracula",
    "nord",
    "tokyo-night",
    "gruvbox",
    "matrix",
    "monochrome",
    "high-contrast",
    "light",
];
pub fn n(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.)
}
pub fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "—".into(),
        Value::Number(x) => {
            if x.is_f64() {
                if n(v).fract() == 0. {
                    format!("{:.0}", n(v))
                } else {
                    x.to_string()
                }
            } else {
                x.to_string()
            }
        }
        _ => v.to_string(),
    }
}
pub fn array(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
pub fn values(v: &Value) -> Vec<f64> {
    array(v).iter().map(n).collect()
}
pub fn push(v: &mut Value, key: &str, value: f64) {
    if !v[key].is_array() {
        v[key] = json!([])
    };
    let a = v[key].as_array_mut().unwrap();
    a.push(json!(value));
    if a.len() > 240 {
        a.drain(..a.len() - 240);
    }
}
pub fn blank(v: &Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(m.iter().map(|(k, v)| (k.clone(), blank(v))).collect()),
        Value::Array(_) => json!([]),
        Value::String(_) => json!(""),
        Value::Number(_) => json!(0),
        Value::Bool(_) => json!(false),
        _ => Value::Null,
    }
}
pub fn sample(real: bool) -> Value {
    let data: Value =
        serde_json::from_str(include_str!("sample.json")).expect("valid packaged fixture");
    if !real {
        return data;
    };
    let mut data = blank(&data);
    data["cpu"]["load"] = json!([0, 0, 0]);
    data["telemetry"]["http"] = Value::Null;
    data["telemetry"]["power"] = Value::Null;
    data
}
#[derive(Default, Clone, Debug)]
pub struct Pane {
    pub log: bool,
    pub selected: usize,
    pub offset: usize,
    pub total: usize,
}
impl Pane {
    pub fn move_by(&mut self, d: i64) {
        if self.log {
            self.offset =
                (self.offset as i64 - d).clamp(0, self.total.saturating_sub(1) as i64) as usize;
            return;
        }
        self.selected =
            (self.selected as i64 + d).clamp(0, self.total.saturating_sub(1) as i64) as usize;
    }
}
pub type Panes = Rc<RefCell<BTreeMap<String, Pane>>>;
pub struct State {
    pub clock: String,
    pub fps: f64,
    pub render_ms: f64,
    pub changed_cells: usize,
    pub bytes: usize,
    pub sample: Value,
    pub real: bool,
    pub seed: u32,
    pub tick: u64,
    pub screen: usize,
    pub theme: usize,
    pub sort: usize,
    pub filter: String,
    pub input: String,
    pub query: String,
    pub last_key: String,
    pub last_mouse: String,
    pub paused: bool,
    pub help: bool,
    pub modal: bool,
    pub palette: bool,
    pub filtering: bool,
    pub collapse: bool,
    pub editing: bool,
    pub checked: bool,
    pub toggle: bool,
    pub select_open: bool,
    pub select_index: usize,
    pub palette_index: usize,
    pub key_log: Vec<Value>,
    pub panes: Panes,
    pub focused: BTreeMap<usize, String>,
    pub missing: Vec<String>,
}
impl State {
    pub fn new(real: bool, seed: u32) -> Self {
        let mut s = Self {
            clock: "12:00:00".into(),
            fps: 0.,
            render_ms: 0.,
            changed_cells: 0,
            bytes: 0,
            sample: sample(real),
            real,
            seed,
            tick: 0,
            screen: 0,
            theme: 0,
            sort: 0,
            filter: String::new(),
            input: String::new(),
            query: String::new(),
            last_key: "—".into(),
            last_mouse: "—".into(),
            paused: false,
            help: false,
            modal: false,
            palette: false,
            filtering: false,
            collapse: false,
            editing: false,
            checked: true,
            toggle: true,
            select_open: false,
            select_index: 0,
            palette_index: 0,
            key_log: vec![],
            panes: Rc::new(RefCell::new(BTreeMap::new())),
            focused: BTreeMap::new(),
            missing: vec![],
        };
        if !real {
            for _ in 0..120 {
                s.simulate()
            }
        };
        s
    }
    pub fn simulate(&mut self) {
        self.tick += 1;
        let t = self.tick as f64 * 0.1;
        let phase = (self.seed % 10000) as f64 / 100.;
        let s = &mut self.sample;
        s["time"] = json!(t);
        let cores: Vec<f64> = (0..12)
            .map(|i| (0.4 + 0.22 * (t / 3. + phase + i as f64 * 0.7).sin()).clamp(0.02, 0.98))
            .collect();
        let total = cores.iter().sum::<f64>() / 12.;
        let c = &mut s["cpu"];
        c["cores"] = json!(cores);
        c["total"] = json!(total);
        c["frequencyGhz"] = json!(2.1 + cores[0]);
        c["load"] = json!([total * 4., total * 3.5, total * 3.]);
        push(c, "history", total * 100.);
        let m = &mut s["memory"];
        let used = n(&m["total"]) * (0.42 + 0.05 * (t / 13. + phase).sin());
        m["used"] = json!(used);
        m["available"] = json!(n(&m["total"]) - used);
        m["free"] = json!((n(&m["available"]) - n(&m["cached"]) - n(&m["buffers"])).max(0.));
        let ratio = used / n(&m["total"]);
        push(m, "history", ratio * 100.);
        let net = &mut s["network"];
        for (dir, factor) in [("down", 1.), ("up", 0.35)] {
            let r = (2. + (t / 2. + phase).sin()) * 1048576. * factor;
            net[format!("{dir}Rate")] = json!(r);
            let total = n(&net[format!("{dir}Total")]) + r * 0.1;
            net[format!("{dir}Total")] = json!(total);
            net[format!("{dir}Peak")] = json!(n(&net[format!("{dir}Peak")]).max(r));
            push(net, &format!("{dir}History"), r)
        }
        for (i, p) in s["processes"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .enumerate()
        {
            p["cpu"] = json!((8. + 8. * (t / 3. + phase + i as f64).sin()).max(0.))
        }
        for (i, d) in s["disks"].as_array_mut().unwrap().iter_mut().enumerate() {
            for (dir, factor) in [("read", 1.), ("write", 0.4)] {
                let r = (1. + (t / 4. + i as f64 + phase).sin()) * 1048576. * factor;
                d[format!("{dir}Rate")] = json!(r);
                push(d, &format!("{dir}History"), r)
            }
        }
        s["system"]["uptime"] = json!(9254. + t);
        let down = n(&s["network"]["downRate"]);
        let up = n(&s["network"]["upRate"]);
        let tele = &mut s["telemetry"];
        for (i, v) in tele["interfaces"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .enumerate()
        {
            let rx = down / (i + 1) as f64;
            let tx = up / (i + 1) as f64;
            v["rxRate"] = json!(rx);
            v["txRate"] = json!(tx);
            push(v, "rxHistory", rx);
            push(v, "txHistory", tx)
        }
        let connections = array(&tele["connections"]).len() as f64;
        let sessions = array(&tele["sessions"]).len() as f64;
        for (key, v) in [
            ("netInHistory", down / 1400.),
            ("netOutHistory", up / 1400.),
            ("retransHistory", 0.1 + 0.1 * t.sin()),
            ("connectionHistory", connections),
            ("sessionHistory", sessions),
        ] {
            push(tele, key, v)
        }
        if tele["http"].is_object() {
            let r = 60. + 30. * (t + phase).sin();
            tele["http"]["requestsPerSecond"] = json!(r);
            push(&mut tele["http"], "history", r)
        }
    }
    pub fn processes(&self) -> Vec<Value> {
        let query = self.filter.to_lowercase();
        let mut rows: Vec<_> = array(&self.sample["processes"])
            .iter()
            .filter(|p| {
                format!("{} {}", text(&p["name"]), text(&p["command"]))
                    .to_lowercase()
                    .contains(&query)
            })
            .cloned()
            .collect();
        let key = ["cpu", "mem", "pid", "name"][self.sort];
        rows.sort_by(|a, b| {
            if key == "name" {
                text(&a[key]).cmp(&text(&b[key]))
            } else if key == "pid" {
                n(&a[key]).total_cmp(&n(&b[key]))
            } else {
                n(&b[key]).total_cmp(&n(&a[key]))
            }
        });
        rows
    }
    pub fn commands(&self) -> Vec<String> {
        SCREENS
            .iter()
            .copied()
            .chain(["pause", "sort CPU", "sort memory"])
            .filter(|name| name.to_lowercase().contains(&self.query.to_lowercase()))
            .map(str::to_owned)
            .collect()
    }
    pub fn overlay(&self) -> bool {
        self.help || self.modal || self.palette || self.filtering
    }
    pub fn key(&mut self, key: &str, ch: &str) -> bool {
        self.last_key = key.into();
        self.key_log.push(json!(format!(
            "{}  {}{}",
            self.clock,
            key,
            if ch.is_empty() {
                String::new()
            } else {
                format!("  \"{ch}\"")
            }
        )));
        if self.key_log.len() > 100 {
            self.key_log.remove(0);
        }
        if key == "ctrl+c" {
            return true;
        }
        if self.palette {
            let matches = self.commands();
            match key {
                "escape" => self.palette = false,
                "up" => self.palette_index = self.palette_index.saturating_sub(1),
                "down" => {
                    self.palette_index =
                        (self.palette_index + 1).min(matches.len().saturating_sub(1))
                }
                "enter" => {
                    if let Some(action) =
                        matches.get(self.palette_index.min(matches.len().saturating_sub(1)))
                    {
                        if let Some(i) = SCREENS.iter().position(|v| v == action) {
                            self.screen = i
                        } else if action == "pause" {
                            self.paused = !self.paused
                        } else {
                            self.sort = usize::from(action == "sort memory")
                        }
                    }
                    self.palette = false
                }
                "backspace" => {
                    self.query.pop();
                    self.palette_index = 0
                }
                _ => {
                    append(&mut self.query, ch);
                    self.palette_index = 0
                }
            }
            return false;
        }
        if self.help || self.modal {
            self.help = false;
            self.modal = false;
            return false;
        }
        if self.filtering || self.editing {
            let target = if self.editing {
                &mut self.input
            } else {
                &mut self.filter
            };
            match key {
                "escape" => {
                    if self.filtering {
                        target.clear()
                    }
                    self.filtering = false;
                    self.editing = false
                }
                "enter" => self.filtering = false,
                "backspace" => {
                    target.pop();
                }
                _ => append(target, ch),
            }
            return false;
        }
        if self.select_open {
            match key {
                "escape" => self.select_open = false,
                "up" => self.select_index = (self.select_index + 3) % 4,
                "down" => self.select_index = (self.select_index + 1) % 4,
                "enter" => {
                    self.theme = self.select_index;
                    self.select_open = false
                }
                _ => {}
            }
            return false;
        }
        match key {
            "q" | "f10" => return true,
            "f1" => self.help = true,
            "f2" => self.theme = (self.theme + 1) % THEMES.len(),
            "f3" => self.filtering = true,
            // Shows what collapse_borders does, live. Worth a key because the
            // difference is only visible when panels sit next to each other.
            "c" => self.collapse = !self.collapse,
            "f6" => self.sort = (self.sort + 1) % 4,
            "ctrl+k" => {
                self.palette = true;
                self.query.clear();
                self.palette_index = 0
            }
            "space" => self.paused = !self.paused,
            "enter" => self.modal = true,
            "e" if self.screen == 5 || self.screen == 8 => self.editing = true,
            "tab" => self.screen = (self.screen + 1) % 10,
            "right" if self.screen == 7 => self.theme = (self.theme + 1) % THEMES.len(),
            "left" if self.screen == 7 => {
                self.theme = (self.theme + THEMES.len() - 1) % THEMES.len()
            }
            _ => {
                if let Some(i) = "1234567890"
                    .chars()
                    .position(|c| key.len() == 1 && key.starts_with(c))
                {
                    self.screen = i
                } else {
                    let delta = match key {
                        "up" => -1,
                        "down" => 1,
                        "pageup" => -10,
                        "pagedown" => 10,
                        "home" => -1000000,
                        "end" => 1000000,
                        _ => 0,
                    };
                    let name = self.focused.get(&self.screen).cloned().or_else(|| {
                        let preferred = [
                            "dashboard.processes",
                            "traffic.paths",
                            "sessions.active",
                            "network.connections",
                            "services.units",
                            "components.files",
                            "",
                            "",
                            "",
                            "",
                        ][self.screen];
                        if self.panes.borrow().contains_key(preferred) {
                            return Some(preferred.into());
                        }
                        self.panes
                            .borrow()
                            .keys()
                            .find(|k| k.starts_with(SCREENS[self.screen]))
                            .cloned()
                    });
                    if let Some(name) = name {
                        if let Some(p) = self.panes.borrow_mut().get_mut(&name) {
                            p.move_by(delta)
                        }
                    }
                }
            }
        };
        false
    }
}
pub fn append(value: &mut String, ch: &str) {
    let remaining = 4096usize.saturating_sub(value.chars().count());
    value.extend(ch.chars().filter(|c| !c.is_control()).take(remaining))
}
