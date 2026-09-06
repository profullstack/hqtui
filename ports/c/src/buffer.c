#include "internal.h"

static int dimensions(int w,int h) {
    return w>=0 && h>=0 && w<=32768 && h<=32768 && (size_t)w*(size_t)h<=16777216;
}
hq_buffer *hq_buffer_create(int w,int h) {
    if(!dimensions(w,h)) return NULL;
    hq_buffer *b=calloc(1,sizeof(*b));
    if(!b) return NULL;
    b->allocations=1;
    if(!hq_buffer_resize(b,w,h)) { hq_buffer_destroy(b); return NULL; }
    return b;
}
void hq_buffer_destroy(hq_buffer *b) {
    if(!b) return;
    free(b->chars); free(b->fg); free(b->bg); free(b->attrs);
    free(b->clusters); free(b->cluster_hash); free(b);
}
int hq_buffer_resize(hq_buffer *b,int w,int h) {
    if(!b || !dimensions(w,h)) return 0;
    if(w==b->width && h==b->height) return 1;
    size_t n=(size_t)w*(size_t)h;
    if(n>b->capacity) {
        uint32_t *chars=malloc(n*sizeof(*chars)), *fg=malloc(n*sizeof(*fg)), *bg=malloc(n*sizeof(*bg));
        uint16_t *attrs=malloc(n*sizeof(*attrs));
        if(!chars || !fg || !bg || !attrs) { free(chars); free(fg); free(bg); free(attrs); return 0; }
        free(b->chars); free(b->fg); free(b->bg); free(b->attrs);
        b->chars=chars; b->fg=fg; b->bg=bg; b->attrs=attrs;
        b->capacity=n; b->allocations+=4;
    }
    b->width=w; b->height=h; hq_buffer_clear(b,0,0); return 1;
}
int hq_buffer_width(const hq_buffer *b) { return b ? b->width:0; }
int hq_buffer_height(const hq_buffer *b) { return b ? b->height:0; }
size_t hq_buffer_allocations(const hq_buffer *b) { return b ? b->allocations:0; }
void hq_buffer_clear(hq_buffer *b,hq_color bg,hq_color fg) {
    if(!b) return;
    size_t n=(size_t)b->width*(size_t)b->height;
    for(size_t i=0;i<n;++i) { b->chars[i]=32; b->fg[i]=fg; b->bg[i]=bg; b->attrs[i]=0; }
}
static int bounds(const hq_buffer *b,int x,int y) { return b && x>=0 && y>=0 && x<b->width && y<b->height; }
int hq_buffer_cell(const hq_buffer *b,int x,int y,hq_cell *out) {
    if(!out || !bounds(b,x,y)) return 0;
    size_t i=(size_t)y*(size_t)b->width+(size_t)x;
    *out=(hq_cell){b->chars[i],b->fg[i],b->bg[i],b->attrs[i]}; return 1;
}
int hq_cell_width(const hq_buffer *b,uint32_t cp) {
    if(cp==HQ_CONT) return 0;
    if(cp>=HQ_CLUSTER) return cp-HQ_CLUSTER<b->cluster_count ? b->clusters[cp-HQ_CLUSTER].width:1;
    return hq_char_width(cp);
}
const char *hq_cell_text(const hq_buffer *b,uint32_t cp,char out[5]) {
    if(cp==HQ_CONT || !cp) return " ";
    if(cp>=HQ_CLUSTER) return cp-HQ_CLUSTER<b->cluster_count ? b->clusters[cp-HQ_CLUSTER].text:" ";
    hq_utf8(cp,out); return out;
}
const char *hq_buffer_cell_text(const hq_buffer *b,int x,int y,char out[5]) {
    if(!out || !bounds(b,x,y)) return "";
    return hq_cell_text(b,b->chars[(size_t)y*(size_t)b->width+(size_t)x],out);
}
static void style_at(hq_buffer *b,size_t i,hq_style s) {
    if(s.mask&HQ_STYLE_FG) b->fg[i]=s.fg;
    if(s.mask&HQ_STYLE_BG) b->bg[i]=s.bg;
    if(s.mask&HQ_STYLE_ATTRS) b->attrs[i]=s.attrs&127u;
}
static int set(hq_buffer *b,int x,int y,uint32_t cp,hq_style s) {
    if(!bounds(b,x,y)) return 0;
    int w=cp>=32 && cp<127 ? 1:hq_cell_width(b,cp);
    size_t i=(size_t)y*(size_t)b->width+(size_t)x;
    if(b->chars[i]==HQ_CONT && x>0) b->chars[i-1]=32;
    b->chars[i]=cp; style_at(b,i,s);
    if(w==2) {
        if(x+1<b->width) { b->chars[i+1]=HQ_CONT; style_at(b,i+1,s); }
        else { b->chars[i]=32; return 1; }
    }
    return hq_max(w,1);
}
int hq_buffer_set(hq_buffer *b,int x,int y,uint32_t cp,hq_style s) {
    if(hq_unsafe(cp) || cp==HQ_CONT) cp=32;
    else if(cp>0x10ffff || (cp>=0xd800 && cp<=0xdfff)) cp=0xfffd;
    return set(b,x,y,cp,s);
}
static uint32_t hash_text(const char *s,size_t n) {
    uint32_t h=2166136261u;
    for(size_t i=0;i<n;++i) h=(h^(unsigned char)s[i])*16777619u;
    return h;
}
/* Cluster IDs belong to a buffer, not a process-global pool. Keeping this bounded
 * avoids lifetime leaks and global locks. Diff compares cluster text across pools. */
static uint32_t intern(hq_buffer *b,const hq_grapheme *g) {
    char single[5]; size_t n=hq_utf8(g->cp,single);
    if(g->bytes==n && memcmp(single,g->start,n)==0) return g->cp;
    /* The decoder replaces invalid UTF-8. Never intern its original bytes:
     * a raw C1 byte could otherwise become a terminal control on output. */
    if(g->cp==0xfffd && (g->bytes<3 || memcmp(g->start,"\xef\xbf\xbd",3)!=0)) return 0xfffd;
    if(g->bytes>=sizeof(b->clusters[0].text)) return g->cp;
    if(!b->cluster_hash) {
        b->cluster_hash=calloc(HQ_MAX_CLUSTERS*2,sizeof(uint32_t));
        if(!b->cluster_hash) return g->cp;
        ++b->allocations;
    }
    size_t slot=hash_text(g->start,g->bytes)&(HQ_MAX_CLUSTERS*2-1);
    while(b->cluster_hash[slot]) {
        uint32_t id=b->cluster_hash[slot]-1;
        if(strlen(b->clusters[id].text)==g->bytes && !memcmp(b->clusters[id].text,g->start,g->bytes)) return HQ_CLUSTER+id;
        slot=(slot+1)&(HQ_MAX_CLUSTERS*2-1);
    }
    if(b->cluster_count>=HQ_MAX_CLUSTERS) return g->cp;
    if(b->cluster_count==b->cluster_capacity) {
        size_t capacity=b->cluster_capacity ? b->cluster_capacity*2:64;
        hq_cluster *p=realloc(b->clusters,capacity*sizeof(*p));
        if(!p) return g->cp;
        b->clusters=p; b->cluster_capacity=capacity; ++b->allocations;
    }
    size_t id=b->cluster_count++;
    memcpy(b->clusters[id].text,g->start,g->bytes); b->clusters[id].text[g->bytes]=0;
    b->clusters[id].width=(uint8_t)g->width; b->cluster_hash[slot]=(uint32_t)id+1;
    return HQ_CLUSTER+(uint32_t)id;
}
size_t hq_buffer_write_n(hq_buffer *b,int x,int y,const char *text,size_t n,hq_style s,size_t max) {
    if(!b || !text || y<0 || y>=b->height) return 0;
    size_t off=0,used=0; int64_t cx=x; hq_grapheme g;
    while(hq_next_grapheme(text,n,&off,&g)) {
        if((size_t)g.width>max-used || cx+g.width>b->width) break;
        if(cx>=0) set(b,(int)cx,y,intern(b,&g),s);
        cx+=g.width; used+=(size_t)g.width;
    }
    return used;
}
size_t hq_buffer_write(hq_buffer *b,int x,int y,const char *s,hq_style style,size_t max) {
    return s ? hq_buffer_write_n(b,x,y,s,strlen(s),style,max):0;
}
static hq_rect clip(const hq_buffer *b,hq_rect r) {
    int64_t right=(int64_t)r.x+hq_max(r.width,0),bottom=(int64_t)r.y+hq_max(r.height,0);
    int x=hq_min(hq_max(r.x,0),b->width),y=hq_min(hq_max(r.y,0),b->height);
    int endx=(int)hq_clamp((double)right,0,b->width),endy=(int)hq_clamp((double)bottom,0,b->height);
    return (hq_rect){x,y,hq_max(0,endx-x),hq_max(0,endy-y)};
}
void hq_buffer_fill(hq_buffer *b,hq_rect r,uint32_t cp,hq_style s) {
    if(!b) return;
    r=clip(b,r);
    for(int y=r.y;y<r.y+r.height;++y) for(int x=r.x;x<r.x+r.width;++x) hq_buffer_set(b,x,y,cp,s);
}
void hq_buffer_style(hq_buffer *b,hq_rect r,hq_style s) {
    if(!b) return;
    r=clip(b,r);
    for(int y=r.y;y<r.y+r.height;++y) for(int x=r.x;x<r.x+r.width;++x) style_at(b,(size_t)y*(size_t)b->width+(size_t)x,s);
}
int hq_buffer_copy(hq_buffer *dst,const hq_buffer *src) {
    if(!dst || !src) return 0;
    if(dst==src) return 1;
    /* Retain pools between frames so copying ASCII frames never allocates. */
    if(src->cluster_count>dst->cluster_capacity) {
        hq_cluster *p=realloc(dst->clusters,src->cluster_capacity*sizeof(*p));
        if(!p) return 0;
        dst->clusters=p; dst->cluster_capacity=src->cluster_capacity; ++dst->allocations;
    }
    if(src->cluster_hash && !dst->cluster_hash) {
        dst->cluster_hash=calloc(HQ_MAX_CLUSTERS*2,sizeof(uint32_t));
        if(!dst->cluster_hash) return 0;
        ++dst->allocations;
    }
    if(!hq_buffer_resize(dst,src->width,src->height)) return 0;
    size_t n=(size_t)src->width*(size_t)src->height;
    if(n) {
        memcpy(dst->chars,src->chars,n*sizeof(uint32_t)); memcpy(dst->fg,src->fg,n*sizeof(uint32_t));
        memcpy(dst->bg,src->bg,n*sizeof(uint32_t)); memcpy(dst->attrs,src->attrs,n*sizeof(uint16_t));
    }
    dst->cluster_count=src->cluster_count;
    if(src->cluster_count) memcpy(dst->clusters,src->clusters,src->cluster_count*sizeof(hq_cluster));
    if(src->cluster_hash) memcpy(dst->cluster_hash,src->cluster_hash,HQ_MAX_CLUSTERS*2*sizeof(uint32_t));
    else if(dst->cluster_hash) memset(dst->cluster_hash,0,HQ_MAX_CLUSTERS*2*sizeof(uint32_t));
    return 1;
}
size_t hq_buffer_row(const hq_buffer *b,int y,char *out,size_t cap) {
    size_t used=0;
    if(out && cap) out[0]=0;
    if(!b || y<0 || y>=b->height) return 0;
    for(int x=0;x<b->width;++x) {
        uint32_t cp=b->chars[(size_t)y*(size_t)b->width+(size_t)x];
        if(cp==HQ_CONT) continue;
        char scratch[5]; const char *s=hq_cell_text(b,cp,scratch); size_t n=strlen(s);
        if(out && used<cap) { size_t copy=n<cap-used-1 ? n:cap-used-1; memcpy(out+used,s,copy); }
        used+=n;
    }
    if(out && cap) out[used<cap ? used:cap-1]=0;
    return used;
}
