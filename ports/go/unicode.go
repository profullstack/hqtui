package hqtui

import (
	"strings"
	"sync"
	"unicode/utf16"
	"unicode/utf8"
)

// Terminal text is a grid of columns, not a string. Getting width wrong
// corrupts every cell to the right of the mistake, so width lives behind this
// one file.
//
// One difference from the TypeScript reference is worth stating plainly: a Go
// string is a byte sequence that this package always treats as UTF-8, so the
// unpaired-surrogate handling the reference needs cannot arise from ordinary
// input. Everything else — the width tables, the cluster rules, the
// unsafe-codepoint policy — is identical, and the conformance suite checks it.

// Cell is a cell's contents: a bare codepoint, or an index into the cluster
// table.
type Cell uint32

const (
	// ClusterBase and above are indices into the cluster table, not codepoints.
	ClusterBase Cell = 0x110000
	// Continuation is written into the cell after a double-width character.
	// It is never drawn.
	Continuation Cell = 0xffffffff
	// Replacement is what an unrepresentable codepoint is shown as: one
	// column, and it cannot fuse with a neighbour.
	Replacement Cell = 0xfffd
)

// IsControl reports C0, DEL and C1. A cell holding one of these would be
// written straight back out by the encoder, so untrusted text could steer the
// terminal instead of filling a cell.
func IsControl(cp rune) bool { return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) }

// IsBidiControl reports the bidi overrides, embeddings and isolates: the Trojan
// Source set (CVE-2021-42574). They emit no glyph but reorder everything around
// them, so `user<RLO>nimda` reads as `user admin` in a log pane. Directional
// *marks* (LRM/RLM) and real RTL script are left alone — those render honestly.
func IsBidiControl(cp rune) bool {
	return (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)
}

// IsUnsafeCodepoint reports anything that must never occupy a cell, because it
// steers rather than draws.
//
// This runs per cell on the write path and per codepoint on the measure path,
// so it is one small branch ladder rather than two calls. Printable ASCII —
// overwhelmingly the common case — exits on the second comparison.
func IsUnsafeCodepoint(cp rune) bool {
	if cp < 0x20 {
		return true
	}
	if cp < 0x7f {
		return false
	}
	if cp <= 0x9f {
		return true
	}
	if cp < 0x202a || cp > 0x2069 {
		return false
	}
	return cp <= 0x202e || cp >= 0x2066
}

// StripUnsafe removes everything that steers the terminal rather than drawing.
func StripUnsafe(text string) string {
	var b strings.Builder
	b.Grow(len(text))
	for _, r := range text {
		if !IsUnsafeCodepoint(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// A cell may hold at most this many codepoints. Real ZWJ emoji top out around
// ten; anything longer is a byte-amplification bomb, because the cell still
// claims one column while painting hundreds.
const maxClusterCodepoints = 16

// Distinct clusters are interned for the life of the process — a cell holds an
// index into this table, so entries can never be evicted while a framebuffer
// might still reference them. Untrusted text must therefore not be able to grow
// it without bound.
//
// Past this many, internCluster degrades to the base codepoint: the combining
// marks or emoji joins are dropped, but the cell keeps the correct width, so
// the grid stays in step with the screen.
const maxClusters = 32768

var clusters struct {
	sync.RWMutex
	texts []string
	ids   map[string]Cell
}

func init() { clusters.ids = make(map[string]Cell) }

// InternCluster folds a multi-codepoint grapheme (emoji, combining sequence)
// into one cell value. Unsafe codepoints are stripped here as well as in
// Graphemes, so no caller can smuggle one into a cell.
func InternCluster(text string) Cell {
	safe := StripUnsafe(text)
	if safe == "" {
		safe = " "
	}

	clusters.RLock()
	if id, ok := clusters.ids[safe]; ok {
		clusters.RUnlock()
		return id
	}
	clusters.RUnlock()

	clusters.Lock()
	defer clusters.Unlock()
	// Another goroutine may have interned it between the two locks.
	if id, ok := clusters.ids[safe]; ok {
		return id
	}
	if len(clusters.texts) >= maxClusters {
		// Degrade to the base character rather than grow the table for ever.
		first, _ := utf8.DecodeRuneInString(safe)
		if CharWidth(first) > 0 {
			return Cell(first)
		}
		return 32
	}
	id := ClusterBase + Cell(len(clusters.texts))
	clusters.texts = append(clusters.texts, safe)
	clusters.ids[safe] = id
	return id
}

func ClusterText(value Cell) string {
	clusters.RLock()
	defer clusters.RUnlock()
	i := int(value - ClusterBase)
	if i < 0 || i >= len(clusters.texts) {
		return " "
	}
	return clusters.texts[i]
}

// CellText renders a cell value back to the text the terminal should receive.
func CellText(value Cell) string {
	if value >= ClusterBase && value != Continuation {
		return ClusterText(value)
	}
	if value == 0 || value == Continuation {
		return " "
	}
	return string(rune(value))
}

type crange struct{ lo, hi rune }

// Zero-width: combining marks, variation selectors, ZWJ, most format controls.
var zeroWidth = []crange{
	{0x0300, 0x036f}, {0x0483, 0x0489}, {0x0591, 0x05bd}, {0x0610, 0x061a},
	{0x064b, 0x065f}, {0x0670, 0x0670}, {0x06d6, 0x06dc}, {0x0730, 0x074a},
	{0x07a6, 0x07b0}, {0x0816, 0x0819}, {0x08e3, 0x0903}, {0x093a, 0x093c},
	{0x0951, 0x0957}, {0x0e31, 0x0e31}, {0x0e34, 0x0e3a}, {0x0eb1, 0x0eb1},
	{0x1ab0, 0x1aff}, {0x1dc0, 0x1dff}, {0x200b, 0x200f}, {0x2028, 0x202e},
	{0x2060, 0x2064}, {0x2066, 0x2069}, {0x20d0, 0x20f0}, {0xfe00, 0xfe0f},
	{0xfe20, 0xfe2f},
	{0xfeff, 0xfeff}, {0xe0100, 0xe01ef},
}

// Double-width: East Asian Wide/Fullwidth plus the emoji blocks terminals widen.
var wide = []crange{
	{0x1100, 0x115f}, {0x2e80, 0x303e}, {0x3041, 0x33ff}, {0x3400, 0x4dbf},
	{0x4e00, 0x9fff}, {0xa000, 0xa4cf}, {0xa960, 0xa97f}, {0xac00, 0xd7a3},
	{0xf900, 0xfaff}, {0xfe10, 0xfe19}, {0xfe30, 0xfe6f}, {0xff00, 0xff60},
	{0xffe0, 0xffe6}, {0x1f004, 0x1f004}, {0x1f0cf, 0x1f0cf}, {0x1f18e, 0x1f18e},
	{0x1f191, 0x1f19a}, {0x1f200, 0x1f320}, {0x1f32d, 0x1f335}, {0x1f337, 0x1f37c},
	{0x1f37e, 0x1f393}, {0x1f3a0, 0x1f3ca}, {0x1f3cf, 0x1f3d3}, {0x1f3e0, 0x1f3f0},
	{0x1f3f4, 0x1f3f4}, {0x1f3f8, 0x1f43e}, {0x1f440, 0x1f440}, {0x1f442, 0x1f4fc},
	{0x1f4ff, 0x1f53d}, {0x1f54b, 0x1f54e}, {0x1f550, 0x1f567}, {0x1f57a, 0x1f57a},
	{0x1f595, 0x1f596}, {0x1f5a4, 0x1f5a4}, {0x1f5fb, 0x1f64f}, {0x1f680, 0x1f6c5},
	{0x1f6cc, 0x1f6cc}, {0x1f6d0, 0x1f6d2}, {0x1f6eb, 0x1f6ec}, {0x1f910, 0x1f9ff},
	{0x20000, 0x2fffd}, {0x30000, 0x3fffd},
}

// Extended_Pictographic, approximated to the ranges terminals actually join.
// ZWJ only glues emoji together; joining it to arbitrary text is how one cell
// ends up painting hundreds of columns.
var pictographic = []crange{
	{0x00a9, 0x00a9}, {0x00ae, 0x00ae}, {0x203c, 0x203c}, {0x2049, 0x2049},
	{0x2122, 0x2122}, {0x2139, 0x2139}, {0x2194, 0x21aa}, {0x231a, 0x23fa},
	{0x24c2, 0x24c2}, {0x25aa, 0x25fe}, {0x2600, 0x27bf}, {0x2934, 0x2935},
	{0x2b00, 0x2bff}, {0x3030, 0x3030}, {0x303d, 0x303d}, {0x3297, 0x3299},
	{0x1f000, 0x1faff}, {0x1fc00, 0x1fffd},
}

func inRanges(cp rune, ranges []crange) bool {
	lo, hi := 0, len(ranges)-1
	for lo <= hi {
		mid := (lo + hi) / 2
		r := ranges[mid]
		switch {
		case cp < r.lo:
			hi = mid - 1
		case cp > r.hi:
			lo = mid + 1
		default:
			return true
		}
	}
	return false
}

// CharWidth is the number of columns a single codepoint occupies: 0, 1, or 2.
func CharWidth(cp rune) int {
	if cp == 0 {
		return 0
	}
	if cp < 32 || (cp >= 0x7f && cp < 0xa0) {
		return 0
	}
	if cp < 0x300 {
		return 1
	}
	if inRanges(cp, zeroWidth) {
		return 0
	}
	if inRanges(cp, wide) {
		return 2
	}
	return 1
}

// CellWidth is the number of columns a cell value occupies, handling clusters.
func CellWidth(value Cell) int {
	if value == Continuation {
		return 0
	}
	if value >= ClusterBase {
		first, _ := utf8.DecodeRuneInString(ClusterText(value))
		if CharWidth(first) == 2 {
			return 2
		}
		return 1
	}
	return CharWidth(rune(value))
}

const zwj rune = 0x200d

// Grapheme is one terminal cell's worth of text.
type Grapheme struct {
	// Value is a bare codepoint, or an interned cluster id.
	Value Cell
	Width int
}

// Graphemes splits text into terminal cells. Combining marks, variation
// selectors and ZWJ sequences attach to the base character instead of stealing
// a column.
func Graphemes(text string) []Grapheme {
	out := make([]Grapheme, 0, len(text))
	i := 0
	for i < len(text) {
		cp, size := utf8.DecodeRuneInString(text[i:])
		width := CharWidth(cp)

		// An unsafe codepoint never reaches a cell: it would otherwise be
		// absorbed into the previous grapheme exactly like a combining mark and
		// re-emitted verbatim — escape injection. Every unsafe codepoint is
		// zero-width, so testing the width first means printable text never
		// pays for this check.
		if width == 0 && IsUnsafeCodepoint(cp) {
			i += size
			continue
		}

		// A cell paints one column but may hold several codepoints; cap how
		// many, so no input makes a single cell emit an unbounded run of glyphs.
		clusterEnd := -1
		parts := 1
		for parts < maxClusterCodepoints {
			if i+size >= len(text) {
				break
			}
			next, nsize := utf8.DecodeRuneInString(text[i+size:])
			if next == zwj {
				if i+size+nsize >= len(text) {
					break
				}
				after, asize := utf8.DecodeRuneInString(text[i+size+nsize:])
				// ZWJ joins emoji, and nothing else. Joining it to arbitrary
				// text lets one cell claim a single column while painting
				// hundreds of them.
				if !inRanges(cp, pictographic) || !inRanges(after, pictographic) {
					break
				}
				size += nsize + asize
				clusterEnd = i + size
				parts += 2
				continue
			}
			if CharWidth(next) != 0 {
				break
			}
			// Leave anything unsafe to the outer loop, which drops it.
			if IsUnsafeCodepoint(next) {
				break
			}
			size += nsize
			clusterEnd = i + size
			parts++
		}

		switch {
		case width == 0:
			// A zero-width base: a combining mark with nothing to combine with,
			// or a stray ZWJ. It paints no column, so handing it one would walk
			// the cursor ahead of the screen. Drop it, and what it absorbed.
		case clusterEnd >= 0:
			out = append(out, Grapheme{Value: InternCluster(text[i:clusterEnd]), Width: width})
		default:
			out = append(out, Grapheme{Value: Cell(cp), Width: width})
		}
		i += size
	}
	return out
}

// StringWidth is the display width of a string in terminal columns.
func StringWidth(text string) int {
	w := 0
	for _, g := range Graphemes(text) {
		w += g.Width
	}
	return w
}

// Truncate cuts to max columns, appending an ellipsis when it does not fit.
func Truncate(text string, max int) string { return TruncateWith(text, max, "…") }

func TruncateWith(text string, max int, ellipsis string) string {
	if max <= 0 {
		return ""
	}
	if StringWidth(text) <= max {
		return text
	}
	limit := max - StringWidth(ellipsis)
	if limit < 0 {
		limit = 0
	}
	var b strings.Builder
	w := 0
	for _, g := range Graphemes(text) {
		if w+g.Width > limit {
			break
		}
		b.WriteString(CellText(g.Value))
		w += g.Width
	}
	b.WriteString(ellipsis)
	return b.String()
}

// Align is horizontal placement within a fixed width.
type Align int

const (
	AlignLeft Align = iota
	AlignCenter
	AlignRight
)

// ParseAlign reads the reference implementation's spelling.
func ParseAlign(name string) Align {
	switch name {
	case "right":
		return AlignRight
	case "center":
		return AlignCenter
	}
	return AlignLeft
}

// Fit pads or truncates to exactly width columns.
func Fit(text string, width int, align Align) string {
	t := Truncate(text, width)
	pad := width - StringWidth(t)
	if pad <= 0 {
		return t
	}
	switch align {
	case AlignRight:
		return strings.Repeat(" ", pad) + t
	case AlignCenter:
		l := pad / 2
		return strings.Repeat(" ", l) + t + strings.Repeat(" ", pad-l)
	}
	return t + strings.Repeat(" ", pad)
}

// Wrap is a greedy word wrap at width columns.
func Wrap(text string, width int) []string {
	if width <= 0 {
		return nil
	}
	var lines []string
	for _, paragraph := range strings.Split(text, "\n") {
		line := strings.Builder{}
		lineW := 0
		for _, word := range splitKeepingWhitespace(paragraph) {
			if word == "" {
				continue
			}
			w := StringWidth(word)
			if lineW+w > width && lineW > 0 {
				lines = append(lines, trimEndSpace(line.String()))
				line.Reset()
				lineW = 0
				if allSpace(word) {
					continue
				}
			}
			if w > width {
				// A single word longer than the line: hard-split it.
				for _, g := range Graphemes(word) {
					if lineW+g.Width > width {
						lines = append(lines, line.String())
						line.Reset()
						lineW = 0
					}
					line.WriteString(CellText(g.Value))
					lineW += g.Width
				}
				continue
			}
			line.WriteString(word)
			lineW += w
		}
		lines = append(lines, trimEndSpace(line.String()))
	}
	return lines
}

// splitKeepingWhitespace is JavaScript's `split(/(\s+)/)`: separators are kept
// as their own entries, which is what makes the wrap above preserve interior
// spacing.
func splitKeepingWhitespace(text string) []string {
	if text == "" {
		return []string{""}
	}
	var out []string
	start := 0
	inSpace := -1
	for i, r := range text {
		space := 0
		if isSpace(r) {
			space = 1
		}
		if inSpace == -1 {
			inSpace = space
		} else if inSpace != space {
			out = append(out, text[start:i])
			start = i
			inSpace = space
		}
	}
	out = append(out, text[start:])
	return out
}

// isSpace is JavaScript's `\s`, which is not quite Go's unicode.IsSpace: it
// excludes U+0085 and includes U+FEFF.
func isSpace(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '\v', '\f', '\r', 0xa0,
		0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
		0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return false
}

// trimEndSpace is `String.prototype.trimEnd`, which trims the same set.
func trimEndSpace(s string) string { return strings.TrimRightFunc(s, isSpace) }

// allSpace is `/^\s+$/`, which is false for the empty string.
func allSpace(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !isSpace(r) {
			return false
		}
	}
	return true
}

// utf16Len counts UTF-16 code units, which is what the reference's
// `String.length` means. It only matters in one place — whether a key name is
// long enough to carry a shift modifier — but matching it exactly costs
// nothing.
func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }
