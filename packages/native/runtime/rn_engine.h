#ifndef RN_ENGINE_H
#define RN_ENGINE_H
#include "rn_gfx.h"
#include <stdio.h>
typedef struct rn_engine rn_engine;
rn_engine *rn_engine_create(rn_platform *platform,rn_scene *scene,const char *assets);
void rn_engine_destroy(rn_engine *engine);
bool rn_engine_load(rn_engine *engine,const char *source,bool headless,const char *input,int width,int height);
bool rn_engine_frame(rn_engine *engine,double delta_ms);
bool rn_engine_event(rn_engine *engine,const rn_event *event);
bool rn_engine_snapshot(rn_engine *engine,FILE *out);
bool rn_engine_failed(rn_engine *engine);
#endif
