//! Native Traffic/Sessions sources. Port classification is an estimate, not DPI.
use crate::model::{array, n, text};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{File, Metadata},
    io::{Read, Seek, SeekFrom},
    path::Path,
    time::Instant,
};
const PORTS:&str="20=FTP 21=FTP 22=SSH 23=Telnet 25=SMTP 53=DNS 67=DHCP 68=DHCP 80=HTTP 110=POP3 111=RPC 123=NTP 143=IMAP 161=SNMP 389=LDAP 443=HTTPS 445=SMB 465=SMTPS 514=Syslog 587=SMTP 631=IPP 636=LDAPS 993=IMAPS 995=POP3S 1194=OpenVPN 1433=MSSQL 1521=Oracle 2049=NFS 2379=etcd 3000=HTTP-dev 3306=MySQL 3389=RDP 4000=HTTP-dev 5000=HTTP-dev 5432=Postgres 5672=AMQP 5900=VNC 6379=Redis 8000=HTTP-alt 8080=HTTP-alt 8443=HTTPS-alt 9000=HTTP-alt 9090=Prometheus 9200=Elasticsearch 11211=Memcached 27017=MongoDB 41641=Tailscale 51820=WireGuard";
fn classify(port: &str) -> String {
    for pair in PORTS.split_whitespace() {
        if let Some((key, value)) = pair.split_once('=') {
            if key == port {
                return value.into();
            }
        }
    }
    if port.parse::<u32>().unwrap_or(0) >= 32768 {
        "ephemeral".into()
    } else {
        format!("port {port}")
    }
}
fn endpoint(s: &str) -> (&str, &str) {
    s.rsplit_once(':').unwrap_or((s, ""))
}
pub fn breakdown(connections: &Value, listeners: &Value) -> Value {
    let listening: BTreeSet<_> = array(listeners).iter().map(|v| text(&v["port"])).collect();
    let mut buckets: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    let mut remotes: BTreeMap<String, (u64, BTreeSet<String>)> = BTreeMap::new();
    let (mut inbound, mut outbound) = (0, 0);
    for c in array(connections) {
        let state = text(&c["state"]);
        if state == "LISTEN" || (state != "ESTAB" && !text(&c["proto"]).starts_with("udp")) {
            continue;
        }
        let local = text(&c["local"]);
        let remote = text(&c["remote"]);
        let (_, lp) = endpoint(&local);
        let (host, rp) = endpoint(&remote);
        let incoming = listening.contains(lp);
        let protocol = classify(if incoming { lp } else { rp });
        let bucket = buckets.entry(protocol.clone()).or_default();
        if incoming {
            bucket.0 += 1;
            inbound += 1
        } else {
            bucket.1 += 1;
            outbound += 1
        }
        if !host.is_empty() && host != "*" && host != "0.0.0.0" {
            let entry = remotes.entry(host.into()).or_default();
            entry.0 += 1;
            entry.1.insert(protocol);
        }
    }
    let mut protocols: Vec<Value> = buckets
        .into_iter()
        .map(|(protocol, (i, o))| json!({"protocol":protocol,"inbound":i,"outbound":o,"total":i+o}))
        .collect();
    protocols.sort_by(|a, b| n(&b["total"]).total_cmp(&n(&a["total"])));
    let mut remotes:Vec<Value>=remotes.into_iter().map(|(host,(count,protocols))|json!({"host":host,"connections":count,"protocols":protocols.into_iter().take(3).collect::<Vec<_>>().join(", ")})).collect();
    remotes.sort_by(|a, b| n(&b["connections"]).total_cmp(&n(&a["connections"])));
    remotes.truncate(12);
    json!({"protocols":protocols,"remotes":remotes,"inboundConnections":inbound,"outboundConnections":outbound})
}
pub fn sessions(raw: &str) -> Value {
    json!(raw.lines().filter_map(|line|{let f:Vec<_>=line.split_whitespace().collect();if f.len()<4{return None}let origin=line.split_once('(').and_then(|(_,s)|s.split_once(')')).map(|(s,_)|s).unwrap_or("local");Some(json!({"user":f[0],"tty":f[1],"loginAt":f[2..4].join(" "),"idle":f.get(4).unwrap_or(&"."),"what":f.get(5).unwrap_or(&""),"from":origin}))}).take(1000).collect::<Vec<_>>())
}
pub fn logins(raw: &str, status: &str) -> Value {
    json!(raw.lines().filter_map(|line|{let f:Vec<_>=line.split_whitespace().collect();if f.len()<4||matches!(f[0],"wtmp"|"btmp"|"reboot"){return None}let when=f[f.len().saturating_sub(7)..f.len()-3].join(" ");Some(json!({"user":f[0],"tty":f[1],"from":if f[2].contains(['.',':']){f[2]}else{"local"},"when":if when.is_empty(){f[3..f.len().min(7)].join(" ")}else{when},"status":if line.contains("still logged in"){"still"}else{status}}))}).take(40).collect::<Vec<_>>())
}
fn timestamp(line: &str) -> &str {
    for (i, w) in line.as_bytes().windows(8).enumerate() {
        if i > 0 && line.as_bytes()[i - 1].is_ascii_digit() {
            continue;
        }
        if w[2] == b':' && w[5] == b':' && [0, 1, 3, 4, 6, 7].iter().all(|j| w[*j].is_ascii_digit())
        {
            return &line[i..i + 8];
        }
    }
    ""
}
pub fn ssh(raw: &str) -> Value {
    let mut out = vec![];
    for line in raw.lines() {
        if !line.contains("sshd") {
            continue;
        }
        let f: Vec<_> = line.split_whitespace().collect();
        let mut row = None;
        for (i, word) in f.iter().enumerate() {
            if matches!(*word, "Accepted" | "Failed") && f.get(i + 2) == Some(&"for") {
                let invalid = f.get(i + 3) == Some(&"invalid") && f.get(i + 4) == Some(&"user");
                let at = i + if invalid { 5 } else { 3 };
                if f.get(at + 1) == Some(&"from") {
                    if let Some(origin) = f.get(at + 2) {
                        row = Some(
                            json!({"time":timestamp(line),"action":if *word=="Accepted"{"accepted"}else if invalid{"invalid"}else{"failed"},"method":f[i+1],"user":f[at],"from":origin}),
                        );
                        break;
                    }
                }
            }
            if *word == "Disconnected" && f.get(i + 1) == Some(&"from") {
                let at = i + if f.get(i + 2) == Some(&"authenticating") {
                    3
                } else {
                    2
                };
                if f.get(at) == Some(&"user") {
                    if let (Some(user), Some(origin)) = (f.get(at + 1), f.get(at + 2)) {
                        row = Some(
                            json!({"time":timestamp(line),"action":"disconnect","user":user,"from":origin,"method":"-"}),
                        );
                        break;
                    }
                }
            }
        }
        if let Some(row) = row {
            out.push(row)
        }
    }
    let start = out.len().saturating_sub(40);
    json!(out[start..])
}
pub fn tail(path: &Path) -> Option<(String, Metadata)> {
    let mut f = File::open(path).ok()?;
    let info = f.metadata().ok()?;
    let start = info.len().saturating_sub(256 * 1024);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut raw = vec![];
    f.take(256 * 1024).read_to_end(&mut raw).ok()?;
    let start = if start > 0 {
        raw.iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(raw.len())
    } else {
        0
    };
    Some((String::from_utf8_lossy(&raw[start..]).into_owned(), info))
}
pub fn http_stats(raw: &str, source: &str) -> Value {
    let mut recent = vec![];
    let mut counts: [BTreeMap<String, u64>; 4] = std::array::from_fn(|_| BTreeMap::new());
    let mut upgrades = 0;
    for line in raw.lines() {
        let Some((prefix, rest)) = line.split_once(" [") else {
            continue;
        };
        let Some((stamp, rest)) = rest.split_once("] \"") else {
            continue;
        };
        let Some((request, suffix)) = rest.split_once("\" ") else {
            continue;
        };
        let f: Vec<_> = request.split_whitespace().collect();
        let stats: Vec<_> = suffix.split_whitespace().collect();
        if f.len() < 2
            || stats.len() < 2
            || stats[0].len() != 3
            || !stats[0].bytes().all(|b| b.is_ascii_digit())
        {
            continue;
        }
        let Some(client) = prefix.split_whitespace().next() else {
            continue;
        };
        let path: String = f[1]
            .split('?')
            .next()
            .unwrap_or("")
            .chars()
            .take(60)
            .collect();
        let status = stats[0];
        let keys = [
            format!("{}xx", &status[..1]),
            path.clone(),
            client.into(),
            f[0].into(),
        ];
        for (i, key) in keys.into_iter().enumerate() {
            *counts[i].entry(key).or_default() += 1
        }
        if status == "101" {
            upgrades += 1
        }
        recent.push(json!({"time":timestamp(stamp),"method":f[0],"path":path,"status":status,"client":client,"bytes":stats[1].parse::<u64>().unwrap_or(0)}));
    }
    let total = recent.len();
    recent.reverse();
    recent.truncate(40);
    let mut out = json!({"source":source,"requestsPerSecond":0,"total":total,"upgrades":upgrades,"recent":recent,"history":[]});
    for (i, (dest, key, limit)) in [
        ("statusClasses", "class", 6),
        ("topPaths", "path", 10),
        ("topClients", "client", 8),
        ("methods", "method", 6),
    ]
    .into_iter()
    .enumerate()
    {
        let mut items: Vec<_> = counts[i].iter().collect();
        items.sort_by(|a, b| b.1.cmp(a.1));
        out[dest] = json!(items
            .into_iter()
            .take(limit)
            .map(|(name, count)| json!({key:name,"count":count}))
            .collect::<Vec<_>>());
    }
    out
}
#[derive(Default)]
pub struct HttpCollector {
    previous: Option<(String, u64, u64, Instant)>,
    history: Vec<f64>,
}
fn inode(info: &Metadata) -> u64 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        info.ino()
    }
    #[cfg(not(unix))]
    {
        let _ = info;
        0
    }
}
impl HttpCollector {
    pub fn sample(&mut self, root: &Path, now: Instant) -> Value {
        for candidate in [
            "var/log/nginx/access.log",
            "var/log/apache2/access.log",
            "var/log/httpd/access_log",
            "var/log/caddy/access.log",
        ] {
            let path = root.join(candidate);
            let Some((raw, info)) = tail(&path) else {
                continue;
            };
            if raw.is_empty() {
                continue;
            }
            let path = path.to_string_lossy().into_owned();
            let mut out = http_stats(&raw, &path);
            let mut rate = 0.;
            if let Some((old, ino, size, at)) = &self.previous {
                if *old == path && *ino == inode(&info) && info.len() > *size && now > *at {
                    let average = raw.len() as f64 / raw.lines().count().max(1) as f64;
                    rate = (info.len() - size) as f64
                        / average.max(1.)
                        / now.duration_since(*at).as_secs_f64();
                }
            }
            self.previous = Some((path, inode(&info), info.len(), now));
            self.history.push(rate);
            if self.history.len() > 240 {
                self.history.remove(0);
            }
            out["requestsPerSecond"] = json!(rate);
            out["history"] = json!(self.history);
            return out;
        }
        self.previous = None;
        self.history.clear();
        Value::Null
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../conformance/fixtures/demo-traffic.json"
        ))
        .unwrap()
    }
    #[test]
    fn sources_and_tabs_render() {
        let f = fixture();
        let mut state = crate::model::State::new(true, 42);
        let t = &mut state.sample["telemetry"];
        let split = breakdown(&f["connections"], &f["listeners"]);
        assert_eq!(split["inboundConnections"], 1);
        assert_eq!(split["outboundConnections"], 2);
        assert_eq!(array(&split["protocols"]).len(), 3);
        for key in [
            "protocols",
            "remotes",
            "inboundConnections",
            "outboundConnections",
        ] {
            t[key] = split[key].clone();
        }
        t["sessions"] = sessions(f["who"].as_str().unwrap());
        assert_eq!(t["sessions"][0]["from"], "203.0.113.4");
        t["logins"] = logins(f["last"].as_str().unwrap(), "ok");
        assert_eq!(array(&t["logins"]).len(), 1);
        assert_eq!(t["logins"][0]["status"], "still");
        t["failedLogins"] = logins(f["lastb"].as_str().unwrap(), "failed");
        t["ssh"] = ssh(f["ssh"].as_str().unwrap());
        assert_eq!(
            array(&t["ssh"])
                .iter()
                .map(|e| text(&e["action"]))
                .collect::<Vec<_>>(),
            vec!["accepted", "invalid", "disconnect"]
        );
        t["http"] = http_stats(f["http"].as_str().unwrap(), "fixture");
        assert_eq!(t["http"]["total"], 3);
        assert_eq!(t["http"]["upgrades"], 1);
        assert_eq!(t["http"]["recent"][0]["path"], "/chat");
        assert_eq!(t["http"]["recent"][0]["time"], "10:01:02");
        assert!(!t["http"].to_string().contains("secret"));
        assert_eq!(t["http"]["statusClasses"][0]["count"], 1);
        for (screen, labels) in [
            (1, vec!["HTTPS", "SSH", "accepted", "/chat"]),
            (2, vec!["alice", "eve", "still"]),
        ] {
            state.screen = screen;
            let frame =
                crate::render_to_screen(240, 80, "dark", |ui| crate::view::render(ui, &state));
            for label in labels {
                assert!(frame.contains(label), "screen {screen}: {label}");
            }
        }
        assert!(array(&ssh("")).is_empty());
        assert!(array(&logins("", "ok")).is_empty());
    }
    #[test]
    fn http_growth_rotation_and_missing() {
        struct Temp(std::path::PathBuf);
        impl Drop for Temp {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let root = Temp(std::env::temp_dir().join(format!(
                "hqtui-http-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            )));
        let path = root.0.join("var/log/nginx/access.log");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let raw = text(&fixture()["http"]);
        std::fs::write(&path, &raw).unwrap();
        let mut c = HttpCollector::default();
        let now = Instant::now();
        assert_eq!(n(&c.sample(&root.0, now)["requestsPerSecond"]), 0.);
        std::fs::write(&path, raw.repeat(2)).unwrap();
        assert!(
            n(&c.sample(&root.0, now + std::time::Duration::from_secs(1))["requestsPerSecond"])
                > 0.
        );
        std::fs::rename(&path, path.with_extension("old")).unwrap();
        std::fs::write(&path, raw.repeat(3)).unwrap();
        assert_eq!(
            n(&c.sample(&root.0, now + std::time::Duration::from_secs(2))["requestsPerSecond"]),
            0.
        );
        std::fs::write(&path, &raw).unwrap();
        assert_eq!(
            n(&c.sample(&root.0, now + std::time::Duration::from_secs(3))["requestsPerSecond"]),
            0.
        );
        std::fs::write(&path, format!("{}\n{raw}", "x".repeat(300000))).unwrap();
        assert!(tail(&path).unwrap().0.len() <= 256 * 1024);
        std::fs::remove_file(&path).unwrap();
        assert!(c
            .sample(&root.0, now + std::time::Duration::from_secs(4))
            .is_null());
    }
}
