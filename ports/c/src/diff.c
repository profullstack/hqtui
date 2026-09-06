#include "internal.h"
#include <stdio.h>
#include <stdarg.h>
struct hq_encoder {
    char *data;
    size_t length,capacity,allocations;
    int colors,monochrome,x,y,known,failed,force;
    hq_color fg,bg;
    uint16_t attrs;
};
static void append(hq_encoder *e,const char *s,size_t n) {
    if(e->failed) return;
    if(n>SIZE_MAX-e->length-1) { e->failed=1; return; }
    size_t required=e->length+n+1;
    if(required>e->capacity) {
        size_t cap=e->capacity ? e->capacity:4096;
        while(cap<required) { if(cap>SIZE_MAX/2) { cap=required; break; } cap*=2; }
        char *p=realloc(e->data,cap);
        if(!p) { e->failed=1; return; }
        e->data=p; e->capacity=cap; ++e->allocations;
    }
    memcpy(e->data+e->length,s,n); e->length+=n; e->data[e->length]=0;
}
static void text(hq_encoder *e,const char *s) { append(e,s,strlen(s)); }
static void fmt(hq_encoder *e,const char *format,...) {
    char s[96]; va_list args; va_start(args,format);
    int n=vsnprintf(s,sizeof(s),format,args); va_end(args);
    if(n<0 || (size_t)n>=sizeof(s)) { e->failed=1; return; }
    append(e,s,(size_t)n);
}
hq_encoder *hq_encoder_create(int colors,int mono) {
    if(colors!=0 && colors!=16 && colors!=256 && colors!=16777216) return NULL;
    hq_encoder *e=calloc(1,sizeof(*e));
    if(e) { e->colors=colors; e->monochrome=!!mono; e->x=e->y=-1; e->allocations=1; }
    return e;
}
void hq_encoder_destroy(hq_encoder *e) { if(e) { free(e->data); free(e); } }
void hq_encoder_invalidate(hq_encoder *e) { if(e) e->force=1; }
size_t hq_encoder_allocations(const hq_encoder *e) { return e ? e->allocations:0; }
static void color(hq_encoder *e,hq_color c,int background) {
    if(!e->colors) return;
    if(!c) { text(e,background ? "\033[49m":"\033[39m"); return; }
    if(e->monochrome) c=hq_grayscale(c);
    int code=background ? 48:38;
    if(e->colors==16777216) fmt(e,"\033[%d;2;%u;%u;%um",code,(c>>16)&255u,(c>>8)&255u,c&255u);
    else if(e->colors==256) fmt(e,"\033[%d;5;%dm",code,hq_to256(c));
    else { int idx=hq_to16(c); fmt(e,"\033[%dm",(background ? 40:30)+(idx>=8 ? 60:0)+idx%8); }
}
static void style(hq_encoder *e,hq_color fg,hq_color bg,uint16_t attrs) {
    if(e->fg==fg && e->bg==bg && e->attrs==attrs) return;
    if(e->attrs & (uint16_t)~attrs) { text(e,"\033[0m"); e->attrs=0; e->fg=e->bg=0; }
    uint16_t added=attrs & (uint16_t)~e->attrs;
    if(added) {
        static const int codes[7]={1,2,3,4,5,7,9}; int first=1;
        text(e,"\033[");
        for(int i=0;i<7;++i) if(added&(1u<<i)) { if(!first) text(e,";"); fmt(e,"%d",codes[i]); first=0; }
        text(e,"m"); e->attrs=attrs;
    }
    if(e->fg!=fg) { color(e,fg,0); e->fg=fg; }
    if(e->bg!=bg) { color(e,bg,1); e->bg=bg; }
}
static void move(hq_encoder *e,int x,int y) {
    if(e->known && e->y==y) {
        if(e->x==x) return;
        if(x>e->x && x-e->x<=3) fmt(e,"\033[%dC",x-e->x);
        else if(!x) text(e,"\r");
        else fmt(e,"\033[%dG",x+1);
    } else fmt(e,"\033[%d;%dH",y+1,x+1);
    e->x=x; e->y=y; e->known=1;
}
static int differs(const hq_buffer *a,const hq_buffer *b,size_t i,int same) {
    if(!same) return 1;
    if(a->fg[i]!=b->fg[i] || a->bg[i]!=b->bg[i] || a->attrs[i]!=b->attrs[i]) return 1;
    uint32_t x=a->chars[i],y=b->chars[i];
    if(x>=HQ_CLUSTER && x!=HQ_CONT && y>=HQ_CLUSTER && y!=HQ_CONT) {
        char t[5],u[5]; return strcmp(hq_cell_text(a,x,t),hq_cell_text(b,y,u))!=0;
    }
    return x!=y;
}
int hq_encode(hq_encoder *e,const hq_buffer *prev,const hq_buffer *next,int full,hq_encoded *out) {
    if(!e || !next || !out) return 0;
    *out=(hq_encoded){"",0,0,0}; e->length=0; e->failed=0;
    if(e->data) e->data[0]=0;
    int same=prev && prev->width==next->width && prev->height==next->height;
    int repaint=full || !same || e->force;
    if(repaint) { e->known=0; e->x=e->y=-1; e->fg=e->bg=0; e->attrs=0; e->force=0; text(e,"\033[0m"); }
    int w=next->width,h=next->height;
    for(int y=0;y<h;++y) {
        size_t row=(size_t)y*(size_t)w; int x=0,dirty=0;
        /* Bulk comparisons vectorize on libc implementations. Only use raw IDs
         * when both pools contain plain scalars; cluster IDs are buffer-local. */
        if(w>0 && !repaint && same && !prev->cluster_count && !next->cluster_count &&
           !memcmp(prev->chars+row,next->chars+row,(size_t)w*sizeof(uint32_t)) &&
           !memcmp(prev->fg+row,next->fg+row,(size_t)w*sizeof(uint32_t)) &&
           !memcmp(prev->bg+row,next->bg+row,(size_t)w*sizeof(uint32_t)) &&
           !memcmp(prev->attrs+row,next->attrs+row,(size_t)w*sizeof(uint16_t))) continue;
        while(x<w) {
            if(!repaint && !differs(prev,next,row+(size_t)x,same)) { ++x; continue; }
            int start=x;
            while(start>0 && next->chars[row+(size_t)start]==HQ_CONT) --start;
            int end=start,clean=0;
            for(int probe=start;probe<w;++probe) {
                if(repaint || differs(prev,next,row+(size_t)probe,same)) { end=probe; clean=0; }
                else if(++clean>5) break;
            }
            move(e,start,y);
            for(int cx=start;cx<=end;++cx) {
                size_t i=row+(size_t)cx; uint32_t cp=next->chars[i];
                if(cp==HQ_CONT) continue;
                style(e,next->fg[i],next->bg[i],next->attrs[i]);
                if(cp>=32 && cp<127) {
                    char ascii=(char)cp; append(e,&ascii,1); ++e->x;
                } else {
                    char scratch[5]; text(e,hq_cell_text(next,cp,scratch));
                    e->x+=hq_max(1,hq_cell_width(next,cp));
                }
                if(differs(prev,next,i,same)) ++out->changed_cells;
            }
            if(e->x>=w) e->known=0;
            dirty=1; x=end+1;
        }
        if(dirty) ++out->dirty_rows;
    }
    if(e->failed) { hq_encoder_invalidate(e); *out=(hq_encoded){"",0,0,0}; return 0; }
    out->data=e->data ? e->data:""; out->length=e->length; return 1;
}
