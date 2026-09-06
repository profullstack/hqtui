package demo

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var sensorInput = regexp.MustCompile(`^(temp|fan|in|power|curr)([0-9]+)_(input|average)$`)
var cpuDirectory = regexp.MustCompile(`^cpu([0-9]+)$`)

func sensorNumber(raw string) (float64, bool) {
	v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return v, err == nil && !math.IsNaN(v) && !math.IsInf(v, 0)
}
func sensorPositive(raw string) (float64, bool) { v, ok := sensorNumber(raw); return v, ok && v > 0 }
func sensorEntries(path string) []string {
	dir, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer dir.Close()
	names, _ := dir.Readdirnames(4096)
	sort.Strings(names)
	return names
}

type sensorReadings struct {
	temperatures, sensors []any
	power                 any
	hardwareCount         int
}

func collectSensors(sysroot, cpuinfo string, gpus []any, lm func() string) sensorReadings {
	out := sensorReadings{temperatures: []any{}, sensors: []any{}}
	read := func(path string) string { return strings.TrimSpace(readFile(path)) }
	base := filepath.Join(sysroot, "class/hwmon")
	for i, folder := range sensorEntries(base) {
		if i >= 128 {
			break
		}
		dir := filepath.Join(base, folder)
		chip := read(filepath.Join(dir, "name"))
		if chip == "" {
			chip = read(filepath.Join(dir, "device/name"))
		}
		if chip == "" {
			chip = folder
		}
		for _, dir := range []string{dir, filepath.Join(dir, "device")} {
			for _, name := range sensorEntries(dir) {
				match := sensorInput.FindStringSubmatch(name)
				if match == nil {
					continue
				}
				kind, index, suffix := match[1], match[2], match[3]
				if suffix == "average" && kind != "power" {
					continue
				}
				value, ok := sensorPositive(read(filepath.Join(dir, name)))
				if !ok {
					continue
				}
				label := read(filepath.Join(dir, kind+index+"_label"))
				if label == "" {
					fallback := kind + index
					if kind == "fan" {
						fallback = "Fan " + index
					}
					label = chip + " " + fallback
				}
				if kind == "temp" {
					if value > 150000 || len(out.temperatures) >= 12 {
						continue
					}
					maximum, ok := sensorPositive(read(filepath.Join(dir, kind+index+"_crit")))
					if !ok {
						maximum = 100000
					}
					out.temperatures = append(out.temperatures, object{"label": label, "value": value / 1000, "max": maximum / 1000})
				} else if len(out.sensors) < 14 {
					text := ""
					switch kind {
					case "fan":
						text = fmt.Sprintf("%.0f RPM", math.Floor(value+.5))
					case "in":
						text = fmt.Sprintf("%.2f V", value/1000)
					case "power":
						text = fmt.Sprintf("%.1f W", value/1e6)
					case "curr":
						text = fmt.Sprintf("%.2f A", value/1000)
					}
					out.sensors = append(out.sensors, object{"label": label, "value": text})
				}
			}
		}
	}
	if len(out.temperatures) == 0 {
		base := filepath.Join(sysroot, "class/thermal")
		for i, name := range sensorEntries(base) {
			if i >= 128 {
				break
			}
			if !strings.HasPrefix(name, "thermal_zone") {
				continue
			}
			dir := filepath.Join(base, name)
			value, ok := sensorPositive(read(filepath.Join(dir, "temp")))
			if !ok || value > 150000 {
				continue
			}
			label := read(filepath.Join(dir, "type"))
			if label == "" {
				label = name
			}
			out.temperatures = append(out.temperatures, object{"label": label, "value": value / 1000, "max": 100.})
			if len(out.temperatures) == 12 {
				break
			}
		}
	}
	if len(out.temperatures) == 0 {
		var chips object
		if json.Unmarshal([]byte(lm()), &chips) == nil {
			for _, chip := range sortedKeys(chips) {
				for _, feature := range sortedKeys(obj(chips[chip])) {
					values := obj(obj(chips[chip])[feature])
					for _, key := range sortedKeys(values) {
						match := sensorInput.FindStringSubmatch(key)
						value, ok := values[key].(float64)
						if match != nil && match[1] == "temp" && match[3] == "input" && ok && value > 0 && value <= 150 {
							if len(out.temperatures) < 12 {
								out.temperatures = append(out.temperatures, object{"label": strings.Split(chip, "-")[0] + " " + feature, "value": value, "max": 100.})
							}
							break
						}
					}
				}
			}
		}
	}
	out.hardwareCount = len(out.sensors)
	out.power = sensorBattery(sysroot)
	if power, ok := out.power.(object); ok {
		out.sensors = append(out.sensors, object{"label": "Battery", "value": fmt.Sprintf("%g%% (%s)", num(power["battery"]), str(power["timeRemaining"]))})
		if watts := num(power["powerDraw"]); watts > 0 {
			out.sensors = append(out.sensors, object{"label": "Battery draw", "value": fmt.Sprintf("%.1f W", watts)})
		}
	}
	for i, v := range gpus {
		if i >= 16 {
			break
		}
		gpu := obj(v)
		usage, temp := "unavailable", "temperature unavailable"
		if gpu["utilization"] != nil {
			usage = fmt.Sprintf("%.0f%%", math.Floor(num(gpu["utilization"])*100+.5))
		}
		if gpu["temperature"] != nil {
			temp = fmt.Sprintf("%g°C", num(gpu["temperature"]))
		}
		out.sensors = append(out.sensors, object{"label": gpu["name"], "value": usage + " · " + temp})
	}
	clocks := []any{}
	base = filepath.Join(sysroot, "devices/system/cpu")
	cpus := []string{}
	for _, name := range sensorEntries(base) {
		if cpuDirectory.MatchString(name) {
			cpus = append(cpus, name)
		}
	}
	sort.Slice(cpus, func(i, j int) bool {
		a, _ := strconv.Atoi(cpus[i][3:])
		b, _ := strconv.Atoi(cpus[j][3:])
		return a < b
	})
	for i, cpu := range cpus {
		if i >= 4 {
			break
		}
		if value, ok := sensorPositive(read(filepath.Join(base, cpu, "cpufreq/scaling_cur_freq"))); ok {
			clocks = append(clocks, object{"label": cpu + " clock", "value": fmt.Sprintf("%.2f GHz", value/1e6)})
		}
	}
	if len(clocks) == 0 {
		for _, line := range strings.Split(cpuinfo, "\n") {
			key, raw, ok := strings.Cut(line, ":")
			if !ok || strings.TrimSpace(key) != "cpu MHz" {
				continue
			}
			if value, ok := sensorPositive(raw); ok {
				clocks = append(clocks, object{"label": fmt.Sprintf("cpu%d clock", len(clocks)), "value": fmt.Sprintf("%.2f GHz", value/1000)})
				if len(clocks) == 4 {
					break
				}
			}
		}
	}
	out.sensors = append(out.sensors, clocks...)
	out.sensors = out.sensors[:min(14, len(out.sensors))]
	return out
}
func sortedKeys(o object) []string {
	keys := make([]string, 0, len(o))
	for k := range o {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
func sensorBattery(sysroot string) any {
	base := filepath.Join(sysroot, "class/power_supply")
	names := sensorEntries(base)
	names = names[:min(128, len(names))]
	read := func(name, key string) string { return strings.TrimSpace(readFile(filepath.Join(base, name, key))) }
	ac := false
	for _, name := range names {
		if read(name, "type") == "Mains" && read(name, "online") == "1" {
			ac = true
		}
	}
	for _, name := range names {
		if read(name, "type") != "Battery" {
			continue
		}
		capacity, ok := sensorNumber(read(name, "capacity"))
		if !ok || capacity < 0 || capacity > 100 {
			continue
		}
		var watts any
		if value, ok := sensorNumber(read(name, "power_now")); ok {
			watts = value / 1e6
		} else {
			amps, a := sensorNumber(read(name, "current_now"))
			volts, v := sensorNumber(read(name, "voltage_now"))
			if a && v {
				watts = amps * volts / 1e12
			}
		}
		status := read(name, "status")
		return object{"battery": capacity, "charging": status == "Charging", "timeRemaining": status, "powerDraw": watts, "acConnected": ac}
	}
	return nil
}
func parseGPUs(raw string) []any {
	out := []any{}
	for i, line := range strings.Split(raw, "\n") {
		if i >= 16 {
			break
		}
		f := strings.Split(line, ",")
		if len(f) != 6 || strings.TrimSpace(f[0]) == "" {
			continue
		}
		row := object{"name": strings.TrimSpace(f[0])}
		for i, key := range []string{"utilization", "memoryUsed", "memoryTotal", "temperature", "power"} {
			row[key] = nil
			if value, ok := sensorNumber(f[i+1]); ok && value >= 0 {
				row[key] = value * []float64{.01, 1048576, 1048576, 1, 1}[i]
			}
		}
		out = append(out, row)
	}
	return out
}
