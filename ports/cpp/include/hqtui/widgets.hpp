#ifndef HQTUI_WIDGETS_HPP
#define HQTUI_WIDGETS_HPP
#include <algorithm>
#include <cmath>
#include <functional>
#include <hqtui.hpp>
#include <optional>
#include <vector>

namespace hqtui {
using Paint = std::function<void(Surface)>;
inline int iround(double n) {
  return std::isfinite(n) ? int(std::floor(n + .5)) : 0;
}
inline double ratio(double n) { return n > 0 ? std::min(1., n) : 0; }
inline std::string utf8(uint32_t c) {
  std::string s;
  if (c < 128)
    s += char(c);
  else if (c < 2048) {
    s += char(192 | (c >> 6));
    s += char(128 | (c & 63));
  } else if (c < 65536) {
    s += char(224 | (c >> 12));
    s += char(128 | ((c >> 6) & 63));
    s += char(128 | (c & 63));
  } else {
    s += char(240 | (c >> 18));
    s += char(128 | ((c >> 12) & 63));
    s += char(128 | ((c >> 6) & 63));
    s += char(128 | (c & 63));
  }
  return s;
}
inline std::string fit(std::string_view s, int columns, int align = HQ_LEFT,
                       bool ellipsis = true) {
  if (columns <= 0)
    return {};
  std::string out(s);
  int n = int(width(s));
  if (n > columns) {
    int budget = columns - (ellipsis ? 1 : 0);
    std::size_t i = 0, end = 0;
    int used = 0;
    while (i < s.size()) {
      unsigned char c = s[i];
      std::size_t len = c < 128 ? 1 : c < 224 ? 2 : c < 240 ? 3 : 4;
      len = std::min(len, s.size() - i);
      int w = int(width(s.substr(i, len)));
      if (used + w > budget)
        break;
      used += w;
      i += len;
      end = i;
    }
    out = std::string(s.substr(0, end)) + (ellipsis ? "…" : "");
    n = used + (ellipsis ? 1 : 0);
  }
  int padding = std::max(0, columns - n), left = align == HQ_RIGHT ? padding
                                                 : align == HQ_CENTER
                                                     ? padding / 2
                                                     : 0;
  return std::string(left, ' ') + out + std::string(padding - left, ' ');
}
inline const hq_theme &theme(Surface s) { return *s.native().theme; }
inline void text(Surface s, int x, int y, std::string_view value, Color fg,
                 uint16_t attrs = 0, std::optional<Color> bg = {}) {
  hq_text_options o{};
  o.style = Style().foreground(fg).attributes(attrs);
  if (bg)
    o.style = Style(o.style.fg, *bg, attrs);
  s.text(x, y, std::string(value).c_str(), o);
}
inline void aligned(Surface s, int y, std::string_view value, Color fg,
                    int align = HQ_LEFT, uint16_t attrs = 0,
                    std::optional<Color> bg = {}) {
  text(s, 0, y, fit(value, s.rect().width, align), fg, attrs, bg);
}
inline Constraint cells(int n, int min = 0) {
  return {HQ_CELLS, double(n), min, -1, 0};
}
inline Constraint fr(double n = 1, int min = 0) {
  return {HQ_FR, n, min, -1, 0};
}
inline Constraint automatic(int intrinsic, int min = 0) {
  return {HQ_AUTO, 0., min, -1, intrinsic};
}
/// Aligned, styled, optionally wrapped copy. Every other widget is built on it.
struct TextStyle {
  Color fg = 0;
  std::optional<Color> bg;
  int align = HQ_LEFT;
  int attrs = 0;
  /// Wrap on the surface width rather than truncating at the edge.
  bool wrap = false;
};
void draw_text(Surface, std::string_view content, const TextStyle & = {});

enum BadgeVariant { HQ_BADGE_FILLED, HQ_BADGE_OUTLINE, HQ_BADGE_SUBTLE };
struct Badge {
  std::string text;
  Color color = 0;
  int variant = HQ_BADGE_FILLED;
  int align = HQ_LEFT;
};
/// Returns the columns the chip occupies.
int draw_badge(Surface, const Badge &);

struct Divider {
  std::string label;
  Color color = 0;
  /// The rule character. Empty means the theme's horizontal line.
  std::string ch;
  int align = HQ_LEFT;
};
void draw_divider(Surface, const Divider & = {});

struct KeyValue {
  std::string label, value;
  Color color = 0;
};
struct Series {
  std::vector<double> values;
  Color color = 0;
  std::string label;
  bool fill = false;
};
struct Graph {
  std::vector<Series> series;
  double min = 0;
  std::optional<double> max;
  bool axis = false, grid = false, legend = false;
  std::string mode = "braille";
  std::vector<Color> colors;
  std::optional<Color> background;
  std::function<std::string(double)> axis_format;
};
class Braille {
public:
  int cols, rows, w, h;
  std::vector<unsigned char> dots;
  Braille(int columns, int rows)
      : cols(std::max(0, columns)), rows(std::max(0, rows)), w(cols * 2),
        h(this->rows * 4), dots(std::size_t(cols) * this->rows) {}
  void pixel(double dx, double dy) {
    if (!std::isfinite(dx) || !std::isfinite(dy) || dx < -.5 || dy < -.5 ||
        dx >= w || dy >= h)
      return;
    int x = iround(dx), y = iround(dy);
    if (x < 0 || y < 0 || x >= w || y >= h)
      return;
    constexpr int bits[4][2] = {{1, 8}, {2, 16}, {4, 32}, {64, 128}};
    dots[std::size_t(y / 4) * cols + x / 2] |= bits[y % 4][x % 2];
  }
  void line(double ax, double ay, double bx, double by) {
    if (!std::isfinite(ax) || !std::isfinite(ay) || !std::isfinite(bx) ||
        !std::isfinite(by))
      return;
    // Clip pathological walks before integer conversion; ordinary short
    // off-screen lines retain the reference's Bresenham rasterization.
    if (std::max(std::abs(ax - bx), std::abs(ay - by)) > 100000 ||
        std::max({std::abs(ax), std::abs(ay), std::abs(bx), std::abs(by)}) >
            1e7) {
      double dx = bx - ax, dy = by - ay, t0 = 0, t1 = 1;
      if (!std::isfinite(dx) || !std::isfinite(dy))
        return;
      double p[] = {-dx, dx, -dy, dy}, q[] = {ax, w - 1 - ax, ay, h - 1 - ay};
      for (int i = 0; i < 4; i++) {
        if (p[i] == 0) {
          if (q[i] < 0)
            return;
        } else {
          double t = q[i] / p[i];
          if (p[i] < 0)
            t0 = std::max(t0, t);
          else
            t1 = std::min(t1, t);
          if (t0 > t1)
            return;
        }
      }
      bx = ax + t1 * dx;
      by = ay + t1 * dy;
      ax += t0 * dx;
      ay += t0 * dy;
    }
    int x = iround(ax), y = iround(ay), ex = iround(bx), ey = iround(by),
        dx = std::abs(ex - x), dy = -std::abs(ey - y), sx = x < ex ? 1 : -1,
        sy = y < ey ? 1 : -1, err = dx + dy;
    for (;;) {
      pixel(x, y);
      if (x == ex && y == ey)
        break;
      int e = 2 * err;
      if (e >= dy) {
        err += dy;
        x += sx;
      }
      if (e <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
  void blit(Surface s, Color color, std::optional<Color> bg = {}) const {
    for (int y = 0; y < rows; y++)
      for (int x = 0; x < cols; x++)
        if (auto d = dots[std::size_t(y) * cols + x]) {
          auto st = Style().foreground(color);
          if (bg)
            st = st.background(*bg);
          s.set(x, y, 0x2800 + d, st);
        }
  }
};
struct Meter {
  double value = 0;
  std::string label, readout;
  Color color = 0;
  int label_width = -1, value_width = -1;
  bool show_value = true;
  /// Discrete ticks rather than partial blocks. Smooth is the default in every
  /// port; this one defaulted the other way and quietly drew a different meter
  /// from the rest of the library.
  /// Discrete ticks rather than partial blocks. Smooth is the default in every
  /// port; this one defaulted the other way and quietly drew a different meter
  /// from the rest of the library.
  bool segmented = false;
  std::optional<Color> background;
};
void draw_meter(Surface, const Meter &);
void draw_graph(Surface, const Graph &);
void draw_gauge(Surface, double, std::string_view);
void draw_keys(Surface, const std::vector<KeyValue> &, bool spread = true);
void draw_scrollbar(Surface, int, int, int, int, int);
struct Column {
  std::string title;
  int width = -1, min = 1;
  Color color = 0;
  int align = HQ_LEFT;
};
struct TableRow {
  std::vector<std::string> cells;
  std::vector<Color> colors;
};
struct Pane {
  int selected = 0, offset = 0, total = 0, capacity = 0;
  bool log = false;
  void move(int delta) {
    if (log)
      offset = std::clamp(offset - delta, 0, std::max(0, total - 1));
    else
      selected = std::clamp(selected + delta, 0, std::max(0, total - 1));
  }
};
struct Region {
  Rect rect;
  std::string id;
  int header = 0;
};
struct Table {
  std::vector<Column> columns;
  std::vector<TableRow> rows;
  Pane *pane = nullptr;
  bool zebra = false, header = true, scrollbar = true;
};
void draw_table(Surface, const Table &);
struct LogEntry {
  std::string time, level, message, meta;
};
/// `scrollbar` reserves the rightmost column, as the reference does when a log
/// is asked for one. It changes where the meta field lands, so it is a
/// parameter rather than an assumption.
void draw_log(Surface, const std::vector<LogEntry> &, Pane *, bool scrollbar = false);

// A deferred builder: callbacks receive their final viewport, so tables follow
// selection using the space actually rendered. All rendering stays in C/C++.
class UI {
  struct Node {
    Constraint size;
    Paint draw;
    /// True when this child draws a border of its own. Only bordered siblings
    /// collapse into each other: a table pressed against a panel edge should
    /// not grow junctions out of its rows.
    bool bordered = false;
  };
  Surface surface_;
  bool horizontal_;
  int gap_;
  std::vector<Node> nodes_;
  bool collapse_ = false;

public:
  std::vector<Region> *regions;
  UI(Surface s, bool horizontal = false, int gap = 0,
     std::vector<Region> *regions = nullptr, bool collapse = false)
      : surface_(s), horizontal_(horizontal), gap_(gap), collapse_(collapse),
        regions(regions) {}

  /// Merge the borders of adjacent panels into shared lines, the way CSS
  /// collapses table borders. Inherited by nested containers.
  void collapse_borders(bool value) { collapse_ = value; }
  bool collapse_borders() const { return collapse_; }
  int width() const { return surface_.rect().width; }
  int height() const { return surface_.rect().height; }
  const hq_theme &t() const { return theme(surface_); }
  void draw(Paint fn, Constraint size = fr()) {
    nodes_.push_back({size, std::move(fn), false});
  }

  /// As `draw`, for a child that draws its own border.
  void draw_bordered(Paint fn, Constraint size, bool bordered) {
    nodes_.push_back({size, std::move(fn), bordered});
  }
  void flush() {
    if (width() <= 0 || height() <= 0 || nodes_.empty())
      return;
    std::vector<Constraint> sizes;
    for (auto &n : nodes_)
      sizes.push_back(n.size);
    std::vector<Rect> rects(nodes_.size());
    // The gap at each seam. Ordinarily `gap_` repeated, but where collapsing is
    // on and two bordered siblings meet with no gap between them, the seam is
    // minus one so their borders land in the same column and merge.
    std::vector<int> seams(nodes_.empty() ? 0 : nodes_.size() - 1, gap_);
    if (collapse_ && gap_ == 0)
      for (std::size_t i = 0; i + 1 < nodes_.size(); i++)
        if (nodes_[i].bordered && nodes_[i + 1].bordered)
          seams[i] = -1;
    if (!hq_stack_gaps(surface_.rect(), sizes.data(), sizes.size(), horizontal_,
                       seams.empty() ? nullptr : seams.data(), rects.data()))
      throw std::runtime_error("hqtui: invalid layout");
    for (std::size_t i = 0; i < nodes_.size(); i++)
      if (rects[i].width > 0 && rects[i].height > 0)
        nodes_[i].draw(surface_.region(rects[i]));
  }
  void group(Constraint size, int gap, bool horizontal,
             std::function<void(UI &)> body) {
    auto regions_ = regions;
    auto collapse = collapse_;
    draw(
        [=](Surface s) {
          UI p(s, horizontal, gap, regions_, collapse);
          body(p);
          p.flush();
        },
        size);
  }
  void row(Constraint size, int gap, std::function<void(UI &)> body) {
    group(size, gap, true, std::move(body));
  }
  void col(Constraint size, int gap, std::function<void(UI &)> body) {
    group(size, gap, false, std::move(body));
  }
  void panel(std::string title, std::function<void(UI &)> body,
             Constraint size = fr(), std::string subtitle = {},
             Color border = 0, std::optional<Color> bg = {},
             Color subtitle_color = 0) {
    auto regions_ = regions;
    auto collapse = collapse_;
    draw_bordered(
        [=](Surface s) {
          hq_box_options o{};
          o.collapse = collapse ? 1 : 0;
          o.title = title.empty() ? nullptr : title.c_str();
          o.subtitle = subtitle.empty() ? nullptr : subtitle.c_str();
          if (border)
            o.border_style = Style().foreground(border);
          if (subtitle_color)
            o.subtitle_style = Style().foreground(subtitle_color);
          if (bg) {
            o.has_background = 1;
            o.background = *bg;
          }
          auto inner = s.box(o);
          inner = inner.sub(
              {1, 0, std::max(0, inner.rect().width - 2), inner.rect().height});
          UI p(inner, false, 0, regions_, collapse);
          body(p);
          p.flush();
        },
        size, true);
  }
  void spacer(Constraint size = fr()) {
    draw([](Surface) {}, size);
  }
  void text(std::string value, Color color = 0, int align = HQ_LEFT,
            Constraint size = automatic(1), uint16_t attrs = 0) {
    if (size.kind == HQ_AUTO)
      size = horizontal_ ? fr() : cells(1);
    draw(
        [=](Surface s) {
          aligned(s, 0, value, color ? color : theme(s).foreground, align,
                  attrs);
        },
        size);
  }
  void label(std::string value) { text(std::move(value), t().muted); }
  void divider(std::string label = {}) {
    draw(
        [=](Surface s) {
          for (int x = 0; x < s.rect().width; x++)
            s.set(x, 0, 0x2500, Style().foreground(theme(s).border));
          if (!label.empty())
            hqtui::text(s, 1, 0, " " + label + " ", theme(s).muted);
        },
        cells(1));
  }
  void keys(std::vector<KeyValue> rows, bool spread = true) {
    auto size = horizontal_ ? fr() : cells(int(rows.size()));
    draw([=](Surface s) { draw_keys(s, rows, spread); }, size);
  }
  void meter(Meter o) {
    draw([=](Surface s) { draw_meter(s, o); }, cells(1));
  }
  void meters(std::vector<Meter> items, int columns = 1) {
    draw(
        [=](Surface s) {
          int count = int(items.size()), rows = (count + columns - 1) / columns,
              cw = (s.rect().width - 2 * (columns - 1)) / columns;
          for (int i = 0; i < count && rows; i++)
            draw_meter(
                s.sub({(i / rows) * (cw + 2), i % rows, std::max(0, cw), 1}),
                items[i]);
        },
        cells((int(items.size()) + columns - 1) / columns));
  }
  void graph(Graph graph, Constraint size = fr()) {
    draw([=](Surface s) { draw_graph(s, graph); }, size);
  }
  void gauge(double value, std::string label) {
    draw([=](Surface s) { draw_gauge(s, value, label); });
  }
  void table(Table data, std::string id = {}) {
    auto regions_ = regions;
    draw([=](Surface s) {
      draw_table(s, data);
      if (regions_ && !id.empty())
        regions_->push_back({s.rect(), id, int(data.header)});
    });
  }
  void log(std::vector<LogEntry> entries, Pane *pane, std::string id) {
    auto regions_ = regions;
    draw([=](Surface s) {
      draw_log(s, entries, pane, true);
      if (regions_)
        regions_->push_back({s.rect(), id, 0});
    });
  }
};
} // namespace hqtui
#endif
