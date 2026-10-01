/// A scrollbar, on its own.
///
/// The renderer used to live inside the table and was reachable only by being a
/// table, list, tree or log. Anything else that scrolls — a wrapped paragraph, a
/// canvas, a `draw()` somebody wrote themselves — could not show one.
///
/// This is the same drawing, lifted out and given the four edges plus state the
/// caller owns. The dense widgets route through it, so there is one
/// implementation and one appearance.
#include <hqtui/widgets.hpp>

namespace hqtui {

Thumb thumb(int track, int total, int offset, int viewport) {
  if (track <= 0 || total <= 0)
    return {0, 0};
  int visible = viewport > 0 ? viewport : track;
  if (total <= visible)
    return {0, track};
  int size = std::min(track, std::max(1, iround(double(visible) / total * track)));
  int max_offset = std::max(1, total - visible);
  int clamped = std::clamp(offset, 0, max_offset);
  int start = iround(double(clamped) / max_offset * (track - size));
  return {std::clamp(start, 0, track - size), size};
}

void draw_scrollbar(Surface s, int x, int y, int h, int total, int offset) {
  // The table draws its bar unconditionally and leans on this guard to keep it
  // off screen when everything already fits, so the early return has to stay.
  if (h <= 0 || total <= h)
    return;
  auto &t = theme(s);
  Thumb bar = thumb(h, total, offset, h);
  for (int i = 0; i < h; i++) {
    bool in_thumb = i >= bar.start && i < bar.start + bar.size;
    s.set(x, y + i, in_thumb ? 0x2588 : 0x2502,
          Style().foreground(in_thumb ? t.accent : hq_mix(t.background, t.border, .7)));
  }
}

void draw_scrollbar(Surface s, const Scrollbar &o) {
  int w = s.rect().width, h = s.rect().height;
  if (w <= 0 || h <= 0)
    return;
  bool vertical = is_vertical(o.orientation);
  auto &t = theme(s);
  Color track_color = hq_mix(t.background, t.border, .7);

  int length = vertical ? h : w;
  int viewport = o.viewport > 0 ? o.viewport : length;
  Thumb bar = thumb(length, o.total, o.offset, viewport);

  int line = vertical ? (o.orientation == HQ_SCROLLBAR_RIGHT ? w - 1 : 0)
                      : (o.orientation == HQ_SCROLLBAR_BOTTOM ? h - 1 : 0);

  for (int i = 0; i < length; i++) {
    bool in_thumb = i >= bar.start && i < bar.start + bar.size;
    // A horizontal bar uses the half-height glyphs rather than the full block:
    // a run of full blocks across a row reads as a solid rule, which is not
    // what a thumb is meant to look like.
    uint32_t glyph = vertical ? (in_thumb ? 0x2588 : 0x2502) : (in_thumb ? 0x2501 : 0x2500);
    Style style = Style().foreground(in_thumb ? t.accent : track_color);
    if (vertical)
      s.set(line, i, glyph, style);
    else
      s.set(i, line, glyph, style);
  }
}

int offset_for_position(int position, int track, int total, int viewport) {
  int visible = viewport > 0 ? viewport : track;
  if (track <= 0 || total <= visible)
    return 0;
  int size = thumb(track, total, 0, visible).size;
  int usable = std::max(1, track - size);
  int at = std::clamp(position - size / 2, 0, usable);
  return iround(double(at) / usable * (total - visible));
}

} // namespace hqtui
