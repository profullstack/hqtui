#include "hqtui_bindings.h"
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>
static void check(bool ok) {
  if (!ok)
    throw std::runtime_error(hqb_error());
}
int main() {
  try {
    check(hqb_abi_version() == 1);
    check(hqb_create(-1, 20, "dark") == nullptr);
    check(hqb_render(nullptr, "text") == nullptr);
    hqb_destroy(nullptr);
    hqb_close(nullptr);
    auto *s = hqb_create(80, 24, "dark");
    check(s);
    const char *good =
        R"({"type":"panel","title":"ABI","children":[{"type":"text","text":"Unicode → 世界"}]})";
    check(hqb_set(s, good, strlen(good)));
    std::string text = hqb_render(s, "text");
    check(text.find("Unicode") != text.npos);
    check(std::string(hqb_render(s, "diff")).empty());
    for (auto bad :
         {"{", R"({"type":"unknown"})", R"({"type":"col","children":"wrong"})",
          R"({"type":"text","size":-1})",
          R"({"type":"text","color":"invalid"})"}) {
      check(!hqb_set(s, bad, strlen(bad)));
      check(std::string(hqb_render(s, "text")) == text);
    }
    std::string deep = R"({"type":"text","text":"deep"})";
    for (int i = 0; i < 40; i++)
      deep = R"({"type":"col","children":[)" + deep + "]}";
    check(!hqb_set(s, deep.data(), deep.size()));
    check(!hqb_set(s, good, 1048577));
    check(!hqb_resize(s, 501, 200));
    check(hqb_render(s, "unknown") == nullptr);
    check(hqb_demo_frame(s, "missing", "text") == nullptr);
    check(hqb_demo("{}", 2) == -1);
    check(hqb_demo("[1]", 3) == -1);
    check(hqb_poll(s, 0) == nullptr);
    check(!hqb_present(s));
    check(hqb_resize(s, 1, 1));
    check(hqb_render(s, "text") != nullptr);
    hqb_destroy(s);
    for (int i = 0; i < 500; i++) {
      s = hqb_create(40, 12, "light");
      check(s);
      check(hqb_set(s, good, strlen(good)));
      check(hqb_render(s, "ansi"));
      hqb_destroy(s);
    }
    std::cout << "Binding ABI: limits, ownership, Unicode, unchanged frames, "
                 "rejected updates and errors passed\n";
  } catch (const std::exception &e) {
    std::cerr << e.what() << "\n";
    return 1;
  }
}
