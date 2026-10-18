#include "rn_gfx.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static bool compare(const char *a,const char *b) {
    FILE *left=fopen(a,"rb"),*right=fopen(b,"rb"); if(!left || !right) { if(left) fclose(left); if(right) fclose(right); return false; }
    int x,y; bool ok=true; size_t offset=0;
    while((x=fgetc(left))!=EOF) { y=fgetc(right); if(y==EOF || abs(x-y)>(offset>138 ? 2:0)) { ok=false; break; } offset++; }
    if(ok && fgetc(right)!=EOF) ok=false;
    fclose(left); fclose(right); return ok;
}
int main(int argc,char **argv) {
    if(argc!=4) return 2;
    rn_platform *p=rn_platform_create("gfx test",64,64,true,false); if(!p) { fprintf(stderr,"%s\n",rn_platform_error()); return 1; }
    rn_scene *scene=rn_scene_create(p); int status=1;
    if(!scene) goto done;
    int layer=rn_scene_node(scene,0,-1),rect=rn_scene_node(scene,1,-1);
    if(!rn_scene_set(scene,rect,"x",4,"") || !rn_scene_set(scene,rect,"y",4,"") || !rn_scene_set(scene,rect,"width",16,"") || !rn_scene_set(scene,rect,"height",16,"") || !rn_scene_set(scene,rect,"tint",0xff0000,"") || !rn_scene_attach(scene,layer,rect)) goto done;
    int w,h,texture=rn_scene_texture(scene,argv[3],&w,&h); if(texture<0 || w!=2 || h!=2) goto done;
    int sprite=rn_scene_node(scene,2,texture);
    rn_scene_set(scene,sprite,"x",24,""); rn_scene_set(scene,sprite,"y",8,""); rn_scene_set(scene,sprite,"width",16,""); rn_scene_set(scene,sprite,"height",16,""); rn_scene_attach(scene,layer,sprite);
    int text=rn_scene_node(scene,3,-1); rn_scene_set(scene,text,"text",0,"SDL3"); rn_scene_set(scene,text,"x",4,""); rn_scene_set(scene,text,"y",40,""); rn_scene_attach(scene,layer,text);
    if(!rn_scene_draw(scene,0x182028) || !rn_platform_screenshot(p,argv[2])) goto done;
    if(!strcmp(argv[1],"--record") || compare(argv[1],argv[2])) status=0;
    else fprintf(stderr,"Native scene differs from committed image: %s\n",argv[2]);
done:
    rn_scene_destroy(scene); rn_platform_destroy(p); return status;
}
