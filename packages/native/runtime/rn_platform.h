#ifndef RN_PLATFORM_H
#define RN_PLATFORM_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
typedef struct rn_platform rn_platform;
typedef struct { const char *type; char key[64], code[64]; bool repeat; double x,y; int button; int64_t pointer; const char *pointer_type; } rn_event;
typedef struct { double x,y,w,h,rotation,anchor_x,anchor_y; uint32_t tint; double alpha; bool textured; double sx,sy,sw,sh; const char *text; void *texture; } rn_draw;
rn_platform *rn_platform_create(const char *title,int width,int height,bool headless,bool resizable);
void rn_platform_destroy(rn_platform *p);
const char *rn_platform_error(void);
double rn_platform_now(void);
void rn_platform_delay(unsigned ms);
bool rn_platform_poll(rn_platform *p,rn_event *event);
const char *rn_platform_assets(rn_platform *p);
void rn_platform_safe_area(rn_platform *p,int *left,int *top,int *right,int *bottom);
void rn_platform_size(rn_platform *p,int *w,int *h);
void rn_platform_begin(rn_platform *p,uint32_t color);
bool rn_platform_draw(rn_platform *p,const rn_draw *draw);
void rn_platform_present(rn_platform *p);
void *rn_platform_texture(rn_platform *p,const char *path,int *w,int *h);
void rn_platform_texture_destroy(void *texture);
bool rn_platform_screenshot(rn_platform *p,const char *path);
#endif
