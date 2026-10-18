#ifndef RN_GFX_H
#define RN_GFX_H
#include "rn_platform.h"
typedef struct rn_scene rn_scene;
rn_scene *rn_scene_create(rn_platform *platform);
void rn_scene_destroy(rn_scene *scene);
int rn_scene_node(rn_scene *scene,int kind,int texture);
bool rn_scene_set(rn_scene *scene,int id,const char *field,double value,const char *text);
bool rn_scene_frame(rn_scene *scene,int id,double x,double y,double w,double h);
bool rn_scene_remove(rn_scene *scene,int id);
bool rn_scene_attach(rn_scene *scene,int layer,int id);
int rn_scene_texture(rn_scene *scene,const char *path,int *w,int *h);
bool rn_scene_free_texture(rn_scene *scene,int id);
bool rn_scene_draw(rn_scene *scene,uint32_t background);
#endif
