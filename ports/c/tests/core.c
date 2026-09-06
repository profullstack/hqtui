#include <hqtui.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#define CHECK(x) do { if(!(x)) { fprintf(stderr,"%s:%d: %s\n",__FILE__,__LINE__,#x); abort(); } } while(0)
int main(void) {
    hq_buffer *a=hq_buffer_create(200,50),*b=hq_buffer_create(200,50);
    hq_encoder *e=hq_encoder_create(16777216,0); hq_encoded out;
    CHECK(a && b && e);
    hq_style s={hq_rgb(88,166,255),hq_rgb(5,7,10),HQ_BOLD,HQ_STYLE_ALL};
    hq_buffer_write(b,0,0,"CPU Overview",s,200);
    CHECK(hq_encode(e,a,b,1,&out)); CHECK(out.changed_cells==12);
    CHECK(hq_buffer_copy(a,b));
    size_t allocations=hq_buffer_allocations(a)+hq_buffer_allocations(b)+hq_encoder_allocations(e);
    for(int tick=0;tick<1000;++tick) {
        hq_buffer_set(b,15,1,(uint32_t)('0'+tick%10),s);
        CHECK(hq_encode(e,a,b,0,&out)); CHECK(out.changed_cells==1);
        CHECK(hq_buffer_copy(a,b));
    }
    CHECK(allocations==hq_buffer_allocations(a)+hq_buffer_allocations(b)+hq_encoder_allocations(e));
    CHECK(hq_encode(e,a,b,0,&out) && out.length==0);
    CHECK(!hq_buffer_resize(a,INT_MAX,INT_MAX));
    CHECK(hq_buffer_width(a)==200);
    hq_buffer_fill(a,(hq_rect){INT_MAX,INT_MAX,INT_MAX,INT_MAX},'X',s);
    hq_buffer_fill(a,(hq_rect){INT_MIN,INT_MIN,INT_MAX,INT_MAX},'X',s);
    CHECK(hq_text_width("界á👨‍💻")==5);
    /* A wide glyph must not cross a nested surface's clipping boundary. */
    hq_buffer_clear(b,0,0);
    hq_surface root=hq_surface_root(b,NULL);
    hq_surface narrow=hq_surface_sub(root,(hq_rect){2,2,1,1});
    hq_surface_set(narrow,0,0,0x754c,s);
    hq_cell c;
    CHECK(hq_buffer_cell(b,3,2,&c) && c.value==32);
    hq_surface_text(narrow,0,0,"界",(hq_text_options){0});
    CHECK(hq_buffer_cell(b,2,2,&c) && c.value==0x2026);
    CHECK(hq_buffer_cell(b,3,2,&c) && c.value==32);
    /* Exercise all malformed byte prefixes under the sanitizer build. */
    for(unsigned int byte=0;byte<256;++byte) {
        char raw[5]={(char)byte,(char)0x80,(char)0xff,'A',0};
        hq_buffer_write_n(b,0,0,raw,4,s,20);
        CHECK(hq_encode(e,a,b,0,&out));
    }
    uint32_t seed=1337;
    for(int i=0;i<2000;++i) {
        seed=seed*1664525u+1013904223u;
        int x=(int)(seed%500)-250,y=(int)(seed%200)-100;
        hq_buffer_set(b,x,y,seed,s);
        hq_buffer_fill(b,(hq_rect){x,y,(int)(seed%20),(int)(seed%7)},seed,s);
        CHECK(hq_encode(e,a,b,0,&out));
        CHECK(hq_buffer_copy(a,b));
    }
    hq_buffer_clear(b,0,0);
    hq_buffer_write(b,0,0,"\233\xc0\x9b\xf0\xed\xa0\x80",s,200);
    char row[1024]; hq_buffer_row(b,0,row,sizeof(row));
    CHECK(strchr(row,'\033')==NULL);
    CHECK(hq_buffer_resize(a,0,0)); CHECK(hq_buffer_copy(b,a));
    CHECK(hq_encode(e,a,b,1,&out));
    hq_buffer_destroy(a); hq_buffer_destroy(b); hq_encoder_destroy(e);
    puts("C safety, lifecycle, delta output, Unicode, and zero-allocation warmed frames: PASS");
}
