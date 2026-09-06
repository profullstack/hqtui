package demo

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const outputLimit = 1024 * 1024

func readFile(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	b, _ := io.ReadAll(io.LimitReader(f, outputLimit))
	return string(b)
}
func number(s string) float64 { v, _ := strconv.ParseFloat(s, 64); return v }
func command(args ...string) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 700*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", false
	}
	if err = cmd.Start(); err != nil {
		return "", false
	}
	data, err := io.ReadAll(io.LimitReader(stdout, outputLimit+1))
	if len(data) > outputLimit || err != nil {
		cancel()
		_ = cmd.Wait()
		return "", false
	}
	err = cmd.Wait()
	return string(data), err == nil
}
func counterRate(now, previous, dt float64, known bool) float64 {
	if !known || dt <= 0 {
		return 0
	}
	return math.Max(0, now-previous) / dt
}

type collector struct {
	sample               object
	previous             map[string]float64
	cpu                  map[string][2]float64
	procs                map[string]float64
	last, slow           time.Time
	missing, slowMissing []string
}

func newCollector() *collector {
	c := &collector{sample: loadSample(true), previous: map[string]float64{}, cpu: map[string][2]float64{}, procs: map[string]float64{}}
	host, _ := os.Hostname()
	sys := obj(c.sample["system"])
	sys["hostname"] = host
	sys["os"] = runtime.GOOS
	sys["kernel"] = strings.TrimSpace(readFile("/proc/sys/kernel/osrelease"))
	sys["shell"] = os.Getenv("SHELL")
	return c
}
func (c *collector) delta(key string, value, dt float64) float64 {
	old, ok := c.previous[key]
	c.previous[key] = value
	return counterRate(value, old, dt, ok)
}
func (c *collector) refresh() {
	now := time.Now()
	dt := 0.
	if !c.last.IsZero() {
		dt = now.Sub(c.last).Seconds()
	}
	c.last = now
	c.sample["time"] = float64(now.UnixNano()) / 1e9
	c.missing = nil
	if runtime.GOOS != "linux" {
		c.missing = []string{"live metrics require Linux on this port"}
		return
	}
	s := c.sample
	cpu, mem, sys := obj(s["cpu"]), obj(s["memory"]), obj(s["system"])
	tele := obj(s["telemetry"])
	kernel := obj(tele["kernel"])
	cores := []any{}
	for _, line := range strings.Split(readFile("/proc/stat"), "\n") {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		key := f[0]
		if strings.HasPrefix(key, "cpu") && len(f) >= 5 {
			total := 0.
			for _, v := range f[1:min(len(f), 9)] {
				total += number(v)
			}
			idle := number(f[4])
			if len(f) > 5 {
				idle += number(f[5])
			}
			prev, ok := c.cpu[key]
			c.cpu[key] = [2]float64{total, idle}
			usage := 0.
			if ok && total > prev[0] {
				usage = math.Max(0, math.Min(1, 1-(idle-prev[1])/(total-prev[0])))
			}
			if key == "cpu" {
				cpu["total"] = usage
			} else {
				cores = append(cores, usage)
			}
		} else {
			switch key {
			case "ctxt":
				kernel["contextSwitches"] = number(f[1])
				kernel["contextSwitchRate"] = c.delta(key, number(f[1]), dt)
				sys["contextSwitches"] = number(f[1])
			case "intr":
				kernel["interrupts"] = number(f[1])
				kernel["interruptRate"] = c.delta(key, number(f[1]), dt)
			case "processes":
				kernel["forks"] = number(f[1])
				kernel["forkRate"] = c.delta(key, number(f[1]), dt)
			case "procs_running":
				kernel["procsRunning"] = number(f[1])
			case "procs_blocked":
				kernel["procsBlocked"] = number(f[1])
			}
		}
	}
	cpu["cores"] = cores
	push(cpu, "history", num(cpu["total"])*100)
	if len(cores) == 0 {
		c.missing = append(c.missing, "CPU counters")
	}
	for _, line := range strings.Split(readFile("/proc/cpuinfo"), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "model name":
			cpu["model"] = strings.TrimSpace(value)
		case "cpu MHz":
			cpu["frequencyGhz"] = number(strings.TrimSpace(value)) / 1000
		}
	}
	load := strings.Fields(readFile("/proc/loadavg"))
	if len(load) >= 3 {
		cpu["load"] = []any{number(load[0]), number(load[1]), number(load[2])}
	}
	rawMem := map[string]float64{}
	for _, line := range strings.Split(readFile("/proc/meminfo"), "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 {
			rawMem[strings.TrimSuffix(f[0], ":")] = number(f[1]) * 1024
		}
	}
	for key, source := range map[string]string{"total": "MemTotal", "available": "MemAvailable", "free": "MemFree", "cached": "Cached", "buffers": "Buffers", "swapTotal": "SwapTotal"} {
		mem[key] = rawMem[source]
	}
	mem["used"] = math.Max(0, num(mem["total"])-num(mem["available"]))
	mem["swapUsed"] = math.Max(0, num(mem["swapTotal"])-rawMem["SwapFree"])
	push(mem, "history", num(mem["used"])/math.Max(1, num(mem["total"]))*100)
	uptime := strings.Fields(readFile("/proc/uptime"))
	if len(uptime) > 0 {
		sys["uptime"] = number(uptime[0])
	}
	c.processes(dt)
	c.network(dt)
	c.disks(dt)
	c.sensors()
	if c.slow.IsZero() || now.Sub(c.slow) >= 5*time.Second {
		c.slow = now
		c.slowCollect()
	}
	c.missing = append(c.missing, c.slowMissing...)
}
func (c *collector) processes(dt float64) {
	// Linux USER_HZ is obtained natively through getconf, never guessed from
	// kernel CONFIG_HZ. Cache the read-only utility result for counter rates.
	hz, ok := c.previous["clockTicks"]
	if !ok {
		result, valid := command("getconf", "CLK_TCK")
		if valid {
			hz = number(strings.TrimSpace(result))
		}
		c.previous["clockTicks"] = hz
	}
	rows := []any{}
	current := map[string]float64{}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		c.missing = append(c.missing, "processes")
		return
	}
	threads := 0.
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		base := filepath.Join("/proc", entry.Name())
		raw := readFile(filepath.Join(base, "stat"))
		start, end := strings.Index(raw, "("), strings.LastIndex(raw, ")")
		if start < 0 || end < start {
			continue
		}
		f := strings.Fields(raw[end+1:])
		if len(f) < 22 {
			continue
		}
		identity := fmt.Sprintf("%d:%s", pid, f[19])
		count := number(f[11]) + number(f[12])
		current[identity] = count
		old, known := c.procs[identity]
		usage := 0.
		if hz > 0 {
			usage = counterRate(count, old, dt, known) / hz * 100
		}
		rss := math.Max(0, number(f[21])) * float64(os.Getpagesize())
		name := raw[start+1 : end]
		cmd := strings.TrimSpace(strings.ReplaceAll(readFile(filepath.Join(base, "cmdline")), "\x00", " "))
		if cmd == "" {
			cmd = name
		}
		user := "—"
		for _, line := range strings.Split(readFile(filepath.Join(base, "status")), "\n") {
			if strings.HasPrefix(line, "Uid:") {
				parts := strings.Fields(line)
				if len(parts) > 1 {
					user = parts[1]
				}
				break
			}
		}
		threads += number(f[17])
		rows = append(rows, object{"pid": pid, "name": name, "cpu": usage, "mem": rss / math.Max(1, num(obj(c.sample["memory"])["total"])) * 100, "rss": rss, "threads": number(f[17]), "state": f[0], "user": user, "command": cmd})
		if len(rows) >= 10000 {
			c.missing = append(c.missing, "process list truncated at 10000")
			break
		}
	}
	c.procs = current
	c.sample["processes"] = rows
	sys := obj(c.sample["system"])
	sys["processCount"] = len(rows)
	sys["threadCount"] = threads
	if hz == 0 {
		c.missing = append(c.missing, "process CPU clock rate")
	}
}
func (c *collector) network(dt float64) {
	tele := obj(c.sample["telemetry"])
	old := map[string]object{}
	for _, v := range arr(tele["interfaces"]) {
		old[str(obj(v)["name"])] = obj(v)
	}
	interfaces := []any{}
	for _, line := range strings.Split(readFile("/proc/net/dev"), "\n") {
		name, raw, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		f := strings.Fields(raw)
		if len(f) < 16 {
			continue
		}
		o := old[name]
		if o == nil {
			o = object{"name": name, "ip": "", "rxHistory": []any{}, "txHistory": []any{}}
		}
		base := filepath.Join("/sys/class/net", name)
		o["state"] = strings.TrimSpace(readFile(base + "/operstate"))
		o["mac"] = strings.TrimSpace(readFile(base + "/address"))
		o["mtu"] = number(strings.TrimSpace(readFile(base + "/mtu")))
		o["rxTotal"] = number(f[0])
		o["txTotal"] = number(f[8])
		o["rxRate"] = c.delta(name+".rx", number(f[0]), dt)
		o["txRate"] = c.delta(name+".tx", number(f[8]), dt)
		o["errors"] = number(f[2]) + number(f[10])
		o["drops"] = number(f[3]) + number(f[11])
		push(o, "rxHistory", num(o["rxRate"]))
		push(o, "txHistory", num(o["txRate"]))
		interfaces = append(interfaces, o)
	}
	tele["interfaces"] = interfaces
	n := obj(c.sample["network"])
	for _, d := range []struct{ name, prefix string }{{"down", "rx"}, {"up", "tx"}} {
		rate, total := 0., 0.
		for _, v := range interfaces {
			o := obj(v)
			if str(o["name"]) != "lo" {
				rate += num(o[d.prefix+"Rate"])
				total += num(o[d.prefix+"Total"])
			}
		}
		n[d.name+"Rate"] = rate
		n[d.name+"Total"] = total
		n[d.name+"Peak"] = math.Max(num(n[d.name+"Peak"]), rate)
		push(n, d.name+"History", rate)
	}
	lines := strings.Split(strings.TrimSpace(readFile("/proc/net/snmp")), "\n")
	counts := map[string]float64{}
	for i := 0; i+1 < len(lines); i += 2 {
		h, v := strings.Fields(lines[i]), strings.Fields(lines[i+1])
		for j := 1; j < len(h) && j < len(v); j++ {
			counts[strings.TrimSuffix(h[0], ":")+h[j]] = number(v[j])
		}
	}
	net := obj(tele["net"])
	for key := range net {
		source := ""
		if strings.HasPrefix(key, "tcp") || strings.HasPrefix(key, "udp") {
			source = strings.ToUpper(key[:1]) + key[1:]
		} else if strings.HasPrefix(key, "icmp") {
			source = "Icmp" + key[4:]
		}
		if v, ok := counts[source]; ok {
			net[key] = v
		}
	}
	rates := obj(net["rates"])
	for key, source := range map[string]string{"inSegs": "tcpInSegs", "outSegs": "tcpOutSegs", "retrans": "tcpRetransSegs", "activeOpens": "tcpActiveOpens", "passiveOpens": "tcpPassiveOpens", "udpIn": "udpInDatagrams", "udpOut": "udpOutDatagrams"} {
		rates[key] = c.delta(source, num(net[source]), dt)
	}
	net["retransRatio"] = num(rates["retrans"]) / math.Max(1, num(rates["outSegs"]))
	push(tele, "netInHistory", num(rates["inSegs"]))
	push(tele, "netOutHistory", num(rates["outSegs"]))
	push(tele, "retransHistory", num(net["retransRatio"])*100)
}
func (c *collector) disks(dt float64) {
	old := map[string]object{}
	for _, v := range arr(c.sample["disks"]) {
		old[str(obj(v)["device"])] = obj(v)
	}
	disks := []any{}
	for _, line := range strings.Split(readFile("/proc/diskstats"), "\n") {
		f := strings.Fields(line)
		if len(f) < 14 || strings.HasPrefix(f[2], "loop") || strings.HasPrefix(f[2], "ram") {
			continue
		}
		name := f[2]
		d := old[name]
		if d == nil {
			d = object{"device": name, "mount": "", "type": "block", "used": 0., "total": 0., "readHistory": []any{}, "writeHistory": []any{}}
		}
		d["readRate"] = c.delta("read."+name, number(f[5])*512, dt)
		d["writeRate"] = c.delta("write."+name, number(f[9])*512, dt)
		push(d, "readHistory", num(d["readRate"]))
		push(d, "writeHistory", num(d["writeRate"]))
		disks = append(disks, d)
		if len(disks) >= 128 {
			break
		}
	}
	c.sample["disks"] = disks
}
func (c *collector) sensors() {
	temps := []any{}
	paths, _ := filepath.Glob("/sys/class/hwmon/hwmon*/temp*_input")
	for _, path := range paths {
		raw := strings.TrimSpace(readFile(path))
		if raw == "" {
			continue
		}
		v := number(raw) / 1000
		if v < -50 || v > 200 {
			continue
		}
		label := strings.TrimSpace(readFile(strings.Replace(path, "_input", "_label", 1)))
		if label == "" {
			label = filepath.Base(path)
		}
		temps = append(temps, object{"label": label, "value": v, "max": 100.})
	}
	c.sample["temperatures"] = temps
}
func (c *collector) slowCollect() {
	t := obj(c.sample["telemetry"])
	missing := []string{}
	run := func(label string, args ...string) string {
		out, ok := command(args...)
		if !ok {
			missing = append(missing, label)
		}
		return out
	}
	sessions := []any{}
	for _, line := range strings.Split(run("sessions", "who"), "\n") {
		f := strings.Fields(line)
		if len(f) >= 4 {
			sessions = append(sessions, object{"user": f[0], "tty": f[1], "loginAt": strings.Join(f[2:4], " "), "from": strings.Join(f[4:], " "), "idle": "—", "what": "—"})
		}
	}
	t["sessions"] = sessions
	push(t, "sessionHistory", float64(len(sessions)))
	services := []any{}
	for _, line := range strings.Split(run("services", "systemctl", "list-units", "--type=service", "--all", "--no-legend", "--no-pager", "--plain"), "\n") {
		f := strings.Fields(line)
		if len(f) >= 5 {
			services = append(services, object{"name": f[0], "active": f[2], "sub": f[3], "description": strings.Join(f[4:], " ")})
		}
		if len(services) >= 1000 {
			break
		}
	}
	t["services"] = services
	connections, listeners := []any{}, []any{}
	for _, line := range strings.Split(run("sockets", "ss", "-H", "-tuna", "-p"), "\n") {
		f := strings.Fields(line)
		if len(f) < 6 {
			continue
		}
		process := strings.Join(f[6:], " ")
		connections = append(connections, object{"proto": f[0], "state": f[1], "local": f[4], "remote": f[5], "process": process})
		if f[1] == "LISTEN" || f[1] == "UNCONN" {
			cut := strings.LastIndex(f[4], ":")
			if cut >= 0 {
				listeners = append(listeners, object{"proto": f[0], "address": f[4][:cut], "port": f[4][cut+1:], "process": process})
			}
		}
		if len(connections) >= 5000 {
			break
		}
	}
	t["connections"] = connections
	t["listeners"] = listeners
	push(t, "connectionHistory", float64(len(connections)))
	journal := []any{}
	for _, line := range strings.Split(run("journal", "journalctl", "-n", "100", "--no-pager", "-o", "json"), "\n") {
		var row object
		if json.Unmarshal([]byte(line), &row) != nil {
			continue
		}
		stamp := number(str(row["__REALTIME_TIMESTAMP"]))
		journal = append(journal, object{"time": time.UnixMicro(int64(stamp)).Format("15:04:05"), "level": str(row["PRIORITY"]), "unit": str(row["_SYSTEMD_UNIT"]), "message": str(row["MESSAGE"]), "meta": ""})
	}
	t["journal"] = journal
	c.sample["logs"] = journal
	filesystems := []any{}
	for _, line := range strings.Split(run("filesystems", "df", "-PT", "-B1"), "\n") {
		f := strings.Fields(line)
		if len(f) != 7 || f[0] == "Filesystem" {
			continue
		}
		filesystems = append(filesystems, object{"device": f[0], "type": f[1], "size": number(f[2]), "used": number(f[3]), "mount": f[6]})
		for _, v := range arr(c.sample["disks"]) {
			d := obj(v)
			if filepath.Base(f[0]) == str(d["device"]) {
				d["mount"] = f[6]
				d["total"] = number(f[2])
				d["used"] = number(f[3])
			}
		}
		if len(filesystems) >= 128 {
			break
		}
	}
	t["filesystems"] = filesystems
	c.slowMissing = append(missing, "connection direction/application protocols", "login history", "SSH authentication log", "HTTP access log", "GPU/power")
}
