package hqtui

// Collapsed panel borders, asserted the same way the TypeScript reference and
// the Rust port assert them. The scenes are deliberately identical so the three
// can be compared directly.

import (
	"strings"
	"testing"
)

func twoPanels(collapse bool) []string {
	view := func(ui *Container) {
		ui.Row(RowOptions{Layout: Layout{Size: sizePtr(Cells(3))}}, func(row *Container) {
			row.Panel(PanelOptions{Title: "A", Layout: Layout{Size: sizePtr(Cells(8))}}, func(*Container) {})
			row.Panel(PanelOptions{Title: "B", Layout: Layout{Size: sizePtr(Cells(8))}}, func(*Container) {})
		})
	}
	var text string
	if collapse {
		text = RenderCollapsedToText(16, 3, "dark", view)
	} else {
		text = RenderToText(16, 3, "dark", view)
	}
	return strings.Split(text, "\n")
}

func sizePtr(s Size) *Size { return &s }

func TestOffByDefaultTwoPanelsKeepTheirOwnBorders(t *testing.T) {
	lines := twoPanels(false)
	for i, want := range []string{"╮╭", "││", "╯╰"} {
		if !strings.Contains(lines[i], want) {
			t.Fatalf("row %d: want %q in %q", i, want, lines[i])
		}
	}
}

func TestCollapsedSharedEdgeBecomesOneLine(t *testing.T) {
	lines := twoPanels(true)
	if !strings.Contains(lines[0], "┬") || strings.Contains(lines[0], "╮╭") {
		t.Fatalf("top row not collapsed: %q", lines[0])
	}
	if strings.Contains(lines[1], "││") {
		t.Fatalf("middle row not collapsed: %q", lines[1])
	}
	if !strings.Contains(lines[2], "┴") {
		t.Fatalf("bottom row not collapsed: %q", lines[2])
	}
}

func TestTwoFixedPanelsGiveAColumnBack(t *testing.T) {
	plain := []rune(twoPanels(false)[0])
	merged := []rune(twoPanels(true)[0])
	if len(plain) != 16 || len(merged) != 15 {
		t.Fatalf("widths: plain %d, merged %d", len(plain), len(merged))
	}
	if n := strings.Count(string(merged), "┬"); n != 1 {
		t.Fatalf("want exactly one seam, got %d in %q", n, string(merged))
	}
}

func TestOnlyBorderedSiblingsCollapse(t *testing.T) {
	out := RenderCollapsedToText(16, 3, "dark", func(ui *Container) {
		ui.Row(RowOptions{Layout: Layout{Size: sizePtr(Cells(3))}}, func(row *Container) {
			row.Panel(PanelOptions{Title: "A", Layout: Layout{Size: sizePtr(Cells(8))}}, func(*Container) {})
			row.Text("plain")
		})
	})
	if !strings.Contains(out, "plain") {
		t.Fatalf("text missing: %q", out)
	}
	if strings.Contains(strings.Split(out, "\n")[0], "┬") {
		t.Fatalf("text should not collapse into the panel: %q", out)
	}
}

func TestEdgeBitsRoundTrip(t *testing.T) {
	if bits, ok := BorderBits('┬'); !ok || bits != EdgeLeft|EdgeRight|EdgeDown {
		t.Fatalf("┬ bits: %d %v", bits, ok)
	}
	if _, ok := BorderBits('x'); ok {
		t.Fatal("x is not a border glyph")
	}
	a, _ := BorderBits('╮')
	b, _ := BorderBits('╭')
	if glyph, ok := BorderGlyph(BorderRounded, a|b); !ok || glyph != '┬' {
		t.Fatalf("union: %q %v", glyph, ok)
	}
}
