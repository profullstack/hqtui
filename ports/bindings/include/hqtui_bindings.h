#ifndef HQTUI_BINDINGS_H
#define HQTUI_BINDINGS_H
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Experimental ABI 1. Opaque handles, primitive arguments, no callbacks into a
 * language runtime. Each scene belongs to one thread. All exceptions stop here.
 * Output/error strings are borrowed until the next operation on that thread or
 * scene. Copy them before calling again. NULL destroy is safe; other handles
 * must be live values returned by create. Never destroy a handle twice.
 */
typedef struct hqb_scene hqb_scene;
int hqb_abi_version(void);
const char *hqb_error(void);
hqb_scene *hqb_create(int width, int height, const char *theme);
void hqb_destroy(hqb_scene *scene);
/* JSON scene is parsed once per update. At most 1 MiB, 4096 nodes, depth 32.
 * A rejected update leaves the last valid scene intact. See PROTOCOL.md. */
int hqb_set(hqb_scene *scene, const char *json, size_t length);
int hqb_resize(hqb_scene *scene, int width, int height);
/* text, ansi (full frame), diff (against last rendered frame), hashes (tests).
 */
const char *hqb_render(hqb_scene *scene, const char *format);
/* Render a shared deterministic demo body at the scene's size/theme. */
const char *hqb_demo_frame(hqb_scene *scene, const char *screen,
                           const char *format);
/* Optional native terminal transport for custom language applications.
 * One terminal/demo per process; close/destroy restores it. poll returns a
 * copied raw UTF-8/escape byte chunk (possibly empty); NULL means failure.
 * Applications handle keys in their own runtime. present updates terminal size.
 */
int hqb_open(hqb_scene *scene);
int hqb_present(hqb_scene *scene);
const char *hqb_poll(hqb_scene *scene, int timeout_ms);
int hqb_interrupted(void);
void hqb_close(hqb_scene *scene);
/* Shared ten-screen demo executes INSIDE the calling VM, never execs another
 * demo. JSON is an array of CLI argument strings; returns the demo exit status.
 * It owns the terminal for the duration and restores signal handlers on exit.
 */
int hqb_demo(const char *arguments, size_t length);
#ifdef __cplusplus
}
#endif
#endif
