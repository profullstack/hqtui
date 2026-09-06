package demo

import (
	"encoding/json"
	ui "github.com/profullstack/hqtui/ports/go"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSharedSensorsRefreshAndRender(t *testing.T) {
	var cases []struct {
		Name                 string
		Files, Changes       map[string]string
		CPUInfo              string  `json:"cpuinfo"`
		NextCPUInfo          *string `json:"nextCpuinfo"`
		GPUs, LM             string
		Temperatures         []float64
		Sensors, NextSensors map[string]string
	}
	raw, err := os.ReadFile("../../../conformance/fixtures/demo-sensors.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			root := t.TempDir()
			write := func(files map[string]string) {
				for name, value := range files {
					path := filepath.Join(root, name)
					if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(path, []byte(value), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			write(c.Files)
			read := func(cpu string) sensorReadings {
				return collectSensors(filepath.Join(root, "sys"), cpu, parseGPUs(c.GPUs), func() string { return c.LM })
			}
			first := read(c.CPUInfo)
			temps := []float64{}
			values := map[string]string{}
			for _, v := range first.temperatures {
				temps = append(temps, num(obj(v)["value"]))
			}
			for _, v := range first.sensors {
				values[str(obj(v)["label"])] = str(obj(v)["value"])
			}
			if !reflect.DeepEqual(temps, c.Temperatures) || !reflect.DeepEqual(values, c.Sensors) {
				t.Fatalf("temperatures=%v sensors=%v", temps, values)
			}
			s := newState(true, 42)
			s.sample["temperatures"] = first.temperatures
			s.sample["sensors"] = first.sensors
			frame := ui.RenderToScreen(220, 70, "dark", s.render)
			for label, value := range values {
				if !frame.Contains(label) || !frame.Contains(value) {
					t.Fatalf("sensor not rendered: %s=%s", label, value)
				}
			}
			write(c.Changes)
			cpu := c.CPUInfo
			if c.NextCPUInfo != nil {
				cpu = *c.NextCPUInfo
			}
			values = map[string]string{}
			for _, v := range read(cpu).sensors {
				values[str(obj(v)["label"])] = str(obj(v)["value"])
			}
			for label, value := range c.NextSensors {
				if values[label] != value {
					t.Fatalf("stale %s: %s", label, values[label])
				}
			}
		})
	}
}
