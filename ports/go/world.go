package hqtui

import (
	"math"
	"strings"
)

// The world, as shapes for the canvas, and the lookup that makes it clickable.
//
// The canvas already draws in the caller's own coordinates, and longitude and
// latitude are just another pair of axes — so a map is a list of polylines in
// degrees, and nothing here needs a projection of its own beyond deciding which
// window on the globe to show.
//
// The interesting half is the other direction. A click arrives as a terminal
// cell, and a country is a polygon, so answering "what did they click" means
// turning the cell back into degrees and testing it against the outlines. Doing
// it that way rather than with bounding boxes is what makes the answer right:
// Russia's bounding box covers most of the northern hemisphere, and Chile's
// covers Argentina.

// WorldX and WorldY are the whole globe, which is what a map shows unless told
// otherwise.
var (
	WorldX = Bounds{Min: -180, Max: 180}
	WorldY = Bounds{Min: -90, Max: 90}
)

type WorldShapeOptions struct {
	// Color is for countries with nothing special about them.
	Color *Color
	// Highlight names countries to pick out, by name or ISO code.
	Highlight      []string
	HighlightColor *Color
}

// countryMatches matches on either the name or the ISO code, case-insensitively.
func countryMatches(c CountryOutline, keys []string) bool {
	for _, key := range keys {
		if key == "" {
			continue
		}
		if strings.EqualFold(c.Name, key) {
			return true
		}
		if c.ISO != "" && strings.EqualFold(c.ISO, key) {
			return true
		}
	}
	return false
}

// WorldShapes is the world as canvas shapes, one polyline per landmass.
//
// Polylines rather than scattered points: the outlines are closed rings, so
// joining them draws a coastline instead of a dotted suggestion of one, and it
// reads at a fraction of the resolution dots would need.
func WorldShapes(o WorldShapeOptions) []Shape {
	shapes := make([]Shape, 0, 300)
	for _, country := range WorldCountries {
		color := o.Color
		if len(o.Highlight) > 0 && countryMatches(country, o.Highlight) && o.HighlightColor != nil {
			color = o.HighlightColor
		}
		for _, ring := range country.Rings {
			points := make([]Point, 0, len(ring)/2+1)
			for i := 0; i+1 < len(ring); i += 2 {
				points = append(points, Point{X: ring[i], Y: ring[i+1]})
			}
			// Closed: the last point joins the first, or every country has a gap
			// in its coastline where the ring started.
			if len(points) > 0 {
				points = append(points, points[0])
			}
			shapes = append(shapes, Shape{Kind: ShapePolyline, Points: points, Color: color})
		}
	}
	return shapes
}

// insideRing reports whether a point is inside a ring, by ray casting.
//
// The ring is a flat list of interleaved coordinates, so this walks it two at a
// time rather than allocating a pair per vertex — it runs once per country per
// click, and there are a couple of thousand vertices.
func insideRing(ring []float64, lon, lat float64) bool {
	inside := false
	n := len(ring) / 2
	if n == 0 {
		return false
	}
	j := n - 1
	for i := 0; i < n; i++ {
		xi, yi := ring[i*2], ring[i*2+1]
		xj, yj := ring[j*2], ring[j*2+1]
		if (yi > lat) != (yj > lat) && lon < (xj-xi)*(lat-yi)/(yj-yi)+xi {
			inside = !inside
		}
		j = i
	}
	return inside
}

// CountryAt is the country containing a point, or nil for open water.
//
// Where outlines overlap — and at this resolution simplified borders do overlap
// — the first match wins, which is stable because the data is sorted by name.
func CountryAt(lon, lat float64) *CountryOutline {
	if math.IsNaN(lon) || math.IsNaN(lat) || math.IsInf(lon, 0) || math.IsInf(lat, 0) {
		return nil
	}
	for i := range WorldCountries {
		for _, ring := range WorldCountries[i].Rings {
			if insideRing(ring, lon, lat) {
				return &WorldCountries[i]
			}
		}
	}
	return nil
}

// FindCountry looks a country up by name or ISO code.
func FindCountry(key string) *CountryOutline {
	keys := []string{key}
	for i := range WorldCountries {
		if countryMatches(WorldCountries[i], keys) {
			return &WorldCountries[i]
		}
	}
	return nil
}

// CountryBounds is the window a country fills, with a little room around it.
//
// For zooming a map to a country: the bounding box alone puts the coastline
// flat against the edge of the panel, which reads as though the country has
// been cut off rather than framed.
func CountryBounds(country *CountryOutline, margin float64) (Bounds, Bounds) {
	minLon, maxLon := math.Inf(1), math.Inf(-1)
	minLat, maxLat := math.Inf(1), math.Inf(-1)
	for _, ring := range country.Rings {
		for i := 0; i+1 < len(ring); i += 2 {
			minLon = math.Min(minLon, ring[i])
			maxLon = math.Max(maxLon, ring[i])
			minLat = math.Min(minLat, ring[i+1])
			maxLat = math.Max(maxLat, ring[i+1])
		}
	}
	if math.IsInf(minLon, 0) {
		return WorldX, WorldY
	}
	// A single-point country would give a zero-width window, which cannot be
	// mapped onto anything.
	padX := math.Max((maxLon-minLon)*margin, 1)
	padY := math.Max((maxLat-minLat)*margin, 1)
	return Bounds{Min: minLon - padX, Max: maxLon + padX},
		Bounds{Min: minLat - padY, Max: maxLat + padY}
}

// DegreesAt is the degrees under a terminal cell, given the window the map was
// drawn with.
//
// The inverse of what the canvas does on the way in, taken at the centre of the
// cell: a click lands on a whole cell, and the centre is the only point in it
// that is not arbitrarily nearer one neighbour than the other.
func DegreesAt(column, row, width, height int, x, y Bounds) (lon, lat float64, ok bool) {
	if width <= 0 || height <= 0 {
		return 0, 0, false
	}
	// The canvas is 2x4 Braille pixels per cell, and it spans its bounds across
	// `pixels - 1`, so the inverse has to use the same denominators or a click
	// drifts from what was drawn.
	px := math.Max(1, float64(width*2-1))
	py := math.Max(1, float64(height*4-1))
	lon = x.Min + (float64(column*2+1)/px)*(x.Max-x.Min)
	lat = y.Min + (1-float64(row*4+2)/py)*(y.Max-y.Min)
	return lon, lat, true
}
