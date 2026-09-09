/// Prints what the country lookup answers for a fixed set of points.
///
/// The same probe exists for every port, so "the ports agree about the world" is
/// a diff rather than a hope.
#include <cstdio>
#include <hqtui/widgets.hpp>

using namespace hqtui;

int main() {
  struct Place {
    const char *name;
    double lon, lat;
  };
  const Place places[] = {
      {"Paris", 2.35, 48.86},        {"Tokyo", 139.7, 35.7},
      {"Cairo", 31.2, 30.0},         {"Brasilia", -47.9, -15.8},
      {"Canberra", 149.1, -35.3},    {"Denver", -105.0, 39.7},
      {"Moscow", 37.6, 55.75},       {"Delhi", 77.2, 28.6},
      {"Nairobi", 36.8, -1.3},       {"Pacific", -140.0, 0.0},
      {"Atlantic", -30.0, 0.0},      {"SouthernOcean", 80.0, -40.0},
      {"NorthPacific", -150.0, 40.0},
  };
  for (auto &place : places) {
    const CountryOutline *found = country_at(place.lon, place.lat);
    std::printf("%s %s\n", place.name, found ? found->name.c_str() : "-");
  }

  // The cell path, which has to agree with what the canvas drew.
  const int cells[][2] = {{173, 28}, {74, 2}, {20, 25}, {88, 7}};
  for (auto &cell : cells) {
    const CountryOutline *found = country_at_cell(cell[0], cell[1], 200, 50);
    std::printf("cell:%d,%d %s\n", cell[0], cell[1], found ? found->name.c_str() : "-");
  }

  // And the projection itself, so a drift shows up as a number rather than as a
  // country that happens to still be right.
  const int probes[][2] = {{0, 0}, {99, 25}, {50, 13}};
  for (auto &cell : probes) {
    double lon = 0, lat = 0;
    degrees_at(cell[0], cell[1], 100, 26, Bounds{-180, 180}, Bounds{-90, 90}, &lon, &lat);
    std::printf("degrees:%d,%d %.4f %.4f\n", cell[0], cell[1], lon, lat);
  }
  return 0;
}
