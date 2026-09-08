#pragma once
// Small, bounded JSON value/parser for telemetry and test data. Not a renderer;
// simulated samples contain measurements, never pre-rendered cells or frames.
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <hqtui/widgets.hpp>
#include <map>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>
namespace demo {
struct Json {
  using Array = std::vector<Json>;
  using Object = std::map<std::string, Json, std::less<>>;
  std::variant<std::monostate, bool, double, std::string, Array, Object> value;
  Json() = default;
  Json(double n) : value(n) {}
  Json(int n) : value(double(n)) {}
  Json(bool n) : value(n) {}
  Json(std::string s) : value(std::move(s)) {}
  Json(const char *s) : value(std::string(s)) {}
  Json(Array a) : value(std::move(a)) {}
  Json(Object o) : value(std::move(o)) {}
  bool null() const { return std::holds_alternative<std::monostate>(value); }
  double n(double fallback = 0) const {
    auto p = std::get_if<double>(&value);
    return p ? *p : fallback;
  }
  std::string s(std::string fallback = "—") const {
    if (auto p = std::get_if<std::string>(&value))
      return *p;
    if (auto p = std::get_if<double>(&value)) {
      char b[80];
      if (*p == std::floor(*p) && std::abs(*p) < 1e21) {
        std::snprintf(b, sizeof b, "%.0f", *p);
        return b;
      }
      auto result = std::to_chars(b, b + sizeof b, *p);
      return std::string(b, result.ptr);
    }
    if (auto p = std::get_if<bool>(&value))
      return *p ? "true" : "false";
    return fallback;
  }
  /// A JSON true, or a number the caller wrote instead. Anything else is the
  /// fallback, so a missing key and an explicit false read the same.
  bool b(bool fallback = false) const {
    if (auto p = std::get_if<bool>(&value))
      return *p;
    if (auto p = std::get_if<double>(&value))
      return *p != 0;
    return fallback;
  }
  const Array &array() const {
    static const Array empty;
    auto p = std::get_if<Array>(&value);
    return p ? *p : empty;
  }
  Array &array() {
    if (!std::holds_alternative<Array>(value))
      value = Array{};
    return std::get<Array>(value);
  }
  const Json &operator[](std::string_view key) const {
    static const Json empty;
    if (auto p = std::get_if<Object>(&value)) {
      auto it = p->find(key);
      if (it != p->end())
        return it->second;
    }
    return empty;
  }
  Json &operator[](std::string_view key) {
    if (!std::holds_alternative<Object>(value))
      value = Object{};
    return std::get<Object>(value)[std::string(key)];
  }
  const Json &at(std::size_t i) const {
    static const Json empty;
    auto &a = array();
    return i < a.size() ? a[i] : empty;
  }
  const Json &path(std::string_view key) const {
    auto dot = key.find('.');
    return dot == key.npos
               ? (*this)[key]
               : (*this)[key.substr(0, dot)].path(key.substr(dot + 1));
  }
  static Json parse(std::string_view source) {
    if (source.size() > 16 * 1024 * 1024)
      throw std::runtime_error("JSON input too large");
    struct Parser {
      std::string_view s;
      std::size_t i = 0;
      [[noreturn]] void fail() {
        throw std::runtime_error("invalid JSON at byte " + std::to_string(i));
      }
      void ws() {
        while (i < s.size() &&
               (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t'))
          i++;
      }
      char take() {
        if (i == s.size())
          fail();
        return s[i++];
      }
      unsigned hex() {
        unsigned n = 0;
        for (int j = 0; j < 4; j++) {
          char c = take();
          n *= 16;
          if (c >= '0' && c <= '9')
            n += c - '0';
          else if (c >= 'a' && c <= 'f')
            n += c - 'a' + 10;
          else if (c >= 'A' && c <= 'F')
            n += c - 'A' + 10;
          else
            fail();
        }
        return n;
      }
      std::string string() {
        if (take() != '"')
          fail();
        std::string out;
        for (;;) {
          unsigned char c = take();
          if (c == '"')
            break;
          if (c < 32)
            fail();
          if (c != '\\') {
            out += char(c);
            continue;
          }
          switch (take()) {
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          case '/':
            out += '/';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            unsigned cp = hex();
            if (cp >= 0xd800 && cp <= 0xdbff) {
              if (take() != '\\' || take() != 'u')
                fail();
              unsigned lo = hex();
              if (lo < 0xdc00 || lo > 0xdfff)
                fail();
              cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
            } else if (cp >= 0xdc00 && cp <= 0xdfff)
              fail();
            out += hqtui::utf8(cp);
            break;
          }
          default:
            fail();
          }
        }
        return out;
      }
      Json parse(int depth = 0) {
        if (depth > 64)
          fail();
        ws();
        if (i == s.size())
          fail();
        char c = s[i];
        if (c == '"')
          return Json(string());
        if (c == '[') {
          i++;
          Array a;
          ws();
          if (i < s.size() && s[i] == ']') {
            i++;
            return a;
          }
          for (;;) {
            a.push_back(parse(depth + 1));
            ws();
            char end = take();
            if (end == ']')
              return a;
            if (end != ',')
              fail();
          }
        }
        if (c == '{') {
          i++;
          Object o;
          ws();
          if (i < s.size() && s[i] == '}') {
            i++;
            return o;
          }
          for (;;) {
            ws();
            auto key = string();
            ws();
            if (take() != ':')
              fail();
            auto v = parse(depth + 1);
            if (!o.emplace(std::move(key), std::move(v)).second)
              fail();
            ws();
            char end = take();
            if (end == '}')
              return o;
            if (end != ',')
              fail();
          }
        }
        for (auto literal : {"null", "true", "false"})
          if (s.substr(i, std::char_traits<char>::length(literal)) == literal) {
            i += std::char_traits<char>::length(literal);
            return literal[0] == 'n' ? Json() : Json(literal[0] == 't');
          }
        std::size_t start = i;
        if (s[i] == '-')
          i++;
        if (i == s.size())
          fail();
        if (s[i] == '0')
          i++;
        else {
          if (s[i] < '1' || s[i] > '9')
            fail();
          while (i < s.size() && s[i] >= '0' && s[i] <= '9')
            i++;
        }
        if (i < s.size() && s[i] == '.') {
          i++;
          auto begin = i;
          while (i < s.size() && s[i] >= '0' && s[i] <= '9')
            i++;
          if (i == begin)
            fail();
        }
        if (i < s.size() && (s[i] == 'e' || s[i] == 'E')) {
          i++;
          if (i < s.size() && (s[i] == '+' || s[i] == '-'))
            i++;
          auto begin = i;
          while (i < s.size() && s[i] >= '0' && s[i] <= '9')
            i++;
          if (i == begin)
            fail();
        }
        double n = std::strtod(std::string(s.substr(start, i - start)).c_str(),
                               nullptr);
        if (!std::isfinite(n))
          fail();
        return n;
      }
    } p{source};
    Json result = p.parse();
    p.ws();
    if (p.i != source.size())
      p.fail();
    return result;
  }
};
inline std::vector<double> numbers(const Json &j) {
  std::vector<double> result;
  for (auto &v : j.array())
    result.push_back(v.n());
  return result;
}
} // namespace demo
