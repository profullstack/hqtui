#include <hqtui.hpp>
#include <cstdio>
#include <cstdlib>
#include <type_traits>
#define CHECK(x) do { if(!(x)) { std::fprintf(stderr,"%s:%d: %s\n",__FILE__,__LINE__,#x); std::abort(); } } while(0)
int main() {
    using namespace hqtui;
    static_assert(!std::is_copy_constructible_v<Buffer>);
    static_assert(std::is_nothrow_move_constructible_v<Buffer>);
    static_assert(sizeof(Style)==sizeof(hq_style));
    static_assert(sizeof(Buffer)==sizeof(void*));
    Buffer a(20,4),b(20,4);
    Style style=Style().foreground(rgb(255,0,0)).attributes(HQ_BOLD);
    b.write(0,0,"hello",style);
    CHECK(b.row(0)=="hello               ");
    CHECK(b.cell(0,0).fg==rgb(255,0,0));
    Encoder encoder;
    auto first=encoder.encode(a,b,true);
    CHECK(first.changed_cells==5);
    CHECK(first.output.find("hello")!=std::string_view::npos);
    a.copy_from(b);
    CHECK(encoder.encode(a,b).output.empty());
    std::size_t allocations=encoder.allocations()+a.allocations()+b.allocations();
    for(int i=0;i<1000;++i) {
        b.set(10,0,static_cast<std::uint32_t>('0'+i%10),style);
        auto delta=encoder.encode(a,b);
        CHECK(delta.changed_cells==1);
        a.copy_from(b);
    }
    CHECK(allocations==encoder.allocations()+a.allocations()+b.allocations());
    CHECK(width("界á👨‍💻")==5);
    const char unsafe[]={'A','\0','B','\033','C'};
    b.clear(); b.write(0,0,std::string_view(unsafe,sizeof(unsafe)));
    CHECK(b.row(0)=="ABC                 ");
    Buffer moved=std::move(b);
    CHECK(moved.width()==20);
    bool threw=false;
    try { moved.resize(-1,5); } catch(const std::runtime_error&) { threw=true; }
    CHECK(threw && moved.width()==20);
    moved.clear();
    hq_box_options options{};
    options.title="CPU";
    auto inner=moved.surface().box(options);
    inner.text(0,0,"native C++");
    CHECK(moved.row(1)=="│native C++        │");
    std::puts("C++ ownership, exact cells, delta output, Unicode, and zero-allocation warmed frames: PASS");
}
