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
/* Every style's glyphs, in the order hq_part_bits describes them: the six a
 * lone panel draws, then the five junctions collapsing needs. */
static const uint32_t hq_borders[6][11]={
    {0x256d,0x256e,0x2570,0x256f,0x2500,0x2502,0x251c,0x2524,0x252c,0x2534,0x253c},
    {0x250c,0x2510,0x2514,0x2518,0x2500,0x2502,0x251c,0x2524,0x252c,0x2534,0x253c},
    {0x2554,0x2557,0x255a,0x255d,0x2550,0x2551,0x2560,0x2563,0x2566,0x2569,0x256c},
    {0x250f,0x2513,0x2517,0x251b,0x2501,0x2503,0x2523,0x252b,0x2533,0x253b,0x254b},
    {0x256d,0x256e,0x2570,0x256f,0x254c,0x254e,0x251c,0x2524,0x252c,0x2534,0x253c},
    {'+','+','+','+','-','|','+','+','+','+','+'}
};

static const int hq_part_bits[11]={
    HQ_EDGE_RIGHT|HQ_EDGE_DOWN,                          /* tl */
    HQ_EDGE_LEFT|HQ_EDGE_DOWN,                           /* tr */
    HQ_EDGE_UP|HQ_EDGE_RIGHT,                            /* bl */
    HQ_EDGE_UP|HQ_EDGE_LEFT,                             /* br */
    HQ_EDGE_LEFT|HQ_EDGE_RIGHT,                          /* h */
    HQ_EDGE_UP|HQ_EDGE_DOWN,                             /* v */
    HQ_EDGE_UP|HQ_EDGE_DOWN|HQ_EDGE_RIGHT,               /* ml */
    HQ_EDGE_UP|HQ_EDGE_DOWN|HQ_EDGE_LEFT,                /* mr */
    HQ_EDGE_LEFT|HQ_EDGE_RIGHT|HQ_EDGE_DOWN,             /* mt */
    HQ_EDGE_LEFT|HQ_EDGE_RIGHT|HQ_EDGE_UP,               /* mb */
    HQ_EDGE_UP|HQ_EDGE_RIGHT|HQ_EDGE_DOWN|HQ_EDGE_LEFT   /* cross */
};

int hq_border_bits(uint32_t cp) {
    /* ASCII borders collide (every corner is '+') and the first match wins,
     * which is right: the union of anything with a '+' is a '+'. */
    for(int b=0;b<6;++b) for(int i=0;i<11;++i) if(hq_borders[b][i]==cp) return hq_part_bits[i];
    return -1;
}

uint32_t hq_border_glyph(int border,int bits) {
    if(border<0 || border>=6) return 0;
    for(int i=0;i<11;++i) if(hq_part_bits[i]==bits) return hq_borders[border][i];
    return 0;
}

/* Writes a border glyph, merging it with whatever border is already there.
 *
 * Only border glyphs merge. Anything else in the cell is overwritten, which
 * keeps a panel drawn over a chart looking like a panel rather than growing
 * junctions out of the data. */
static void hq_put_border(hq_surface s,int border,int collapse,int x,int y,uint32_t cp,hq_style st) {
    if(collapse) {
        hq_cell cell;
        if(hq_buffer_cell(s.buffer,s.rect.x+x,s.rect.y+y,&cell)) {
            int before=hq_border_bits(cell.value),after=hq_border_bits(cp);
            if(before>=0 && after>=0 && before!=after) {
                uint32_t merged=hq_border_glyph(border,before|after);
                if(merged) cp=merged;
            }
        }
    }
    hq_surface_set(s,x,y,cp,st);
}

/* The glyph for a cell where two edges meet, given which of them are drawn. A
 * single edge has no glyph of its own, so the plain rule stands in: that cell
 * is part of a run, not a corner. */
static uint32_t hq_side_glyph(int border,int bits) {
    if(!bits) return 0;
    uint32_t g=hq_border_glyph(border,bits);
    if(g) return g;
    return bits&(HQ_EDGE_LEFT|HQ_EDGE_RIGHT) ? hq_borders[border][4]:hq_borders[border][5];
}

hq_surface hq_surface_box(hq_surface s,hq_box_options o) {
    const hq_theme *theme=s.theme ? s.theme:hq_theme_at(0);
    if(o.has_background && !o.no_fill) {
        hq_style bg={0,o.background,0,HQ_STYLE_BG}; hq_surface_fill(s,32,bg);
    }
    /* Zero means all four, so a caller that predates this gets what it always
     * got. HQ_SIDES_NONE is an explicit "no rule at all". */
    int sides=o.sides==0 ? HQ_SIDES_ALL:(o.sides&HQ_SIDES_NONE ? 0:o.sides&HQ_SIDES_ALL);
    int s_top=(sides&HQ_SIDE_TOP)!=0, s_right=(sides&HQ_SIDE_RIGHT)!=0;
    int s_bottom=(sides&HQ_SIDE_BOTTOM)!=0, s_left=(sides&HQ_SIDE_LEFT)!=0;

    if(o.border==HQ_NO_BORDER || !sides) return s;
    /* The interior follows the sides actually drawn, so a top-only box costs
     * one row rather than two. */
    hq_surface inner=hq_surface_region(s,hq_inset(s.rect,s_top,s_right,s_bottom,s_left));
    if(s.rect.width<2 || s.rect.height<1) return inner;
    int border=o.border>=0 && o.border<6 ? o.border:0;
    const uint32_t *c=hq_borders[border];
    int w=s.rect.width,h=s.rect.height;
    hq_style bs=default_style(o.border_style,theme->border,o);
    /* With collapsing on a border glyph landing on another becomes the union
     * of the two; without it this is the plain write it always was, so a
     * screen that never asks for collapsing renders byte for byte as before. */
    /* A corner belongs to the two sides that meet there, so it exists only when
     * both are drawn; where one is, the rule runs straight through the cell the
     * corner would have occupied. */
    #define HQ_CORNER(a,abit,b,bbit) hq_side_glyph(border,((a)?(abit):0)|((b)?(bbit):0))
    uint32_t tl=HQ_CORNER(s_top,HQ_EDGE_RIGHT,s_left,HQ_EDGE_DOWN);
    uint32_t tr=HQ_CORNER(s_top,HQ_EDGE_LEFT,s_right,HQ_EDGE_DOWN);

    if(s_top) for(int x=1;x<w-1;++x) hq_put_border(s,border,o.collapse,x,0,c[4],bs);
    if(tl) hq_put_border(s,border,o.collapse,0,0,tl,bs);
    if(tr) hq_put_border(s,border,o.collapse,w-1,0,tr,bs);
    if(h>1) {
        uint32_t bl=HQ_CORNER(s_bottom,HQ_EDGE_RIGHT,s_left,HQ_EDGE_UP);
        uint32_t br=HQ_CORNER(s_bottom,HQ_EDGE_LEFT,s_right,HQ_EDGE_UP);
        if(s_bottom) for(int x=1;x<w-1;++x) hq_put_border(s,border,o.collapse,x,h-1,c[4],bs);
        if(bl) hq_put_border(s,border,o.collapse,0,h-1,bl,bs);
        if(br) hq_put_border(s,border,o.collapse,w-1,h-1,br,bs);
        for(int y=1;y<h-1;++y) {
            if(s_left) hq_put_border(s,border,o.collapse,0,y,c[5],bs);
            if(s_right) hq_put_border(s,border,o.collapse,w-1,y,c[5],bs);
        }
    }
    #undef HQ_CORNER
    char sub[4096]="",title[4096],foot[4096]; size_t sw=0;
    if(o.subtitle && s_top) { label(sub,o.subtitle); sw=hq_text_width(sub); if(sw+4>=(size_t)w) sw=0; }
    if(o.title && s_top) {
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
    if(o.footer && s_bottom && h>2) {
        label(foot,o.footer);
        if(hq_text_width(foot)+4<(size_t)w) {
            hq_text_options t={0}; t.style=default_style(o.footer_style,theme->muted,o);
            hq_surface_text(s,2,h-1,foot,t);
        }
    }
    return inner;
}
