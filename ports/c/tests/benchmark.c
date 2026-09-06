/* The C and C++ builds run identical workloads through their public APIs.
 * Encoding is measured in memory: terminal I/O and system collectors excluded.
 * JSON makes cross-language byte counts and allocation checks machine-verifiable.
 */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <hqtui.h>
#ifdef __cplusplus
#include <hqtui.hpp>
#define LANGUAGE "cpp"
#else
#define LANGUAGE "c"
#endif

static double now_ns(void) {
    struct timespec t;
#ifdef _WIN32
    timespec_get(&t,TIME_UTC);
#else
    clock_gettime(CLOCK_MONOTONIC,&t);
#endif
    return (double)t.tv_sec*1e9+(double)t.tv_nsec;
}
int main(int argc,char **argv) {
    char *end=NULL;
    long requested=argc>1 ? strtol(argv[1],&end,10):2000;
    if(argc>2 || requested<100 || requested>1000000 || (argc>1 && (!end || *end))) return 2;
    int iterations=(int)requested;
    const int width=200,height=50;
    for(int mode=0;mode<3;++mode) {
#ifdef __cplusplus
        hqtui::Buffer a(width,height),b(width,height);
        hqtui::Encoder encoder;
        auto style=hqtui::Style(hqtui::rgb(88,166,255),hqtui::rgb(5,7,10));
#else
        hq_buffer *a=hq_buffer_create(width,height),*b=hq_buffer_create(width,height);
        hq_encoder *encoder=hq_encoder_create(16777216,0);
        hq_style style={hq_rgb(88,166,255),hq_rgb(5,7,10),0,HQ_STYLE_ALL};
        if(!a || !b || !encoder) return 1;
#endif
        size_t bytes=0,changed=0,baseline=0;
        double start=0;
        for(int tick=-100;tick<iterations;++tick) {
            if(tick==0) {
#ifdef __cplusplus
                baseline=a.allocations()+b.allocations()+encoder.allocations();
#else
                baseline=hq_buffer_allocations(a)+hq_buffer_allocations(b)+hq_encoder_allocations(encoder);
#endif
                start=now_ns();
            }
            int count=mode==0 ? 0:mode==1 ? 100:width*height;
            for(int i=0;i<count;++i) {
                int pos=mode==1 ? i*97%(width*height):i;
                uint32_t cp=(uint32_t)('A'+((tick+100+i)%26));
#ifdef __cplusplus
                b.set(pos%width,pos/width,cp,style);
#else
                hq_buffer_set(b,pos%width,pos/width,cp,style);
#endif
            }
#ifdef __cplusplus
            auto out=encoder.encode(a,b,tick==-100);
            if(tick>=0) { bytes+=out.output.size(); changed+=out.changed_cells; }
            a.copy_from(b);
#else
            hq_encoded out;
            if(!hq_encode(encoder,a,b,tick==-100,&out)) return 1;
            if(tick>=0) { bytes+=out.length; changed+=out.changed_cells; }
            if(!hq_buffer_copy(a,b)) return 1;
#endif
        }
        double ns=(now_ns()-start)/iterations;
#ifdef __cplusplus
        size_t allocations=a.allocations()+b.allocations()+encoder.allocations()-baseline;
#else
        size_t allocations=hq_buffer_allocations(a)+hq_buffer_allocations(b)+hq_encoder_allocations(encoder)-baseline;
#endif
        printf("{\"language\":\"%s\",\"workload\":\"%s\",\"width\":%d,\"height\":%d,\"iterations\":%d,\"ns_per_frame\":%.1f,\"bytes\":%zu,\"changed_cells\":%zu,\"warm_allocations\":%zu}\n",
#ifdef __cplusplus
               LANGUAGE,
#else
               "c",
#endif
               mode==0 ? "unchanged":mode==1 ? "sparse":"full",width,height,iterations,ns,bytes,changed,allocations);
#ifndef __cplusplus
        hq_buffer_destroy(a); hq_buffer_destroy(b); hq_encoder_destroy(encoder);
#endif
        if(allocations) return 1;
    }
    return 0;
}
