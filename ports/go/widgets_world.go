package hqtui

// A world map you can click.
//
// The drawing is the canvas doing what it already does — polylines in the
// caller's own coordinates, which for a map are degrees. What this adds is the
// other direction: turning a click back into a country.

type WorldMapOptions struct {
	// X and Y are the window on the globe. Nil means all of it.
	X *Bounds
	Y *Bounds
	// Color is the coastline colour.
	Color *Color
	// Highlight names countries to pick out, by name or ISO code.
	Highlight      []string
	HighlightColor *Color
	Background     *Color
	Grid           bool
}

func (o WorldMapOptions) window() (Bounds, Bounds) {
	x, y := WorldX, WorldY
	if o.X != nil {
		x = *o.X
	}
	if o.Y != nil {
		y = *o.Y
	}
	return x, y
}

func DrawWorldMap(s Surface, o WorldMapOptions) {
	if s.IsEmpty() {
		return
	}
	theme := s.Theme
	color := theme.Border
	if o.Color != nil {
		color = *o.Color
	}
	highlight := theme.Accent
	if o.HighlightColor != nil {
		highlight = *o.HighlightColor
	}
	x, y := o.window()
	DrawCanvas(s, CanvasOptions{
		Shapes: WorldShapes(WorldShapeOptions{
			Color:          &color,
			Highlight:      o.Highlight,
			HighlightColor: &highlight,
		}),
		X:          &x,
		Y:          &y,
		Background: o.Background,
		Grid:       o.Grid,
	})
}

// CountryAtCell is the country under a cell of a map drawn with these bounds.
//
// Exposed so a caller can answer a hover as well as a click, and so the
// arithmetic that has to agree with the drawing lives in one place.
func CountryAtCell(column, row, width, height int, o WorldMapOptions) *CountryOutline {
	x, y := o.window()
	lon, lat, ok := DegreesAt(column, row, width, height, x, y)
	if !ok {
		return nil
	}
	return CountryAt(lon, lat)
}
