#include "internal.h"
typedef struct { uint32_t lo,hi; } range;
static const range zero[]={
    {0x0300,0x036f},{0x0483,0x0489},{0x0591,0x05bd},{0x0610,0x061a},
    {0x064b,0x065f},{0x0670,0x0670},{0x06d6,0x06dc},{0x0730,0x074a},
    {0x07a6,0x07b0},{0x0816,0x0819},{0x08e3,0x0903},{0x093a,0x093c},
    {0x0951,0x0957},{0x0e31,0x0e31},{0x0e34,0x0e3a},{0x0eb1,0x0eb1},
    {0x1ab0,0x1aff},{0x1dc0,0x1dff},{0x200b,0x200f},{0x2028,0x202e},
    {0x2060,0x2064},{0x2066,0x2069},{0x20d0,0x20f0},{0xfe00,0xfe0f},
    {0xfe20,0xfe2f},{0xfeff,0xfeff},{0xe0100,0xe01ef}
};
static const range wide[]={
    {0x1100,0x115f},{0x2e80,0x303e},{0x3041,0x33ff},{0x3400,0x4dbf},
    {0x4e00,0x9fff},{0xa000,0xa4cf},{0xa960,0xa97f},{0xac00,0xd7a3},
    {0xf900,0xfaff},{0xfe10,0xfe19},{0xfe30,0xfe6f},{0xff00,0xff60},
    {0xffe0,0xffe6},{0x1f004,0x1f004},{0x1f0cf,0x1f0cf},{0x1f18e,0x1f18e},
    {0x1f191,0x1f19a},{0x1f200,0x1f320},{0x1f32d,0x1f335},{0x1f337,0x1f37c},
    {0x1f37e,0x1f393},{0x1f3a0,0x1f3ca},{0x1f3cf,0x1f3d3},{0x1f3e0,0x1f3f0},
    {0x1f3f4,0x1f3f4},{0x1f3f8,0x1f43e},{0x1f440,0x1f440},{0x1f442,0x1f4fc},
    {0x1f4ff,0x1f53d},{0x1f54b,0x1f54e},{0x1f550,0x1f567},{0x1f57a,0x1f57a},
    {0x1f595,0x1f596},{0x1f5a4,0x1f5a4},{0x1f5fb,0x1f64f},{0x1f680,0x1f6c5},
    {0x1f6cc,0x1f6cc},{0x1f6d0,0x1f6d2},{0x1f6eb,0x1f6ec},{0x1f910,0x1f9ff},
    {0x20000,0x2fffd},{0x30000,0x3fffd}
};
static const range pictographic[]={
    {0xa9,0xa9},{0xae,0xae},{0x203c,0x203c},{0x2049,0x2049},{0x2122,0x2122},
    {0x2139,0x2139},{0x2194,0x21aa},{0x231a,0x23fa},{0x24c2,0x24c2},
    {0x25aa,0x25fe},{0x2600,0x27bf},{0x2934,0x2935},{0x2b00,0x2bff},
    {0x3030,0x3030},{0x303d,0x303d},{0x3297,0x3299},{0x1f000,0x1faff},{0x1fc00,0x1fffd}
};
static int in_ranges(uint32_t cp,const range *r,size_t n) {
    size_t lo=0,hi=n;
    while(lo<hi) { size_t mid=lo+(hi-lo)/2;
        if(cp<r[mid].lo) hi=mid; else if(cp>r[mid].hi) lo=mid+1; else return 1;
    }
    return 0;
}
#define IN(cp,r) in_ranges(cp,r,sizeof(r)/sizeof(r[0]))
int hq_unsafe(uint32_t cp) {
    return cp<32 || (cp>=127 && cp<=159) || (cp>=0x202a && cp<=0x202e) || (cp>=0x2066 && cp<=0x2069);
}
int hq_char_width(uint32_t cp) {
    if(cp<32 || (cp>=127 && cp<160)) return 0;
    if(cp<0x300) return 1;
    if(IN(cp,zero)) return 0;
    return IN(cp,wide) ? 2:1;
}
/* Invalid encodings consume one byte, preventing reads past truncated input. */
static uint32_t decode(const char *s,size_t n,size_t *used) {
    *used=1;
    unsigned char c=(unsigned char)s[0];
    if(c<128) return c;
    size_t len=c>=0xc2 && c<=0xdf ? 2 : c>=0xe0 && c<=0xef ? 3 : c>=0xf0 && c<=0xf4 ? 4:0;
    if(!len || n<len) return 0xfffd;
    uint32_t cp=c & (len==2 ? 31u:len==3 ? 15u:7u);
    for(size_t i=1;i<len;++i) {
        unsigned char b=(unsigned char)s[i];
        if((b&0xc0)!=0x80) return 0xfffd;
        cp=(cp<<6)|(b&63u);
    }
    if((len==2 && cp<128) || (len==3 && cp<2048) || (len==4 && cp<65536) ||
       (cp>=0xd800 && cp<=0xdfff) || cp>0x10ffff) return 0xfffd;
    *used=len; return cp;
}
size_t hq_utf8(uint32_t cp,char out[5]) {
    if(cp>0x10ffff || (cp>=0xd800 && cp<=0xdfff)) cp=0xfffd;
    size_t n;
    if(cp<128) { out[0]=(char)cp; n=1; }
    else if(cp<2048) { out[0]=(char)(0xc0|(cp>>6)); out[1]=(char)(0x80|(cp&63)); n=2; }
    else if(cp<65536) { out[0]=(char)(0xe0|(cp>>12)); out[1]=(char)(0x80|(cp>>6&63)); out[2]=(char)(0x80|(cp&63)); n=3; }
    else { out[0]=(char)(0xf0|(cp>>18)); out[1]=(char)(0x80|(cp>>12&63)); out[2]=(char)(0x80|(cp>>6&63)); out[3]=(char)(0x80|(cp&63)); n=4; }
    out[n]=0; return n;
}
int hq_next_grapheme(const char *s,size_t n,size_t *offset,hq_grapheme *g) {
    while(*offset<n) {
        size_t start=*offset, bytes;
        uint32_t cp=decode(s+start,n-start,&bytes);
        int width=hq_char_width(cp);
        if(hq_unsafe(cp)) { *offset+=bytes; continue; }
        size_t parts=1;
        while(start+bytes<n && parts<16) {
            size_t nb; uint32_t next=decode(s+start+bytes,n-start-bytes,&nb);
            if(next==0x200d) {
                if(start+bytes+nb>=n) break;
                size_t ab; uint32_t after=decode(s+start+bytes+nb,n-start-bytes-nb,&ab);
                if(!IN(cp,pictographic) || !IN(after,pictographic) || parts+2>16) break;
                bytes+=nb+ab; parts+=2; continue;
            }
            if(hq_char_width(next)!=0 || hq_unsafe(next)) break;
            bytes+=nb; ++parts;
        }
        *offset=start+bytes;
        if(!width) continue;
        g->start=s+start; g->bytes=bytes; g->cp=cp; g->width=width;
        return 1;
    }
    return 0;
}
size_t hq_text_width_n(const char *s,size_t n) {
    if(!s) return 0;
    size_t off=0,w=0; hq_grapheme g;
    while(hq_next_grapheme(s,n,&off,&g)) w+=(size_t)g.width;
    return w;
}
size_t hq_text_width(const char *s) { return s ? hq_text_width_n(s,strlen(s)):0; }
