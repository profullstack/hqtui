//! Native read-only sampling. No shell, no other language runtime, no probes.
use crate::model::{array, n, push, sample, text};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs::File,
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

const LIMIT: u64 = 1024 * 1024;
pub fn read(path: impl AsRef<Path>) -> String {
    let mut data = vec![];
    if let Ok(f) = File::open(path) {
        let _ = f.take(LIMIT).read_to_end(&mut data);
    }
    String::from_utf8_lossy(&data).into_owned()
}
pub fn command(args: &[&str]) -> Option<String> {
    let mut child = Command::new(args[0])
        .args(&args[1..])
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let out = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut data = vec![];
        let result = out.take(LIMIT + 1).read_to_end(&mut data);
        let _ = tx.send((result, data));
    });
    let start = Instant::now();
    let result = loop {
        if let Ok((result, data)) = rx.try_recv() {
            if result.is_err() || data.len() > LIMIT as usize {
                break None;
            };
            match child.try_wait() {
                Ok(Some(status)) if status.success() => {
                    break Some(String::from_utf8_lossy(&data).into_owned())
                }
                Ok(Some(_)) => break None,
                _ => {
                    let remaining = Duration::from_millis(700).saturating_sub(start.elapsed());
                    if remaining.is_zero() {
                        break None;
                    };
                    while start.elapsed() < Duration::from_millis(700) {
                        if let Ok(Some(status)) = child.try_wait() {
                            if status.success() {
                                let _ = reader.join();
                                return Some(String::from_utf8_lossy(&data).into_owned());
                            }
                            break;
                        }
                        thread::sleep(Duration::from_millis(5));
                    }
                    break None;
                }
            }
        }
        if start.elapsed() >= Duration::from_millis(700) {
            break None;
        };
        if let Ok(Some(status)) = child.try_wait() {
            if !status.success() {
                break None;
            }
        }
        thread::sleep(Duration::from_millis(5));
    };
    let _ = child.kill();
    let _ = child.wait();
    let _ = reader.join();
    result
}
fn number(v: &str) -> f64 {
    v.parse().unwrap_or(0.)
}
pub fn rate(current: f64, previous: Option<f64>, dt: f64) -> f64 {
    if dt > 0. {
        previous.map(|p| (current - p).max(0.) / dt).unwrap_or(0.)
    } else {
        0.
    }
}
pub struct Collector {
    pub sample: Value,
    pub missing: Vec<String>,
    slow_missing: Vec<String>,
    previous: BTreeMap<String, f64>,
    cpu: BTreeMap<String, (f64, f64)>,
    procs: BTreeMap<String, f64>,
    last: Option<Instant>,
    slow: Option<Instant>,
}
impl Collector {
    pub fn new() -> Self {
        let mut s = sample(true);
        s["system"]["os"] = json!(std::env::consts::OS);
        s["system"]["kernel"] = json!(read("/proc/sys/kernel/osrelease").trim());
        s["system"]["hostname"] = json!(read("/proc/sys/kernel/hostname").trim());
        s["system"]["shell"] = json!(std::env::var("SHELL").unwrap_or_default());
        Self {
            sample: s,
            missing: vec![],
            slow_missing: vec![],
            previous: BTreeMap::new(),
            cpu: BTreeMap::new(),
            procs: BTreeMap::new(),
            last: None,
            slow: None,
        }
    }
    fn delta(&mut self, key: &str, v: f64, dt: f64) -> f64 {
        rate(v, self.previous.insert(key.into(), v), dt)
    }
    pub fn refresh(&mut self) {
        let now = Instant::now();
        let dt = self
            .last
            .map(|t| now.duration_since(t).as_secs_f64())
            .unwrap_or(0.);
        self.last = Some(now);
        self.missing.clear();
        if std::env::consts::OS != "linux" {
            self.missing
                .push("live metrics require Linux on this port".into());
            return;
        }
        let mut cores = vec![];
        for line in read("/proc/stat").lines() {
            let f: Vec<_> = line.split_whitespace().collect();
            if f.len() < 2 {
                continue;
            };
            let key = f[0];
            if key.starts_with("cpu") && f.len() >= 5 {
                let total: f64 = f[1..f.len().min(9)].iter().map(|v| number(v)).sum();
                let idle = number(f[4]) + f.get(5).map(|v| number(v)).unwrap_or(0.);
                let prev = self.cpu.insert(key.into(), (total, idle));
                let usage = prev
                    .filter(|p| total > p.0)
                    .map(|p| (1. - (idle - p.1) / (total - p.0)).clamp(0., 1.))
                    .unwrap_or(0.);
                if key == "cpu" {
                    self.sample["cpu"]["total"] = json!(usage)
                } else {
                    cores.push(usage)
                }
            } else {
                let v = number(f[1]);
                let dest = match key {
                    "ctxt" => Some(("contextSwitches", "contextSwitchRate")),
                    "intr" => Some(("interrupts", "interruptRate")),
                    "processes" => Some(("forks", "forkRate")),
                    _ => None,
                };
                if let Some((count, rate_key)) = dest {
                    let r = self.delta(key, v, dt);
                    self.sample["telemetry"]["kernel"][count] = json!(v);
                    self.sample["telemetry"]["kernel"][rate_key] = json!(r)
                }
                if key == "procs_running" {
                    self.sample["telemetry"]["kernel"]["procsRunning"] = json!(v)
                }
                if key == "procs_blocked" {
                    self.sample["telemetry"]["kernel"]["procsBlocked"] = json!(v)
                }
            }
        }
        if cores.is_empty() {
            self.missing.push("CPU counters".into())
        }
        self.sample["cpu"]["cores"] = json!(cores);
        let total = n(&self.sample["cpu"]["total"]);
        push(&mut self.sample["cpu"], "history", total * 100.);
        for line in read("/proc/cpuinfo").lines() {
            if let Some((key, value)) = line.split_once(':') {
                match key.trim() {
                    "model name" => self.sample["cpu"]["model"] = json!(value.trim()),
                    "cpu MHz" => {
                        self.sample["cpu"]["frequencyGhz"] = json!(number(value.trim()) / 1000.)
                    }
                    _ => {}
                }
            }
        }
        let load: Vec<f64> = read("/proc/loadavg")
            .split_whitespace()
            .take(3)
            .map(number)
            .collect();
        if load.len() == 3 {
            self.sample["cpu"]["load"] = json!(load)
        }
        let mut mem = BTreeMap::new();
        for line in read("/proc/meminfo").lines() {
            let f: Vec<_> = line.split_whitespace().collect();
            if f.len() >= 2 {
                mem.insert(f[0].trim_end_matches(':').to_owned(), number(f[1]) * 1024.);
            }
        }
        let m = &mut self.sample["memory"];
        for (key, source) in [
            ("total", "MemTotal"),
            ("available", "MemAvailable"),
            ("free", "MemFree"),
            ("cached", "Cached"),
            ("buffers", "Buffers"),
            ("swapTotal", "SwapTotal"),
        ] {
            m[key] = json!(mem.get(source).copied().unwrap_or(0.))
        }
        let used = (n(&m["total"]) - n(&m["available"])).max(0.);
        let ratio = used / n(&m["total"]).max(1.);
        m["used"] = json!(used);
        m["swapUsed"] =
            json!((n(&m["swapTotal"]) - mem.get("SwapFree").copied().unwrap_or(0.)).max(0.));
        push(m, "history", ratio * 100.);
        self.sample["system"]["uptime"] = json!(read("/proc/uptime")
            .split_whitespace()
            .next()
            .map(number)
            .unwrap_or(0.));
        self.processes(dt);
        self.network(dt);
        self.disks(dt);
        if self
            .slow
            .map(|t| now.duration_since(t).as_secs() >= 5)
            .unwrap_or(true)
        {
            self.slow = Some(now);
            self.slow_collect()
        }
        self.sensors();
        self.missing.extend(self.slow_missing.clone());
    }
    fn processes(&mut self, dt: f64) {
        let hz = *self.previous.entry("clockTicks".into()).or_insert_with(|| {
            command(&["getconf", "CLK_TCK"])
                .map(|s| number(s.trim()))
                .unwrap_or(0.)
        });
        let pages = *self.previous.entry("pageSize".into()).or_insert_with(|| {
            command(&["getconf", "PAGESIZE"])
                .map(|s| number(s.trim()))
                .unwrap_or(0.)
        });
        let mut current = BTreeMap::new();
        let mut rows = vec![];
        let mut threads = 0.;
        if let Ok(entries) = std::fs::read_dir("/proc") {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let Ok(pid) = name.parse::<u32>() else {
                    continue;
                };
                let base = entry.path();
                let raw = read(base.join("stat"));
                let (Some(start), Some(end)) = (raw.find('('), raw.rfind(')')) else {
                    continue;
                };
                if end <= start {
                    continue;
                }
                let f: Vec<_> = raw[end + 1..].split_whitespace().collect();
                if f.len() < 22 {
                    continue;
                };
                let identity = format!("{pid}:{}", f[19]);
                let count = number(f[11]) + number(f[12]);
                current.insert(identity.clone(), count);
                let cpu = if hz > 0. {
                    rate(count, self.procs.get(&identity).copied(), dt) / hz * 100.
                } else {
                    0.
                };
                let rss = number(f[21]).max(0.) * pages;
                let mut cmd = read(base.join("cmdline"))
                    .replace('\0', " ")
                    .trim()
                    .to_owned();
                if cmd.is_empty() {
                    cmd = raw[start + 1..end].into()
                };
                let user = read(base.join("status"))
                    .lines()
                    .find(|l| l.starts_with("Uid:"))
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("—")
                    .to_owned();
                threads += number(f[17]);
                rows.push(json!({"pid":pid,"name":&raw[start+1..end],"cpu":cpu,"mem":rss/n(&self.sample["memory"]["total"]).max(1.)*100.,"rss":rss,"threads":number(f[17]),"state":f[0],"user":user,"command":cmd}));
                if rows.len() >= 10000 {
                    self.missing.push("process list truncated at 10000".into());
                    break;
                }
            }
        }
        self.procs = current;
        self.sample["system"]["processCount"] = json!(rows.len());
        self.sample["system"]["threadCount"] = json!(threads);
        self.sample["processes"] = json!(rows);
        if hz == 0. || pages == 0. {
            self.missing.push("process CPU clock/page size".into())
        }
    }
    fn network(&mut self, dt: f64) {
        let mut old: BTreeMap<_, _> = array(&self.sample["telemetry"]["interfaces"])
            .iter()
            .map(|i| (text(&i["name"]), i.clone()))
            .collect();
        let mut interfaces = vec![];
        for line in read("/proc/net/dev").lines() {
            let Some((name, raw)) = line.split_once(':') else {
                continue;
            };
            let name = name.trim();
            let f: Vec<_> = raw.split_whitespace().collect();
            if f.len() < 16 {
                continue;
            };
            let mut v = old
                .remove(name)
                .unwrap_or(json!({"name":name,"ip":"","rxHistory":[],"txHistory":[]}));
            v["state"] = json!(read(format!("/sys/class/net/{name}/operstate")).trim());
            v["mac"] = json!(read(format!("/sys/class/net/{name}/address")).trim());
            v["mtu"] = json!(number(read(format!("/sys/class/net/{name}/mtu")).trim()));
            v["rxTotal"] = json!(number(f[0]));
            v["txTotal"] = json!(number(f[8]));
            let rx = self.delta(&format!("{name}.rx"), number(f[0]), dt);
            let tx = self.delta(&format!("{name}.tx"), number(f[8]), dt);
            v["rxRate"] = json!(rx);
            v["txRate"] = json!(tx);
            v["errors"] = json!(number(f[2]) + number(f[10]));
            v["drops"] = json!(number(f[3]) + number(f[11]));
            push(&mut v, "rxHistory", rx);
            push(&mut v, "txHistory", tx);
            interfaces.push(v)
        }
        for (dir, prefix) in [("down", "rx"), ("up", "tx")] {
            let rate: f64 = interfaces
                .iter()
                .filter(|i| i["name"] != "lo")
                .map(|i| n(&i[format!("{prefix}Rate")]))
                .sum();
            let total: f64 = interfaces
                .iter()
                .filter(|i| i["name"] != "lo")
                .map(|i| n(&i[format!("{prefix}Total")]))
                .sum();
            let net = &mut self.sample["network"];
            net[format!("{dir}Rate")] = json!(rate);
            net[format!("{dir}Total")] = json!(total);
            net[format!("{dir}Peak")] = json!(n(&net[format!("{dir}Peak")]).max(rate));
            push(net, &format!("{dir}History"), rate)
        }
        self.sample["telemetry"]["interfaces"] = json!(interfaces);
        let raw = read("/proc/net/snmp");
        let lines: Vec<_> = raw.lines().collect();
        let mut counts = BTreeMap::new();
        for pair in lines.chunks_exact(2) {
            let keys: Vec<_> = pair[0].split_whitespace().collect();
            let vals: Vec<_> = pair[1].split_whitespace().collect();
            for (key, value) in keys.iter().skip(1).zip(vals.iter().skip(1)) {
                counts.insert(
                    format!("{}{key}", keys[0].trim_end_matches(':')),
                    number(value),
                );
            }
        }
        let keys: Vec<_> = self.sample["telemetry"]["net"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        for key in keys {
            let source = if key == "tcpEstablished" {
                "TcpCurrEstab".into()
            } else if let Some(rest) = key.strip_prefix("icmp") {
                format!("Icmp{rest}")
            } else {
                format!("{}{}", key[..1].to_uppercase(), &key[1..])
            };
            if let Some(v) = counts.get(&source) {
                self.sample["telemetry"]["net"][&key] = json!(v)
            }
        }
        for (key, source) in [
            ("inSegs", "tcpInSegs"),
            ("outSegs", "tcpOutSegs"),
            ("retrans", "tcpRetransSegs"),
            ("activeOpens", "tcpActiveOpens"),
            ("passiveOpens", "tcpPassiveOpens"),
            ("udpIn", "udpInDatagrams"),
            ("udpOut", "udpOutDatagrams"),
        ] {
            let r = self.delta(source, n(&self.sample["telemetry"]["net"][source]), dt);
            self.sample["telemetry"]["net"]["rates"][key] = json!(r)
        }
        let tele = &mut self.sample["telemetry"];
        let r = n(&tele["net"]["rates"]["retrans"]) / n(&tele["net"]["rates"]["outSegs"]).max(1.);
        tele["net"]["retransRatio"] = json!(r);
        let inbound = n(&tele["net"]["rates"]["inSegs"]);
        let outbound = n(&tele["net"]["rates"]["outSegs"]);
        push(tele, "netInHistory", inbound);
        push(tele, "netOutHistory", outbound);
        push(tele, "retransHistory", r * 100.);
    }
    fn disks(&mut self, dt: f64) {
        let mut old: BTreeMap<_, _> = array(&self.sample["disks"])
            .iter()
            .map(|d| (text(&d["device"]), d.clone()))
            .collect();
        let mut disks = vec![];
        for line in read("/proc/diskstats").lines() {
            let f: Vec<_> = line.split_whitespace().collect();
            if f.len() < 14 || f[2].starts_with("loop") || f[2].starts_with("ram") {
                continue;
            };
            let name = f[2];
            let mut d=old.remove(name).unwrap_or(json!({"device":name,"mount":"","type":"block","used":0,"total":0,"readHistory":[],"writeHistory":[]}));
            for (dir, index) in [("read", 5), ("write", 9)] {
                let r = self.delta(&format!("{dir}.{name}"), number(f[index]) * 512., dt);
                d[format!("{dir}Rate")] = json!(r);
                push(&mut d, &format!("{dir}History"), r)
            }
            disks.push(d);
            if disks.len() >= 128 {
                break;
            }
        }
        self.sample["disks"] = json!(disks)
    }
    fn sensors(&mut self) {
        let readings = crate::sensors::collect(
            Path::new("/"),
            &read("/proc/cpuinfo"),
            &self.sample["telemetry"]["gpus"],
            || command(&["sensors", "-j"]),
        );
        if readings.temperatures.is_empty() {
            self.missing.push("temperatures".into());
        }
        if readings.hardware_count == 0 {
            self.missing.push("fans/voltage/power".into());
        }
        self.sample["temperatures"] = json!(readings.temperatures);
        self.sample["sensors"] = json!(readings.sensors);
        self.sample["telemetry"]["power"] = readings.power;
    }
    fn slow_collect(&mut self) {
        let mut missing = vec![];
        self.sample["telemetry"]["gpus"] = crate::sensors::parse_gpus(&command(&[
            "nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
            "--format=csv,noheader,nounits",
        ]).unwrap_or_default());
        if array(&self.sample["telemetry"]["gpus"]).is_empty() {
            missing.push("GPU telemetry".into());
        }
        let mut run = |label: &str, args: &[&str]| {
            command(args).unwrap_or_else(|| {
                missing.push(label.to_owned());
                String::new()
            })
        };
        let sessions:Vec<Value>=run("sessions",&["who"]).lines().filter_map(|line|{let f:Vec<_>=line.split_whitespace().collect();if f.len()<4{return None}Some(json!({"user":f[0],"tty":f[1],"loginAt":f[2..4].join(" "),"from":f[4..].join(" "),"idle":"—","what":"—"}))}).collect();
        let count = sessions.len() as f64;
        self.sample["telemetry"]["sessions"] = json!(sessions);
        push(&mut self.sample["telemetry"], "sessionHistory", count);
        let services: Vec<Value> = run(
            "services",
            &[
                "systemctl",
                "list-units",
                "--type=service",
                "--all",
                "--no-legend",
                "--no-pager",
                "--plain",
            ],
        )
        .lines()
        .take(1000)
        .filter_map(|line| {
            let f: Vec<_> = line.split_whitespace().collect();
            if f.len() < 5 {
                return None;
            }
            Some(json!({"name":f[0],"active":f[2],"sub":f[3],"description":f[4..].join(" ")}))
        })
        .collect();
        self.sample["telemetry"]["services"] = json!(services);
        let mut connections = vec![];
        let mut listeners = vec![];
        for line in run("sockets", &["ss", "-H", "-tuna", "-p"])
            .lines()
            .take(5000)
        {
            let f: Vec<_> = line.split_whitespace().collect();
            if f.len() < 6 {
                continue;
            }
            let process = f[6..].join(" ");
            connections.push(
                json!({"proto":f[0],"state":f[1],"local":f[4],"remote":f[5],"process":process}),
            );
            if matches!(f[1], "LISTEN" | "UNCONN") {
                if let Some((address, port)) = f[4].rsplit_once(':') {
                    listeners.push(
                        json!({"proto":f[0],"address":address,"port":port,"process":process}),
                    );
                }
            }
        }
        let count = connections.len() as f64;
        let tele = &mut self.sample["telemetry"];
        tele["connections"] = json!(connections);
        tele["listeners"] = json!(listeners);
        push(tele, "connectionHistory", count);
        let journal:Vec<Value>=run("journal",&["journalctl","-n","100","--no-pager","-o","json"]).lines().filter_map(|line|{let row:Value=serde_json::from_str(line).ok()?;Some(json!({"time":row["__REALTIME_TIMESTAMP"],"level":row["PRIORITY"],"unit":row["_SYSTEMD_UNIT"],"message":row["MESSAGE"],"meta":""}))}).collect();
        self.sample["telemetry"]["journal"] = json!(journal);
        self.sample["logs"] = json!(journal);
        let filesystems:Vec<Value>=run("filesystems",&["df","-PT","-B1"]).lines().skip(1).take(128).filter_map(|line|{let f:Vec<_>=line.split_whitespace().collect();if f.len()!=7{return None}Some(json!({"device":f[0],"type":f[1],"size":number(f[2]),"used":number(f[3]),"mount":f[6]}))}).collect();
        for fs in &filesystems {
            for d in self.sample["disks"].as_array_mut().unwrap() {
                if text(&fs["device"]).rsplit('/').next() == Some(text(&d["device"]).as_str()) {
                    d["mount"] = fs["mount"].clone();
                    d["total"] = fs["size"].clone();
                    d["used"] = fs["used"].clone();
                }
            }
        }
        self.sample["telemetry"]["filesystems"] = json!(filesystems);
        missing.extend(
            [
                "connection direction/application protocols",
                "login history",
                "SSH authentication log",
                "HTTP access log",
            ]
            .map(str::to_owned),
        );
        self.slow_missing = missing;
    }
}
