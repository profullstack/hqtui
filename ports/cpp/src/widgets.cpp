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
/// The reference's word wrap: break before a word that would overflow, and
/// hard-split a single word longer than the line. Trailing space is trimmed
/// from each produced line.
static std::vector<std::string> wrap_text(std::string_view content, int columns) {
  std::vector<std::string> lines;
  if (columns <= 0)
    return lines;

  std::size_t para_start = 0;
  while (para_start <= content.size()) {
    std::size_t brk = content.find('\n', para_start);
    std::string_view paragraph = content.substr(
        para_start, brk == std::string_view::npos ? std::string_view::npos : brk - para_start);

    std::string line;
    int line_w = 0;
    // Split on runs of whitespace, keeping them as their own tokens, exactly as
    // the reference's /(\s+)/ split does.
    std::size_t i = 0;
    while (i <= paragraph.size()) {
      bool space = i < paragraph.size() && std::isspace((unsigned char)paragraph[i]);
      std::size_t j = i;
      while (j < paragraph.size() &&
             bool(std::isspace((unsigned char)paragraph[j])) == space)
        j++;
      if (j == i)
        break;
      std::string_view word = paragraph.substr(i, j - i);
      i = j;

      int w = int(width(word));
      if (line_w + w > columns && line_w > 0) {
        while (!line.empty() && line.back() == ' ')
          line.pop_back();
        lines.push_back(line);
        line.clear();
        line_w = 0;
        if (space)
          continue;
      }
      if (w > columns) {
        // A single word longer than the line: hard-split it by grapheme.
        std::size_t k = 0;
        while (k < word.size()) {
          unsigned char lead = word[k];
          std::size_t len = lead < 128 ? 1 : lead < 224 ? 2 : lead < 240 ? 3 : 4;
          len = std::min(len, word.size() - k);
          std::string_view g = word.substr(k, len);
          int gw = int(width(g));
          if (line_w + gw > columns) {
            lines.push_back(line);
            line.clear();
            line_w = 0;
          }
          line += g;
          line_w += gw;
          k += len;
        }
        continue;
      }
      line += word;
      line_w += w;
    }
    while (!line.empty() && line.back() == ' ')
      line.pop_back();
    lines.push_back(line);

    if (brk == std::string_view::npos)
      break;
    para_start = brk + 1;
  }
  return lines;
}

/// Splits on newlines, or wraps, depending on what the caller asked for.
static std::vector<std::string> lines_of(std::string_view content, int columns,
                                         bool wrap) {
  if (wrap)
    return wrap_text(content, columns);
  std::vector<std::string> out;
  std::size_t start = 0;
  while (start <= content.size()) {
    std::size_t brk = content.find('\n', start);
    out.emplace_back(content.substr(
        start, brk == std::string_view::npos ? std::string_view::npos : brk - start));
    if (brk == std::string_view::npos)
      break;
    start = brk + 1;
  }
  return out;
}

void draw_text(Surface s, std::string_view content, const TextStyle &o) {
  auto &t = theme(s);
  int w = s.rect().width, h = s.rect().height;
  if (w <= 0 || h <= 0)
    return;
  Color fg = o.fg ? o.fg : t.foreground;
  auto lines = lines_of(content, w, o.wrap);
  for (int i = 0; i < h && i < int(lines.size()); i++)
    text(s, 0, i, fit(lines[std::size_t(i)], w, o.align), fg, o.attrs, o.bg);
}

int draw_badge(Surface s, const Badge &o) {
  auto &t = theme(s);
  int surface_width = s.rect().width;
  if (surface_width <= 0 || s.rect().height <= 0)
    return 0;
  Color color = o.color ? o.color : t.primary;
  std::string label = " " + o.text + " ";
  int w = std::min(int(width(label)), surface_width);

  Color fg = color;
  std::optional<Color> bg;
  int attrs = HQ_BOLD;
  if (o.variant == HQ_BADGE_FILLED) {
    fg = t.dark ? t.background : t.surface;
    bg = color;
  } else if (o.variant == HQ_BADGE_SUBTLE) {
    bg = hq_mix(t.surface, color, .18);
    attrs = 0;
  }

  int x = o.align == HQ_RIGHT      ? surface_width - w
          : o.align == HQ_CENTER   ? (surface_width - w) / 2
                                   : 0;
  text(s, std::max(0, x), 0, fit(label, w, HQ_LEFT), fg, attrs, bg);
  return w;
}

void draw_divider(Surface s, const Divider &o) {
  auto &t = theme(s);
  int w = s.rect().width;
  if (w <= 0 || s.rect().height <= 0)
    return;
  Color color = o.color ? o.color : t.border;
  uint32_t ch = 0x2500;
  if (!o.ch.empty()) {
    // First code point of the caller's rule character.
    unsigned char lead = o.ch[0];
    std::size_t len = lead < 128 ? 1 : lead < 224 ? 2 : lead < 240 ? 3 : 4;
    len = std::min(len, o.ch.size());
    ch = 0;
    if (len == 1) {
      ch = lead;
    } else {
      ch = lead & (0xffu >> (len + 1));
      for (std::size_t i = 1; i < len; i++)
        ch = (ch << 6) | (uint32_t(o.ch[i]) & 0x3f);
    }
  }
  auto st = Style().foreground(color);
  for (int x = 0; x < w; x++)
    s.set(x, 0, ch, st);

  if (!o.label.empty()) {
    std::string label = " " + o.label + " ";
    int lw = int(width(label));
    int x = o.align == HQ_LEFT      ? 1
            : o.align == HQ_RIGHT   ? w - lw - 1
                                    : (w - lw) / 2;
    text(s, std::max(0, x), 0, fit(label, std::min(lw, w), HQ_LEFT), t.muted, 0, {});
  }
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
/// Eighth-width blocks, for the partial cell at the end of a smooth bar.
static uint32_t horizontal_glyph(double ratio, bool ascii) {
  double r = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
  if (ascii)
    return r == 0 ? ' ' : r < .5 ? '-' : '#';
  static const uint32_t eighths[9] = {' ',    0x258f, 0x258e, 0x258d, 0x258c,
                                      0x258b, 0x258a, 0x2589, 0x2588};
  return eighths[iround(r * 8)];
}

void draw_bar(Surface s, const Bar &o) {
  auto &t = theme(s);
  int w = s.rect().width;
  if (w <= 0 || s.rect().height <= 0)
    return;
  double r = ratio(o.value);
  Color track = hq_mix(t.background, t.border, .8);
  Color color = o.color ? o.color : t.primary;
  uint32_t track_char = o.style == HQ_BAR_ASCII       ? '-'
                        : o.style == HQ_BAR_SEGMENTED ? 0x25ae
                                                      : 0x2500;
  uint32_t fill_char = o.style == HQ_BAR_ASCII       ? '#'
                       : o.style == HQ_BAR_SEGMENTED ? 0x25ae
                                                     : 0x2588;

  double filled = r * w;
  int full = int(std::floor(filled));
  for (int x = 0; x < w; x++) {
    uint32_t ch;
    Color fg;
    if (x < full) {
      ch = fill_char;
      fg = o.heat ? hq_heat(&t, w <= 1 ? r : double(x) / (w - 1)) : color;
    } else if (x == full && o.style != HQ_BAR_SEGMENTED) {
      uint32_t glyph = horizontal_glyph(filled - full, o.style == HQ_BAR_ASCII);
      ch = glyph == ' ' ? track_char : glyph;
      fg = glyph == ' ' ? track : (o.heat ? hq_heat(&t, r) : color);
    } else {
      ch = track_char;
      fg = track;
    }
    auto st = Style().foreground(fg);
    if (o.background)
      st = st.background(*o.background);
    s.set(x, 0, ch, st);
  }
}

void draw_meter(Surface s, const Meter &o) {
  auto &t = theme(s);
  int w = s.rect().width;
  if (w <= 0 || s.rect().height <= 0)
    return;
  // Ordered so a non-finite value falls through to 0 rather than rendering
  // "nan%" in black on black.
  double r = ratio(o.max ? o.value / o.max : o.value);
  bool heat = o.heat ? *o.heat : o.color == 0;

  int lw = o.label.empty()   ? 0
           : o.label_width < 0 ? int(width(o.label)) + 1
                               : o.label_width;
  std::string value = o.show_value
                          ? (o.readout.empty() ? number(iround(r * 100)) + "%"
                                               : o.readout)
                          : "";
  int vw = value.empty()      ? 0
           : o.value_width < 0 ? int(width(value)) + 1
                               : o.value_width;
  int bw = std::max(0, w - lw - vw);

  if (lw)
    text(s, 0, 0, fit(o.label, lw), t.muted, 0, o.background);
  if (bw > 0) {
    Bar bar;
    bar.value = r;
    bar.color = o.color;
    bar.heat = heat;
    bar.style = o.ascii ? HQ_BAR_ASCII
                : o.segmented ? HQ_BAR_SEGMENTED
                              : HQ_BAR_SMOOTH;
    bar.background = o.background;
    draw_bar(s.sub({lw, 0, bw, 1}), bar);
  }
  if (vw)
    text(s, w - vw, 0, fit(value, vw, HQ_RIGHT),
         o.color ? o.color : (o.heat && !*o.heat ? t.foreground : hq_heat(&t, r)),
         HQ_BOLD, o.background);
}

void draw_meters(Surface s, const Meters &o) {
  int w = s.rect().width, h = s.rect().height;
  if (w <= 0 || h <= 0 || o.items.empty())
    return;
  int columns = std::max(1, o.columns);
  int gap = o.gap;
  int col_width = (w - gap * (columns - 1)) / columns;
  int per_column = int((o.items.size() + std::size_t(columns) - 1) / std::size_t(columns));
  if (per_column <= 0 || col_width <= 0)
    return;

  for (std::size_t i = 0; i < o.items.size(); i++) {
    int col = int(i) / per_column, row = int(i) % per_column;
    if (row >= h || col >= columns)
      continue;
    const auto &item = o.items[i];
    Meter m;
    m.value = item.value;
    m.max = item.max;
    m.label = item.label;
    m.readout = item.text;
    m.color = item.color;
    m.label_width = o.label_width;
    m.value_width = o.value_width;
    m.heat = o.heat;
    m.segmented = o.style == HQ_BAR_SEGMENTED;
    m.ascii = o.style == HQ_BAR_ASCII;
    m.background = o.background;
    draw_meter(s.sub({col * (col_width + gap), row, col_width, 1}), m);
  }
}

/// Bottom-up eighths, for one cell of a sparkline or column chart.
static uint32_t vertical_glyph(double ratio) {
  double r = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;
  static const uint32_t eighths[9] = {' ',    0x2581, 0x2582, 0x2583, 0x2584,
                                      0x2585, 0x2586, 0x2587, 0x2588};
  return eighths[iround(r * 8)];
}

/// The reference's axis extent: a caller's bound wins, otherwise the data's,
/// and a bound that is not finite falls back to the computed one so every
/// plotted coordinate stays finite.
static void extent(const std::vector<double> &values, std::optional<double> min_in,
                   std::optional<double> max_in, double *min_out, double *max_out) {
  std::optional<double> min = min_in && std::isfinite(*min_in) ? min_in : std::nullopt;
  std::optional<double> max = max_in && std::isfinite(*max_in) ? max_in : std::nullopt;
  if (!min || !max) {
    double lo = INFINITY, hi = -INFINITY;
    for (double v : values) {
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
      min = std::min(0., lo);
    if (!max)
      max = hi;
  }
  if (*max <= *min)
    max = *min + 1;
  *min_out = *min;
  *max_out = *max;
}

void draw_spark(Surface s, const std::vector<double> &values, const Sparkline &o) {
  auto &t = theme(s);
  int w = s.rect().width;
  if (w <= 0 || s.rect().height <= 0)
    return;
  // The scale comes from the window that is actually shown, not the whole
  // series, so a long history does not flatten the visible part.
  std::size_t window = std::size_t(std::max(1, w));
  std::vector<double> shown(values.end() - std::min(window, values.size()), values.end());
  double min = 0, max = 1;
  extent(shown, o.min, o.max, &min, &max);
  double span = max - min;
  Color color = o.color ? o.color : t.accent;

  int count = int(std::min(values.size(), std::size_t(w)));
  int start = int(values.size()) - count, offset = w - count;
  for (int i = 0; i < count; i++) {
    double v = values[std::size_t(start + i)];
    if (!std::isfinite(v))
      continue;
    double r = ratio((v - min) / span);
    auto st = Style().foreground(color);
    if (o.background)
      st = st.background(*o.background);
    s.set(offset + i, 0, vertical_glyph(r), st);
  }
}

void draw_sparkline(Surface s, const Sparkline &o) {
  auto &t = theme(s);
  int w = s.rect().width;
  if (w <= 0 || s.rect().height <= 0)
    return;
  int lw = o.label.empty() ? 0 : int(width(o.label)) + 1;
  int vw = o.text.empty() ? 0 : int(width(o.text)) + 1;
  if (lw)
    text(s, 0, 0, o.label, t.muted, 0, o.background);
  int bw = w - lw - vw;
  if (bw > 0)
    draw_spark(s.sub({lw, 0, bw, 1}), o.values, o);
  if (vw)
    text(s, w - vw, 0, fit(o.text, vw, HQ_RIGHT), o.color ? o.color : t.accent,
         HQ_BOLD, o.background);
}

void draw_heat_bar(Surface s, const HeatBar &o) {
  auto &t = theme(s);
  int surface_width = s.rect().width;
  if (surface_width <= 0 || s.rect().height <= 0)
    return;
  double r = ratio(o.value);
  int w = std::min(o.width < 0 ? surface_width : o.width, surface_width);
  int filled = iround(r * w);
  uint32_t ch = 0x25ae;
  if (!o.ch.empty()) {
    unsigned char lead = o.ch[0];
    std::size_t len = lead < 128 ? 1 : lead < 224 ? 2 : lead < 240 ? 3 : 4;
    len = std::min(len, o.ch.size());
    if (len == 1) {
      ch = lead;
    } else {
      ch = lead & (0xffu >> (len + 1));
      for (std::size_t i = 1; i < len; i++)
        ch = (ch << 6) | (uint32_t(o.ch[i]) & 0x3f);
    }
  }
  Color off = hq_mix(t.background, t.border, .75);
  for (int x = 0; x < w; x++) {
    bool on = x < filled;
    Color fg = on ? (o.color ? o.color : hq_heat(&t, w <= 1 ? r : double(x) / (w - 1)))
                  : off;
    auto st = Style().foreground(fg);
    if (o.background)
      st = st.background(*o.background);
    s.set(x, 0, ch, st);
  }
}

void draw_columns(Surface s, const Columns &o) {
  auto &t = theme(s);
  int w = s.rect().width, h = s.rect().height;
  if (w <= 0 || h <= 0 || o.values.empty())
    return;
  double max = 1;
  if (o.max) {
    max = *o.max;
  } else {
    for (double v : o.values)
      max = std::max(max, v);
  }
  Color color = o.color ? o.color : t.primary;

  int count = int(std::min(o.values.size(), std::size_t(w)));
  int start = int(o.values.size()) - count;
  for (int i = 0; i < count; i++) {
    double r = ratio(o.values[std::size_t(start + i)] / max);
    double filled = r * h;
    int full = int(std::floor(filled));
    auto st = Style().foreground(color);
    if (o.background)
      st = st.background(*o.background);
    for (int k = 0; k < full; k++)
      s.set(i, h - 1 - k, 0x2588, st);
    if (full < h) {
      uint32_t glyph = vertical_glyph(filled - full);
      if (glyph != ' ')
        s.set(i, h - 1 - full, glyph, st);
    }
  }
}

void draw_progress(Surface s, const Progress &o) {
  auto &t = theme(s);
  Meter m;
  m.value = o.value;
  m.max = o.max ? o.max : 1;
  m.label = o.label;
  m.color = o.color ? o.color : t.primary;
  m.heat = false;
  m.background = o.background;
  if (o.show_count)
    m.readout = number(iround(o.value)) + "/" + number(iround(m.max));
  draw_meter(s, m);
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
  // Whether the bottom row belongs to the time axis rather than the plot.
  // Decided before the y-axis labels are written: the minimum marks the bottom
  // of the *plot*, and the time axis takes that row away. Writing it at
  // height - 1 regardless put it against the first time label, so "$0" and
  // "08-10" rendered as "$008-10".
  const bool time_axis_row = !o.time_axis.empty() && s.rect().height > 2;
  if (o.axis) {
    double hi = o.max.value_or(highFor(s.rect().width * mult));
    int lw = std::max(width(label(hi)), width(label(o.min))) + 1;
    text(s, 0, 0, fit(label(hi), lw, HQ_RIGHT), t.muted);
    if (s.rect().height > 1) {
      const int bottom = time_axis_row ? s.rect().height - 2 : s.rect().height - 1;
      text(s, 0, bottom, fit(label(o.min), lw, HQ_RIGHT), t.muted);
    }
    s = s.sub({lw, 0, std::max(0, s.rect().width - lw), s.rect().height});
  }
  // The time axis costs the bottom row, and the plot gets what is left.
  if (!o.time_axis.empty() && s.rect().height > 1) {
    Surface plot_surface = s;
    int pw = plot_surface.rect().width, ph = plot_surface.rect().height;
    double step = o.time_axis.size() > 1 ? double(pw - 1) / double(o.time_axis.size() - 1) : 0;
    for (std::size_t i = 0; i < o.time_axis.size(); i++) {
      const auto &label = o.time_axis[i];
      int x = std::min(pw - int(width(label)), iround(double(i) * step));
      text(plot_surface, std::max(0, x), ph - 1, label, t.muted, 0, {});
    }
    s = s.sub({0, 0, pw, ph - 1});
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
void draw_donut(Surface s, const Donut &o) {
  auto &t = theme(s);
  int w = s.rect().width, h = s.rect().height;
  if (w <= 0 || h <= 0)
    return;
  double total = 0;
  for (const auto &seg : o.segments)
    total += std::max(0., seg.value);
  if (total <= 0)
    total = 1;

  Braille canvas(w, h);
  // Colour is per cell rather than per segment, because one cell can hold dots
  // from two segments and the last one written wins, as in the reference.
  std::vector<Color> colors(std::size_t(w) * std::size_t(h), 0);
  double cx = canvas.w / 2., cy = canvas.h / 2.;
  double outer = std::min(canvas.w / 2., canvas.h / 2.) - 1, inner = outer * .55;

  double angle = -std::acos(-1.) / 2;
  for (std::size_t i = 0; i < o.segments.size(); i++) {
    const auto &seg = o.segments[i];
    double sweep = (std::max(0., seg.value) / total) * std::acos(-1.) * 2;
    Color color = seg.color ? seg.color : hq_series(&t, i);
    int steps = std::max(8, iround(sweep * outer * 3));
    for (int step = 0; step <= steps; step++) {
      double a = angle + (sweep * step) / steps;
      for (double r = inner; r <= outer; r += .4) {
        int x = iround(cx + std::cos(a) * r);
        int y = iround(cy + std::sin(a) * r * .9);
        canvas.pixel(x, y);
        int col = x >> 1, row = y >> 2;
        if (col >= 0 && col < w && row >= 0 && row < h)
          colors[std::size_t(row) * std::size_t(w) + std::size_t(col)] = color;
      }
    }
    angle += sweep;
  }

  canvas.blit(
      s,
      [&](int col, int row) {
        Color c = colors[std::size_t(row) * std::size_t(w) + std::size_t(col)];
        return c ? c : t.muted;
      },
      o.background);
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
/// Where the visible window starts, given an explicit offset, a selection to
/// follow, and how much fits.
static int resolve_offset(int offset, int selected, int capacity, int total, bool follow) {
  int max_offset = std::max(0, total - capacity);
  int start = std::clamp(offset, 0, max_offset);
  if (follow && selected >= 0 && capacity > 0) {
    if (selected < start)
      start = selected;
    else if (selected >= start + capacity)
      start = selected - capacity + 1;
  }
  return std::clamp(start, 0, max_offset);
}

int draw_button(Surface s, const Button &o) {
  auto &t = theme(s);
  int surface_width = s.rect().width;
  if (surface_width <= 0 || s.rect().height <= 0)
    return 0;
  Color color = o.color ? o.color
                : o.variant == HQ_BUTTON_SUCCESS ? t.success
                : o.variant == HQ_BUTTON_WARNING ? t.warning
                : o.variant == HQ_BUTTON_DANGER  ? t.danger
                : o.variant == HQ_BUTTON_GHOST   ? t.muted
                                                 : t.primary;
  std::string label = " " + o.label + " ";
  int w = std::min(o.width < 0 ? int(width(label)) : o.width, surface_width);

  Color fg = color;
  std::optional<Color> bg;
  int attrs = 0;
  if (o.disabled) {
    fg = t.muted;
    bg = elevate(t, .05);
  } else if (o.focused) {
    fg = t.dark ? t.background : t.surface;
    bg = color;
    attrs = HQ_BOLD;
  } else if (o.variant != HQ_BUTTON_GHOST) {
    bg = hq_mix(t.surface, color, .16);
    attrs = HQ_BOLD;
  }
  text(s, 0, 0, fit(label, w, o.align), fg, attrs, bg);
  return w;
}

int draw_checkbox(Surface s, const Checkbox &o) {
  auto &t = theme(s);
  if (s.rect().width <= 0 || s.rect().height <= 0)
    return 0;
  Color color = o.color ? o.color : (o.checked ? t.success : t.muted);
  const char *glyph = o.variant == HQ_CHECKBOX_TOGGLE
                          ? (o.checked ? "[▮ ]" : "[ ▮]")
                      : o.variant == HQ_CHECKBOX_RADIO
                          ? (o.checked ? "(●)" : "( )")
                          : (o.checked ? "[✓]" : "[ ]");
  int x = int(text(s, 0, 0, glyph, color, o.focused ? HQ_BOLD : 0, {}));
  if (!o.label.empty())
    x += int(text(s, x, 0, " " + o.label, o.focused ? t.foreground : t.muted,
                  o.focused ? HQ_BOLD : 0, {}));
  return x;
}

void draw_select(Surface s, const Select &o) {
  auto &t = theme(s);
  int surface_width = s.rect().width, h = s.rect().height;
  if (surface_width <= 0 || h <= 0)
    return;
  int w = std::min(o.width < 0 ? surface_width : o.width, surface_width);
  Color color = o.color ? o.color : (o.focused ? t.border_focused : t.border);
  Color chrome = elevate(t, .05);

  std::string label = " " + std::string(fit(o.value, std::max(0, w - 4), HQ_LEFT));
  text(s, 0, 0, fit(label, w - 2), t.foreground, o.focused ? HQ_BOLD : 0, chrome);
  text(s, w - 2, 0, o.open ? " ▴" : " ▾", color, 0, chrome);

  if (o.open && !o.options.empty()) {
    int rows = std::min(int(o.options.size()), h - 1);
    Color open_bg = elevate(t, .08);
    for (int i = 0; i < rows; i++) {
      bool selected = i == o.selected_index;
      text(s, 0, i + 1, fit(" " + std::string(fit(o.options[std::size_t(i)], w - 2, HQ_LEFT)), w),
           selected ? t.selection_text : t.foreground, 0,
           selected ? t.selection : open_bg);
    }
  }
}

void draw_text_input(Surface s, const TextInput &o) {
  auto &t = theme(s);
  int surface_width = s.rect().width;
  if (surface_width <= 0 || s.rect().height <= 0)
    return;
  int w = std::min(o.width < 0 ? surface_width : o.width, surface_width);
  int lw = o.label.empty() ? 0 : int(width(o.label)) + 1;
  if (!o.label.empty())
    text(s, 0, 0, o.label, t.muted, 0, {});

  int field = std::max(0, w - lw);
  Color bg = elevate(t, o.focused ? .1 : .05);
  s.sub({lw, 0, field, 1}).fill(' ', Style().background(bg));

  std::string shown = o.value;
  if (o.password) {
    shown.clear();
    // One bullet per character, not per byte.
    for (std::size_t i = 0; i < o.value.size();) {
      unsigned char lead = o.value[i];
      i += lead < 128 ? 1 : lead < 224 ? 2 : lead < 240 ? 3 : 4;
      shown += "•";
    }
  }
  bool empty = shown.empty();
  std::string content = empty ? o.placeholder : shown;
  text(s, lw + 1, 0, fit(content, std::max(0, field - 2), HQ_LEFT, false),
       empty ? t.muted : t.foreground, 0, bg);

  if (o.focused) {
    int caret = o.cursor < 0 ? int(width(shown)) : o.cursor;
    int x = std::min(lw + 1 + caret, lw + field - 1);
    auto native = s.native();
    hq_rect cell{native.rect.x + x, native.rect.y, 1, 1};
    hq_style style{t.background, o.color ? o.color : t.cursor, 0, HQ_STYLE_FG | HQ_STYLE_BG};
    hq_buffer_style(native.buffer, hq_intersect(cell, native.clip), style);
  }
}

void draw_tabs(Surface s, const Tabs &o) {
  auto &t = theme(s);
  int w = s.rect().width;
  if (w <= 0 || s.rect().height <= 0)
    return;
  Color color = o.color ? o.color : t.accent;
  int total = 0;
  for (const auto &tab : o.tabs)
    total += int(width(tab)) + 4;
  int x = o.align == HQ_CENTER  ? std::max(0, (w - total) / 2)
          : o.align == HQ_RIGHT ? std::max(0, w - total)
                                : 0;

  for (std::size_t i = 0; i < o.tabs.size(); i++) {
    bool active = int(i) == o.active;
    std::string label = "  " + o.tabs[i] + "  ";
    Color fg = active ? (o.variant == HQ_TAB_FILLED ? (t.dark ? t.background : t.surface) : color)
                      : t.muted;
    std::optional<Color> bg;
    int attrs = 0;
    if (active) {
      attrs = o.variant == HQ_TAB_FILLED ? HQ_BOLD : (HQ_BOLD | HQ_UNDERLINE);
      if (o.variant == HQ_TAB_FILLED)
        bg = color;
    }
    x += int(text(s, x, 0, label, fg, attrs, bg));
  }
}

void draw_status_bar(Surface s, const StatusBar &o) {
  auto &t = theme(s);
  int w = s.rect().width;
  if (w <= 0 || s.rect().height <= 0)
    return;
  Color bg = o.background ? *o.background : elevate(t, .04);
  s.fill(' ', Style().background(bg));

  auto draw_items = [&](const std::vector<StatusItem> &items, int start) {
    int cx = start;
    for (const auto &item : items) {
      if (cx >= w)
        break;
      if (!item.key.empty()) {
        Color cap_fg = o.caps ? (t.dark ? t.background : t.surface)
                              : (o.key_color ? o.key_color : t.accent);
        Color cap_bg = o.caps ? (o.key_color ? o.key_color : t.accent) : bg;
        cx += int(text(s, cx, 0, item.key, cap_fg, HQ_BOLD, cap_bg));
        cx += int(text(s, cx, 0, " ", t.foreground, 0, bg));
      }
      cx += int(text(s, cx, 0, item.label,
                     item.active ? t.foreground : (item.color ? item.color : t.muted),
                     item.active ? HQ_BOLD : 0, bg));
      cx += int(text(s, cx, 0, "  ", t.foreground, 0, bg));
    }
    return cx;
  };

  int x = draw_items(o.items, 1);
  if (!o.right.empty()) {
    int right_width = 0;
    for (const auto &item : o.right)
      right_width += int(width(item.label)) + (item.key.empty() ? 0 : int(width(item.key)) + 1) + 2;
    draw_items(o.right, std::max(x, w - right_width - 1));
  }
}

/// Restyles a rectangle in place, for the backdrop dim and the caret.
static void restyle(Surface s, hq_rect local, hq_style style) {
  auto native = s.native();
  hq_rect absolute{native.rect.x + local.x, native.rect.y + local.y, local.width,
                   local.height};
  hq_buffer_style(native.buffer, hq_intersect(absolute, native.clip), style);
}

Surface draw_modal(Surface root, const Modal &o) {
  auto &t = theme(root);
  int rw = root.rect().width, rh = root.rect().height;
  if (o.backdrop)
    // Dim rather than blank: the dashboard stays legible behind the dialog.
    restyle(root, {0, 0, rw, rh},
            hq_style{hq_mix(t.foreground, t.background, .72), 0, 0, HQ_STYLE_FG});

  int w = std::min(o.width < 0 ? 48 : o.width, rw - 2);
  int message_lines = o.message.empty() ? 0 : int(wrap_text(o.message, w - 4).size());
  int h = std::min(o.height < 0 ? message_lines + (o.buttons.empty() ? 4 : 5) : o.height,
                   rh - 2);
  int x = std::max(0, (rw - w) / 2), y = std::max(0, (rh - h) / 2);

  Surface surface = root.sub({x, y, w, h});
  hq_box_options box{};
  box.title = o.title.empty() ? nullptr : o.title.c_str();
  box.title_align = o.align;
  box.border = HQ_ROUNDED;
  box.border_style = Style().foreground(o.color ? o.color : t.border_focused);
  box.has_background = 1;
  box.background = elevate(t, .08);
  Surface inner = surface.box(box);

  if (!o.message.empty()) {
    auto lines = wrap_text(o.message, inner.rect().width - 2);
    for (std::size_t i = 0; i < lines.size(); i++) {
      if (int(i) + 1 >= inner.rect().height)
        break;
      text(inner, 1, int(i) + 1, fit(lines[i], inner.rect().width - 2, o.align),
           t.foreground, 0, {});
    }
  }

  if (!o.buttons.empty()) {
    std::vector<int> widths;
    int total = -2;
    for (const auto &b : o.buttons) {
      widths.push_back(int(width(b.label)) + 4);
      total += widths.back() + 2;
    }
    int bx = std::max(0, (inner.rect().width - total) / 2);
    int by = inner.rect().height - 2;
    for (std::size_t i = 0; i < o.buttons.size(); i++) {
      Button button;
      button.label = o.buttons[i].label;
      button.variant = o.buttons[i].variant;
      button.focused = o.buttons[i].focused;
      button.width = widths[i];
      draw_button(inner.sub({bx, by, widths[i], 1}), button);
      bx += widths[i] + 2;
    }
  }
  return inner;
}

void draw_command_palette(Surface root, const CommandPalette &o) {
  auto &t = theme(root);
  int rw = root.rect().width, rh = root.rect().height;
  int w = std::min(o.width < 0 ? 60 : o.width, rw - 2);
  int h = std::min(o.height < 0 ? std::min(int(o.items.size()) + 4, 14) : o.height, rh - 2);
  int x = std::max(0, (rw - w) / 2), y = std::max(1, rh / 5);

  restyle(root, {0, 0, rw, rh},
          hq_style{hq_mix(t.foreground, t.background, .7), 0, 0, HQ_STYLE_FG});

  Surface surface = root.sub({x, y, w, h});
  hq_box_options box{};
  box.border = HQ_ROUNDED;
  box.border_style = Style().foreground(t.border_focused);
  box.has_background = 1;
  box.background = elevate(t, .1);
  box.title = "Command Palette";
  Surface inner = surface.box(box);

  int iw = inner.rect().width, ih = inner.rect().height;
  text(inner, 0, 0, "› ", t.accent, HQ_BOLD, {});
  std::string prompt = !o.query.empty() ? o.query
                       : !o.placeholder.empty() ? o.placeholder
                                                : "Type a command…";
  text(inner, 2, 0, prompt, o.query.empty() ? t.muted : t.foreground, 0, {});
  for (int i = 0; i < iw; i++)
    inner.set(i, 1, 0x2500, Style().foreground(t.border));

  int rows = ih - 2;
  for (int i = 0; i < rows; i++) {
    if (i >= int(o.items.size()))
      break;
    const auto &item = o.items[std::size_t(i)];
    bool selected = i == o.selected;
    int yy = i + 2;
    std::optional<Color> bg;
    if (selected) {
      inner.sub({0, yy, iw, 1}).fill(' ', Style().background(t.selection));
      bg = t.selection;
    }
    text(inner, 1, yy, fit(item.label, iw - 2, HQ_LEFT, false),
         selected ? t.selection_text : t.foreground, selected ? HQ_BOLD : 0, bg);
    if (!item.hint.empty()) {
      int hw = int(width(item.hint));
      if (hw + 3 < iw)
        text(inner, iw - hw - 1, yy, item.hint, t.muted, 0, bg);
    }
  }
}

void draw_tooltip(Surface root, const Tooltip &o) {
  auto &t = theme(root);
  int rw = root.rect().width, rh = root.rect().height;
  int w = std::min(int(width(o.text)) + 4, rw);
  int x = std::clamp(o.x, 0, std::max(0, rw - w));
  int y = std::clamp(o.y, 0, std::max(0, rh - 3));

  Surface surface = root.sub({x, y, w, 3});
  hq_box_options box{};
  box.border = HQ_ROUNDED;
  box.border_style = Style().foreground(o.color ? o.color : t.border_focused);
  box.has_background = 1;
  box.background = elevate(t, .12);
  Surface inner = surface.box(box);
  text(inner, 0, 0, fit(o.text, inner.rect().width, HQ_LEFT, false), t.foreground, 0, {});
}

void draw_list(Surface s, const List &o) {
  auto &t = theme(s);
  int h = s.rect().height;
  if (s.rect().width <= 0 || h <= 0)
    return;
  int w = s.rect().width - (o.scrollbar ? 1 : 0);
  int offset = resolve_offset(o.offset, o.selected, h, int(o.items.size()), o.follow_selection);

  for (int i = 0; i < h; i++) {
    int index = offset + i;
    if (index >= int(o.items.size()))
      break;
    const auto &item = o.items[std::size_t(index)];
    bool selected = o.selected == index;
    std::string label = (o.bullet.empty() ? "" : o.bullet + " ") + item.label;
    std::optional<Color> bg = selected ? std::optional<Color>(t.selection) : o.background;
    if (selected)
      s.sub({0, i, w, 1}).fill(' ', Style().background(t.selection));
    text(s, 0, i, fit(label, w), selected ? t.selection_text : (item.color ? item.color : t.foreground),
         selected ? HQ_BOLD : 0, bg);
  }

  if (o.scrollbar && int(o.items.size()) > h)
    draw_scrollbar(s, s.rect().width - 1, 0, h, int(o.items.size()), offset);
}

namespace {
struct FlatNode {
  const TreeNode *node;
  int depth;
  std::vector<bool> last;
};

void flatten(const std::vector<TreeNode> &nodes, int depth, std::vector<bool> trail,
             std::vector<FlatNode> &out) {
  for (std::size_t i = 0; i < nodes.size(); i++) {
    bool last = i + 1 == nodes.size();
    std::vector<bool> here = trail;
    here.push_back(last);
    out.push_back({&nodes[i], depth, here});
    if (!nodes[i].children.empty() && nodes[i].expanded)
      flatten(nodes[i].children, depth + 1, here, out);
  }
}
} // namespace

void draw_tree(Surface s, const Tree &o) {
  auto &t = theme(s);
  int w = s.rect().width, h = s.rect().height;
  if (w <= 0 || h <= 0)
    return;
  std::vector<FlatNode> flat;
  flatten(o.nodes, 0, {}, flat);

  int offset = resolve_offset(o.offset, o.selected, h, int(flat.size()), o.follow_selection);
  Color guide_color = o.guide_color ? o.guide_color : hq_mix(t.border, t.foreground, .15);

  for (int i = 0; i < h; i++) {
    int index = offset + i;
    if (index >= int(flat.size()))
      break;
    const auto &entry = flat[std::size_t(index)];
    bool selected = o.selected == index;
    std::optional<Color> bg = selected ? std::optional<Color>(t.selection) : o.background;
    if (selected)
      s.sub({0, i, w, 1}).fill(' ', Style().background(t.selection));

    std::string prefix;
    if (o.guides) {
      for (int d = 0; d < entry.depth; d++)
        prefix += entry.last[std::size_t(d)] ? "   " : "│  ";
      prefix += entry.last[std::size_t(entry.depth)] ? "└─ " : "├─ ";
    } else {
      for (int d = 0; d < entry.depth; d++)
        prefix += "  ";
    }

    int values_width = 0;
    for (const auto &v : entry.node->values)
      values_width += v.width + 1;
    int label_width = std::max(0, w - values_width);

    text(s, 0, i, fit(prefix, label_width, HQ_LEFT, false), guide_color, 0, bg);
    int px = std::min(int(width(prefix)), label_width);
    text(s, px, i, fit(entry.node->label, std::max(0, label_width - px), HQ_LEFT, false),
         selected ? t.selection_text : (entry.node->color ? entry.node->color : t.foreground),
         selected ? HQ_BOLD : 0, bg);

    int vx = label_width;
    for (const auto &v : entry.node->values) {
      text(s, vx, i, fit(v.text, v.width, v.align),
           selected ? t.selection_text : (v.color ? v.color : t.foreground), 0, bg);
      vx += v.width + 1;
    }
  }
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
