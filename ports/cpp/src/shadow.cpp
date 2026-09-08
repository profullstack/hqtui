/// A drop shadow cast by a region onto whatever is behind it.
///
/// The point is that it dims what it covers rather than painting over it: a
/// shadow that filled its band with a flat colour would erase the dashboard
/// underneath, which is the opposite of what a shadow is for. Every covered cell
/// keeps its own character and its own hue, and only loses some of its light.
#include <hqtui/widgets.hpp>

namespace hqtui {

void dim_rect(Surface s, int x, int y, int width, int height, double amount) {
  double t = std::clamp(amount, 0.0, 1.0);
  // `hq_rgb(0, 0, 0)`, not a bare 0: zero is the sentinel for "the terminal's
  // own colour", so mixing towards it drains a cell's colour rather than
  // darkening it.
  Color black = hq_rgb(0, 0, 0);
  auto native = s.native();
  for (int row = 0; row < height; row++) {
    for (int col = 0; col < width; col++) {
      int ax = native.rect.x + x + col;
      int ay = native.rect.y + y + row;
      if (ax < native.clip.x || ay < native.clip.y ||
          ax >= native.clip.x + native.clip.width || ay >= native.clip.y + native.clip.height)
        continue;
      hq_cell cell{};
      if (!hq_buffer_cell(native.buffer, ax, ay, &cell))
        continue;
      // Written through the absolute-coordinate surface so the cell keeps its
      // own character: only the colours change.
      Surface whole(hq_surface{native.buffer, native.theme, native.clip, native.clip});
      whole.set(ax - native.clip.x, ay - native.clip.y, cell.value,
                Style(hq_mix(cell.fg, black, t), hq_mix(cell.bg, black, t), cell.attrs));
    }
  }
}

void draw_shadow(Surface s, Rect rect, const Shadow &o) {
  if (s.rect().width <= 0 || s.rect().height <= 0)
    return;
  int dx = o.offset_x, dy = o.offset_y;
  if (dx == 0 && dy == 0)
    return;

  auto paint = [&](int x, int y, int w, int h) {
    if (w <= 0 || h <= 0)
      return;
    if (o.color)
      s.sub({x, y, w, h}).fill(' ', Style().background(*o.color));
    else
      dim_rect(s, x, y, w, h, o.amount);
  };

  // The shadow is the moved region minus the original, which splits into two
  // rectangles that do not touch: the rows the move added, at the moved
  // region's full width, and then the columns it added over the rows the two
  // still share. Cutting it any other way overlaps at the corner, and a corner
  // dimmed twice reads as a smudge rather than an edge.
  int tx = rect.x + dx, ty = rect.y + dy;
  if (dy > 0)
    paint(tx, rect.y + rect.height, rect.width, dy);
  else if (dy < 0)
    paint(tx, ty, rect.width, -dy);

  int y0 = std::max(rect.y, ty);
  int shared = std::min(rect.y + rect.height, ty + rect.height) - y0;
  if (shared > 0) {
    if (dx > 0)
      paint(rect.x + rect.width, y0, dx, shared);
    else if (dx < 0)
      paint(tx, y0, -dx, shared);
  }
}

} // namespace hqtui
