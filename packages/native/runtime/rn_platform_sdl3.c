#include "rn_platform.h"
#include <SDL3/SDL.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "stb_image.h"
struct rn_platform { SDL_Window *window; SDL_Renderer *renderer; SDL_Surface *surface; int width,height; char assets[4096]; };
const char *rn_platform_error(void) { return SDL_GetError(); }
double rn_platform_now(void) { return (double)SDL_GetTicksNS()/1000000.0; }
void rn_platform_delay(unsigned ms) { SDL_Delay(ms); }
rn_platform *rn_platform_create(const char *title,int width,int height,bool headless,bool resizable) {
    if(!SDL_Init(headless ? SDL_INIT_EVENTS : SDL_INIT_VIDEO|SDL_INIT_EVENTS)) return NULL;
    rn_platform *p=calloc(1,sizeof(*p)); if(!p) { SDL_Quit(); return NULL; }
    p->width=width; p->height=height;
#ifdef SDL_PLATFORM_ANDROID
    snprintf(p->assets,sizeof(p->assets),"assets");
#else
    const char *base=SDL_GetBasePath();
    snprintf(p->assets,sizeof(p->assets),"%sassets",base ? base:"");
#endif
    if(headless) {
        p->surface=SDL_CreateSurface(width,height,SDL_PIXELFORMAT_RGBA32);
        if(p->surface) p->renderer=SDL_CreateSoftwareRenderer(p->surface);
    } else {
        p->window=SDL_CreateWindow(title,width,height,resizable ? SDL_WINDOW_RESIZABLE : 0);
        if(p->window) p->renderer=SDL_CreateRenderer(p->window,NULL);
    }
    if(!p->renderer) { rn_platform_destroy(p); return NULL; }
    SDL_SetRenderDrawBlendMode(p->renderer,SDL_BLENDMODE_BLEND);
    return p;
}
void rn_platform_destroy(rn_platform *p) {
    if(!p) return;
    SDL_DestroyRenderer(p->renderer); SDL_DestroySurface(p->surface); SDL_DestroyWindow(p->window); free(p); SDL_Quit();
}
const char *rn_platform_assets(rn_platform *p) { return p->assets; }
void rn_platform_size(rn_platform *p,int *w,int *h) { SDL_GetRenderOutputSize(p->renderer,w,h); p->width=*w; p->height=*h; }
void rn_platform_safe_area(rn_platform *p,int *left,int *top,int *right,int *bottom) {
    *left=*top=*right=*bottom=0;
    if(p->window) { SDL_Rect rect; int w,h; rn_platform_size(p,&w,&h); if(SDL_GetWindowSafeArea(p->window,&rect)) { *left=rect.x; *top=rect.y; *right=w-rect.x-rect.w; *bottom=h-rect.y-rect.h; } }
}
static void key_names(const SDL_KeyboardEvent *event,rn_event *out) {
    const char *name=SDL_GetKeyName(event->key);
    snprintf(out->key,sizeof(out->key),"%s",name);
    if(event->key>=SDLK_A && event->key<=SDLK_Z) { out->key[0]=(char)event->key; out->key[1]=0; }
    switch(event->key) {
    case SDLK_LEFT: name="ArrowLeft"; break; case SDLK_RIGHT: name="ArrowRight"; break;
    case SDLK_UP: name="ArrowUp"; break; case SDLK_DOWN: name="ArrowDown"; break;
    case SDLK_SPACE: name=" "; break; case SDLK_RETURN: name="Enter"; break;
    case SDLK_ESCAPE: name="Escape"; break; default: name=out->key; break;
    }
    if(name!=out->key) snprintf(out->key,sizeof(out->key),"%s",name);
    if(event->scancode>=SDL_SCANCODE_A && event->scancode<=SDL_SCANCODE_Z) snprintf(out->code,sizeof(out->code),"Key%c",'A'+event->scancode-SDL_SCANCODE_A);
    else if(event->scancode>=SDL_SCANCODE_1 && event->scancode<=SDL_SCANCODE_9) snprintf(out->code,sizeof(out->code),"Digit%d",1+event->scancode-SDL_SCANCODE_1);
    else if(event->scancode==SDL_SCANCODE_0) snprintf(out->code,sizeof(out->code),"Digit0");
    else if(event->scancode==SDL_SCANCODE_SPACE) snprintf(out->code,sizeof(out->code),"Space");
    else snprintf(out->code,sizeof(out->code),"%s",out->key);
}
bool rn_platform_poll(rn_platform *p,rn_event *out) {
    SDL_Event event;
    while(SDL_PollEvent(&event)) {
        memset(out,0,sizeof(*out)); out->pointer_type="mouse";
        switch(event.type) {
        case SDL_EVENT_QUIT: out->type="quit"; return true;
        case SDL_EVENT_WINDOW_FOCUS_LOST: out->type="blur"; return true;
        case SDL_EVENT_WILL_ENTER_BACKGROUND: out->type="pause"; return true;
        case SDL_EVENT_DID_ENTER_FOREGROUND: out->type="resume"; return true;
        case SDL_EVENT_KEY_DOWN: case SDL_EVENT_KEY_UP:
            out->type=event.type==SDL_EVENT_KEY_DOWN ? "keydown":"keyup"; out->repeat=event.key.repeat; key_names(&event.key,out); return true;
        case SDL_EVENT_MOUSE_MOTION: out->type="pointermove"; out->x=event.motion.x; out->y=event.motion.y; out->pointer=1; return true;
        case SDL_EVENT_MOUSE_BUTTON_DOWN: case SDL_EVENT_MOUSE_BUTTON_UP:
            out->type=event.type==SDL_EVENT_MOUSE_BUTTON_DOWN ? "pointerdown":"pointerup";
            out->x=event.button.x; out->y=event.button.y; out->pointer=1;
            out->button=event.button.button==SDL_BUTTON_RIGHT ? 2 : event.button.button==SDL_BUTTON_MIDDLE ? 1:0; return true;
        case SDL_EVENT_FINGER_DOWN: case SDL_EVENT_FINGER_UP: case SDL_EVENT_FINGER_MOTION:
            out->type=event.type==SDL_EVENT_FINGER_DOWN ? "pointerdown":event.type==SDL_EVENT_FINGER_UP ? "pointerup":"pointermove";
            out->pointer_type="touch"; out->pointer=event.tfinger.fingerID; out->x=event.tfinger.x*p->width; out->y=event.tfinger.y*p->height; return true;
        default: break;
        }
    }
    return false;
}
static void color(SDL_Renderer *r,uint32_t value,double alpha) { SDL_SetRenderDrawColor(r,(Uint8)(value>>16),(Uint8)(value>>8),(Uint8)value,(Uint8)(255.0*alpha)); }
void rn_platform_begin(rn_platform *p,uint32_t value) { color(p->renderer,value,1.0); SDL_RenderClear(p->renderer); }
bool rn_platform_draw(rn_platform *p,const rn_draw *d) {
    color(p->renderer,d->tint,d->alpha);
    if(d->text) return SDL_RenderDebugText(p->renderer,(float)d->x,(float)d->y,d->text);
    SDL_FRect dst={(float)(d->x-d->w*d->anchor_x),(float)(d->y-d->h*d->anchor_y),(float)d->w,(float)d->h};
    if(d->textured) {
        SDL_Texture *texture=d->texture;
        SDL_SetTextureColorMod(texture,(Uint8)(d->tint>>16),(Uint8)(d->tint>>8),(Uint8)d->tint);
        SDL_SetTextureAlphaMod(texture,(Uint8)(255.0*d->alpha));
        SDL_FRect src={(float)d->sx,(float)d->sy,(float)d->sw,(float)d->sh};
        SDL_FPoint center={(float)(d->w*d->anchor_x),(float)(d->h*d->anchor_y)};
        return SDL_RenderTextureRotated(p->renderer,texture,d->sw>0 ? &src:NULL,&dst,d->rotation,&center,SDL_FLIP_NONE);
    }
    return SDL_RenderFillRect(p->renderer,&dst);
}
void rn_platform_present(rn_platform *p) { SDL_RenderPresent(p->renderer); }
void *rn_platform_texture(rn_platform *p,const char *path,int *w,int *h) {
    int channels; size_t length=0; void *file=SDL_LoadFile(path,&length);
    unsigned char *pixels=file && length<=2147483647 ? stbi_load_from_memory(file,(int)length,w,h,&channels,4):NULL;
    SDL_free(file);
    if(!pixels) { SDL_SetError("Load PNG %s: %s",path,stbi_failure_reason() ? stbi_failure_reason():SDL_GetError()); return NULL; }
    SDL_Surface *surface=SDL_CreateSurfaceFrom(*w,*h,SDL_PIXELFORMAT_RGBA32,pixels,*w*4);
    SDL_Texture *texture=surface ? SDL_CreateTextureFromSurface(p->renderer,surface):NULL;
    SDL_DestroySurface(surface); stbi_image_free(pixels);
    if(texture) SDL_SetTextureScaleMode(texture,SDL_SCALEMODE_NEAREST);
    return texture;
}
void rn_platform_texture_destroy(void *texture) { SDL_DestroyTexture(texture); }
bool rn_platform_screenshot(rn_platform *p,const char *path) {
    SDL_Surface *surface=SDL_RenderReadPixels(p->renderer,NULL);
    if(!surface) return false;
    bool ok=SDL_SaveBMP(surface,path); SDL_DestroySurface(surface); return ok;
}
