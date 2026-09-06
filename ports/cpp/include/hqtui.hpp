#ifndef HQTUI_HPP
#define HQTUI_HPP
#include <hqtui.h>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

// C++17 ownership and value types over the same native C hot path. No virtual
// dispatch, callback erasure, GC, or per-cell C++ allocation. Static linking with
// LTO can inline across the C/C++ boundary; correctness never depends on LTO.
namespace hqtui {
using Color = hq_color;
using Rect = hq_rect;
using Cell = hq_cell;
using Constraint = hq_constraint;

struct Style : hq_style {
    constexpr Style() noexcept : hq_style{0,0,0,0} {}
    constexpr Style(Color fg, Color bg, std::uint16_t attrs=0) noexcept
        : hq_style{fg,bg,attrs,HQ_STYLE_ALL} {}
    constexpr Style foreground(Color color) const noexcept {
        auto s=*this; s.fg=color; s.mask|=HQ_STYLE_FG; return s;
    }
    constexpr Style background(Color color) const noexcept {
        auto s=*this; s.bg=color; s.mask|=HQ_STYLE_BG; return s;
    }
    constexpr Style attributes(std::uint16_t flags) const noexcept {
        auto s=*this; s.attrs=flags; s.mask|=HQ_STYLE_ATTRS; return s;
    }
};
constexpr Color rgb(int r,int g,int b) noexcept {
    return 0x1000000u | (static_cast<Color>(r)&255u)<<16 |
           (static_cast<Color>(g)&255u)<<8 | (static_cast<Color>(b)&255u);
}
inline std::size_t width(std::string_view text) noexcept { return hq_text_width_n(text.data(),text.size()); }

class Surface {
    hq_surface surface_;
public:
    // A borrowed view: keep its Buffer and any custom theme alive.
    explicit Surface(hq_surface surface) noexcept : surface_(surface) {}
    Rect rect() const noexcept { return surface_.rect; }
    Surface sub(Rect local) const noexcept { return Surface(hq_surface_sub(surface_,local)); }
    Surface region(Rect absolute) const noexcept { return Surface(hq_surface_region(surface_,absolute)); }
    Surface box(hq_box_options options={}) const noexcept { return Surface(hq_surface_box(surface_,options)); }
    void set(int x,int y,std::uint32_t cp,Style style={}) const noexcept { hq_surface_set(surface_,x,y,cp,style); }
    void fill(std::uint32_t cp=' ',Style style={}) const noexcept { hq_surface_fill(surface_,cp,style); }
    std::size_t text(int x,int y,const char *text,hq_text_options options={}) const noexcept {
        return hq_surface_text(surface_,x,y,text,options);
    }
};

class Buffer {
    struct Destroy { void operator()(hq_buffer *p) const noexcept { hq_buffer_destroy(p); } };
    std::unique_ptr<hq_buffer,Destroy> buffer_;
public:
    Buffer(int width,int height) : buffer_(hq_buffer_create(width,height)) {
        if(!buffer_) throw std::runtime_error("hqtui: invalid buffer dimensions or allocation failure");
    }
    Buffer(Buffer&&) noexcept=default;
    Buffer& operator=(Buffer&&) noexcept=default;
    Buffer(const Buffer&)=delete;
    Buffer& operator=(const Buffer&)=delete;
    hq_buffer *native_handle() noexcept { return buffer_.get(); }
    const hq_buffer *native_handle() const noexcept { return buffer_.get(); }
    int width() const noexcept { return hq_buffer_width(buffer_.get()); }
    int height() const noexcept { return hq_buffer_height(buffer_.get()); }
    std::size_t allocations() const noexcept { return hq_buffer_allocations(buffer_.get()); }
    Surface surface(const hq_theme *theme=nullptr) noexcept { return Surface(hq_surface_root(buffer_.get(),theme)); }
    void resize(int width,int height) {
        if(!hq_buffer_resize(buffer_.get(),width,height)) throw std::runtime_error("hqtui: resize failed");
    }
    void clear(Color background=0,Color foreground=0) noexcept { hq_buffer_clear(buffer_.get(),background,foreground); }
    int set(int x,int y,std::uint32_t cp,Style style={}) noexcept { return hq_buffer_set(buffer_.get(),x,y,cp,style); }
    std::size_t write(int x,int y,std::string_view text,Style style={},
                      std::size_t max_columns=std::numeric_limits<std::size_t>::max()) noexcept {
        return hq_buffer_write_n(buffer_.get(),x,y,text.data(),text.size(),style,max_columns);
    }
    void fill(Rect rect,std::uint32_t cp=' ',Style style={}) noexcept { hq_buffer_fill(buffer_.get(),rect,cp,style); }
    void restyle(Rect rect,Style style) noexcept { hq_buffer_style(buffer_.get(),rect,style); }
    Cell cell(int x,int y) const {
        Cell c{};
        if(!hq_buffer_cell(buffer_.get(),x,y,&c)) throw std::out_of_range("hqtui: cell outside buffer");
        return c;
    }
    void copy_from(const Buffer &other) {
        if(!hq_buffer_copy(buffer_.get(),other.buffer_.get())) throw std::bad_alloc();
    }
    std::string row(int y) const {
        std::size_t n=hq_buffer_row(buffer_.get(),y,nullptr,0);
        std::string result(n,'\0');
        hq_buffer_row(buffer_.get(),y,result.data(),n+1);
        return result;
    }
};

struct Encoded {
    // Borrowed until the next encode() call or destruction of the encoder.
    std::string_view output;
    std::size_t changed_cells,dirty_rows;
};
class Encoder {
    struct Destroy { void operator()(hq_encoder *p) const noexcept { hq_encoder_destroy(p); } };
    std::unique_ptr<hq_encoder,Destroy> encoder_;
public:
    explicit Encoder(int colors=16777216,bool monochrome=false)
        : encoder_(hq_encoder_create(colors,monochrome)) {
        if(!encoder_) throw std::runtime_error("hqtui: invalid color mode or allocation failure");
    }
    Encoder(Encoder&&) noexcept=default;
    Encoder& operator=(Encoder&&) noexcept=default;
    Encoder(const Encoder&)=delete;
    Encoder& operator=(const Encoder&)=delete;
    void invalidate() noexcept { hq_encoder_invalidate(encoder_.get()); }
    std::size_t allocations() const noexcept { return hq_encoder_allocations(encoder_.get()); }
    Encoded encode(const Buffer &previous,const Buffer &next,bool full=false) {
        hq_encoded out{};
        if(!hq_encode(encoder_.get(),previous.native_handle(),next.native_handle(),full,&out)) throw std::bad_alloc();
        return {{out.data,out.length},out.changed_cells,out.dirty_rows};
    }
};
}
#endif
