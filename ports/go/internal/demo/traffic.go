package demo

import (
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Same port-based estimates as TypeScript. No packet capture or active probes.
const protocolPorts = "20=FTP 21=FTP 22=SSH 23=Telnet 25=SMTP 53=DNS 67=DHCP 68=DHCP 80=HTTP 110=POP3 111=RPC 123=NTP 143=IMAP 161=SNMP 389=LDAP 443=HTTPS 445=SMB 465=SMTPS 514=Syslog 587=SMTP 631=IPP 636=LDAPS 993=IMAPS 995=POP3S 1194=OpenVPN 1433=MSSQL 1521=Oracle 2049=NFS 2379=etcd 3000=HTTP-dev 3306=MySQL 3389=RDP 4000=HTTP-dev 5000=HTTP-dev 5432=Postgres 5672=AMQP 5900=VNC 6379=Redis 8000=HTTP-alt 8080=HTTP-alt 8443=HTTPS-alt 9000=HTTP-alt 9090=Prometheus 9200=Elasticsearch 11211=Memcached 27017=MongoDB 41641=Tailscale 51820=WireGuard"

func classifyPort(port string) string {
	for _, pair := range strings.Fields(protocolPorts) {
		key, value, _ := strings.Cut(pair, "=")
		if key == port {
			return value
		}
	}
	if n, _ := strconv.Atoi(port); n >= 32768 {
		return "ephemeral"
	}
	return "port " + port
}
func splitEndpoint(endpoint string) (string, string) {
	cut := strings.LastIndex(endpoint, ":")
	if cut < 0 {
		return endpoint, ""
	}
	return endpoint[:cut], endpoint[cut+1:]
}
func socketBreakdown(connections, listeners []any) object {
	listening := map[string]bool{}
	for _, v := range listeners {
		listening[str(obj(v)["port"])] = true
	}
	buckets, remotes := map[string]object{}, map[string]object{}
	order, hosts := []string{}, []string{}
	protocolsByHost := map[string][]string{}
	in, out := 0., 0.
	for _, v := range connections {
		c := obj(v)
		if str(c["state"]) == "LISTEN" || (str(c["state"]) != "ESTAB" && !strings.HasPrefix(str(c["proto"]), "udp")) {
			continue
		}
		_, lp := splitEndpoint(str(c["local"]))
		host, rp := splitEndpoint(str(c["remote"]))
		incoming := listening[lp]
		port := rp
		if incoming {
			port = lp
		}
		protocol := classifyPort(port)
		if buckets[protocol] == nil {
			buckets[protocol] = object{"protocol": protocol, "inbound": 0., "outbound": 0., "total": 0.}
			order = append(order, protocol)
		}
		b := buckets[protocol]
		key := "outbound"
		if incoming {
			key = "inbound"
			in++
		} else {
			out++
		}
		b[key] = num(b[key]) + 1
		b["total"] = num(b["total"]) + 1
		if host != "" && host != "*" && host != "0.0.0.0" {
			if remotes[host] == nil {
				remotes[host] = object{"host": host, "connections": 0.}
				hosts = append(hosts, host)
			}
			r := remotes[host]
			r["connections"] = num(r["connections"]) + 1
			seen := false
			for _, p := range protocolsByHost[host] {
				if p == protocol {
					seen = true
				}
			}
			if !seen {
				protocolsByHost[host] = append(protocolsByHost[host], protocol)
			}
		}
	}
	sort.SliceStable(order, func(i, j int) bool { return num(buckets[order[i]]["total"]) > num(buckets[order[j]]["total"]) })
	sort.SliceStable(hosts, func(i, j int) bool {
		return num(remotes[hosts[i]]["connections"]) > num(remotes[hosts[j]]["connections"])
	})
	bs, rs := []any{}, []any{}
	for _, p := range order {
		bs = append(bs, buckets[p])
	}
	for _, host := range hosts[:min(12, len(hosts))] {
		ps := protocolsByHost[host]
		remotes[host]["protocols"] = strings.Join(ps[:min(3, len(ps))], ", ")
		rs = append(rs, remotes[host])
	}
	return object{"protocols": bs, "remotes": rs, "inboundConnections": in, "outboundConnections": out}
}

var originPattern = regexp.MustCompile(`\(([^)]+)\)`)

func trafficTime(raw string) string {
	for i := 0; i+8 <= len(raw); i++ {
		if i > 0 && raw[i-1] >= '0' && raw[i-1] <= '9' {
			continue
		}
		s := raw[i : i+8]
		if s[2] != ':' || s[5] != ':' {
			continue
		}
		valid := true
		for _, j := range []int{0, 1, 3, 4, 6, 7} {
			if s[j] < '0' || s[j] > '9' {
				valid = false
			}
		}
		if valid {
			return s
		}
	}
	return ""
}

var authPattern = regexp.MustCompile(`(Accepted|Failed) (\S+) for (invalid user )?(\S+) from (\S+)`)
var disconnectPattern = regexp.MustCompile(`Disconnected from (?:authenticating )?user (\S+) (\S+)`)

func trafficSessions(raw string) []any {
	out := []any{}
	for _, line := range strings.Split(raw, "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		origin, idle, what := "local", ".", ""
		if m := originPattern.FindStringSubmatch(line); m != nil {
			origin = m[1]
		}
		if len(f) > 4 {
			idle = f[4]
		}
		if len(f) > 5 {
			what = f[5]
		}
		out = append(out, object{"user": f[0], "tty": f[1], "loginAt": strings.Join(f[2:4], " "), "idle": idle, "what": what, "from": origin})
		if len(out) == 1000 {
			break
		}
	}
	return out
}
func trafficLogins(raw, status string) []any {
	out := []any{}
	for _, line := range strings.Split(raw, "\n") {
		f := strings.Fields(line)
		if len(f) < 4 || f[0] == "wtmp" || f[0] == "btmp" || f[0] == "reboot" {
			continue
		}
		from := "local"
		if strings.ContainsAny(f[2], ".:") {
			from = f[2]
		}
		state := status
		if strings.Contains(line, "still logged in") {
			state = "still"
		}
		when := strings.Join(f[max(0, len(f)-7):len(f)-3], " ")
		if when == "" {
			when = strings.Join(f[3:min(7, len(f))], " ")
		}
		out = append(out, object{"user": f[0], "tty": f[1], "from": from, "when": when, "status": state})
		if len(out) == 40 {
			break
		}
	}
	return out
}
func trafficSSH(raw string) []any {
	out := []any{}
	for _, line := range strings.Split(raw, "\n") {
		if !strings.Contains(line, "sshd") {
			continue
		}
		stamp := trafficTime(line)
		if m := authPattern.FindStringSubmatch(line); m != nil {
			action := "failed"
			if m[1] == "Accepted" {
				action = "accepted"
			} else if m[3] != "" {
				action = "invalid"
			}
			out = append(out, object{"time": stamp, "action": action, "user": m[4], "from": m[5], "method": m[2]})
		} else if m := disconnectPattern.FindStringSubmatch(line); m != nil {
			out = append(out, object{"time": stamp, "action": "disconnect", "user": m[1], "from": m[2], "method": "-"})
		}
	}
	return out[max(0, len(out)-40):]
}
func tailLog(path string) (string, os.FileInfo, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", nil, err
	}
	start := max(int64(0), info.Size()-256*1024)
	if _, err = f.Seek(start, io.SeekStart); err != nil {
		return "", nil, err
	}
	raw, err := io.ReadAll(io.LimitReader(f, 256*1024))
	if start > 0 {
		if cut := strings.IndexByte(string(raw), '\n'); cut >= 0 {
			raw = raw[cut+1:]
		} else {
			raw = nil
		}
	}
	return string(raw), info, err
}

var combinedPattern = regexp.MustCompile(`^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) (\d+|-)`)

func httpStats(raw, source string) object {
	recent := []any{}
	maps := []map[string]int{{}, {}, {}, {}}
	orders := make([][]string, 4)
	upgrades := 0
	for _, line := range strings.Split(raw, "\n") {
		f := combinedPattern.FindStringSubmatch(line)
		if f == nil {
			continue
		}
		path, _, _ := strings.Cut(f[4], "?")
		runes := []rune(path)
		path = string(runes[:min(60, len(runes))])
		values := []string{f[5][:1] + "xx", path, f[1], f[3]}
		for i, v := range values {
			if maps[i][v] == 0 {
				orders[i] = append(orders[i], v)
			}
			maps[i][v]++
		}
		if f[5] == "101" {
			upgrades++
		}
		recent = append(recent, object{"time": trafficTime(f[2]), "method": f[3], "path": path, "status": f[5], "client": f[1], "bytes": number(f[6])})
	}
	result := object{"source": source, "requestsPerSecond": 0., "total": float64(len(recent)), "upgrades": float64(upgrades), "history": []any{}}
	for i, key := range []string{"statusClasses", "topPaths", "topClients", "methods"} {
		order := orders[i]
		counts := maps[i]
		sort.SliceStable(order, func(i, j int) bool { return counts[order[i]] > counts[order[j]] })
		rows := []any{}
		for _, v := range order[:min([]int{6, 10, 8, 6}[i], len(order))] {
			rows = append(rows, object{[]string{"class", "path", "client", "method"}[i]: v, "count": float64(counts[v])})
		}
		result[key] = rows
	}
	rows := []any{}
	for i := len(recent) - 1; i >= max(0, len(recent)-40); i-- {
		rows = append(rows, recent[i])
	}
	result["recent"] = rows
	return result
}

type httpCollector struct {
	path    string
	info    os.FileInfo
	at      time.Time
	history []any
}

func (h *httpCollector) sample(root string, now time.Time) any {
	for _, candidate := range []string{"var/log/nginx/access.log", "var/log/apache2/access.log", "var/log/httpd/access_log", "var/log/caddy/access.log"} {
		path := filepath.Join(root, candidate)
		raw, info, err := tailLog(path)
		if err != nil || raw == "" {
			continue
		}
		result := httpStats(raw, path)
		rate := 0.
		if h.info != nil && h.path == path && os.SameFile(h.info, info) && info.Size() > h.info.Size() && now.After(h.at) {
			average := float64(len(raw)) / float64(max(1, len(strings.Split(strings.TrimSpace(raw), "\n"))))
			rate = float64(info.Size()-h.info.Size()) / max(1, average) / now.Sub(h.at).Seconds()
		}
		h.path, h.info, h.at = path, info, now
		h.history = append(h.history, rate)
		h.history = h.history[max(0, len(h.history)-240):]
		result["requestsPerSecond"] = rate
		result["history"] = append([]any{}, h.history...)
		return result
	}
	*h = httpCollector{}
	return nil
}
func (c *collector) trafficCollect(missing *[]string) {
	t := obj(c.sample["telemetry"])
	run := func(label string, args ...string) string {
		raw, ok := command(args...)
		if !ok {
			*missing = append(*missing, label)
		}
		return raw
	}
	for key, value := range socketBreakdown(arr(t["connections"]), arr(t["listeners"])) {
		t[key] = value
	}
	t["logins"] = trafficLogins(run("login history", "last", "-n", "20", "-w"), "ok")
	t["failedLogins"] = trafficLogins(run("failed login history", "lastb", "-n", "15", "-w"), "failed")
	raw, ok := command("journalctl", "-u", "ssh", "-u", "sshd", "-n", "80", "--no-pager", "--output=short-iso")
	if len(trafficSSH(raw)) == 0 {
		if fallback, _, err := tailLog("/var/log/auth.log"); err == nil {
			raw = fallback
			ok = true
		}
	}
	t["ssh"] = trafficSSH(raw)
	if !ok {
		*missing = append(*missing, "SSH authentication log")
	}
	t["http"] = c.http.sample("/", time.Now())
	if t["http"] == nil {
		*missing = append(*missing, "HTTP access log")
	}
}
