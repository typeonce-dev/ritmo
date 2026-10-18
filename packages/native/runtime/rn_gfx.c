#include "rn_gfx.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
typedef struct { bool alive,visible; int kind,texture,layer; size_t order; rn_draw draw; double scale_x,scale_y; char *text; } rn_node;
typedef struct { int id,layer; size_t order; } rn_draw_item;
struct rn_scene { rn_platform *platform; rn_node *nodes; size_t count,capacity,order; void **textures; size_t texture_count; rn_draw_item *draws; size_t draw_count; bool dirty; };
rn_scene *rn_scene_create(rn_platform *platform) { rn_scene *s=calloc(1,sizeof(*s)); if(s) s->platform=platform; return s; }
void rn_scene_destroy(rn_scene *s) {
    if(!s) return;
    for(size_t i=0;i<s->count;i++) free(s->nodes[i].text);
    for(size_t i=0;i<s->texture_count;i++) rn_platform_texture_destroy(s->textures[i]);
    free(s->nodes); free(s->textures); free(s->draws); free(s);
}
static rn_node *node(rn_scene *s,int id) { return id>=0 && (size_t)id<s->count && s->nodes[id].alive ? &s->nodes[id]:NULL; }
int rn_scene_node(rn_scene *s,int kind,int texture) {
    if(kind<0 || kind>3 || (kind==2 && (texture<0 || (size_t)texture>=s->texture_count || !s->textures[texture]))) return -1;
    if(s->count==s->capacity) { size_t capacity=s->capacity ? s->capacity*2:64; rn_node *nodes=realloc(s->nodes,capacity*sizeof(*nodes)); if(!nodes) return -1; s->nodes=nodes; s->capacity=capacity; }
    s->dirty=true; size_t id=s->count++; rn_node *n=&s->nodes[id]; memset(n,0,sizeof(*n));
    n->alive=true; n->visible=true; n->kind=kind; n->texture=texture; n->layer=-1; n->scale_x=n->scale_y=1;
    n->draw.tint=0xffffff; n->draw.alpha=1; return (int)id;
}
bool rn_scene_set(rn_scene *s,int id,const char *field,double value,const char *text) {
    rn_node *n=node(s,id); if(!n) return false;
    if(!strcmp(field,"text")) { size_t length=strlen(text); char *copy=malloc(length+1); if(!copy) return false; memcpy(copy,text,length+1); free(n->text); n->text=copy; return true; }
    if(!strcmp(field,"x")) n->draw.x=value;
    else if(!strcmp(field,"y")) n->draw.y=value;
    else if(!strcmp(field,"width")) n->draw.w=value;
    else if(!strcmp(field,"height")) n->draw.h=value;
    else if(!strcmp(field,"scaleX")) n->scale_x=value;
    else if(!strcmp(field,"scaleY")) n->scale_y=value;
    else if(!strcmp(field,"rotation")) n->draw.rotation=value*180.0/3.14159265358979323846;
    else if(!strcmp(field,"anchorX")) n->draw.anchor_x=value;
    else if(!strcmp(field,"anchorY")) n->draw.anchor_y=value;
    else if(!strcmp(field,"tint")) n->draw.tint=(uint32_t)value;
    else if(!strcmp(field,"alpha")) n->draw.alpha=value;
    else if(!strcmp(field,"visible")) n->visible=value!=0;
    else return false;
    return true;
}
bool rn_scene_frame(rn_scene *s,int id,double x,double y,double w,double h) { rn_node *n=node(s,id); if(!n) return false; n->draw.sx=x; n->draw.sy=y; n->draw.sw=w; n->draw.sh=h; return true; }
bool rn_scene_attach(rn_scene *s,int layer,int id) { rn_node *n=node(s,id); if(!n || (layer!=-1 && (!node(s,layer) || s->nodes[layer].kind!=0))) return false; n->layer=layer; n->order=++s->order; s->dirty=true; return true; }
bool rn_scene_remove(rn_scene *s,int id) { rn_node *n=node(s,id); if(!n) return false; n->alive=false; s->dirty=true; free(n->text); n->text=NULL; for(size_t i=0;i<s->count;i++) if(s->nodes[i].layer==id) rn_scene_remove(s,(int)i); return true; }
int rn_scene_texture(rn_scene *s,const char *path,int *w,int *h) {
    void *texture=rn_platform_texture(s->platform,path,w,h); if(!texture) return -1;
    void **textures=realloc(s->textures,(s->texture_count+1)*sizeof(*textures)); if(!textures) { rn_platform_texture_destroy(texture); return -1; }
    s->textures=textures; size_t id=s->texture_count++; s->textures[id]=texture; return (int)id;
}
bool rn_scene_free_texture(rn_scene *s,int id) { if(id<0 || (size_t)id>=s->texture_count || !s->textures[id]) return false; rn_platform_texture_destroy(s->textures[id]); s->textures[id]=NULL; return true; }
static int draw_order(const void *a,const void *b) {
    const rn_draw_item *left=a,*right=b;
    if(left->layer!=right->layer) return left->layer<right->layer ? -1:1;
    return left->order<right->order ? -1:left->order>right->order ? 1:0;
}
bool rn_scene_draw(rn_scene *s,uint32_t background) {
    if(s->dirty) {
        rn_draw_item *draws=realloc(s->draws,(s->count+1)*sizeof(*draws)); if(!draws) return false;
        s->draws=draws; s->draw_count=0;
        for(size_t i=0;i<s->count;i++) { rn_node *n=&s->nodes[i]; if(n->alive && n->kind!=0 && n->layer>=0) s->draws[s->draw_count++]=(rn_draw_item){(int)i,n->layer,n->order}; }
        qsort(s->draws,s->draw_count,sizeof(*draws),draw_order); s->dirty=false;
    }
    rn_platform_begin(s->platform,background);
    for(size_t i=0;i<s->draw_count;i++) {
        rn_draw_item item=s->draws[i]; rn_node *next=&s->nodes[item.id],*layer=&s->nodes[item.layer];
        if(!next->visible || !layer->alive || !layer->visible) continue;
        rn_draw d=next->draw; d.x+=layer->draw.x; d.y+=layer->draw.y; d.w*=next->scale_x; d.h*=next->scale_y;
        d.text=next->kind==3 ? (next->text ? next->text:""):NULL; d.textured=next->kind==2;
        if(d.textured) { d.texture=s->textures[next->texture]; if(!d.texture) return false; }
        if(!rn_platform_draw(s->platform,&d)) return false;
    }
    return true;
}
