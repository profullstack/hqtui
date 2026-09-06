#include "internal.h"
#include <ctype.h>

hq_color hq_rgb(int r,int g,int b) {
    return 0x1000000u | ((uint32_t)r & 255u)<<16 | ((uint32_t)g & 255u)<<8 | ((uint32_t)b & 255u);
}
hq_color hq_indexed(int i) { return 0x2000000u | ((uint32_t)i & 255u); }
static int digit(char c) {
    if(c>='0' && c<='9') return c-'0';
    if(c>='a' && c<='f') return c-'a'+10;
    if(c>='A' && c<='F') return c-'A'+10;
    return -1;
}
hq_color hq_hex(const char *s) {
    if(!s) return hq_rgb(0,0,0);
    while(isspace((unsigned char)*s)) ++s;
    if(*s=='#') ++s;
    size_t n=strlen(s);
    while(n && isspace((unsigned char)s[n-1])) --n;
    uint32_t v=0;
    for(size_t i=0;i<n;++i) {
        int d=digit(s[i]);
        if(d<0) return hq_rgb(0,0,0);
        v=n==3 ? (v<<8)|(uint32_t)(d*17) : (v<<4)|(uint32_t)d;
    }
    return 0x1000000u | (v & 0xffffffu);
}
static const int cube[6]={0,95,135,175,215,255};
static const int base[16][3]={
    {0,0,0},{205,49,49},{13,188,121},{229,229,16},{36,114,200},{188,63,188},{17,168,205},{229,229,229},
    {102,102,102},{241,76,76},{35,209,139},{245,245,67},{59,142,234},{214,112,214},{41,184,219},{255,255,255}
};
static int channel(hq_color c,int shift) { return (int)((c>>shift)&255u); }
static int nearest(int v) {
    int best=0, dist=INT_MAX;
    for(int i=0;i<6;++i) if(abs(cube[i]-v)<dist) { best=i; dist=abs(cube[i]-v); }
    return best;
}
hq_color hq_from256(int index) {
    int i=index&255;
    if(i<16) return hq_rgb(base[i][0],base[i][1],base[i][2]);
    if(i>=232) { int v=8+(i-232)*10; return hq_rgb(v,v,v); }
    i-=16; return hq_rgb(cube[i/36%6],cube[i/6%6],cube[i%6]);
}
int hq_to256(hq_color c) {
    if(c&0x2000000u) return (int)(c&255u);
    int r=channel(c,16),g=channel(c,8),b=channel(c,0);
    if(abs(r-g)<8 && abs(g-b)<8) {
        if(r<8) return 16;
        if(r>248) return 231;
        return 232+(int)floor((r-8)/247.0*24+0.5);
    }
    return 16+36*nearest(r)+6*nearest(g)+nearest(b);
}
int hq_to16(hq_color c) {
    if(c&0x2000000u) {
        int i=(int)(c&255u); if(i<16) return i; c=hq_from256(i);
    }
    int best=7,dist=INT_MAX;
    for(int i=0;i<16;++i) {
        int r=channel(c,16)-base[i][0],g=channel(c,8)-base[i][1],b=channel(c,0)-base[i][2];
        int d=r*r+g*g+b*b;
        if(d<dist) { dist=d; best=i; }
    }
    return best;
}
hq_color hq_mix(hq_color a,hq_color b,double t) {
    if(!a || !b) return t<0.5 ? a:b;
    t=isnan(t) ? 0 : hq_clamp(t,0,1);
    return hq_rgb((int)floor(channel(a,16)+(channel(b,16)-channel(a,16))*t+0.5),
                  (int)floor(channel(a,8)+(channel(b,8)-channel(a,8))*t+0.5),
                  (int)floor(channel(a,0)+(channel(b,0)-channel(a,0))*t+0.5));
}
hq_color hq_grayscale(hq_color c) {
    if(!c) return 0;
    int v=(int)floor(.299*channel(c,16)+.587*channel(c,8)+.114*channel(c,0)+.5);
    return hq_rgb(v,v,v);
}
static double linear(int v) { double x=v/255.0; return x<=.03928 ? x/12.92 : pow((x+.055)/1.055,2.4); }
double hq_luminance(hq_color c) { return .2126*linear(channel(c,16))+.7152*linear(channel(c,8))+.0722*linear(channel(c,0)); }
double hq_contrast(hq_color a,hq_color b) {
    double x=hq_luminance(a),y=hq_luminance(b); return (fmax(x,y)+.05)/(fmin(x,y)+.05);
}
hq_color hq_gradient(const hq_color *s,size_t n,double t) {
    if(!s || !n) return 0;
    if(n==1) return s[0];
    t=isnan(t) ? 0 : hq_clamp(t,0,1);
    double p=t*(double)(n-1); size_t i=(size_t)p;
    if(i>=n-1) i=n-2;
    return hq_mix(s[i],s[i+1],p-(double)i);
}
