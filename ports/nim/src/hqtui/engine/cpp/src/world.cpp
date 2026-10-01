/// The world, as shapes for the canvas, and the lookup that makes it clickable.
///
/// The canvas already draws in the caller's own coordinates, and longitude and
/// latitude are just another pair of axes -- so a map is a list of polylines in
/// degrees, and nothing here needs a projection of its own beyond deciding
/// which window on the globe to show.
///
/// The interesting half is the other direction. A click arrives as a terminal
/// cell, and a country is a polygon, so answering "what did they click" means
/// turning the cell back into degrees and testing it against the outlines.
/// Doing it that way rather than with bounding boxes is what makes the answer
/// right: Russia's bounding box covers most of the northern hemisphere, and
/// Chile's covers Argentina.
#include <hqtui/widgets.hpp>

namespace hqtui {
namespace {

bool equals_ignoring_case(std::string_view a, std::string_view b) {
  if (a.size() != b.size())
    return false;
  for (std::size_t i = 0; i < a.size(); i++)
    if (std::tolower((unsigned char)a[i]) != std::tolower((unsigned char)b[i]))
      return false;
  return true;
}

/// Match on either the name or the ISO code, case-insensitively.
bool matches(const CountryOutline &country, const std::vector<std::string> &keys) {
  for (auto &key : keys) {
    if (key.empty())
      continue;
    if (equals_ignoring_case(country.name, key))
      return true;
    if (!country.iso.empty() && equals_ignoring_case(country.iso, key))
      return true;
  }
  return false;
}

/// Whether a point is inside a ring, by ray casting.
///
/// The ring is a flat list of interleaved coordinates, so this walks it two at a
/// time rather than allocating a pair per vertex -- it runs once per country per
/// click, and there are a couple of thousand vertices.
bool inside_ring(const std::vector<double> &ring, double lon, double lat) {
  bool inside = false;
  std::size_t n = ring.size() / 2;
  if (n == 0)
    return false;
  std::size_t j = n - 1;
  for (std::size_t i = 0; i < n; i++) {
    double xi = ring[i * 2], yi = ring[i * 2 + 1];
    double xj = ring[j * 2], yj = ring[j * 2 + 1];
    if ((yi > lat) != (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
      inside = !inside;
    j = i;
  }
  return inside;
}

} // namespace

std::vector<Shape> world_shapes(const WorldShapeOptions &o) {
  std::vector<Shape> shapes;
  for (auto &country : world_countries()) {
    bool picked = !o.highlight.empty() && matches(country, o.highlight);
    Color color = picked && o.highlight_color ? o.highlight_color : o.color;
    for (auto &ring : country.rings) {
      Shape shape;
      shape.kind = HQ_SHAPE_POLYLINE;
      shape.color = color;
      std::size_t n = ring.size() / 2;
      shape.points.reserve(n + 1);
      for (std::size_t i = 0; i < n; i++)
        shape.points.push_back({ring[i * 2], ring[i * 2 + 1]});
      // Closed: the last point joins the first, or every country has a gap in
      // its coastline where the ring started.
      if (n > 0)
        shape.points.push_back(shape.points.front());
      shapes.push_back(std::move(shape));
    }
  }
  return shapes;
}

const CountryOutline *country_at(double lon, double lat) {
  if (!std::isfinite(lon) || !std::isfinite(lat))
    return nullptr;
  for (auto &country : world_countries())
    for (auto &ring : country.rings)
      if (inside_ring(ring, lon, lat))
        return &country;
  return nullptr;
}

const CountryOutline *find_country(std::string_view key) {
  std::vector<std::string> keys{std::string(key)};
  for (auto &country : world_countries())
    if (matches(country, keys))
      return &country;
  return nullptr;
}

void country_bounds(const CountryOutline &country, double margin, Bounds *x, Bounds *y) {
  double min_lon = INFINITY, max_lon = -INFINITY;
  double min_lat = INFINITY, max_lat = -INFINITY;
  for (auto &ring : country.rings)
    for (std::size_t i = 0; i + 1 < ring.size(); i += 2) {
      min_lon = std::min(min_lon, ring[i]);
      max_lon = std::max(max_lon, ring[i]);
      min_lat = std::min(min_lat, ring[i + 1]);
      max_lat = std::max(max_lat, ring[i + 1]);
    }
  if (!std::isfinite(min_lon)) {
    *x = Bounds{-180, 180};
    *y = Bounds{-90, 90};
    return;
  }
  // A single-point country would give a zero-width window, which cannot be
  // mapped onto anything.
  double pad_x = std::max((max_lon - min_lon) * margin, 1.0);
  double pad_y = std::max((max_lat - min_lat) * margin, 1.0);
  *x = Bounds{min_lon - pad_x, max_lon + pad_x};
  *y = Bounds{min_lat - pad_y, max_lat + pad_y};
}

bool degrees_at(int column, int row, int width, int height, Bounds x, Bounds y, double *lon,
                double *lat) {
  if (width <= 0 || height <= 0)
    return false;
  // The canvas is 2x4 Braille pixels per cell, and it spans its bounds across
  // `pixels - 1`, so the inverse has to use the same denominators or a click
  // drifts from what was drawn.
  double px = std::max(1, width * 2 - 1);
  double py = std::max(1, height * 4 - 1);
  *lon = x.min + ((column * 2 + 1) / px) * (x.max - x.min);
  *lat = y.min + (1 - (row * 4 + 2) / py) * (y.max - y.min);
  return true;
}

void draw_world_map(Surface s, const WorldMap &o) {
  if (s.rect().width <= 0 || s.rect().height <= 0)
    return;
  auto &t = theme(s);
  WorldShapeOptions shapes;
  shapes.color = o.color ? o.color : t.border;
  shapes.highlight = o.highlight;
  shapes.highlight_color = o.highlight_color ? o.highlight_color : t.accent;

  Canvas canvas;
  canvas.shapes = world_shapes(shapes);
  canvas.x = o.x.value_or(Bounds{-180, 180});
  canvas.y = o.y.value_or(Bounds{-90, 90});
  canvas.background = o.background;
  canvas.grid = o.grid;
  draw_canvas(s, canvas);
}

const CountryOutline *country_at_cell(int column, int row, int width, int height,
                                      const WorldMap &o) {
  double lon = 0, lat = 0;
  if (!degrees_at(column, row, width, height, o.x.value_or(Bounds{-180, 180}),
                  o.y.value_or(Bounds{-90, 90}), &lon, &lat))
    return nullptr;
  return country_at(lon, lat);
}

} // namespace hqtui
