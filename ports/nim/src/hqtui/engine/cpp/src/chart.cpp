/// Charts of arbitrary (x, y) data.
///
/// `draw_graph` takes a vector of doubles and puts one sample per column: the x
/// axis is the vector index. That is the right model for a history buffer and
/// the wrong one for everything else -- two series of different lengths
/// silently render at different horizontal scales, a gap in the data is
/// indistinguishable from a shorter series, and there is no way at all to say
/// where on the x axis a point belongs.
///
/// This takes points and a domain for each axis, so a series is placed rather
/// than appended. `draw_graph` is untouched and still means what it meant.
#include <hqtui/widgets.hpp>

namespace hqtui {
namespace {

/// A finite number, or nothing: a caller's bound is data, and data can be NaN.
std::optional<double> bound(std::optional<double> value) {
  if (value && std::isfinite(*value))
    return value;
  return std::nullopt;
}

double clamp01(double v) { return std::clamp(v, 0.0, 1.0); }

/// Where a value sits in its domain, 0 at the minimum and 1 at the maximum.
double ratio(double value, Domain d) { return (value - d.min) / (d.max - d.min); }

/// The eighth-block for a partial cell, as the reference spells it.
uint32_t partial(double r, const std::string &mode) {
  int n = std::clamp(iround(clamp01(r) * 8), 0, 8);
  if (mode == "ascii")
    return r <= 0 ? ' ' : r < .4 ? '.' : r < .7 ? '=' : '#';
  return n ? 0x2580 + n : ' ';
}

} // namespace

Domain domain_of(const std::vector<ChartSeries> &series, const Axis *axis, int which) {
  auto min = axis ? bound(axis->min) : std::nullopt;
  auto max = axis ? bound(axis->max) : std::nullopt;
  if (!min || !max) {
    double lo = INFINITY, hi = -INFINITY;
    for (auto &s : series)
      for (auto &p : s.points) {
        double v = which == 0 ? p.x : p.y;
        if (!std::isfinite(v))
          continue;
        lo = std::min(lo, v);
        hi = std::max(hi, v);
      }
    if (!std::isfinite(lo)) {
      lo = 0;
      hi = 1;
    }
    if (!min)
      min = lo;
    if (!max)
      max = hi;
  }
  if (!(*max > *min)) {
    // A flat series still has to be drawn somewhere sensible.
    double pad = std::abs(*min) > 0 ? std::abs(*min) * .5 : .5;
    return {*min - pad, *min + pad};
  }
  return {*min, *max};
}

/// The area between a series and its baseline, in block elements.
///
/// Braille would give eight scattered dots per cell, which reads as noise where
/// an area should read as an area. The line itself stays Braille, so it keeps
/// the sub-cell resolution.
///
/// The height of each column is interpolated along the line rather than sampled
/// from the points that happen to land in it. Sampling leaves a gap wherever a
/// column has no point of its own, which with arbitrary x values is most of
/// them -- the area comes out striped instead of solid.
static void fill_under(Surface s, const std::vector<ChartPoint> &points, Domain xd,
                       Domain yd, double baseline, Color color,
                       std::optional<Color> bg, double alpha) {
  int w = s.rect().width, h = s.rect().height;
  if (w <= 0 || h <= 0 || points.empty())
    return;
  auto &t = theme(s);
  Color base = bg.value_or(t.background);
  double floor_at = clamp01(ratio(baseline, yd));
  auto column = [&](double x) { return ratio(x, xd) * (w - 1); };

  std::vector<double> tops(std::size_t(w), std::numeric_limits<double>::quiet_NaN());
  auto record = [&](int col, double value) {
    if (col < 0 || col >= w)
      return;
    // A path that doubles back covers a column twice; the outer edge is the one
    // that bounds the area.
    double previous = tops[std::size_t(col)];
    if (std::isnan(previous) ||
        std::abs(value - floor_at) > std::abs(previous - floor_at))
      tops[std::size_t(col)] = value;
  };

  if (points.size() == 1)
    record(iround(column(points[0].x)), clamp01(ratio(points[0].y, yd)));
  for (std::size_t i = 0; i + 1 < points.size(); i++) {
    double x0 = points[i].x, y0 = points[i].y;
    double x1 = points[i + 1].x, y1 = points[i + 1].y;
    double c0 = column(x0), c1 = column(x1);
    int from = int(std::max(0.0, std::floor(std::min(c0, c1))));
    int to = int(std::min(double(w - 1), std::max(0.0, std::ceil(std::max(c0, c1)))));
    for (int col = from; col <= to; col++) {
      double u = c1 == c0 ? 0 : (col - c0) / (c1 - c0);
      if (u < -.5 || u > 1.5)
        continue;
      record(col, clamp01(ratio(y0 + (y1 - y0) * clamp01(u), yd)));
    }
  }

  for (int x = 0; x < w; x++) {
    double top = tops[std::size_t(x)];
    if (std::isnan(top))
      continue;
    double from01 = std::min(floor_at, top);
    double filled = (std::max(floor_at, top) - from01) * h;
    int bottom = int(std::floor(from01 * h));
    int full = int(std::floor(filled));
    for (int k = 0; k < full && k < h; k++) {
      int row = h - 1 - bottom - k;
      if (row < 0 || row >= h)
        continue;
      double depth = h <= 1 ? 0 : double(row) / (h - 1);
      auto st = Style().foreground(hq_mix(base, color, alpha * (1 - depth * .3)));
      if (bg)
        st = st.background(*bg);
      s.set(x, row, 0x2588, st);
    }
    if (full < h) {
      uint32_t glyph = partial(filled - full, "block");
      int row = h - 1 - bottom - full;
      if (glyph != ' ' && row >= 0 && row < h) {
        double depth = h <= 1 ? 0 : double(row) / (h - 1);
        auto st =
            Style().foreground(hq_mix(base, color, alpha * (1 - depth * .3) + .12));
        if (bg)
          st = st.background(*bg);
        s.set(x, row, glyph, st);
      }
    }
  }
}

/// The block and ascii degradations: one column per cell, tallest point wins.
///
/// A scatter keeps its dots rather than growing columns, because a scatter that
/// fills to the baseline is a bar chart wearing the wrong name.
static void plot_cells(Surface s, const std::vector<ChartSeries> &series,
                       const std::string &mode, Domain xd, Domain yd,
                       double baseline, std::optional<Color> bg) {
  int w = s.rect().width, h = s.rect().height;
  if (w <= 0 || h <= 0)
    return;
  auto &t = theme(s);
  double floor_ratio = clamp01(ratio(baseline, yd));

  for (std::size_t si = 0; si < series.size(); si++) {
    auto &cs = series[si];
    Color color = cs.color ? cs.color : hq_series(&t, si);
    // Highest value per column, so a column shows the peak that fell in it
    // rather than whichever point happened to be last.
    std::vector<double> tops(std::size_t(w), std::numeric_limits<double>::quiet_NaN());
    for (auto &p : cs.points) {
      if (!std::isfinite(p.x) || !std::isfinite(p.y))
        continue;
      int col = std::clamp(iround(ratio(p.x, xd) * (w - 1)), 0, w - 1);
      double value = clamp01(ratio(p.y, yd));
      if (std::isnan(tops[std::size_t(col)]) || value > tops[std::size_t(col)])
        tops[std::size_t(col)] = value;
    }

    for (int x = 0; x < w; x++) {
      double top = tops[std::size_t(x)];
      if (std::isnan(top))
        continue;
      auto st = Style().foreground(color);
      if (bg)
        st = st.background(*bg);
      if (cs.mark == HQ_MARK_SCATTER) {
        int row = h - 1 - std::min(int(std::floor(top * h)), h - 1);
        s.set(x, row, mode == "ascii" ? '*' : 0x2022, st);
        continue;
      }
      double from = std::min(floor_ratio, top) * h;
      double filled = (std::max(floor_ratio, top) - std::min(floor_ratio, top)) * h;
      int full = int(std::floor(filled));
      for (int k = 0; k < full; k++) {
        int row = h - 1 - int(std::floor(from)) - k;
        if (row >= 0 && row < h)
          s.set(x, row, 0x2588, st);
      }
      uint32_t glyph = partial(filled - full, mode);
      int row = h - 1 - int(std::floor(from)) - full;
      if (glyph != ' ' && row >= 0 && row < h)
        s.set(x, row, glyph, st);
    }
  }
}

void plot_points(Surface s, const std::vector<ChartSeries> &series,
                 const ChartPlot &o) {
  if (s.rect().width <= 0 || s.rect().height <= 0 || series.empty())
    return;
  auto &t = theme(s);
  int w = s.rect().width, h = s.rect().height;

  Domain xd = domain_of(series, o.x ? &*o.x : nullptr, 0);
  Domain yd = domain_of(series, o.y ? &*o.y : nullptr, 1);
  double baseline = bound(o.baseline).value_or(yd.min);

  if (o.grid) {
    Color color = o.grid_color.value_or(hq_mix(t.border, t.background, .4));
    for (int y = 0; y < h; y += std::max(2, h / 4))
      for (int x = 0; x < w; x += 2)
        s.set(x, y, 0xb7, Style().foreground(color));
  }

  if (o.mode != "braille") {
    plot_cells(s, series, o.mode, xd, yd, baseline, o.background);
    return;
  }

  for (std::size_t si = 0; si < series.size(); si++) {
    auto &cs = series[si];
    Color color = cs.color ? cs.color : hq_series(&t, si);
    std::vector<ChartPoint> finite;
    for (auto &p : cs.points)
      if (std::isfinite(p.x) && std::isfinite(p.y))
        finite.push_back(p);
    if (finite.empty())
      continue;

    Braille canvas(w, h);
    double px = canvas.w, py = canvas.h;
    std::vector<ChartPoint> pixels;
    pixels.reserve(finite.size());
    for (auto &p : finite)
      pixels.push_back({double(iround(clamp01(ratio(p.x, xd)) * (px - 1))),
                        double(iround((1 - clamp01(ratio(p.y, yd))) * (py - 1)))});

    if (cs.mark == HQ_MARK_SCATTER) {
      for (auto &p : pixels)
        canvas.pixel(p.x, p.y);
    } else if (cs.mark == HQ_MARK_BAR) {
      double floor_px = iround((1 - clamp01(ratio(baseline, yd))) * (py - 1));
      for (auto &p : pixels)
        canvas.line(p.x, std::min(p.y, floor_px), p.x, std::max(p.y, floor_px));
    } else if (pixels.size() == 1) {
      canvas.pixel(pixels[0].x, pixels[0].y);
    } else {
      for (std::size_t i = 0; i + 1 < pixels.size(); i++)
        canvas.line(pixels[i].x, pixels[i].y, pixels[i + 1].x, pixels[i + 1].y);
    }

    if (cs.fill && cs.mark != HQ_MARK_SCATTER)
      fill_under(s, finite, xd, yd, baseline, color, o.background,
                 o.fill_alpha.value_or(.5));
    canvas.blit(s, color, o.background);
  }
}

/// Evenly spaced values across a domain, ends included.
///
/// Two ticks means the ends and nothing else, which is what an axis wants when
/// there is no room to say more.
static std::vector<double> ticks_for(double min, double max, int count) {
  int n = std::max(2, count);
  std::vector<double> out;
  out.reserve(std::size_t(n));
  for (int i = 0; i < n; i++)
    out.push_back(min + (max - min) * i / (n - 1));
  return out;
}

void draw_chart(Surface surface, const Chart &o) {
  if (surface.rect().width <= 0 || surface.rect().height <= 0)
    return;
  auto &t = theme(surface);
  Color axis_color = o.axis_color ? o.axis_color : t.muted;

  Domain xd = domain_of(o.series, o.plot.x ? &*o.plot.x : nullptr, 0);
  Domain yd = domain_of(o.series, o.plot.y ? &*o.plot.y : nullptr, 1);

  auto label_of = [](const std::optional<Axis> &axis, double v) {
    if (axis && axis->format)
      return axis->format(v);
    return std::abs(v) >= 1000 ? number(std::floor(v / 100 + .5) / 10) + "k"
                               : number(v);
  };

  // The x labels take a row, and they can only take one when there is a row to
  // spare -- a two-row chart is all plot.
  int x_ticks = o.axis ? 2 : 0;
  if (o.plot.x && o.plot.x->ticks > 0)
    x_ticks = o.plot.x->ticks;
  const bool want_x_axis = o.axis && x_ticks >= 2 && surface.rect().height > 2;

  Surface s = surface;
  if (o.axis) {
    std::string hi = label_of(o.plot.y, yd.max), lo = label_of(o.plot.y, yd.min);
    int lw = std::max(int(width(hi)), int(width(lo))) + 1;
    text(s, 0, 0, fit(hi, lw, HQ_RIGHT), axis_color);
    if (s.rect().height > 1) {
      // The minimum marks the bottom of the plot, which is a row higher when
      // the x labels have taken the last one.
      int bottom = want_x_axis ? s.rect().height - 2 : s.rect().height - 1;
      text(s, 0, bottom, fit(lo, lw, HQ_RIGHT), axis_color);
    }
    s = s.sub({lw, 0, std::max(0, s.rect().width - lw), s.rect().height});
  }

  Surface area = s;
  if (want_x_axis && s.rect().height > 1 && s.rect().width > 0) {
    area = s.sub({0, 0, s.rect().width, s.rect().height - 1});
    int row = s.rect().height - 1;
    auto values = ticks_for(xd.min, xd.max, x_ticks);
    double step = values.size() > 1 ? double(s.rect().width - 1) / (values.size() - 1) : 0;
    for (std::size_t i = 0; i < values.size(); i++) {
      std::string label = label_of(o.plot.x, values[i]);
      // The last label is right-aligned to the edge, so it cannot run off it.
      int x = std::min(s.rect().width - int(width(label)), iround(double(i) * step));
      text(s, std::max(0, x), row, label, axis_color);
    }
  }

  // The domain is resolved once and handed down, so the labels and the marks
  // cannot disagree about what the axis spans.
  ChartPlot plot = o.plot;
  Axis x_axis = plot.x.value_or(Axis{});
  x_axis.min = xd.min;
  x_axis.max = xd.max;
  Axis y_axis = plot.y.value_or(Axis{});
  y_axis.min = yd.min;
  y_axis.max = yd.max;
  plot.x = x_axis;
  plot.y = y_axis;
  plot_points(area, o.series, plot);

  if (o.legend) {
    int total = 0;
    for (auto &cs : o.series)
      if (!cs.label.empty())
        total += int(width(cs.label)) + 3;
    int x = o.legend_align == HQ_RIGHT ? std::max(0, area.rect().width - total) : 0;
    int y = area.rect().height > 3 ? area.rect().height - 1 : 0;
    for (std::size_t i = 0; i < o.series.size(); i++) {
      auto &cs = o.series[i];
      if (cs.label.empty())
        continue;
      Color color = cs.color ? cs.color : hq_series(&t, i);
      x += int(text(area, x, y, "■ ", color));
      x += int(text(area, x, y, cs.label + " ", t.muted));
    }
  }
}

} // namespace hqtui
