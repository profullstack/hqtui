//! Read-only Linux sensor sources, matching the TypeScript collector's routes.
//! The root is explicit for fixture tests; production uses `/`.
use crate::collect::read;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn path(root: &Path, absolute: &str) -> PathBuf {
    root.join(absolute.trim_start_matches('/'))
}
fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<_> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .take(4096)
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}
fn finite(raw: &str) -> Option<f64> {
    raw.trim().parse::<f64>().ok().filter(|n| n.is_finite())
}
fn positive(raw: &str) -> Option<f64> {
    finite(raw).filter(|n| *n > 0.)
}
fn input(name: &str, prefix: &str, suffix: &str) -> bool {
    name.strip_prefix(prefix)
        .and_then(|s| s.strip_suffix(suffix))
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()))
}
fn label(dir: &Path, name: &str, chip: &str, fallback: &str) -> String {
    let named = read(
        dir.join(
            name.replace("_input", "_label")
                .replace("_average", "_label"),
        ),
    );
    if !named.trim().is_empty() {
        named.trim().into()
    } else if !chip.is_empty() {
        format!("{chip} {fallback}")
    } else {
        fallback.into()
    }
}

pub struct Readings {
    pub temperatures: Vec<Value>,
    pub sensors: Vec<Value>,
    pub hardware_count: usize,
    pub power: Value,
}
pub fn collect(
    root: &Path,
    cpuinfo: &str,
    gpus: &Value,
    lm_sensors: impl FnOnce() -> Option<String>,
) -> Readings {
    let mut temperatures = vec![];
    let mut hardware = vec![];
    let base = path(root, "/sys/class/hwmon");
    for name in entries(&base).into_iter().take(128) {
        let dir = base.join(&name);
        let chip = read(dir.join("name"));
        let old_chip = read(dir.join("device/name"));
        let chip = if !chip.trim().is_empty() {
            chip.trim()
        } else if !old_chip.trim().is_empty() {
            old_chip.trim()
        } else {
            &name
        };
        for dir in [dir.clone(), dir.join("device")] {
            for name in entries(&dir) {
                if input(&name, "temp", "_input") && temperatures.len() < 12 {
                    let Some(value) = positive(&read(dir.join(&name)))
                        .map(|n| n / 1000.)
                        .filter(|n| *n <= 150.)
                    else {
                        continue;
                    };
                    let max = positive(&read(dir.join(name.replace("_input", "_crit"))))
                        .map(|n| n / 1000.)
                        .unwrap_or(100.);
                    temperatures.push(json!({"label":label(&dir,&name,chip,name.trim_end_matches("_input")),"value":value,"max":max}));
                } else if hardware.len() < 14 {
                    let kind = if input(&name, "fan", "_input") {
                        "fan"
                    } else if input(&name, "in", "_input") {
                        "voltage"
                    } else if input(&name, "power", "_input") || input(&name, "power", "_average") {
                        "power"
                    } else if input(&name, "curr", "_input") {
                        "current"
                    } else {
                        continue;
                    };
                    let Some(value) = positive(&read(dir.join(&name))) else {
                        continue;
                    };
                    let fallback = name.trim_end_matches("_input").trim_end_matches("_average");
                    let fallback = if kind == "fan" {
                        fallback.replacen("fan", "Fan ", 1)
                    } else {
                        fallback.into()
                    };
                    let value = match kind {
                        "fan" => format!("{:.0} RPM", (value + 0.5).floor()),
                        "voltage" => format!("{:.2} V", value / 1000.),
                        "power" => format!("{:.1} W", value / 1e6),
                        _ => format!("{:.2} A", value / 1000.),
                    };
                    hardware.push(json!({"label":label(&dir,&name,chip,&fallback),"value":value}));
                }
            }
        }
    }
    if temperatures.is_empty() {
        let base = path(root, "/sys/class/thermal");
        for zone in entries(&base)
            .into_iter()
            .filter(|n| n.starts_with("thermal_zone"))
            .take(128)
        {
            let dir = base.join(&zone);
            let Some(value) = positive(&read(dir.join("temp")))
                .map(|n| n / 1000.)
                .filter(|n| *n <= 150.)
            else {
                continue;
            };
            let name = read(dir.join("type"));
            temperatures.push(json!({"label":if name.trim().is_empty(){&zone}else{name.trim()},"value":value,"max":100}));
            if temperatures.len() == 12 {
                break;
            }
        }
    }
    if temperatures.is_empty() {
        if let Some(raw) = lm_sensors() {
            temperatures = parse_lm_sensors(&raw);
        }
    }
    let hardware_count = hardware.len();
    let power = power(root);
    if !power.is_null() {
        hardware.push(json!({"label":"Battery","value":format!("{}% ({})",power["battery"].as_f64().unwrap_or_default(),power["timeRemaining"].as_str().unwrap_or("unknown"))}));
        if let Some(watts) = power["powerDraw"].as_f64().filter(|w| *w > 0.) {
            hardware.push(json!({"label":"Battery draw","value":format!("{watts:.1} W")}));
        }
    }
    for gpu in gpus.as_array().into_iter().flatten().take(16) {
        let Some(name) = gpu["name"].as_str() else {
            continue;
        };
        let utilization = gpu["utilization"]
            .as_f64()
            .map(|n| format!("{:.0}%", (n * 100. + 0.5).floor()))
            .unwrap_or("unavailable".into());
        let temperature = gpu["temperature"]
            .as_f64()
            .map(|n| format!("{n}°C"))
            .unwrap_or("temperature unavailable".into());
        hardware.push(json!({"label":name,"value":format!("{utilization} · {temperature}")}));
    }
    let base = path(root, "/sys/devices/system/cpu");
    let mut cpus: Vec<_> = entries(&base)
        .into_iter()
        .filter_map(|name| {
            let index = name.strip_prefix("cpu")?.parse::<u32>().ok()?;
            Some((index, name))
        })
        .collect();
    cpus.sort_by_key(|(index, _)| *index);
    let mut clocks = vec![];
    for (_, cpu) in cpus.into_iter().take(4) {
        if let Some(khz) = positive(&read(base.join(&cpu).join("cpufreq/scaling_cur_freq"))) {
            clocks
                .push(json!({"label":format!("{cpu} clock"),"value":format!("{:.2} GHz",khz/1e6)}));
        }
    }
    if clocks.is_empty() {
        for mhz in cpuinfo
            .lines()
            .filter_map(|line| {
                let (key, value) = line.split_once(':')?;
                (key.trim() == "cpu MHz").then(|| positive(value)).flatten()
            })
            .take(4)
        {
            clocks.push(json!({"label":format!("cpu{} clock",clocks.len()),"value":format!("{:.2} GHz",mhz/1000.)}));
        }
    }
    hardware.extend(clocks);
    hardware.truncate(14);
    Readings {
        temperatures,
        sensors: hardware,
        hardware_count,
        power,
    }
}

pub fn parse_lm_sensors(raw: &str) -> Vec<Value> {
    let Ok(Value::Object(chips)) = serde_json::from_str::<Value>(raw) else {
        return vec![];
    };
    let mut out = vec![];
    for (chip, features) in chips {
        let Some(features) = features.as_object() else {
            continue;
        };
        for (feature, values) in features {
            let Some(values) = values.as_object() else {
                continue;
            };
            for (key, value) in values {
                if !input(key, "temp", "_input") {
                    continue;
                }
                let Some(value) = value
                    .as_f64()
                    .filter(|v| v.is_finite() && *v > 0. && *v <= 150.)
                else {
                    continue;
                };
                out.push(json!({"label":format!("{} {feature}",chip.split('-').next().unwrap_or(&chip)),"value":value,"max":100}));
                if out.len() == 12 {
                    return out;
                }
                break;
            }
        }
    }
    out
}
pub fn parse_gpus(raw: &str) -> Value {
    let mut out = vec![];
    for line in raw.lines().take(16) {
        let fields: Vec<_> = line.split(',').map(str::trim).collect();
        if fields.len() != 6 || fields[0].is_empty() {
            continue;
        }
        out.push(json!({"name":fields[0],"utilization":finite(fields[1]).map(|n|n/100.),
            "memoryUsed":finite(fields[2]).map(|n|n*1048576.),"memoryTotal":finite(fields[3]).map(|n|n*1048576.),
            "temperature":finite(fields[4]),"power":finite(fields[5])}));
    }
    json!(out)
}
fn power(root: &Path) -> Value {
    let base = path(root, "/sys/class/power_supply");
    let names = entries(&base);
    let ac = names.iter().any(|name| {
        read(base.join(name).join("type")).trim() == "Mains"
            && read(base.join(name).join("online")).trim() == "1"
    });
    for name in names.into_iter().take(128) {
        let dir = base.join(name);
        if read(dir.join("type")).trim() != "Battery" {
            continue;
        }
        let Some(capacity) =
            finite(&read(dir.join("capacity"))).filter(|n| (0. ..=100.).contains(n))
        else {
            continue;
        };
        let status = read(dir.join("status"));
        let watts = finite(&read(dir.join("power_now")))
            .map(|n| n / 1e6)
            .or_else(|| {
                Some(
                    finite(&read(dir.join("current_now")))?
                        * finite(&read(dir.join("voltage_now")))?
                        / 1e12,
                )
            });
        return json!({"battery":capacity,"charging":status.trim()=="Charging","timeRemaining":status.trim(),"powerDraw":watts,"acConnected":ac});
    }
    Value::Null
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static SEQUENCE: AtomicUsize = AtomicUsize::new(0);
            let root = std::env::temp_dir().join(format!(
                "hqtui-sensors-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn put(&self, name: &str, value: &str) {
            let file = self.0.join(name);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, value).unwrap();
        }
        fn read(&self, cpu: &str) -> Readings {
            collect(&self.0, cpu, &json!([]), || None)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn sensor(readings: &Readings, label: &str) -> Option<String> {
        readings
            .sensors
            .iter()
            .find(|s| s["label"] == label)
            .and_then(|s| s["value"].as_str().map(str::to_owned))
    }
    #[test]
    fn hwmon_sources_and_changed_readings() {
        let f = Fixture::new();
        for (name, value) in [
            ("hwmon0/name", "coretemp"),
            ("hwmon0/temp1_input", "52000"),
            ("hwmon0/temp1_label", "Package id 0"),
            ("hwmon0/temp1_crit", "100000"),
            ("hwmon0/temp2_input", "49000"),
            ("hwmon0/temp3_input", "900000"),
            ("hwmon0/temp4_input", "0"),
            ("hwmon1/name", "nct6775"),
            ("hwmon1/fan1_input", "2140"),
            ("hwmon1/fan1_label", "CPU Fan"),
            ("hwmon1/fan2_input", "0"),
            ("hwmon1/in0_input", "1104"),
            ("hwmon1/in0_label", "Vcore"),
            ("hwmon1/power1_average", "14300000"),
            ("hwmon1/curr1_input", "2500"),
            ("hwmon2/device/temp1_input", "41000"),
        ] {
            f.put(&format!("sys/class/hwmon/{name}"), value);
        }
        f.put(
            "sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq",
            "2900000",
        );
        f.put(
            "sys/devices/system/cpu/cpu1/cpufreq/scaling_cur_freq",
            "3100000",
        );
        let first = f.read("cpu MHz : 9000");
        assert_eq!(
            first
                .temperatures
                .iter()
                .map(|t| t["value"].as_f64().unwrap())
                .collect::<Vec<_>>(),
            vec![52., 49., 41.]
        );
        assert_eq!(first.hardware_count, 4);
        for (label, value) in [
            ("CPU Fan", "2140 RPM"),
            ("Vcore", "1.10 V"),
            ("nct6775 power1", "14.3 W"),
            ("nct6775 curr1", "2.50 A"),
            ("cpu0 clock", "2.90 GHz"),
            ("cpu1 clock", "3.10 GHz"),
        ] {
            assert_eq!(sensor(&first, label).as_deref(), Some(value));
        }
        f.put("sys/class/hwmon/hwmon1/fan1_input", "2500");
        f.put("sys/class/hwmon/hwmon0/temp1_input", "57000");
        f.put(
            "sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq",
            "3300000",
        );
        let next = f.read("");
        assert_eq!(next.temperatures[0]["value"], 57.);
        assert_eq!(sensor(&next, "CPU Fan").as_deref(), Some("2500 RPM"));
        assert_eq!(sensor(&next, "cpu0 clock").as_deref(), Some("3.30 GHz"));
    }
    #[test]
    fn vm_cpuinfo_fallback_refreshes_without_inventing_hardware() {
        let f = Fixture::new();
        let first = f.read("cpu MHz : 2494.134\ncpu MHz : 2494.134\ncpu MHz : NaN");
        assert!(first.temperatures.is_empty());
        assert!(first.power.is_null());
        assert_eq!(first.hardware_count, 0);
        assert_eq!(first.sensors.len(), 2);
        assert_eq!(sensor(&first, "cpu0 clock").as_deref(), Some("2.49 GHz"));
        assert_eq!(
            sensor(&f.read("cpu MHz : 3200"), "cpu0 clock").as_deref(),
            Some("3.20 GHz")
        );
        assert!(f.read("").sensors.is_empty());
    }
    #[test]
    fn temperature_fallbacks_and_bad_input() {
        let f = Fixture::new();
        let raw = r#"{"coretemp-isa-0000":{"Package id 0":{"temp1_input":53},"bad":{"temp2_input":900}}}"#;
        let result = collect(&f.0, "", &json!([]), || Some(raw.into()));
        assert_eq!(result.temperatures.len(), 1);
        assert_eq!(result.temperatures[0]["value"], 53.);
        f.put("sys/class/thermal/thermal_zone0/temp", "44000");
        f.put("sys/class/thermal/thermal_zone0/type", "x86_pkg_temp");
        let result = collect(&f.0, "", &json!([]), || panic!("thermal source should win"));
        assert_eq!(result.temperatures[0]["value"], 44.);
        assert!(parse_lm_sensors("broken").is_empty());
    }
    #[test]
    fn battery_gpu_and_missing_numeric_values() {
        let f = Fixture::new();
        for (name, value) in [
            ("BAT0/type", "Battery"),
            ("BAT0/capacity", "87"),
            ("BAT0/status", "Discharging"),
            ("BAT0/current_now", "2000000"),
            ("BAT0/voltage_now", "12000000"),
            ("AC/type", "Mains"),
            ("AC/online", "1"),
        ] {
            f.put(&format!("sys/class/power_supply/{name}"), value);
        }
        let gpus = parse_gpus("RTX, 25, 100, 1000, 55, 30\nOther, N/A, N/A, N/A, N/A, N/A\nbroken");
        assert_eq!(gpus[0]["utilization"], 0.25);
        assert_eq!(gpus[0]["memoryUsed"], 104857600.);
        assert!(gpus[1]["temperature"].is_null());
        let result = collect(&f.0, "", &gpus, || None);
        assert_eq!(result.power["powerDraw"], 24.);
        assert_eq!(result.power["acConnected"], true);
        assert_eq!(
            sensor(&result, "Battery").as_deref(),
            Some("87% (Discharging)")
        );
        assert_eq!(sensor(&result, "RTX").as_deref(), Some("25% · 55°C"));
        assert_eq!(
            sensor(&result, "Other").as_deref(),
            Some("unavailable · temperature unavailable")
        );
    }
}
