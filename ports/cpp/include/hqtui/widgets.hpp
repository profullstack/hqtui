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
/// `s` with its first `columns` display columns removed.
///
/// For scrolling a line sideways. Slicing by bytes would cut inside a grapheme
/// and corrupt it, and a scroll that lands in the middle of a wide character
/// cannot draw half of it -- what is left of that character is a space, which
/// is what a terminal shows when a double-width cell is clipped.
inline std::string drop_columns(std::string_view s, int columns) {
  if (columns <= 0)
    return std::string(s);
  std::string out;
  int skipped = 0;
  std::size_t i = 0;
  while (i < s.size()) {
    unsigned char c = s[i];
    std::size_t len = c < 128 ? 1 : c < 224 ? 2 : c < 240 ? 3 : 4;
    len = std::min(len, s.size() - i);
    auto cell = s.substr(i, len);
    int cw = int(width(cell));
    if (skipped >= columns) {
      out.append(cell);
    } else {
      skipped += cw;
      // A wide character straddling the cut leaves its trailing half behind.
      if (skipped > columns)
        out.append(std::size_t(skipped - columns), ' ');
    }
    i += len;
  }
  return out;
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
/// `4` rather than `4.0`, `4.2` rather than `4.20`.
std::string number(double);
/// Returns the columns written, so a caller laying items out in a row can
/// advance by what was actually drawn rather than by what it hoped to draw.
inline std::size_t text(Surface s, int x, int y, std::string_view value, Color fg,
                        uint16_t attrs = 0, std::optional<Color> bg = {}) {
  hq_text_options o{};
  o.style = Style().foreground(fg).attributes(attrs);
  if (bg)
    o.style = Style(o.style.fg, *bg, attrs);
  return s.text(x, y, std::string(value).c_str(), o);
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
  /// First line to show, counted after wrapping.
  ///
  /// After wrapping is the only place this can be correct: the caller does not
  /// know how many lines their text became, and pre-slicing the string means
  /// re-deciding every time the width changes.
  int scroll = 0;
  /// Columns to shift the text left by, for lines wider than the surface.
  int scroll_x = 0;
};
void draw_text(Surface, std::string_view content, const TextStyle & = {});

struct Clear {
  /// What to leave behind. Zero means the theme's background.
  Color background = 0;
};
/// Reset a region to empty, so an overlay can draw over what was there.
///
/// Without this an overlay is drawn *into* whatever it lands on: the cells it
/// does not touch keep the widget underneath, and a dialog ends up with someone
/// else's table showing through the gaps between its words.
void draw_clear(Surface, const Clear & = {});

struct Fill {
  /// The symbol to repeat. A wide one is stepped over rather than written per
  /// column, since each glyph owns a continuation cell.
  std::string symbol = " ";
  Color fg = 0;
  std::optional<Color> bg;
  int attrs = 0;
};
/// Flood a region with one repeated symbol and style.
void draw_fill(Surface, const Fill & = {});

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
  /// Labels along the bottom, e.g. {"60s", "30s", "0s"}. Costs a row.
  std::vector<std::string> time_axis;
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
    // Round the tie robustly: plot geometry runs through cos and sin, and libm
    // implementations differ by an ULP at the exact angles where a coordinate
    // lands on .5 -- cos(120 degrees) is -0.5, and V8 returns a hair under it
    // where others return a hair over. Rounding the raw value lets that ULP
    // decide a pixel, so the same widget at the same size differs between
    // ports. The tolerance is far wider than an ULP and far narrower than
    // anything geometric.
    int x = iround(dx >= 0 ? dx + 1e-9 : dx - 1e-9);
    int y = iround(dy >= 0 ? dy + 1e-9 : dy - 1e-9);
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
  /// The inclusive row/column span an axis-aligned loop should cover, clipped
  /// to the canvas. Nothing outside it can draw, so clipping here is what makes
  /// every loop below finite for any input -- infinite, enormous, or NaN.
  std::pair<int, int> span(double a, double b, int limit) const {
    double lo = std::min(a, b), hi = std::max(a, b);
    if (!(lo <= hi))
      return {0, -1};
    return {std::max(0, int(std::ceil(lo))), std::min(limit - 1, int(std::floor(hi)))};
  }
  void vline(double x, double y0, double y1) {
    auto [a, b] = span(y0, y1, h);
    for (int y = a; y <= b; y++)
      pixel(x, y);
  }
  void hline(double y, double x0, double x1) {
    auto [a, b] = span(x0, x1, w);
    for (int x = a; x <= b; x++)
      pixel(x, y);
  }
  void rect(double x0, double y0, double x1, double y1) {
    hline(y0, x0, x1);
    hline(y1, x0, x1);
    vline(x0, y0, y1);
    vline(x1, y0, y1);
  }
  void fill_rect(double x0, double y0, double x1, double y1) {
    auto [a, b] = span(y0, y1, h);
    for (int y = a; y <= b; y++)
      hline(y, x0, x1);
  }
  void circle(double cx, double cy, double radius) {
    // A radius larger than the canvas draws the same arc as one exactly its
    // size, and an unbounded one never finishes the `x >= y` walk.
    if (std::isnan(radius))
      return;
    int x = int(std::floor(std::min(std::abs(radius), double(w + h)) + .5));
    int y = 0, err = 1 - x;
    while (x >= y) {
      pixel(cx + x, cy + y);
      pixel(cx + y, cy + x);
      pixel(cx - y, cy + x);
      pixel(cx - x, cy + y);
      pixel(cx - x, cy - y);
      pixel(cx - y, cy - x);
      pixel(cx + y, cy - x);
      pixel(cx + x, cy - y);
      y++;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }
  void blit(Surface s, Color color, std::optional<Color> bg = {}) const {
    blit(s, [color](int, int) { return color; }, bg);
  }
  /// Blit with a colour chosen per cell, for a canvas whose parts differ.
  void blit(Surface s, const std::function<Color(int, int)> &color_at,
            std::optional<Color> bg = {}) const {
    for (int y = 0; y < rows; y++)
      for (int x = 0; x < cols; x++)
        if (auto d = dots[std::size_t(y) * cols + x]) {
          auto st = Style().foreground(color_at(x, y));
          if (bg)
            st = st.background(*bg);
          s.set(x, y, 0x2800 + d, st);
        }
  }
};
/// How a bar's fill is drawn. Smooth uses partial blocks; segmented draws
/// discrete ticks, which is the btop look and keeps stacked bars separable;
/// ascii is the fallback for a terminal without the glyphs.
enum BarStyle { HQ_BAR_SMOOTH, HQ_BAR_SEGMENTED, HQ_BAR_ASCII };

struct Bar {
  /// Already a 0-1 ratio.
  double value = 0;
  Color color = 0;
  /// Colour along the theme's heat ramp by fill level rather than one colour.
  bool heat = false;
  int style = HQ_BAR_SMOOTH;
  std::optional<Color> background;
};
void draw_bar(Surface, const Bar &);

struct Meter {
  double value = 0;
  /// When set, `value` is absolute and this is its maximum.
  double max = 0;
  std::string label, readout;
  Color color = 0;
  int label_width = -1, value_width = -1;
  bool show_value = true;
  /// Discrete ticks rather than partial blocks. Smooth is the default in every
  /// port; this one defaulted the other way and quietly drew a different meter
  /// from the rest of the library.
  bool segmented = false;
  /// Ascii fill, for a terminal without block glyphs. Wins over `segmented`.
  bool ascii = false;
  /// Green-to-red by fill level. Defaults to on when no colour was given, so
  /// the readout and the bar agree about what "hot" means.
  std::optional<bool> heat;
  std::optional<Color> background;
};
void draw_meter(Surface, const Meter &);

struct MeterItem {
  std::string label;
  double value = 0;
  double max = 0;
  Color color = 0;
  std::string text;
};
struct Meters {
  std::vector<MeterItem> items;
  int label_width = -1, value_width = -1;
  std::optional<bool> heat;
  int style = HQ_BAR_SMOOTH;
  /// Lay out in N columns when there is room, like btop's core grid.
  int columns = 1;
  int gap = 2;
  std::optional<Color> background;
};
void draw_meters(Surface, const Meters &);

/// One row, one glyph per sample, scaled to the window it is given.
struct Sparkline {
  std::vector<double> values;
  Color color = 0;
  std::optional<double> min, max;
  std::string label, text;
  std::optional<Color> background;
};
/// The bare row of glyphs; `draw_sparkline` adds the label and readout.
void draw_spark(Surface, const std::vector<double> &, const Sparkline & = {});
void draw_sparkline(Surface, const Sparkline &);

/// A segmented bar coloured along the theme's heat ramp, like btop's
/// temperatures. No label, no readout: the colour is the information.
struct HeatBar {
  double value = 0;
  int width = -1;
  Color color = 0;
  std::string ch;
  std::optional<Color> background;
};
void draw_heat_bar(Surface, const HeatBar &);

/// Block columns. Cheaper than Braille and reads well when short.
struct Columns {
  std::vector<double> values;
  Color color = 0;
  std::optional<double> max;
  std::optional<Color> background;
};
void draw_columns(Surface, const Columns &);

struct Progress {
  double value = 0;
  double max = 1;
  std::string label;
  Color color = 0;
  /// Show `37/120` rather than a percentage.
  bool show_count = false;
  std::optional<Color> background;
};
void draw_progress(Surface, const Progress &);
void draw_graph(Surface, const Graph &);


extern const char *const MONTH_NAMES[12];
/// Two letters each, so a week is exactly as wide as its days.
extern const char *const WEEKDAY_NAMES[7];
/// The width a calendar wants, which is the same whatever month it shows.
constexpr int CALENDAR_WIDTH = 7 * 3 - 1;
/// The Gregorian leap rule in full: every four years, except centuries, except
/// every fourth century.
bool is_leap_year(long year);
/// How many days a month has. Months are 1-12, as people write them.
long days_in_month(long year, long month);
/// Day of the week, 0 = Sunday. Sakamoto's method, so no host calendar is
/// consulted and every port agrees.
long day_of_week(long year, long month, long day);
struct CalendarMark {
  /// Day of the month, 1-31.
  long day = 0;
  Color color = 0;
  Color background = 0;
  bool bold = false;
};
struct Calendar {
  long year = 1970;
  /// 1-12, as people write months.
  long month = 1;
  /// Days worth pointing at: holidays, deadlines, days with something on.
  std::vector<CalendarMark> marks;
  /// Drawn in the accent colour, as the day the view is about. 0 for none.
  long selected = 0;
  /// The month and year above the grid.
  bool header = true;
  int header_align = HQ_CENTER;
  /// The weekday initials above the days.
  bool weekdays = true;
  /// 0 for Sunday, 1 for Monday. Most of the world starts on Monday.
  long week_start = 1;
  Color color = 0;
  std::optional<Color> background;
};
/// How many rows a month needs, so a caller can size the panel around it.
int calendar_height(const Calendar &);
/// A month as a grid, with per-day styling.
void draw_calendar(Surface, const Calendar &);

/// A point in a chart's own coordinates, not the grid's.
struct ChartPoint {
  double x = 0, y = 0;
};
/// How a series is marked: joined, dotted, or dropped to the baseline.
enum MarkType { HQ_MARK_LINE, HQ_MARK_SCATTER, HQ_MARK_BAR };
struct ChartSeries {
  std::vector<ChartPoint> points;
  Color color = 0;
  std::string label;
  MarkType mark = HQ_MARK_LINE;
  /// Shade between the line and the baseline. Ignored for a scatter.
  bool fill = false;
};
/// One axis: what it spans and how its numbers read.
struct Axis {
  std::optional<double> min, max;
  std::function<std::string(double)> format;
  /// How many labels to place. Default 2 -- the ends.
  int ticks = 0;
};
struct Domain {
  double min = 0, max = 1;
};
struct ChartPlot {
  std::string mode = "braille";
  std::optional<Axis> x, y;
  std::optional<Color> background;
  bool grid = false;
  std::optional<Color> grid_color;
  /// 0-1 opacity of the area fill against the background.
  std::optional<double> fill_alpha;
  /// Where a bar or an area is measured from. Defaults to the y minimum.
  std::optional<double> baseline;
};
struct Chart {
  std::vector<ChartSeries> series;
  ChartPlot plot;
  /// Numbers down the left edge.
  bool axis = false;
  Color axis_color = 0;
  bool legend = false;
  int legend_align = HQ_LEFT;
};
/// The span an axis covers, from the caller where they said and from the data
/// where they did not.
Domain domain_of(const std::vector<ChartSeries> &, const Axis *, int which);
/// Draw point series across the whole surface.
void plot_points(Surface, const std::vector<ChartSeries> &, const ChartPlot &);
/// A chart of arbitrary (x, y) data, with a domain on both axes.
void draw_chart(Surface, const Chart &);

struct Bounds {
  double min = 0, max = 1;
};
/// Which of the shapes a Shape is.
enum ShapeKind {
  HQ_SHAPE_LINE,
  HQ_SHAPE_POLYLINE,
  HQ_SHAPE_POINTS,
  HQ_SHAPE_CIRCLE,
  HQ_SHAPE_RECT,
};
struct Shape {
  ShapeKind kind = HQ_SHAPE_LINE;
  /// Line: the two ends. Circle and rect: the centre or corner.
  double x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  /// points and polyline.
  std::vector<ChartPoint> points;
  /// circle.
  double radius = 0;
  /// rect.
  double width = 0, height = 0;
  bool fill = false;
  Color color = 0;
};
struct Canvas {
  std::vector<Shape> shapes;
  /// The span the drawing is in. Unset means 0-1.
  std::optional<Bounds> x, y;
  /// Colour for shapes that do not name their own.
  Color color = 0;
  std::optional<Color> background;
  /// A faint dotted grid behind the shapes.
  bool grid = false;
  std::optional<Color> grid_color;
};
/// A projection from the caller's coordinates onto the canvas's pixels.
///
/// Handed out so a caller can place their own labels against the same drawing.
struct Projection {
  double width = 0, height = 0;
  Bounds x_bounds, y_bounds;
  double x(double value) const;
  /// Flipped: the caller's y goes up, the canvas's goes down.
  double y(double value) const;
};
Projection canvas_projection(const Braille &, Bounds x, Bounds y);
/// A canvas drawn in the caller's own coordinates rather than in pixels.
void draw_canvas(Surface, const Canvas &);

struct CountryOutline {
  std::string name;
  /// ISO 3166-1 alpha-2, where Natural Earth has one.
  std::string iso;
  /// Longitude and latitude, interleaved. More than one ring means more than
  /// one landmass.
  std::vector<std::vector<double>> rings;
};
/// The country outlines, built once on first use.
const std::vector<CountryOutline> &world_countries();
struct WorldShapeOptions {
  /// Colour for countries with nothing special about them.
  Color color = 0;
  /// Countries to pick out, by name or ISO code.
  std::vector<std::string> highlight;
  Color highlight_color = 0;
};
/// The world as canvas shapes, one closed polyline per landmass.
std::vector<Shape> world_shapes(const WorldShapeOptions & = {});
/// The country containing a point, or null for open water.
const CountryOutline *country_at(double lon, double lat);
/// Look a country up by name or ISO code.
const CountryOutline *find_country(std::string_view key);
/// The window a country fills, with a little room around it.
void country_bounds(const CountryOutline &, double margin, Bounds *x, Bounds *y);
/// The degrees under a terminal cell, given the window the map was drawn with.
bool degrees_at(int column, int row, int width, int height, Bounds x, Bounds y, double *lon,
                double *lat);
struct WorldMap {
  /// The window on the globe. Unset means all of it.
  std::optional<Bounds> x, y;
  /// Coastline colour.
  Color color = 0;
  /// Countries to pick out, by name or ISO code.
  std::vector<std::string> highlight;
  Color highlight_color = 0;
  std::optional<Color> background;
  bool grid = false;
};
/// A world map drawn in degrees.
void draw_world_map(Surface, const WorldMap & = {});
/// The country under a cell of a map drawn with these bounds.
const CountryOutline *country_at_cell(int column, int row, int width, int height,
                                      const WorldMap & = {});

struct Shadow {
  /// How far the shadow falls.
  int offset_x = 1, offset_y = 1;
  /// 0-1: how much light the covered cells lose.
  double amount = .55;
  /// Paint this colour instead of dimming what is underneath.
  std::optional<Color> color;
};
/// Darken every cell in a region, keeping its character and its hue.
void dim_rect(Surface, int x, int y, int width, int height, double amount);
/// Cast a shadow from `rect` onto the surface, behind whatever sits there.
void draw_shadow(Surface, Rect rect, const Shadow & = {});
void draw_gauge(Surface, double, std::string_view);
void draw_keys(Surface, const std::vector<KeyValue> &, bool spread = true);
/// Which edge a scrollbar sits on, and therefore which way it runs.
enum ScrollbarOrientation {
  HQ_SCROLLBAR_RIGHT,
  HQ_SCROLLBAR_LEFT,
  HQ_SCROLLBAR_BOTTOM,
  HQ_SCROLLBAR_TOP,
};
inline bool is_vertical(ScrollbarOrientation o) {
  return o == HQ_SCROLLBAR_RIGHT || o == HQ_SCROLLBAR_LEFT;
}
/// How much there is, how much of it is visible, and how far through it we are
/// — the state the caller owns.
struct Scrollbar {
  int total = 0;
  int viewport = 0;
  int offset = 0;
  ScrollbarOrientation orientation = HQ_SCROLLBAR_RIGHT;
};
/// Where the thumb starts and how long it is, in cells along the track.
struct Thumb {
  int start = 0;
  int size = 0;
};
/// The thumb is as long as the visible fraction, so it needs the viewport as
/// well as the track. For a table those are the same number, which is why
/// `viewport` defaults to the track.
Thumb thumb(int track, int total, int offset, int viewport = 0);
void draw_scrollbar(Surface, int, int, int, int, int);
/// A scrollbar filling the surface it is given, on whichever edge.
void draw_scrollbar(Surface, const Scrollbar &);
/// Which offset a click at `position` along the track means.
int offset_for_position(int position, int track, int total, int viewport);
/// Surface tinted one step above the theme's surface, for a control's chrome.
inline Color elevate(const hq_theme &t, double amount = .06) {
  return hq_mix(t.surface, t.dark ? 0xffffffu : 0x000000u, amount);
}

enum ButtonVariant {
  HQ_BUTTON_PRIMARY,
  HQ_BUTTON_SUCCESS,
  HQ_BUTTON_WARNING,
  HQ_BUTTON_DANGER,
  HQ_BUTTON_GHOST
};
struct Button {
  std::string label;
  bool focused = false;
  Color color = 0;
  int variant = HQ_BUTTON_PRIMARY;
  bool disabled = false;
  int width = -1;
  int align = HQ_CENTER;
};
/// Returns the width it drew, so callers can lay buttons out in a row.
int draw_button(Surface, const Button &);

enum CheckboxVariant { HQ_CHECKBOX_BOX, HQ_CHECKBOX_TOGGLE, HQ_CHECKBOX_RADIO };
struct Checkbox {
  std::string label;
  bool checked = false;
  bool focused = false;
  Color color = 0;
  int variant = HQ_CHECKBOX_BOX;
};
int draw_checkbox(Surface, const Checkbox &);

/// A closed dropdown, or an open one with its option list underneath.
struct Select {
  std::string value;
  bool focused = false;
  bool open = false;
  std::vector<std::string> options;
  int selected_index = 0;
  int width = -1;
  Color color = 0;
};
void draw_select(Surface, const Select &);

struct TextInput {
  std::string value, placeholder, label;
  bool focused = false;
  /// Caret index. Negative means the end of the value.
  int cursor = -1;
  int width = -1;
  bool password = false;
  Color color = 0;
};
void draw_text_input(Surface, const TextInput &);

enum TabVariant { HQ_TAB_FILLED, HQ_TAB_UNDERLINE };
struct Tabs {
  std::vector<std::string> tabs;
  int active = 0;
  Color color = 0;
  int align = HQ_LEFT;
  int variant = HQ_TAB_FILLED;
};
void draw_tabs(Surface, const Tabs &);

/// The F1/F2/F10 bar along the bottom of every serious TUI.
struct StatusItem {
  std::string key, label;
  Color color = 0;
  /// Highlight this entry, e.g. the active mode.
  bool active = false;
};
struct StatusBar {
  std::vector<StatusItem> items, right;
  std::optional<Color> background;
  Color key_color = 0;
  /// Reverse-video key caps, like a function-key bar. False draws them plain.
  bool caps = true;
};
void draw_status_bar(Surface, const StatusBar &);

/// A centred dialog drawn over everything. Returns its interior, so a caller
/// can draw its own content instead of `message`.
struct ModalButton {
  std::string label;
  int variant = HQ_BUTTON_PRIMARY;
  bool focused = false;
};
struct Modal {
  std::string title, message;
  int width = -1, height = -1;
  /// Dim the screen behind the dialog.
  bool backdrop = true;
  std::vector<ModalButton> buttons;
  Color color = 0;
  int align = HQ_CENTER;
};
Surface draw_modal(Surface root, const Modal &);

/// Ctrl+K style palette: a query line above a filtered list.
struct PaletteItem {
  std::string label, hint;
};
struct CommandPalette {
  std::string query, placeholder;
  std::vector<PaletteItem> items;
  int selected = 0;
  int width = -1, height = -1;
};
void draw_command_palette(Surface root, const CommandPalette &);

/// A small floating box anchored at a cell, clamped to stay on screen.
struct Tooltip {
  std::string text;
  int x = 0, y = 0;
  Color color = 0;
};
void draw_tooltip(Surface root, const Tooltip &);

/// A ring split into labelled, coloured segments. Reads well from about 12x6.
struct DonutSegment {
  double value = 0;
  Color color = 0;
  std::string label;
};
struct Donut {
  std::vector<DonutSegment> segments;
  std::optional<Color> background;
};
void draw_donut(Surface, const Donut &);

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
/// A selectable list. One column, less ceremony than a table.
struct ListItem {
  std::string label;
  Color color = 0;
};
struct List {
  std::vector<ListItem> items;
  /// -1 for no selection.
  int selected = -1;
  int offset = 0;
  /// Scroll so `selected` stays visible.
  bool follow_selection = false;
  std::string bullet;
  bool scrollbar = false;
  std::optional<Color> background;
};
void draw_list(Surface, const List &);

/// An indented tree with box-drawing connectors, like `pstree`.
struct TreeValue {
  std::string text;
  int width = 0;
  Color color = 0;
  int align = HQ_RIGHT;
};
struct TreeNode {
  std::string label;
  Color color = 0;
  std::vector<TreeValue> values;
  std::vector<TreeNode> children;
  /// Children are shown unless this is explicitly false.
  bool expanded = true;
};
struct Tree {
  std::vector<TreeNode> nodes;
  int selected = -1;
  int offset = 0;
  bool follow_selection = false;
  /// Draw the ├─ └─ connectors.
  bool guides = true;
  Color guide_color = 0;
  std::optional<Color> background;
};
void draw_tree(Surface, const Tree &);

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
  hq_justify justify_ = HQ_JUSTIFY_START;

public:
  std::vector<Region> *regions;
  UI(Surface s, bool horizontal = false, int gap = 0,
     std::vector<Region> *regions = nullptr, bool collapse = false)
      : surface_(s), horizontal_(horizontal), gap_(gap), collapse_(collapse),
        regions(regions) {}

  /// Where space the children leave over goes. Only ever applies when there is
  /// slack: a container holding any fr or fill child has none.
  void justify(hq_justify value) { justify_ = value; }
  hq_justify justify() const { return justify_; }

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
    if (!hq_stack_justified(surface_.rect(), sizes.data(), sizes.size(),
                            horizontal_, seams.empty() ? nullptr : seams.data(),
                            justify_, rects.data()))
      throw std::runtime_error("hqtui: invalid layout");
    for (std::size_t i = 0; i < nodes_.size(); i++)
      if (rects[i].width > 0 && rects[i].height > 0)
        nodes_[i].draw(surface_.region(rects[i]));
  }
  /// `bordered` treats this container's own edges as panel borders when
  /// collapsing.
  ///
  /// Collapsing merges a seam only where two bordered siblings meet, and a row
  /// or column is not itself bordered -- so wrapping a stack of panels in a
  /// column, which is the only way to put a stack beside one tall panel, used
  /// to make the seam down the middle of the screen the one seam that could
  /// never merge. Set it on such a wrapper and its edges join in.
  ///
  /// It is a declaration rather than something inferred, because the children
  /// are built only once the layout has been solved and the seam has to be
  /// known before that. True only if every child is a panel filling the
  /// container across the seam; otherwise a neighbour's border lands on
  /// content.
  void group(Constraint size, int gap, bool horizontal,
             std::function<void(UI &)> body, bool bordered = false) {
    auto regions_ = regions;
    auto collapse = collapse_;
    draw_bordered(
        [=](Surface s) {
          UI p(s, horizontal, gap, regions_, collapse);
          body(p);
          p.flush();
        },
        size, bordered);
  }
  void row(Constraint size, int gap, std::function<void(UI &)> body,
           bool bordered = false) {
    group(size, gap, true, std::move(body), bordered);
  }
  void col(Constraint size, int gap, std::function<void(UI &)> body,
           bool bordered = false) {
    group(size, gap, false, std::move(body), bordered);
  }
  /// `sides` is a mask of HQ_SIDE_*, or 0 for all four. Use it for chrome that
  /// is not a box: a header rule, a sidebar rail, a footer that should not look
  /// boxed in.
  void panel(std::string title, std::function<void(UI &)> body,
             Constraint size = fr(), std::string subtitle = {},
             Color border = 0, std::optional<Color> bg = {},
             Color subtitle_color = 0, int sides = 0) {
    auto regions_ = regions;
    auto collapse = collapse_;
    draw_bordered(
        [=](Surface s) {
          hq_box_options o{};
          o.collapse = collapse ? 1 : 0;
          o.sides = sides;
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

  // The rest of the library, in the same shape: one row unless the widget
  // genuinely wants the space.
  void badge(Badge o) {
    draw([=](Surface s) { draw_badge(s, o); }, cells(1));
  }
  void progress(Progress o) {
    draw([=](Surface s) { draw_progress(s, o); }, cells(1));
  }
  /// A chart of arbitrary (x, y) data, with a domain on both axes.
  ///
  /// `graph` plots a history buffer, one sample per column. Use this when the
  /// data has its own x values: two series of different lengths then line up,
  /// and a point lands where its x says it does.
  void chart(Chart o, Constraint size = fr()) {
    draw([=](Surface s) { draw_chart(s, o); }, size);
  }
  /// Reset a region so an overlay can own it.
  void clear(Clear o = {}, Constraint size = fr()) {
    draw([=](Surface s) { draw_clear(s, o); }, size);
  }
  /// Flood a region with one repeated symbol and style.
  void fill(Fill o = {}, Constraint size = fr()) {
    draw([=](Surface s) { draw_fill(s, o); }, size);
  }
  /// A month as a grid, with per-day styling. Sized to the month it shows.
  void calendar(Calendar o) {
    int height = calendar_height(o);
    draw([=](Surface s) { draw_calendar(s, o); }, cells(height));
  }
  /// A canvas drawn in your own coordinates rather than in pixels.
  void shapes(Canvas o, Constraint size = fr()) {
    draw([=](Surface s) { draw_canvas(s, o); }, size);
  }
  /// A world map, and the country under whatever gets clicked.
  void world_map(WorldMap o, Constraint size = fr()) {
    draw([=](Surface s) { draw_world_map(s, o); }, size);
  }
  void sparkline(Sparkline o) {
    draw([=](Surface s) { draw_sparkline(s, o); }, cells(1));
  }
  void heat_bar(HeatBar o) {
    draw([=](Surface s) { draw_heat_bar(s, o); }, cells(1));
  }
  void columns(Columns o, Constraint size = fr()) {
    draw([=](Surface s) { draw_columns(s, o); }, size);
  }
  void donut(Donut o, Constraint size = fr()) {
    draw([=](Surface s) { draw_donut(s, o); }, size);
  }
  /// A scrollbar over state you own, for anything that scrolls and is not a
  /// table. A vertical bar fills the space it is given; a horizontal one is a
  /// single row.
  void scrollbar(Scrollbar o, std::string id = {}) {
    auto regions_ = regions;
    draw(
        [=](Surface s) {
          draw_scrollbar(s, o);
          if (regions_ && !id.empty())
            regions_->push_back({s.rect(), id, 0});
        },
        is_vertical(o.orientation) ? fr() : cells(1));
  }
  void list(List o, std::string id = {}) {
    auto regions_ = regions;
    draw([=](Surface s) {
      draw_list(s, o);
      if (regions_ && !id.empty())
        regions_->push_back({s.rect(), id, 0});
    });
  }
  void tree(Tree o, std::string id = {}) {
    auto regions_ = regions;
    draw([=](Surface s) {
      draw_tree(s, o);
      if (regions_ && !id.empty())
        regions_->push_back({s.rect(), id, 0});
    });
  }
  void button(Button o) {
    draw([=](Surface s) { draw_button(s, o); }, cells(1));
  }
  void checkbox(Checkbox o) {
    draw([=](Surface s) { draw_checkbox(s, o); }, cells(1));
  }
  void select(Select o) {
    // An open dropdown needs room for its list; a closed one is one row.
    int rows = o.open ? 1 + int(o.options.size()) : 1;
    draw([=](Surface s) { draw_select(s, o); }, cells(rows));
  }
  void text_input(TextInput o) {
    draw([=](Surface s) { draw_text_input(s, o); }, cells(1));
  }
  void tabs(Tabs o) {
    draw([=](Surface s) { draw_tabs(s, o); }, cells(1));
  }
  void status_bar(StatusBar o) {
    draw([=](Surface s) { draw_status_bar(s, o); }, cells(1));
  }
};
} // namespace hqtui
#endif
