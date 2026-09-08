package demo

import (
	"fmt"
	ui "github.com/profullstack/hqtui/ports/go"
	"math"
	"slices"
	"strings"
)

func rate(v float64) string {
	if v >= 1e6 {
		return fmt.Sprintf("%.1fM/s", v/1e6)
	}
	if v >= 1000 {
		return fmt.Sprintf("%.1fK/s", v/1000)
	}
	return fmt.Sprintf("%.0f/s", v)
}
func commas(v float64) string {
	s := fmt.Sprintf("%.0f", v)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}
func statusColor(t ui.Theme, class string) ui.Color {
	switch class {
	case "1xx":
		return t.Secondary
	case "2xx":
		return t.Success
	case "3xx":
		return t.Accent
	case "4xx":
		return t.Warning
	case "5xx":
		return t.Danger
	}
	return t.Muted
}
func (s *state) telemetry(p *ui.Container) {
	switch s.screen {
	case 1:
		s.trafficScreen(p)
	case 2:
		s.sessionsScreen(p)
	case 3:
		s.networkScreen(p)
	case 4:
		s.servicesScreen(p)
	}
}
func (s *state) trafficScreen(p *ui.Container) {
	gap := s.panelGap()
	if s.real {
		p.Label(trafficNotice())
	}
	t := p.Theme()
	d := obj(s.sample["telemetry"])
	net := obj(d["net"])
	rates := obj(net["rates"])
	http := obj(d["http"])
	row(p, ui.Cells(13), gap, func(r *ui.Container) {
		r.Panel(ui.PanelOptions{Title: "Protocols", Subtitle: fmt.Sprintf("%s in / %s out", scalar(d["inboundConnections"]), scalar(d["outboundConnections"])), BorderColor: &t.Accent}, func(p *ui.Container) {
			data := arr(d["protocols"])
			if len(data) == 0 {
				p.Label("No sockets visible.")
				return
			}
			maxV := 1.
			for _, v := range data {
				maxV = math.Max(maxV, num(obj(v)["total"]))
			}
			items := []ui.MeterItem{}
			for i, v := range data[:min(9, len(data))] {
				b := obj(v)
				items = append(items, ui.MeterItem{Label: scalar(b["protocol"]), Value: num(b["total"]) / maxV, Color: ref(ui.SeriesColor(t, i)), Text: scalar(b["total"])})
			}
			p.Meters(ui.MetersOptions{Items: items, LabelWidth: 13, ValueWidth: 5})
		})
		r.Panel(ui.PanelOptions{Title: "TCP", Layout: fraction(.9), BorderColor: &t.Primary}, func(p *ui.Container) {
			row(p, ui.Cells(1), 0, func(r *ui.Container) {
				txt(r, "↓ "+rate(num(rates["inSegs"]))+" seg", t.Primary)
				r.StyledText("↑ "+rate(num(rates["outSegs"]))+" seg", ui.TextStyle{Fg: &t.Secondary, Align: ui.AlignRight})
			})
			multi(p, d["netInHistory"], d["netOutHistory"], t.Primary, t.Secondary)
			p.Divider(ui.DividerOptions{})
			keys(p, []ui.KeyValueRow{kv("Established", scalar(net["tcpEstablished"]), t.Success), kv("Opens in/out", rate(num(rates["passiveOpens"]))+" / "+rate(num(rates["activeOpens"])), t.Accent), kv("Resets sent", commas(num(net["tcpOutRsts"])), t.Muted)}, true)
		})
		color := t.Success
		if num(net["retransRatio"]) > .02 {
			color = t.Danger
		}
		r.Panel(ui.PanelOptions{Title: "Retransmits", Layout: fraction(.7), BorderColor: &color}, func(p *ui.Container) {
			p.StyledText(fmt.Sprintf("%.2f%%", ui.ClampRatio(num(net["retransRatio"]))*100), ui.TextStyle{Fg: &color, Bold: true})
			p.Label("of outbound segments")
			plot(p, d["retransHistory"], t.Danger, nil, false)
			keys(p, []ui.KeyValueRow{kv("UDP in/out", rate(num(rates["udpIn"]))+" / "+rate(num(rates["udpOut"])), t.Muted), kv("ICMP", scalar(net["icmpInMsgs"])+" / "+scalar(net["icmpOutMsgs"]), t.Muted)}, true)
		})
	})
	row(p, ui.Fr(1), 1, func(r *ui.Container) {
		r.Column(ui.ColumnOptions{Layout: ui.Layout{Gap: gap}}, func(c *ui.Container) {
			subtitle := "no access log"
			if len(http) > 0 {
				subtitle = fmt.Sprintf("%.1f req/s", num(http["requestsPerSecond"]))
			}
			c.Panel(ui.PanelOptions{Title: "HTTP", Subtitle: subtitle, BorderColor: &t.Success}, func(p *ui.Container) {
				if len(http) == 0 {
					p.Label("No readable HTTP access log.")
					p.Label("nginx, apache, httpd and caddy logs are")
					p.Label("root/adm readable — run with sudo to track requests.")
					return
				}
				row(p, ui.Cells(1), 0, func(r *ui.Container) {
					txt(r, scalar(http["source"]), t.Muted)
					r.StyledText(scalar(http["upgrades"])+" upgrades (ws)", ui.TextStyle{Fg: &t.Secondary, Align: ui.AlignRight})
				})
				p.Graph(ui.GraphOptions{Values: values(http["history"]), Plot: ui.PlotOptions{Min: ref(0.), Fill: ref(true), Color: &t.Success}}, fixed(6))
				p.Divider(ui.DividerOptions{Label: "status"})
				maxV := 1.
				for _, v := range arr(http["statusClasses"]) {
					maxV = math.Max(maxV, num(obj(v)["count"]))
				}
				items := []ui.MeterItem{}
				for _, v := range arr(http["statusClasses"]) {
					b := obj(v)
					items = append(items, ui.MeterItem{Label: scalar(b["class"]), Value: num(b["count"]) / maxV, Color: ref(statusColor(t, scalar(b["class"]))), Text: scalar(b["count"])})
				}
				p.Meters(ui.MetersOptions{Items: items, LabelWidth: 5, ValueWidth: 7})
				p.Divider(ui.DividerOptions{Label: "top paths"})
				s.dataTable(p, "traffic.paths", arr(http["topPaths"]), []dataColumn{dc("path", "Path", 0, 20, &t.Primary, false), dc("count", "Hits", 7, 0, &t.Accent, true)}, false, true)
			})
		})
		r.Column(ui.ColumnOptions{Layout: ui.Layout{Size: ref(ui.Fr(.85)), Gap: gap}}, func(c *ui.Container) {
			c.Panel(ui.PanelOptions{Title: "SSH Activity", Subtitle: fmt.Sprint(len(arr(d["ssh"]))), BorderColor: &t.Warning}, func(p *ui.Container) {
				data := slices.Clone(arr(d["ssh"]))
				slices.Reverse(data)
				if len(data) == 0 {
					p.Label("No sshd events in the journal.")
					return
				}
				cols := []dataColumn{dc("time", "Time", 9, 0, &t.Muted, false), dc("action", "Action", 11, 0, nil, false), dc("user", "User", 12, 0, &t.Primary, false), dc("from", "From", 0, 14, &t.Accent, false), dc("method", "Method", 10, 0, &t.Muted, false)}
				cols[1].color = func(d object) ui.Color {
					switch d["action"] {
					case "accepted":
						return t.Success
					case "disconnect":
						return t.Muted
					}
					return t.Danger
				}
				s.dataTable(p, "traffic.ssh", data, cols, true)
			})
			c.Panel(ui.PanelOptions{Title: "Top Remote Hosts", Layout: fixed(10), BorderColor: &t.Secondary}, func(p *ui.Container) {
				data := arr(d["remotes"])
				if len(data) == 0 {
					p.Label("No remote peers.")
					return
				}
				s.dataTable(p, "traffic.remotes", data, []dataColumn{dc("host", "Host", 0, 16, &t.Accent, false), dc("connections", "Conns", 6, 0, &t.Success, true), dc("protocols", "Protocols", 0, 12, &t.Muted, false)}, true)
			})
		})
	})
	if len(arr(http["recent"])) > 0 {
		p.Panel(ui.PanelOptions{Title: "Recent Requests", Layout: fixed(10), BorderColor: &t.Primary}, func(p *ui.Container) {
			cols := []dataColumn{dc("time", "Time", 9, 0, &t.Muted, false), dc("method", "Method", 7, 0, &t.Secondary, false), dc("path", "Path", 0, 24, &t.Primary, false), dc("status", "Status", 7, 0, nil, true), dc("client", "Client", 16, 0, &t.Accent, false), dc("bytes", "Bytes", 9, 0, &t.Muted, true)}
			cols[3].color = func(d object) ui.Color {
				v := scalar(d["status"])
				if len(v) > 0 {
					return statusColor(t, v[:1]+"xx")
				}
				return t.Muted
			}
			s.dataTable(p, "traffic.requests", arr(http["recent"]), cols, true)
		})
	}
}
func (s *state) sessionsScreen(p *ui.Container) {
	gap := s.panelGap()
	t := p.Theme()
	d := obj(s.sample["telemetry"])
	row(p, ui.Cells(9), gap, func(r *ui.Container) {
		r.Panel(ui.PanelOptions{Title: "Active Sessions", Subtitle: fmt.Sprint(len(arr(d["sessions"]))), BorderColor: &t.Success}, func(p *ui.Container) {
			data := arr(d["sessions"])
			if len(data) == 0 {
				p.Label("No interactive sessions.")
				p.Label("(`who` reports nothing on this host)")
				return
			}
			s.dataTable(p, "sessions.active", data, []dataColumn{dc("user", "User", 12, 0, &t.Primary, false), dc("tty", "TTY", 10, 0, nil, false), dc("from", "From", 0, 12, &t.Accent, false), dc("loginAt", "Login", 14, 0, &t.Muted, false), dc("idle", "Idle", 8, 0, nil, true)}, false)
		})
		r.Panel(ui.PanelOptions{Title: "Process States", Layout: fixed(34), BorderColor: &t.Primary}, func(p *ui.Container) {
			states := obj(d["states"])
			for i, key := range []string{"running", "sleeping", "stopped", "zombie"} {
				color := []ui.Color{t.Success, t.Primary, t.Warning, t.Danger}[i]
				p.Meter(ui.MeterOptions{Label: []string{"run ", "slp ", "stop", "zomb"}[i], Value: num(states[key]) / math.Max(1, num(states["total"])), Text: scalar(states[key]), Heat: ref(false), Color: &color})
			}
			p.Spacer(ui.Cells(1))
			keys(p, []ui.KeyValueRow{kv("Total", scalar(states["total"]), t.Accent)}, true)
		})
	})
	row(p, ui.Fr(1), 1, func(r *ui.Container) {
		r.Panel(ui.PanelOptions{Title: "Recent Logins", Subtitle: fmt.Sprintf("%d from wtmp", len(arr(d["logins"]))), BorderColor: &t.Accent}, func(p *ui.Container) {
			data := arr(d["logins"])
			if len(data) == 0 {
				p.Label("No login history available.")
				return
			}
			cols := []dataColumn{dc("user", "User", 12, 0, &t.Primary, false), dc("tty", "TTY", 12, 0, &t.Muted, false), dc("from", "From", 0, 14, &t.Accent, false), dc("when", "When", 0, 16, &t.Muted, false), dc("status", "Status", 8, 0, nil, false)}
			cols[4].color = func(d object) ui.Color {
				if d["status"] == "still" {
					return t.Success
				}
				return t.Muted
			}
			s.dataTable(p, "sessions.logins", data, cols, true)
		})
		r.Column(ui.ColumnOptions{Layout: ui.Layout{Size: ref(ui.Fr(.8)), Gap: gap}}, func(c *ui.Container) {
			c.Panel(ui.PanelOptions{Title: "Failed Logins", BorderColor: &t.Danger}, func(p *ui.Container) {
				data := arr(d["failedLogins"])
				if len(data) == 0 {
					p.Label("None recorded.")
					p.Label("(btmp is usually root-only)")
					return
				}
				s.dataTable(p, "sessions.failed", data, []dataColumn{dc("user", "User", 12, 0, &t.Danger, false), dc("from", "From", 0, 12, nil, false), dc("when", "When", 0, 14, &t.Muted, false)}, false)
			})
			c.Panel(ui.PanelOptions{Title: "Session History", Layout: fixed(8), BorderColor: &t.Secondary}, func(p *ui.Container) {
				p.Label("concurrent sessions")
				plot(p, d["sessionHistory"], t.Success, nil, false)
			})
		})
	})
}
func (s *state) networkScreen(p *ui.Container) {
	gap := s.panelGap()
	t := p.Theme()
	d := obj(s.sample["telemetry"])
	active := []any{}
	for _, v := range arr(d["interfaces"]) {
		i := obj(v)
		if num(i["rxTotal"]) > 0 || i["state"] == "up" {
			active = append(active, v)
		}
	}
	if len(active) == 0 {
		active = arr(d["interfaces"])
	}
	active = active[:min(3, len(active))]
	row(p, ui.Cells(13), gap, func(r *ui.Container) {
		if len(active) == 0 {
			r.Panel(ui.PanelOptions{Title: "Interfaces"}, func(p *ui.Container) { p.Label("No interfaces reported.") })
			return
		}
		for i, v := range active {
			d := obj(v)
			color := []ui.Color{t.Primary, t.Success, t.Secondary}[i]
			r.Panel(ui.PanelOptions{Title: scalar(d["name"]) + " (" + scalar(d["state"]) + ")", Subtitle: scalar(d["ip"]), BorderColor: &color}, func(p *ui.Container) {
				row(p, ui.Cells(1), 0, func(r *ui.Container) {
					txt(r, "↓ "+byteRate(num(d["rxRate"])), t.Primary)
					r.StyledText("↑ "+byteRate(num(d["txRate"])), ui.TextStyle{Fg: &t.Secondary, Align: ui.AlignRight})
				})
				multi(p, d["rxHistory"], d["txHistory"], t.Primary, t.Secondary)
				p.Divider(ui.DividerOptions{})
				keys(p, []ui.KeyValueRow{kv("RX total", bytes(num(d["rxTotal"]), 2), t.Primary), kv("TX total", bytes(num(d["txTotal"]), 2), t.Secondary), kv("MAC", scalar(d["mac"]), t.Muted), kv("MTU / err / drop", scalar(d["mtu"])+" / "+scalar(d["errors"])+" / "+scalar(d["drops"]), t.Muted)}, true)
			})
		}
	})
	row(p, ui.Fr(1), 1, func(r *ui.Container) {
		r.Panel(ui.PanelOptions{Title: "Connections", Subtitle: fmt.Sprintf("%d open", len(arr(d["connections"]))), BorderColor: &t.Accent}, func(p *ui.Container) {
			data := arr(d["connections"])
			if len(data) == 0 {
				p.Label("No connections visible (`ss` unavailable).")
				return
			}
			s.dataTable(p, "network.connections", data, []dataColumn{dc("proto", "Proto", 6, 0, &t.Muted, false), dc("local", "Local", 0, 18, nil, false), dc("remote", "Remote", 0, 18, &t.Accent, false), dc("state", "State", 10, 0, &t.Success, false), dc("process", "Process", 0, 12, &t.Primary, false)}, true)
		})
		r.Column(ui.ColumnOptions{Layout: ui.Layout{Size: ref(ui.Fr(.7)), Gap: gap}}, func(c *ui.Container) {
			c.Panel(ui.PanelOptions{Title: "Listening Ports", Subtitle: fmt.Sprint(len(arr(d["listeners"]))), BorderColor: &t.Warning}, func(p *ui.Container) {
				s.dataTable(p, "network.listeners", arr(d["listeners"]), []dataColumn{dc("proto", "Proto", 6, 0, &t.Muted, false), dc("port", "Port", 7, 0, &t.Warning, true), dc("address", "Address", 0, 10, &t.Muted, false), dc("process", "Process", 0, 10, &t.Primary, false)}, true)
			})
			c.Panel(ui.PanelOptions{Title: "Open Connections", Layout: fixed(6), BorderColor: &t.Secondary}, func(p *ui.Container) { plot(p, d["connectionHistory"], t.Accent, nil, false) })
		})
	})
}
func (s *state) servicesScreen(p *ui.Container) {
	gap := s.panelGap()
	t := p.Theme()
	d := obj(s.sample["telemetry"])
	failed := 0
	for _, v := range arr(d["services"]) {
		if obj(v)["active"] == "failed" {
			failed++
		}
	}
	row(p, ui.Fr(1), 1, func(r *ui.Container) {
		subtitle := fmt.Sprintf("%d units", len(arr(d["services"])))
		border, subcolor := t.Success, t.Muted
		if failed > 0 {
			subtitle = fmt.Sprintf("%d failed", failed)
			border = t.Danger
			subcolor = t.Danger
		}
		r.Panel(ui.PanelOptions{Title: "Services", Subtitle: subtitle, SubtitleColor: &subcolor, BorderColor: &border}, func(p *ui.Container) {
			data := arr(d["services"])
			if len(data) == 0 {
				p.Label("systemd not available on this host.")
				return
			}
			cols := []dataColumn{dc("name", "Unit", 0, 18, &t.Primary, false), dc("active", "Active", 10, 0, nil, false), dc("sub", "Sub", 10, 0, &t.Muted, false), dc("description", "Description", 0, 16, &t.Muted, false)}
			cols[1].color = func(d object) ui.Color {
				switch d["active"] {
				case "failed":
					return t.Danger
				case "active":
					return t.Success
				}
				return t.Muted
			}
			s.dataTable(p, "services.units", data, cols, true)
		})
		r.Column(ui.ColumnOptions{Layout: ui.Layout{Size: ref(ui.Fr(.85)), Gap: gap}}, func(c *ui.Container) {
			c.Panel(ui.PanelOptions{Title: "Kernel", Layout: fixed(11), BorderColor: &t.Accent}, func(p *ui.Container) {
				k := obj(d["kernel"])
				blocked, entropy := t.Muted, t.Success
				if num(k["procsBlocked"]) > 0 {
					blocked = t.Warning
				}
				if num(k["entropy"]) < 200 {
					entropy = t.Warning
				}
				krate := func(v float64) string {
					if v >= 1000 {
						return fmt.Sprintf("%.1fK/s", v/1000)
					}
					return fmt.Sprintf("%.0f/s", v)
				}
				keys(p, []ui.KeyValueRow{kv("Context switches", krate(num(k["contextSwitchRate"])), t.Accent), kv("Interrupts", krate(num(k["interruptRate"])), t.Accent), kv("Forks", krate(num(k["forkRate"])), t.Accent), kv("Procs running", scalar(k["procsRunning"]), t.Success), kv("Procs blocked", scalar(k["procsBlocked"]), blocked), kv("Open file descriptors", commas(num(k["openFiles"])), t.Primary), kv("Entropy available", scalar(k["entropy"]), entropy), kv("Page in / out", fmt.Sprintf("%.0fK / %.0fK", num(k["pageIn"])/1000, num(k["pageOut"])/1000), t.Muted)}, true)
			})
			c.Panel(ui.PanelOptions{Title: "Containers", Layout: fixed(9), BorderColor: &t.Primary}, func(p *ui.Container) {
				data := arr(d["containers"])
				if len(data) == 0 {
					p.Label("No running containers.")
					p.Label("(docker not installed or not reachable)")
					return
				}
				s.dataTable(p, "services.containers", data, []dataColumn{dc("name", "Name", 0, 12, &t.Primary, false), dc("image", "Image", 0, 14, &t.Muted, false), dc("status", "Status", 0, 12, &t.Success, false)}, true)
			})
			c.Panel(ui.PanelOptions{Title: "Hardware", BorderColor: &t.Warning}, func(p *ui.Container) {
				rows := []ui.KeyValueRow{}
				if power := obj(d["power"]); len(power) > 0 {
					ac := "on battery"
					if power["acConnected"] == true {
						ac = "connected"
					}
					rows = append(rows, kv("Battery", scalar(power["battery"])+"% ("+scalar(power["timeRemaining"])+")", t.Success), kv("AC", ac, t.Muted), kv("Draw", fmt.Sprintf("%.1f W", num(power["powerDraw"])), t.Warning))
				}
				for _, v := range arr(d["gpus"]) {
					g := obj(v)
					rows = append(rows, kv(scalar(g["name"]), percent(num(g["utilization"]))+" · "+scalar(g["temperature"])+"°C", t.Accent), kv("GPU memory", bytes(num(g["memoryUsed"]), 2)+" / "+bytes(num(g["memoryTotal"]), 2), t.Muted))
				}
				if len(rows) == 0 {
					p.Label("No battery or GPU telemetry on this host.")
					return
				}
				keys(p, rows, true)
			})
		})
	})
	p.Panel(ui.PanelOptions{Title: "Filesystems", Layout: fixed(10), BorderColor: &t.Secondary}, func(p *ui.Container) {
		data := arr(d["filesystems"])
		if len(data) == 0 {
			p.Label("No filesystems reported.")
			return
		}
		cols := []dataColumn{dc("mount", "Mount", 0, 14, &t.Primary, false), dc("device", "Device", 0, 12, &t.Muted, false), dc("type", "Type", 8, 0, &t.Muted, false), dc("size", "Size", 10, 0, nil, true), dc("used", "Used", 10, 0, nil, true), dc("pct", "Use%", 6, 0, nil, true), dc("inodes", "Inodes", 16, 0, &t.Muted, true)}
		for _, i := range []int{3, 4} {
			key := cols[i].key
			cols[i].format = func(d object) string { return bytes(num(d[key]), 0) }
		}
		cols[5].format = func(d object) string {
			if num(d["size"]) == 0 {
				return "-"
			}
			return percent(num(d["used"]) / num(d["size"]))
		}
		cols[5].color = func(d object) ui.Color {
			if num(d["size"]) > 0 && num(d["used"])/num(d["size"]) > .9 {
				return t.Danger
			}
			return t.Warning
		}
		cols[6].format = func(d object) string {
			if num(d["inodesTotal"]) == 0 {
				return "-"
			}
			return fmt.Sprintf("%s of %.1fM", percent(num(d["inodesUsed"])/num(d["inodesTotal"])), num(d["inodesTotal"])/1e6)
		}
		s.dataTable(p, "services.filesystems", data, cols, true)
	})
}

// Keep estimates distinct from measured throughput without changing simulated
// reference layouts. The shell displays this only in real Traffic mode.
func trafficNotice() string {
	return strings.Join([]string{"Protocol/direction: port-based estimates", "HTTP rate: estimated from log growth"}, "; ")
}
