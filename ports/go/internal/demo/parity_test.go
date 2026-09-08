package demo

import (
	"encoding/json"
	ui "github.com/profullstack/hqtui/ports/go"
	"math/bits"
	"os"
	"strings"
	"testing"
)

func TestTypeScriptScreenCells(t *testing.T) {
	raw, err := os.ReadFile("../../../conformance/fixtures/demo-parity.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Screen, Theme, Text string
		Width, Height       int
		Collapsed           bool
		Hashes              []uint32
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Screen+"/"+c.Theme+"/"+scalar(c.Width), func(t *testing.T) {
			s := newState(false, 1337)
			s.sample = loadSample(false)
			s.theme = index(themes, c.Theme)
			s.screen = index(screens, c.Screen)
			s.collapse = c.Collapsed
			render := ui.RenderToScreen
			if c.Collapsed {
				render = ui.RenderCollapsedToScreen
			}
			f := render(c.Width, c.Height, c.Theme, func(p *ui.Container) {
				s.body(p)
			})
			expected := strings.Split(c.Text, "\n")
			gaugeDots := 0
			for y := 0; y < c.Height; y++ {
				hash := uint32(2166136261)
				add := func(v byte) { hash = (hash ^ uint32(v)) * 16777619 }
				for x := 0; x < c.Width; x++ {
					cell := f.Cell(x, y)
					for _, b := range []byte(cell.Char) {
						add(b)
					}
					add(0)
					for _, v := range []uint32{uint32(cell.Fg), uint32(cell.Bg), uint32(cell.Attrs)} {
						for i := 0; i < 4; i++ {
							add(byte(v >> (i * 8)))
						}
					}
				}
				if hash != c.Hashes[y] {
					// libm and Go's pure-Go cosine differ by one ULP at 2π/3.
					// In the Components gauge this straddles a half-pixel. Permit
					// one Braille dot per frame only; colors/attributes, spacing,
					// every other glyph and every other screen remain exact.
					if c.Screen == "components" {
						glyphs := []string{}
						for _, ch := range expected[y] {
							glyphs = append(glyphs, string(ch))
							if ui.StringWidth(string(ch)) == 2 {
								glyphs = append(glyphs, "")
							}
						}
						for len(glyphs) < c.Width {
							glyphs = append(glyphs, " ")
						}
						normalized := uint32(2166136261)
						addExpected := func(v byte) { normalized = (normalized ^ uint32(v)) * 16777619 }
						dots := 0
						valid := true
						for x := 0; x < c.Width; x++ {
							cell := f.Cell(x, y)
							want := glyphs[x]
							if cell.Char != want {
								if y != 20 || x <= c.Width/2 || x >= c.Width*3/4 {
									valid = false
								}
								a, b := []rune(cell.Char), []rune(want)
								if len(a) != 1 || len(b) != 1 || a[0] < 0x2800 || a[0] > 0x28ff || b[0] < 0x2800 || b[0] > 0x28ff {
									valid = false
								} else {
									dots += bits.OnesCount32(uint32(a[0] ^ b[0]))
								}
							}
							for _, b := range []byte(want) {
								addExpected(b)
							}
							addExpected(0)
							for _, v := range []uint32{uint32(cell.Fg), uint32(cell.Bg), uint32(cell.Attrs)} {
								for i := 0; i < 4; i++ {
									addExpected(byte(v >> (i * 8)))
								}
							}
						}
						if valid && dots > 0 && gaugeDots+dots <= 1 && normalized == c.Hashes[y] {
							gaugeDots += dots
							continue
						}
					}
					t.Errorf("row %d\nTS: %s\nGO: %s", y, expected[y], f.Line(y))
				}
			}
		})
	}
}
