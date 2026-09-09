// Prints what the country lookup answers for a fixed set of points.
//
// The same probe exists for every port, so "the ports agree about the world" is
// a diff rather than a hope.
package main

import (
	"fmt"

	hqtui "github.com/profullstack/hqtui/ports/go"
)

func main() {
	places := []struct {
		name     string
		lon, lat float64
	}{
		{"Paris", 2.35, 48.86},
		{"Tokyo", 139.7, 35.7},
		{"Cairo", 31.2, 30.0},
		{"Brasilia", -47.9, -15.8},
		{"Canberra", 149.1, -35.3},
		{"Denver", -105.0, 39.7},
		{"Moscow", 37.6, 55.75},
		{"Delhi", 77.2, 28.6},
		{"Nairobi", 36.8, -1.3},
		{"Pacific", -140.0, 0.0},
		{"Atlantic", -30.0, 0.0},
		{"SouthernOcean", 80.0, -40.0},
		{"NorthPacific", -150.0, 40.0},
	}
	for _, p := range places {
		name := "-"
		if c := hqtui.CountryAt(p.lon, p.lat); c != nil {
			name = c.Name
		}
		fmt.Printf("%s %s\n", p.name, name)
	}

	// The cell path, which has to agree with what the canvas drew.
	cells := [][2]int{{173, 28}, {74, 2}, {20, 25}, {88, 7}}
	for _, cell := range cells {
		name := "-"
		if c := hqtui.CountryAtCell(cell[0], cell[1], 200, 50, hqtui.WorldMapOptions{}); c != nil {
			name = c.Name
		}
		fmt.Printf("cell:%d,%d %s\n", cell[0], cell[1], name)
	}

	// And the projection itself, so a drift shows up as a number rather than as
	// a country that happens to still be right.
	for _, cell := range [][2]int{{0, 0}, {99, 25}, {50, 13}} {
		lon, lat, _ := hqtui.DegreesAt(cell[0], cell[1], 100, 26, hqtui.WorldX, hqtui.WorldY)
		fmt.Printf("degrees:%d,%d %.4f %.4f\n", cell[0], cell[1], lon, lat)
	}
}
