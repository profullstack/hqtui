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
/// Splits on newlines, then wraps each line on `columns` when asked. Matches
/// the reference's wrap: break on the last space that fits, and hard-break a
/// word longer than the line.
static std::vector<std::string> lines_of(std::string_view content, int columns,
                                         bool wrap) {
  std::vector<std::string> out;
  std::size_t start = 0;
  while (start <= content.size()) {
    std::size_t brk = content.find('\n', start);
    std::string_view line = content.substr(
        start, brk == std::string_view::npos ? std::string_view::npos : brk - start);
    if (!wrap || columns <= 0 || int(width(line)) <= columns) {
      out.emplace_back(line);
    } else {
      std::string rest(line);
      while (int(width(rest)) > columns) {
        // The longest prefix that fits, then back up to a space if there is one.
        std::size_t i = 0, end = 0;
        int used = 0;
        while (i < rest.size()) {
          unsigned char ch = rest[i];
          std::size_t len = ch < 128 ? 1 : ch < 224 ? 2 : ch < 240 ? 3 : 4;
          len = std::min(len, rest.size() - i);
          int w = int(width(std::string_view(rest).substr(i, len)));
          if (used + w > columns)
            break;
          used += w;
          i += len;
          end = i;
        }
        std::size_t space = rest.rfind(' ', end);
        std::size_t cut = (space != std::string::npos && space > 0) ? space : end;
        out.push_back(rest.substr(0, cut));
        rest = rest.substr(cut == space ? cut + 1 : cut);
      }
      out.push_back(rest);
    }
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
