package demo

import (
	"encoding/json"
	ui "github.com/profullstack/hqtui/ports/go"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func trafficFixture(t *testing.T) object {
	t.Helper()
	raw, err := os.ReadFile("../../../conformance/fixtures/demo-traffic.json")
	if err != nil {
		t.Fatal(err)
	}
	var out object
	if err = json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}
func TestTrafficSourcesAndTabs(t *testing.T) {
	f := trafficFixture(t)
	s := newState(true, 42)
	tele := obj(s.sample["telemetry"])
	for key, value := range socketBreakdown(arr(f["connections"]), arr(f["listeners"])) {
		tele[key] = value
	}
	if num(tele["inboundConnections"]) != 1 || num(tele["outboundConnections"]) != 2 || len(arr(tele["protocols"])) != 3 {
		t.Fatal(tele["protocols"])
	}
	tele["sessions"] = trafficSessions(str(f["who"]))
	if str(obj(arr(tele["sessions"])[0])["from"]) != "203.0.113.4" {
		t.Fatal(tele["sessions"])
	}
	tele["logins"] = trafficLogins(str(f["last"]), "ok")
	if len(arr(tele["logins"])) != 1 || str(obj(arr(tele["logins"])[0])["status"]) != "still" {
		t.Fatal(tele["logins"])
	}
	tele["failedLogins"] = trafficLogins(str(f["lastb"]), "failed")
	tele["ssh"] = trafficSSH(str(f["ssh"]))
	events := arr(tele["ssh"])
	if len(events) != 3 {
		t.Fatal(events)
	}
	for i, action := range []string{"accepted", "invalid", "disconnect"} {
		if str(obj(events[i])["action"]) != action {
			t.Fatal(events)
		}
	}
	h := httpStats(str(f["http"]), "fixture")
	if str(obj(arr(h["recent"])[0])["time"]) != "10:01:02" {
		t.Fatal("bad HTTP timestamp")
	}
	tele["http"] = h
	if num(h["total"]) != 3 || num(h["upgrades"]) != 1 || str(obj(arr(h["recent"])[0])["path"]) != "/chat" {
		t.Fatal(h)
	}
	raw, _ := json.Marshal(h)
	if strings.Contains(string(raw), "secret") {
		t.Fatal("query leaked")
	}
	for screen, labels := range map[int][]string{1: {"HTTPS", "SSH", "accepted", "/chat"}, 2: {"alice", "eve", "Failed Logins", "still"}} {
		s.screen = screen
		frame := ui.RenderToScreen(240, 80, "dark", s.render)
		for _, label := range labels {
			if !frame.Contains(label) {
				t.Fatalf("screen %d missing %s", screen, label)
			}
		}
	}
	if len(trafficSSH("")) != 0 || len(trafficLogins("", "ok")) != 0 {
		t.Fatal("fabricated events")
	}
}
func TestHTTPTailGrowthRotationAndDisappearance(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "var/log/nginx/access.log")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	raw := str(trafficFixture(t)["http"])
	write := func(s string) {
		if err := os.WriteFile(path, []byte(s), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(raw)
	var c httpCollector
	now := time.Now()
	if num(obj(c.sample(root, now))["requestsPerSecond"]) != 0 {
		t.Fatal("first rate")
	}
	write(raw + raw)
	if num(obj(c.sample(root, now.Add(time.Second)))["requestsPerSecond"]) <= 0 {
		t.Fatal("no growth")
	}
	if err := os.Rename(path, path+".old"); err != nil {
		t.Fatal(err)
	}
	write(raw + raw + raw)
	if num(obj(c.sample(root, now.Add(2*time.Second)))["requestsPerSecond"]) != 0 {
		t.Fatal("rotation spike")
	}
	write(raw)
	if num(obj(c.sample(root, now.Add(3*time.Second)))["requestsPerSecond"]) != 0 {
		t.Fatal("truncate spike")
	}
	write(strings.Repeat("x", 300000) + "\n" + raw)
	tail, _, err := tailLog(path)
	if err != nil || len(tail) > 256*1024 {
		t.Fatal("unbounded tail")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if c.sample(root, now.Add(4*time.Second)) != nil {
		t.Fatal("stale HTTP")
	}
}
