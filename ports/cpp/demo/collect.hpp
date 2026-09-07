#pragma once
#include "model.hpp"
#include <atomic>
namespace demo {
std::string read_file(const std::string &, std::size_t limit = 1048576);
std::string command(const std::vector<std::string> &,
                    const std::atomic<bool> *cancel = nullptr,
                    int timeout_ms = 800);
struct Collector {
  Json data;
  double last = 0;
  std::map<std::string, double> counters;
  explicit Collector(const Json &shape);
  void refresh(const std::atomic<bool> *cancel = nullptr);
};
} // namespace demo
