#include "internal.h"
#include <stdio.h>
static int integer(int64_t n) { return n<INT_MIN ? INT_MIN:n>INT_MAX ? INT_MAX:(int)n; }
hq_rect hq_intersect(hq_rect a,hq_rect b) {
    int x=hq_max(a.x,b.x),y=hq_max(a.y,b.y);
    int64_t ax=(int64_t)a.x+hq_max(0,a.width),bx=(int64_t)b.x+hq_max(0,b.width);
    int64_t ay=(int64_t)a.y+hq_max(0,a.height),by=(int64_t)b.y+hq_max(0,b.height);
    int64_t w=(ax<bx ? ax:bx)-x,h=(ay<by ? ay:by)-y;
    return (hq_rect){x,y,hq_max(0,integer(w)),hq_max(0,integer(h))};
}
hq_rect hq_inset(hq_rect r,int t,int right,int b,int l) {
    t=hq_max(0,t); right=hq_max(0,right); b=hq_max(0,b); l=hq_max(0,l);
    return (hq_rect){integer((int64_t)r.x+l),integer((int64_t)r.y+t),
        hq_max(0,integer((int64_t)r.width-l-right)),hq_max(0,integer((int64_t)r.height-t-b))};
}
hq_surface hq_surface_root(hq_buffer *b,const hq_theme *theme) {
    hq_rect r={0,0,hq_buffer_width(b),hq_buffer_height(b)};
    return (hq_surface){b,theme ? theme:hq_theme_at(0),r,r};
}
hq_surface hq_surface_region(hq_surface parent,hq_rect r) {
    r.width=hq_min(32768,hq_max(0,r.width)); r.height=hq_min(32768,hq_max(0,r.height));
    return (hq_surface){parent.buffer,parent.theme,r,hq_intersect(r,parent.clip)};
}
hq_surface hq_surface_sub(hq_surface parent,hq_rect r) {
    r.x=integer((int64_t)parent.rect.x+r.x); r.y=integer((int64_t)parent.rect.y+r.y);
    return hq_surface_region(parent,r);
}
static int visible(hq_surface s,int64_t x,int64_t y,int width) {
    return x>=s.clip.x && x+width<=(int64_t)s.clip.x+s.clip.width &&
           y>=s.clip.y && y<(int64_t)s.clip.y+s.clip.height;
}
void hq_surface_set(hq_surface s,int x,int y,uint32_t cp,hq_style style) {
    int64_t ax=(int64_t)s.rect.x+x,ay=(int64_t)s.rect.y+y;
    int width=hq_max(1,hq_char_width(cp));
    if(visible(s,ax,ay,width) && ax>=INT_MIN && ax<=INT_MAX && ay>=INT_MIN && ay<=INT_MAX)
        hq_buffer_set(s.buffer,(int)ax,(int)ay,cp,style);
}
void hq_surface_fill(hq_surface s,uint32_t cp,hq_style style) {
    hq_rect r=hq_intersect(s.clip,(hq_rect){0,0,hq_buffer_width(s.buffer),hq_buffer_height(s.buffer)});
    int w=hq_max(1,hq_char_width(cp));
    for(int y=r.y;y<r.y+r.height;++y) for(int x=r.x;x+w<=r.x+r.width;x+=w)
        hq_buffer_set(s.buffer,x,y,cp,style);
}
size_t hq_surface_text(hq_surface s,int x,int y,const char *text,hq_text_options o) {
    if(!text || !s.buffer) return 0;
    int64_t ay=(int64_t)s.rect.y+y;
    if(ay<s.clip.y || ay>=(int64_t)s.clip.y+s.clip.height) return 0;
    int room=hq_min(32768,hq_max(0,integer((int64_t)s.rect.width-x)));
    size_t limit=(size_t)(o.has_max_columns ? hq_min(room,hq_max(0,o.max_columns)):room);
    if(!limit) return 0;
    size_t bytes=strlen(text),width=hq_text_width_n(text,bytes);
    int ellipsis=!o.no_ellipsis && width>limit;
    size_t content=width,off=0;
    hq_grapheme g;
    if(ellipsis) {
        content=0;
        while(hq_next_grapheme(text,bytes,&off,&g)) {
            if(content+(size_t)g.width>limit-1) break;
            content+=(size_t)g.width;
        }
        ++content;
    }
    size_t padding=content<limit ? limit-content:0;
    size_t left=o.align==HQ_RIGHT ? padding:o.align==HQ_CENTER ? padding/2:0;
    int64_t cx=(int64_t)s.rect.x+x;
    for(size_t i=0;i<left;++i) {
        if(visible(s,cx,ay,1)) hq_buffer_set(s.buffer,(int)cx,(int)ay,32,o.style);
        ++cx;
    }
    off=0; size_t used=0,cap=ellipsis ? content-1:limit;
    while(hq_next_grapheme(text,bytes,&off,&g)) {
        if(used+(size_t)g.width>cap) break;
        if(visible(s,cx,ay,g.width)) hq_buffer_write_n(s.buffer,(int)cx,(int)ay,g.start,g.bytes,o.style,(size_t)g.width);
        cx+=g.width; used+=(size_t)g.width;
    }
    if(ellipsis) {
        if(visible(s,cx,ay,1)) hq_buffer_set(s.buffer,(int)cx,(int)ay,0x2026,o.style);
        ++used; ++cx;
    }
    if(o.align!=HQ_LEFT) for(size_t i=left;i<padding;++i) {
        if(visible(s,cx,ay,1)) hq_buffer_set(s.buffer,(int)cx,(int)ay,32,o.style);
        ++cx;
    }
    return o.align==HQ_LEFT ? used:used+padding;
}
static hq_style default_style(hq_style s,hq_color fg,hq_box_options o) {
    if(!(s.mask&HQ_STYLE_FG)) { s.fg=fg; s.mask|=HQ_STYLE_FG; }
    if(o.has_background && !(s.mask&HQ_STYLE_BG)) { s.bg=o.background; s.mask|=HQ_STYLE_BG; }
    return s;
}
static void label(char out[4096],const char *s) {
    /* Labels are bounded; UTF-8 clipping is sanitized by the text writer. */
    snprintf(out,4096," %.*s ",4092,s);
}
hq_surface hq_surface_box(hq_surface s,hq_box_options o) {
    const hq_theme *theme=s.theme ? s.theme:hq_theme_at(0);
    if(o.has_background && !o.no_fill) {
        hq_style bg={0,o.background,0,HQ_STYLE_BG}; hq_surface_fill(s,32,bg);
    }
    if(o.border==HQ_NO_BORDER) return s;
    hq_surface inner=hq_surface_region(s,hq_inset(s.rect,1,1,1,1));
    if(s.rect.width<2 || s.rect.height<1) return inner;
    static const uint32_t borders[6][6]={
        {0x256d,0x256e,0x2570,0x256f,0x2500,0x2502},
        {0x250c,0x2510,0x2514,0x2518,0x2500,0x2502},
        {0x2554,0x2557,0x255a,0x255d,0x2550,0x2551},
        {0x250f,0x2513,0x2517,0x251b,0x2501,0x2503},
        {0x256d,0x256e,0x2570,0x256f,0x254c,0x254e},
        {'+','+','+','+','-','|'}
    };
    const uint32_t *c=borders[o.border>=0 && o.border<6 ? o.border:0];
    int w=s.rect.width,h=s.rect.height;
    hq_style bs=default_style(o.border_style,theme->border,o);
    hq_surface_set(s,0,0,c[0],bs); hq_surface_set(s,w-1,0,c[1],bs);
    for(int x=1;x<w-1;++x) hq_surface_set(s,x,0,c[4],bs);
    if(h>1) {
        hq_surface_set(s,0,h-1,c[2],bs); hq_surface_set(s,w-1,h-1,c[3],bs);
        for(int x=1;x<w-1;++x) hq_surface_set(s,x,h-1,c[4],bs);
        for(int y=1;y<h-1;++y) { hq_surface_set(s,0,y,c[5],bs); hq_surface_set(s,w-1,y,c[5],bs); }
    }
    char sub[4096]="",title[4096],foot[4096]; size_t sw=0;
    if(o.subtitle) { label(sub,o.subtitle); sw=hq_text_width(sub); if(sw+4>=(size_t)w) sw=0; }
    if(o.title) {
        label(title,o.title);
        int limit=sw ? w-1-(int)sw:w-2,room=hq_max(0,limit-2);
        size_t tw=hq_text_width(title);
        if(tw>(size_t)room) {
            /* Measure the actual truncated width (wide glyphs can leave a gap). */
            size_t off=0,used=0; hq_grapheme g;
            while(hq_next_grapheme(title,strlen(title),&off,&g)) {
                if(room==0 || used+(size_t)g.width>(size_t)room-1) break;
                used+=(size_t)g.width;
            }
            tw=room>0 ? used+1:0;
        }
        int tx=o.title_align==HQ_RIGHT ? hq_max(2,limit-(int)tw):o.title_align==HQ_CENTER ? hq_max(2,hq_min(limit-(int)tw,(w-(int)tw)/2)):2;
        hq_text_options t={0}; t.style=default_style(o.title_style,theme->title,o);
        t.style.attrs=HQ_BOLD; t.style.mask|=HQ_STYLE_ATTRS; t.has_max_columns=1; t.max_columns=room;
        hq_surface_text(s,tx,0,title,t);
    }
    if(sw) {
        hq_text_options t={0}; t.style=default_style(o.subtitle_style,theme->muted,o);
        hq_surface_text(s,w-2-(int)sw,0,sub,t);
    }
    if(o.footer && h>2) {
        label(foot,o.footer);
        if(hq_text_width(foot)+4<(size_t)w) {
            hq_text_options t={0}; t.style=default_style(o.footer_style,theme->muted,o);
            hq_surface_text(s,2,h-1,foot,t);
        }
    }
    return inner;
}
