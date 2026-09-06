#ifndef HQ_INTERNAL_H
#define HQ_INTERNAL_H
#include "hqtui.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <limits.h>
#define HQ_CONT UINT32_MAX
#define HQ_CLUSTER 0x110000u
#define HQ_MAX_CLUSTERS 32768u
typedef struct { char text[69]; uint8_t width; } hq_cluster;
struct hq_buffer {
    int width, height;
    size_t capacity, allocations;
    uint32_t *chars, *fg, *bg;
    uint16_t *attrs;
    hq_cluster *clusters;
    uint32_t *cluster_hash;
    size_t cluster_count, cluster_capacity;
};
typedef struct { const char *start; size_t bytes; uint32_t cp; int width; } hq_grapheme;
int hq_next_grapheme(const char *s, size_t n, size_t *offset, hq_grapheme *g);
size_t hq_utf8(uint32_t cp, char out[5]);
int hq_unsafe(uint32_t cp);
const char *hq_cell_text(const hq_buffer *b, uint32_t cp, char out[5]);
int hq_cell_width(const hq_buffer *b, uint32_t cp);
static inline double hq_clamp(double v, double a, double b) { return fmax(a,fmin(b,v)); }
static inline int hq_min(int a, int b) { return a < b ? a : b; }
static inline int hq_max(int a, int b) { return a > b ? a : b; }
#endif
