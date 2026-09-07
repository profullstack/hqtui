#include "model.hpp"
#include "sample.hpp"
#include <fstream>
#include <iostream>
int main(int argc, char **argv) {
  try {
    int w = argc > 1 ? std::stoi(argv[1]) : 168,
        h = argc > 2 ? std::stoi(argv[2]) : 46;
    const hq_theme *t = hq_theme_named(argc > 3 ? argv[3] : "dark");
    if (!t || w < 1 || h < 1 || w > 500 || h > 200)
      return 2;
    demo::State s;
    s.data = demo::Json::parse(demo::sample_json);
    if (argc > 5)
      for (int i = 0; i < 10; i++)
        if (std::string(argv[5]) == demo::screens[i])
          s.screen = i;
    for (int i = 0; i < 9; i++)
      if (std::string(t->name) == demo::themes[i])
        s.theme_index = i;
    hqtui::Buffer frame(w, h);
    frame.clear(t->background, t->foreground);
    hqtui::UI ui(frame.surface(t));
    if (s.screen == 0)
      demo::dashboard(ui, s);
    else if (s.screen < 5)
      demo::telemetry(ui, s);
    else
      demo::showcase(ui, s);
    ui.flush();
    if (argc > 4 && std::string(argv[4]) == "--cells") {
      for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++) {
          auto c = frame.cell(x, y);
          char scratch[5];
          auto v = hq_buffer_cell_text(frame.native_handle(), x, y, scratch);
          std::cout << c.fg << "," << c.bg << "," << c.attrs << ",";
          for (const unsigned char *p =
                   reinterpret_cast<const unsigned char *>(v);
               *p; p++)
            std::cout << std::hex << std::setw(2) << std::setfill('0')
                      << int(*p);
          std::cout << std::dec << "\n";
        }
    } else if (argc > 4 && std::string(argv[4]) == "--hashes") {
      std::cout << "[";
      for (int y = 0; y < h; y++) {
        uint32_t hash = 2166136261u;
        auto add = [&](unsigned char c) { hash = (hash ^ c) * 16777619u; };
        for (int x = 0; x < w; x++) {
          char scratch[5];
          const char *str =
              hq_buffer_cell_text(frame.native_handle(), x, y, scratch);
          for (const unsigned char *p =
                   reinterpret_cast<const unsigned char *>(str);
               *p; p++)
            add(*p);
          add(0);
          auto cell = frame.cell(x, y);
          for (uint32_t v : {cell.fg, cell.bg, uint32_t(cell.attrs)})
            for (int i = 0; i < 4; i++)
              add((v >> (i * 8)) & 255);
        }
        if (y)
          std::cout << ",";
        std::cout << hash;
      }
      std::cout << "]\n";
    } else
      for (int y = 0; y < h; y++)
        std::cout << frame.row(y) << "\n";
  } catch (const std::exception &e) {
    std::cerr << e.what() << "\n";
    return 1;
  }
}
