/// A canvas you can draw on in your own coordinates.
///
/// `Braille` works in pixels: good primitives, but the caller does every unit
/// conversion, and a drawing written for one panel size is wrong in the next.
/// This wraps it with a domain per axis and a list of shapes placed in that
/// domain, so the same drawing fits whatever region it is given.
///
/// Y increases upwards, as it does on paper and in every plot, rather than
/// downwards as it does in a terminal. A canvas is for drawing things that have
/// their own geometry; making the caller flip every y would be handing them
/// back the conversion this exists to take away.
#include <hqtui/widgets.hpp>

namespace hqtui {
namespace {

/// A usable span: a zero-width one cannot be mapped onto anything.
Bounds span(const std::optional<Bounds> &bounds) {
  if (!bounds || !std::isfinite(bounds->min) || !std::isfinite(bounds->max) ||
      !(bounds->max > bounds->min))
    return Bounds{0, 1};
  return *bounds;
}

bool all_finite(std::initializer_list<double> values) {
  for (double v : values)
    if (!std::isfinite(v))
      return false;
  return true;
}

/// Whether a shape has anything finite to draw.
bool usable(const Shape &s) {
  switch (s.kind) {
  case HQ_SHAPE_LINE:
    return all_finite({s.x1, s.y1, s.x2, s.y2});
  case HQ_SHAPE_CIRCLE:
    return all_finite({s.x1, s.y1, s.radius});
  case HQ_SHAPE_RECT:
    return all_finite({s.x1, s.y1, s.width, s.height});
  default:
    for (auto &p : s.points)
      if (all_finite({p.x, p.y}))
        return true;
    return false;
  }
}

} // namespace

Projection canvas_projection(const Braille &canvas, Bounds x, Bounds y) {
  Projection p;
  p.width = double(std::max(2, canvas.w) - 1);
  p.height = double(std::max(2, canvas.h) - 1);
  p.x_bounds = x;
  p.y_bounds = y;
  return p;
}

double Projection::x(double value) const {
  return (value - x_bounds.min) / (x_bounds.max - x_bounds.min) * width;
}

double Projection::y(double value) const {
  double at = (value - y_bounds.min) / (y_bounds.max - y_bounds.min);
  return (1 - at) * height;
}

void draw_canvas(Surface s, const Canvas &o) {
  int sw = s.rect().width, sh = s.rect().height;
  if (sw <= 0 || sh <= 0 || o.shapes.empty())
    return;
  auto &t = theme(s);
  Bounds xb = span(o.x), yb = span(o.y);

  if (o.grid) {
    Color color = o.grid_color ? *o.grid_color : hq_mix(t.border, t.background, .4);
    for (int y = 0; y < sh; y += std::max(2, sh / 4))
      for (int x = 0; x < sw; x += 2)
        s.set(x, y, 0xb7, Style().foreground(color));
  }

  Braille canvas(sw, sh);
  Projection at = canvas_projection(canvas, xb, yb);
  Color base = o.color ? o.color : t.accent;

  // One shape at a time, blitted before the next is drawn, so each keeps its
  // own colour. A shared canvas would make the last colour win everywhere the
  // shapes overlap.
  for (auto &shape : o.shapes) {
    if (!usable(shape))
      continue;
    std::fill(canvas.dots.begin(), canvas.dots.end(), 0);
    switch (shape.kind) {
    case HQ_SHAPE_LINE:
      canvas.line(at.x(shape.x1), at.y(shape.y1), at.x(shape.x2), at.y(shape.y2));
      break;
    case HQ_SHAPE_POLYLINE: {
      std::vector<ChartPoint> pixels;
      for (auto &p : shape.points)
        if (all_finite({p.x, p.y}))
          pixels.push_back({at.x(p.x), at.y(p.y)});
      if (pixels.size() == 1)
        canvas.pixel(pixels[0].x, pixels[0].y);
      else
        for (std::size_t i = 0; i + 1 < pixels.size(); i++)
          canvas.line(pixels[i].x, pixels[i].y, pixels[i + 1].x, pixels[i + 1].y);
      break;
    }
    case HQ_SHAPE_POINTS:
      for (auto &p : shape.points)
        if (all_finite({p.x, p.y}))
          canvas.pixel(at.x(p.x), at.y(p.y));
      break;
    case HQ_SHAPE_CIRCLE: {
      // A radius is a distance, not a position, so it is scaled by the span
      // rather than projected. The two axes rarely scale alike in a terminal
      // cell, and the x one is what a circle is measured against.
      double scale = double(std::max(2, canvas.w) - 1) / (xb.max - xb.min);
      canvas.circle(at.x(shape.x1), at.y(shape.y1), std::abs(shape.radius) * scale);
      break;
    }
    case HQ_SHAPE_RECT: {
      // Given as a corner and a size, in the caller's own direction: a positive
      // height goes up, because their y does.
      double x0 = at.x(shape.x1), x1 = at.x(shape.x1 + shape.width);
      double y0 = at.y(shape.y1), y1 = at.y(shape.y1 + shape.height);
      if (shape.fill)
        canvas.fill_rect(x0, std::min(y0, y1), x1, std::max(y0, y1));
      else
        canvas.rect(x0, std::min(y0, y1), x1, std::max(y0, y1));
      break;
    }
    }
    canvas.blit(s, shape.color ? shape.color : base, o.background);
  }
}

} // namespace hqtui
