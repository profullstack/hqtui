#ifndef HQTUI_H
#define HQTUI_H

/* Native C11 renderer. No terminal state is changed by framebuffer operations.
 * Objects are independent and may be used on separate threads, but an individual
 * object requires external synchronization. Strings passed to *_n may contain NUL.
 * Returned strings are borrowed until the next mutation of the owning object.
 */
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef uint32_t hq_color;
enum { HQ_BOLD=1, HQ_DIM=2, HQ_ITALIC=4, HQ_UNDERLINE=8,
       HQ_BLINK=16, HQ_REVERSE=32, HQ_STRIKE=64 };
enum { HQ_STYLE_FG=1, HQ_STYLE_BG=2, HQ_STYLE_ATTRS=4, HQ_STYLE_ALL=7 };
typedef struct { hq_color fg, bg; uint16_t attrs, mask; } hq_style;
typedef struct { int x, y, width, height; } hq_rect;
typedef struct hq_buffer hq_buffer;
typedef struct hq_encoder hq_encoder;
typedef struct { uint32_t value; hq_color fg, bg; uint16_t attrs; } hq_cell;
typedef struct {
    const char *data;
    size_t length, changed_cells, dirty_rows;
} hq_encoded;

hq_color hq_rgb(int r, int g, int b);
hq_color hq_hex(const char *s);
hq_color hq_indexed(int index);
hq_color hq_from256(int index);
int hq_to256(hq_color c);
int hq_to16(hq_color c);
hq_color hq_mix(hq_color a, hq_color b, double t);
hq_color hq_grayscale(hq_color c);
double hq_luminance(hq_color c);
double hq_contrast(hq_color a, hq_color b);
hq_color hq_gradient(const hq_color *stops, size_t count, double t);
int hq_char_width(uint32_t cp);
size_t hq_text_width_n(const char *text, size_t length);
size_t hq_text_width(const char *text);

/* create/resize reject negative or excessive dimensions. resize is transactional
 * on allocation failure. Zero dimensions are valid. Each dimension <= 32768,
 * total cells <= 16,777,216. Destroy accepts NULL. */
hq_buffer *hq_buffer_create(int width, int height);
void hq_buffer_destroy(hq_buffer *buffer);
int hq_buffer_resize(hq_buffer *buffer, int width, int height);
int hq_buffer_width(const hq_buffer *buffer);
int hq_buffer_height(const hq_buffer *buffer);
size_t hq_buffer_allocations(const hq_buffer *buffer);
void hq_buffer_clear(hq_buffer *buffer, hq_color bg, hq_color fg);
int hq_buffer_cell(const hq_buffer *buffer, int x, int y, hq_cell *out);
const char *hq_buffer_cell_text(const hq_buffer *buffer, int x, int y, char scratch[5]);
int hq_buffer_set(hq_buffer *buffer, int x, int y, uint32_t cp, hq_style style);
size_t hq_buffer_write_n(hq_buffer *buffer, int x, int y, const char *text,
                         size_t length, hq_style style, size_t max_columns);
size_t hq_buffer_write(hq_buffer *buffer, int x, int y, const char *text,
                       hq_style style, size_t max_columns);
void hq_buffer_fill(hq_buffer *buffer, hq_rect rect, uint32_t cp, hq_style style);
void hq_buffer_style(hq_buffer *buffer, hq_rect rect, hq_style style);
int hq_buffer_copy(hq_buffer *destination, const hq_buffer *source);
/* Required byte count excluding NUL; safely truncates output to capacity-1. */
size_t hq_buffer_row(const hq_buffer *buffer, int row, char *out, size_t capacity);

typedef enum { HQ_CELLS, HQ_PERCENT, HQ_FR, HQ_AUTO, HQ_FILL } hq_size_kind;
typedef struct {
    hq_size_kind kind;
    double value;
    int min, max, intrinsic; /* max=-1 means unbounded */
} hq_constraint;
/* count <= 4096. Returns 0 on invalid input/allocation failure. */
int hq_solve(int total, const hq_constraint *items, size_t count, int gap, int *out);
int hq_stack(hq_rect rect, const hq_constraint *items, size_t count,
             int horizontal, int gap, hq_rect *out);
/* As above, with a gap per seam (count-1 of them) which may be negative.
 * A negative seam is how collapsed borders work: two panels overlap by the
 * column their borders share. `gaps` may be NULL when count < 2. */
int hq_solve_gaps(int total, const hq_constraint *items, size_t count,
                  const int *gaps, int *out);
int hq_stack_gaps(hq_rect rect, const hq_constraint *items, size_t count,
                  int horizontal, const int *gaps, hq_rect *out);

/* Where space the children leave over goes. It only applies when there is
 * slack: a container holding any fr or fill child has none, because that child
 * has already absorbed it. HQ_JUSTIFY_START is what every layout did before
 * this existed. */
typedef enum {
  HQ_JUSTIFY_START = 0,
  HQ_JUSTIFY_END,
  HQ_JUSTIFY_CENTER,
  HQ_JUSTIFY_SPACE_BETWEEN,
  HQ_JUSTIFY_SPACE_AROUND,
  HQ_JUSTIFY_SPACE_EVENLY
} hq_justify;

/* The offset before the first child, and the extra added at each of the
 * count-1 seams. `seams` may be NULL when count < 2. Returns 0 on bad input. */
int hq_distribute(int slack, size_t count, hq_justify justify, int *lead, int *seams);
int hq_stack_justified(hq_rect rect, const hq_constraint *items, size_t count,
                       int horizontal, const int *gaps, hq_justify justify, hq_rect *out);

/* colors: 0 (no color), 16, 256 or 16777216 (truecolor).
 * encode reuses output capacity; allocation failure invalidates terminal state.
 * It never writes to stdout. An unchanged frame produces zero bytes. */
hq_encoder *hq_encoder_create(int colors, int monochrome);
void hq_encoder_destroy(hq_encoder *encoder);
void hq_encoder_invalidate(hq_encoder *encoder);
size_t hq_encoder_allocations(const hq_encoder *encoder);
int hq_encode(hq_encoder *encoder, const hq_buffer *previous,
              const hq_buffer *next, int full, hq_encoded *out);

typedef struct {
    const char *name;
    int dark;
    hq_color background, surface, foreground, muted, primary, secondary, accent;
    hq_color success, warning, danger, info, border, border_focused, title;
    hq_color selection, selection_text, cursor;
    hq_color graph[8], heat[8];
    size_t graph_count, heat_count;
} hq_theme;
size_t hq_theme_count(void);
const hq_theme *hq_theme_at(size_t index);
const hq_theme *hq_theme_named(const char *name); /* NULL if unknown */
hq_color hq_heat(const hq_theme *theme, double value);
hq_color hq_series(const hq_theme *theme, size_t index);

/* Surfaces borrow their buffer and theme; both must outlive all their surfaces.
 * Surface creation, clipping, and text/box rendering do not allocate per frame
 * except when interning a new Unicode cluster in the buffer's bounded pool. */
typedef struct { hq_buffer *buffer; const hq_theme *theme; hq_rect rect, clip; } hq_surface;
typedef struct { hq_style style; int align, no_ellipsis, max_columns, has_max_columns; } hq_text_options;
enum { HQ_LEFT, HQ_CENTER, HQ_RIGHT };
enum { HQ_ROUNDED, HQ_SINGLE, HQ_DOUBLE, HQ_THICK, HQ_DASHED, HQ_ASCII, HQ_NO_BORDER };
/* Edge bits for a border glyph: 1 up, 2 right, 4 down, 8 left.
 *
 * Collapsing two panel borders is the union of their edges. A panel's
 * top-right corner (down + left) landing on its neighbour's top-left
 * (down + right) is down + left + right, which is the T that makes the two
 * read as one frame. */
enum { HQ_EDGE_UP = 1, HQ_EDGE_RIGHT = 2, HQ_EDGE_DOWN = 4, HQ_EDGE_LEFT = 8 };
/* The edges of a border glyph, or -1 when it is not one. */
int hq_border_bits(uint32_t cp);
/* The glyph in `border` with exactly these edges, or 0 if there is none. */
uint32_t hq_border_glyph(int border,int bits);
typedef struct {
    int border, title_align, no_fill;
    /* Merge this border with one already in the same cell rather than
     * overwriting it. Zero unless the caller asks for collapsed borders. */
    int collapse;
    hq_style border_style, title_style, subtitle_style, footer_style;
    hq_color background;
    int has_background;
    const char *title, *subtitle, *footer;
} hq_box_options;
hq_rect hq_intersect(hq_rect a,hq_rect b);
hq_rect hq_inset(hq_rect rect,int top,int right,int bottom,int left);
hq_surface hq_surface_root(hq_buffer *buffer,const hq_theme *theme);
hq_surface hq_surface_region(hq_surface parent,hq_rect absolute);
hq_surface hq_surface_sub(hq_surface parent,hq_rect local);
void hq_surface_set(hq_surface surface,int x,int y,uint32_t cp,hq_style style);
size_t hq_surface_text(hq_surface surface,int x,int y,const char *text,hq_text_options options);
void hq_surface_fill(hq_surface surface,uint32_t cp,hq_style style);
hq_surface hq_surface_box(hq_surface surface,hq_box_options options);

#ifdef __cplusplus
}
#endif
#endif
