#include <cstdio>
#include <hqtui/widgets.hpp>
#include <numeric>
namespace hqtui {
static std::string number(double v) {
  char b[80];
  std::snprintf(b, sizeof b, v == std::floor(v) ? "%.0f" : "%.1f", v);
  return b;
}
static uint32_t vertical(double v, const std::string &mode = "block") {
  int n = std::clamp(iround(ratio(v) * 8), 0, 8);
  if (mode == "ascii") {
    return v <= 0 ? ' ' : v < .4 ? '.' : v < .7 ? '=' : '#';
  }
  return n ? 0x2580 + n : ' ';
}
void draw_keys(Surface s, const std::vector<KeyValue> &rows, bool spread) {
  auto &t = theme(s);
  int w = s.rect().width, h = s.rect().height, lw = 0;
  for (auto &r : rows)
    lw = std::max(lw, int(width(r.label)));
  lw = std::min(lw + 1, std::max(4, int(w * .6)));
  for (int y = 0; y < h && y < int(rows.size()); y++) {
    auto &r = rows[y];
    text(s, 0, y, fit(r.label, lw), t.muted);
    int x = lw + 1, vw = std::max(0, w - x);
    if (vw)
      text(s, x, y,
           spread ? fit(r.value, vw, HQ_RIGHT)
                  : fit(r.value, std::min(vw, int(width(r.value)))),
           r.color ? r.color : t.foreground);
  }
}
void draw_meter(Surface s, const Meter &o) {
  auto &t = theme(s);
  int w = s.rect().width;
  if (w <= 0 || s.rect().height <= 0)
    return;
  double v = ratio(o.value);
  std::string value =
      o.show_value
          ? (o.readout.empty() ? number(iround(v * 100)) + "%" : o.readout)
          : "";
  int lw = o.label.empty()     ? 0
           : o.label_width < 0 ? int(width(o.label)) + 1
                               : o.label_width,
      vw = value.empty()       ? 0
           : o.value_width < 0 ? int(width(value)) + 1
                               : o.value_width,
      bw = std::max(0, w - lw - vw);
  if (lw)
    text(s, 0, 0, fit(o.label, lw), t.muted, 0, o.background);
  auto track = hq_mix(t.background, t.border, .8);
  double filled = v * bw;
  for (int x = 0; x < bw; x++) {
    uint32_t ch = ' ';
    Color color = track;
    if (o.segmented) {
      ch = 0x25ae;
      if (x < int(std::floor(filled)))
        color =
            o.color ? o.color : hq_heat(&t, bw <= 1 ? v : double(x) / (bw - 1));
    } else {
      double remainder = std::clamp(filled - x, 0., 1.);
      int eighth = iround(remainder * 8);
      ch = eighth == 8 ? 0x2588 : eighth ? 0x2590 - eighth : 0x2500;
      if (eighth)
        color = o.color ? o.color
                        : hq_heat(&t, x < int(std::floor(filled)) && bw > 1
                                          ? double(x) / (bw - 1)
                                          : v);
    }
    auto st = Style().foreground(color);
    if (o.background)
      st = st.background(*o.background);
    s.set(lw + x, 0, ch, st);
  }
  if (vw)
    text(s, w - vw, 0, fit(value, vw, HQ_RIGHT),
         o.color ? o.color : hq_heat(&t, v), HQ_BOLD, o.background);
}
void draw_graph(Surface surface, const Graph &o) {
  if (surface.rect().width <= 0 || surface.rect().height <= 0)
    return;
  auto &t = theme(surface);
  Surface s = surface;
  int mult = o.mode == "braille" ? 2 : 1;
  auto highFor = [&](int window) {
    double hi = -INFINITY;
    for (auto &series : o.series)
      for (int i = std::max(0, int(series.values.size()) - window);
           i < int(series.values.size()); i++)
        if (std::isfinite(series.values[i]))
          hi = std::max(hi, series.values[i]);
    return std::isfinite(hi) ? hi : 1.;
  };
  auto label = o.axis_format ? o.axis_format : [](double v) {
    return std::abs(v) >= 1000 ? number(std::floor(v / 100 + .5) / 10) + "k"
                               : number(v);
  };
  if (o.axis) {
    double hi = o.max.value_or(highFor(s.rect().width * mult));
    int lw = std::max(width(label(hi)), width(label(o.min))) + 1;
    text(s, 0, 0, fit(label(hi), lw, HQ_RIGHT), t.muted);
    if (s.rect().height > 1)
      text(s, 0, s.rect().height - 1, fit(label(o.min), lw, HQ_RIGHT), t.muted);
    s = s.sub({lw, 0, std::max(0, s.rect().width - lw), s.rect().height});
  }
  int w = s.rect().width, h = s.rect().height;
  if (w <= 0 || h <= 0)
    return;
  double low = o.min, high = o.max.value_or(highFor(w * mult));
  if (high <= low)
    high = low + 1;
  double span = high - low;
  if (o.grid)
    for (int y = 0; y < h; y += std::max(2, h / 4))
      for (int x = 0; x < w; x += 2)
        s.set(x, y, 0xb7,
              Style().foreground(hq_mix(t.border, t.background, .4)));
  for (std::size_t si = 0; si < o.series.size(); si++) {
    auto &series = o.series[si];
    auto &values = series.values;
    Color color = series.color ? series.color : hq_series(&t, si);
    int count = std::min(int(values.size()), w * mult),
        start = int(values.size()) - count;
    if (!count)
      continue;
    if (o.mode != "braille") {
      for (int x = 0; x < w; x++) {
        int index = int(values.size()) - w + x;
        if (index < 0 || !std::isfinite(values[index]))
          continue;
        double r = (values[index] - low) / span;
        int full = int(std::floor(r * h));
        auto fg = o.colors.empty()
                      ? color
                      : hq_gradient(o.colors.data(), o.colors.size(), r);
        auto st = Style().foreground(fg);
        if (o.background)
          st = st.background(*o.background);
        for (int k = 0; k < std::min(full, h); k++)
          s.set(x, h - 1 - k, 0x2588, st);
        if (full < h && full >= 0) {
          auto cp = vertical(r * h - full, o.mode);
          if (cp != ' ')
            s.set(x, h - 1 - full, cp, st);
        }
      }
      continue;
    }
    Braille canvas(w, h);
    int px = w * 2, py = h * 4, prevx = 0, prevy = 0;
    bool previous = false;
    for (int i = 0; i < count; i++) {
      double v = values[start + i];
      if (!std::isfinite(v))
        continue;
      int x = count == 1 ? px - 1 : iround(double(i) / (count - 1) * (px - 1)),
          y = iround((1 - ratio((v - low) / span)) * (py - 1));
      if (previous)
        canvas.line(prevx, prevy, x, y);
      else
        canvas.pixel(x, y);
      prevx = x;
      prevy = y;
      previous = true;
    }
    if (series.fill) {
      Color base = o.background.value_or(t.background);
      for (int x = 0; x < w; x++) {
        int from = start + int(double(x) / w * count),
            to = std::max(from + 1, start + int(double(x + 1) / w * count));
        double total = 0;
        int seen = 0;
        for (int i = from; i < std::min(to, int(values.size())); i++)
          if (std::isfinite(values[i])) {
            total += values[i];
            seen++;
          }
        if (!seen)
          continue;
        double filled = ratio((total / seen - low) / span) * h;
        int full = int(std::floor(filled));
        auto paint = [&](int y, uint32_t cp, double extra) {
          auto fg = hq_mix(base, color,
                           .5 * (1 - (h <= 1 ? 0 : double(y) / (h - 1)) * .3) +
                               extra);
          auto st = Style().foreground(fg);
          if (o.background)
            st = st.background(*o.background);
          s.set(x, y, cp, st);
        };
        for (int k = 0; k < std::min(full, h); k++)
          paint(h - 1 - k, 0x2588, 0);
        if (full < h) {
          auto cp = vertical(filled - full);
          if (cp != ' ')
            paint(h - 1 - full, cp, .12);
        }
      }
    }
    if (o.colors.empty())
      canvas.blit(s, color, o.background);
    else
      for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
          if (auto d = canvas.dots[std::size_t(y) * w + x]) {
            auto st = Style().foreground(
                hq_gradient(o.colors.data(), o.colors.size(),
                            1 - double(y) / std::max(1, h - 1)));
            if (o.background)
              st = st.background(*o.background);
            s.set(x, y, 0x2800 + d, st);
          }
  }
  if (o.legend) {
    int x = 0, y = h > 3 ? h - 1 : 0;
    for (std::size_t i = 0; i < o.series.size(); i++) {
      auto &series = o.series[i];
      if (series.label.empty())
        continue;
      text(s, x, y, "■ ", series.color ? series.color : hq_series(&t, i));
      x += 2;
      text(s, x, y, series.label + " ", t.muted);
      x += int(width(series.label)) + 1;
    }
  }
}
void draw_gauge(Surface s, double value, std::string_view label) {
  int w = s.rect().width, h = s.rect().height;
  if (w <= 0 || h <= 0)
    return;
  if (h < 3) {
    Meter m;
    m.value = value;
    m.show_value = false;
    m.segmented = false;
    draw_meter(s, m);
    return;
  }
  Braille a(w, h), rest(w, h);
  double v = ratio(value), cx = a.w / 2., cy = a.h - 2,
         radius = std::min(a.w / 2. - 1, a.h - 3.);
  int steps = std::max(24, iround(radius * 4));
  for (int i = 0; i <= steps; i++) {
    double p = double(i) / steps, angle = std::acos(-1.) * (1 - p),
           x = cx + std::cos(angle) * radius,
           y = cy - std::sin(angle) * radius * .85;
    if (p <= v) {
      a.pixel(x, y);
      a.pixel(x, y - 1);
    } else
      rest.pixel(x, y);
  }
  auto &t = theme(s);
  auto color = hq_heat(&t, v);
  a.blit(s, color);
  rest.blit(s, hq_mix(t.background, t.border, .9));
  if (!label.empty())
    aligned(s, h - 1, label, color, HQ_CENTER, HQ_BOLD);
}
void draw_scrollbar(Surface s, int x, int y, int h, int total, int offset) {
  if (h <= 0 || total <= h)
    return;
  auto &t = theme(s);
  int thumb = std::max(1, iround(double(h) / total * h)),
      pos = iround(double(offset) / std::max(1, total - h) * (h - thumb));
  for (int i = 0; i < h; i++)
    s.set(x, y + i, i >= pos && i < pos + thumb ? 0x2588 : 0x2502,
          Style().foreground(i >= pos && i < pos + thumb
                                 ? t.accent
                                 : hq_mix(t.background, t.border, .7)));
}
void draw_table(Surface s, const Table &o) {
  int w = s.rect().width, h = s.rect().height,
      bodyw = std::max(0, w - int(o.scrollbar)),
      capacity = std::max(0, h - int(o.header));
  auto &t = theme(s);
  std::vector<Constraint> constraints;
  for (std::size_t ci = 0; ci < o.columns.size(); ci++) {
    auto &c = o.columns[ci];
    int intrinsic = int(width(c.title));
    for (int i = 0; i < std::min(200, int(o.rows.size())); i++)
      if (ci < o.rows[i].cells.size())
        intrinsic = std::max(intrinsic, int(width(o.rows[i].cells[ci])));
    constraints.push_back(c.width < 0 ? automatic(intrinsic, c.min)
                                      : cells(c.width, c.min));
  }
  std::vector<int> widths(constraints.size());
  hq_solve(bodyw, constraints.data(), constraints.size(), 1, widths.data());
  if (o.header) {
    int x = 0;
    for (std::size_t i = 0; i < o.columns.size(); i++)
      if (widths[i] > 0) {
        text(s, x, 0, fit(o.columns[i].title, widths[i], o.columns[i].align),
             t.muted, HQ_BOLD);
        x += widths[i] + 1;
      }
  }
  Pane local;
  Pane &p = o.pane ? *o.pane : local;
  p.total = int(o.rows.size());
  p.capacity = capacity;
  p.offset = std::clamp(p.offset, 0, std::max(0, p.total - capacity));
  if (o.pane && capacity > 0) {
    if (p.selected < p.offset)
      p.offset = p.selected;
    if (p.selected >= p.offset + capacity)
      p.offset = p.selected - capacity + 1;
    p.offset = std::clamp(p.offset, 0, std::max(0, p.total - capacity));
  }
  for (int i = 0; i < capacity && p.offset + i < p.total; i++) {
    int index = p.offset + i, y = i + int(o.header);
    auto &row = o.rows[index];
    bool selected = o.pane && index == p.selected;
    std::optional<Color> bg;
    if (selected)
      bg = t.selection;
    else if (o.zebra && index % 2)
      bg = hq_mix(t.surface,
                  hq_rgb(t.dark ? 255 : 0, t.dark ? 255 : 0, t.dark ? 255 : 0),
                  .04);
    if (bg)
      s.sub({0, y, bodyw, 1}).fill(' ', Style().background(*bg));
    int x = 0;
    for (std::size_t c = 0; c < o.columns.size(); c++)
      if (widths[c] > 0) {
        Color fg = selected                                 ? t.selection_text
                   : c < row.colors.size() && row.colors[c] ? row.colors[c]
                   : o.columns[c].color                     ? o.columns[c].color
                                                            : t.foreground;
        text(s, x, y,
             fit(c < row.cells.size() ? row.cells[c] : "", widths[c],
                 o.columns[c].align),
             fg, selected ? HQ_BOLD : 0, bg);
        x += widths[c] + 1;
      }
  }
  if (o.scrollbar)
    draw_scrollbar(s, w - 1, int(o.header), capacity, p.total, p.offset);
}
void draw_log(Surface s, const std::vector<LogEntry> &entries, Pane *pane,
              bool scrollbar) {
  auto &t = theme(s);
  int h = s.rect().height, w = s.rect().width - (scrollbar ? 1 : 0),
      total = int(entries.size()),
      offset = pane ? pane->offset : 0,
      start = std::clamp(total - h - offset, 0, std::max(0, total - h));
  if (pane) {
    pane->total = total;
    pane->capacity = h;
    pane->log = true;
  }
  for (int i = 0; i < h && start + i < total; i++) {
    auto &e = entries[start + i];
    int x = 0;
    if (!e.time.empty()) {
      text(s, x, i, e.time + " ", t.muted);
      x += int(width(e.time)) + 1;
    }
    if (!e.level.empty()) {
      auto level = e.level;
      std::transform(level.begin(), level.end(), level.begin(),
                     [](unsigned char c) { return char(std::toupper(c)); });
      Color color = level == "ERROR" || level == "FATAL" ? t.danger
                    : level == "WARN"                    ? t.warning
                    : level == "INFO"                    ? t.success
                                                         : t.muted;
      text(s, x, i, fit(level, 5), color, HQ_BOLD);
      x += 5;
      text(s, x++, i, " ", t.foreground);
    }
    int mw = e.meta.empty() ? 0 : int(width(e.meta)) + 1,
        available = std::max(0, w - x - mw);
    text(s, x, i, fit(e.message, available), t.foreground);
    if (mw && mw < w)
      text(s, w - mw + 1, i, e.meta, t.muted);
  }
  // With `scrollbar`, the rightmost column is reserved and left unpainted, as
  // the reference does.
}
} // namespace hqtui
