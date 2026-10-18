#include "rn_engine.h"
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef RN_APP_NAME
#define RN_APP_NAME "Ritmo"
#endif
#ifndef RN_WIDTH
#define RN_WIDTH 1280
#endif
#ifndef RN_HEIGHT
#define RN_HEIGHT 720
#endif
static char *read_file(const char *path) {
    FILE *file=fopen(path,"rb"); if(!file) return NULL;
    if(fseek(file,0,SEEK_END)) { fclose(file); return NULL; }
    long length=ftell(file); rewind(file); char *data=length>=0 ? malloc((size_t)length+1):NULL;
    if(!data || fread(data,1,(size_t)length,file)!=(size_t)length) { free(data); fclose(file); return NULL; }
    data[length]=0; fclose(file); return data;
}
#ifndef RN_ENTRY
#define RN_ENTRY main
#endif
int RN_ENTRY(int argc,char **argv) {
    bool headless=false; int frames=-1; const char *input_path=NULL,*snapshots=NULL,*screenshot=NULL,*source=NULL,*assets=NULL;
    for(int i=1;i<argc;i++) {
        if(!strcmp(argv[i],"--headless")) headless=true;
        else if(!strcmp(argv[i],"--help")) { puts("Ritmo native: --headless --frames N --input timeline.json --snapshots out.jsonl --screenshot out.bmp --assets directory --bundle game.js"); return 0; }
        else if(i+1<argc) {
            const char *flag=argv[i],*value=argv[++i];
            if(!strcmp(flag,"--frames")) { char *end; errno=0; long parsed=strtol(value,&end,10); if(errno || *end || parsed<0 || parsed>INT_MAX) { fprintf(stderr,"--frames requires a non-negative integer\n"); return 2; } frames=(int)parsed; }
            else if(!strcmp(flag,"--input")) input_path=value;
            else if(!strcmp(flag,"--snapshots")) snapshots=value;
            else if(!strcmp(flag,"--screenshot")) screenshot=value;
            else if(!strcmp(flag,"--bundle")) source=value;
            else if(!strcmp(flag,"--assets")) assets=value;
            else { fprintf(stderr,"Unknown option %s; run --help\n",flag); return 2; }
        } else { fprintf(stderr,"Unknown or incomplete option %s; run --help\n",argv[i]); return 2; }
    }
    if(headless && frames<0) frames=600;
    char *input=input_path ? read_file(input_path):NULL;
    if(input_path && !input) { fprintf(stderr,"Read --input file %s\n",input_path); return 2; }
    FILE *out=snapshots ? fopen(snapshots,"wb"):NULL;
    if(snapshots && !out) { fprintf(stderr,"Create --snapshots file %s\n",snapshots); free(input); return 2; }
    int status=1; rn_platform *platform=rn_platform_create(RN_APP_NAME,RN_WIDTH,RN_HEIGHT,headless,true);
    rn_scene *scene=platform ? rn_scene_create(platform):NULL;
    rn_engine *engine=scene ? rn_engine_create(platform,scene,assets ? assets:rn_platform_assets(platform)):NULL;
    if(!engine) { fprintf(stderr,"Create native host: %s\n",rn_platform_error()); goto done; }
    if(!rn_engine_load(engine,source,headless,input ? input:"[]",RN_WIDTH,RN_HEIGHT)) goto done;
    double previous=rn_platform_now(); bool quit=false;
    for(int frame=0;!quit && (frames<0 || frame<frames);frame++) {
        rn_event event;
        while(rn_platform_poll(platform,&event)) {
            if(!strcmp(event.type,"quit")) quit=true;
            else if(!rn_engine_event(engine,&event)) goto done;
        }
        if(quit) break;
        double now=rn_platform_now(); double delta=headless ? 1000.0/60.0:now-previous; previous=now;
        if(!rn_engine_frame(engine,delta)) goto done;
        if(out && !rn_engine_snapshot(engine,out)) goto done;
        if(screenshot && frames>=0 && frame==frames-1 && !rn_platform_screenshot(platform,screenshot)) { fprintf(stderr,"Save screenshot: %s\n",rn_platform_error()); goto done; }
        rn_platform_present(platform);
        if(!headless) rn_platform_delay(1);
    }
    status=rn_engine_failed(engine) ? 1:0;
done:
    rn_engine_destroy(engine); rn_scene_destroy(scene); rn_platform_destroy(platform); free(input);
    if(out && fclose(out)) status=1;
    return status;
}
