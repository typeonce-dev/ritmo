#include "rn_engine.h"
#include "quickjs.h"
#include "rn_kernel.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
extern const uint8_t rn_bundle[];
extern const uint32_t rn_bundle_size;
struct rn_engine { JSRuntime *runtime; JSContext *context; JSValue control; JSClassID journal_class; rn_platform *platform; rn_scene *scene; const char *assets; bool failed; uint64_t kernel_runs; };
static bool exception(rn_engine *e,JSValue value) {
    if(!JS_IsException(value)) return false;
    JSValue error=JS_GetException(e->context); const char *message=JS_ToCString(e->context,error);
    fprintf(stderr,"ritmo-native: %s\n",message ? message:"JavaScript exception"); JS_FreeCString(e->context,message);
    JSValue stack=JS_GetPropertyStr(e->context,error,"stack"); const char *trace=JS_ToCString(e->context,stack);
    if(trace) fprintf(stderr,"%s\n",trace);
    JS_FreeCString(e->context,trace); JS_FreeValue(e->context,stack); JS_FreeValue(e->context,error); e->failed=true; return true;
}
typedef struct { rn_journal journal; JSValue views,resources; bool released; } rn_js_journal;
static void journal_finalizer(JSRuntime *rt,JSValue value) {
    rn_engine *e=JS_GetRuntimeOpaque(rt); rn_js_journal *j=JS_GetOpaque(value,e->journal_class);
    if(!j) return;
    if(!j->released) { rn_journal_rollback(&j->journal); rn_journal_release(&j->journal); }
    JS_FreeValueRT(rt,j->views); JS_FreeValueRT(rt,j->resources); free(j);
}
static JSValue journal_method(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv,int magic) {
    (void)argc; (void)argv; rn_engine *e=JS_GetContextOpaque(ctx); rn_js_journal *j=JS_GetOpaque2(ctx,self,e->journal_class);
    if(!j) return JS_EXCEPTION;
    if(j->released) return JS_ThrowInternalError(ctx,"Native journal already released");
    if(magic==0) { /* tick is retained on the journal's own object. */
        JSValue tick=JS_GetPropertyStr(ctx,self,"tick"); int32_t value; JS_ToInt32(ctx,&value,tick); JS_FreeValue(ctx,tick); rn_journal_commit(&j->journal,value);
    } else if(magic==1) rn_journal_rollback(&j->journal);
    else { rn_journal_release(&j->journal); j->released=true; JS_FreeValue(ctx,j->views); JS_FreeValue(ctx,j->resources); j->views=j->resources=JS_UNDEFINED; }
    return JS_UNDEFINED;
}
static void *typed_pointer(JSContext *ctx,JSValueConst value,int kind,size_t *length) {
    if(JS_GetTypedArrayType(value)!=kind) { JS_ThrowTypeError(ctx,"Native kernel received an incompatible typed array; rebuild bundle and binary together"); return NULL; }
    size_t offset,bytes,element_size,buffer_size;
    JSValue buffer=JS_GetTypedArrayBuffer(ctx,value,&offset,&bytes,&element_size);
    if(JS_IsException(buffer)) return NULL;
    uint8_t *data=JS_GetArrayBuffer(ctx,&buffer_size,buffer); JS_FreeValue(ctx,buffer);
    *length=element_size ? bytes/element_size:0;
    return data ? data+offset:NULL;
}
static JSValue run_kernel(JSContext *ctx,int argc,JSValueConst *argv) {
    rn_engine *e=JS_GetContextOpaque(ctx);
    if(argc!=6) return JS_ThrowTypeError(ctx,"Kernel ABI requires id, layout hash, query views, resources and tick");
    int32_t id,tick; if(JS_ToInt32(ctx,&id,argv[1]) || JS_ToInt32(ctx,&tick,argv[5])) return JS_EXCEPTION;
    if(id<0 || (size_t)id>=rn_kernel_count) return JS_ThrowRangeError(ctx,"Kernel id is stale; rebuild the native binary");
    const rn_kernel_entry *entry=&rn_kernels[id]; const char *hash=JS_ToCString(ctx,argv[2]);
    bool valid=hash && !strcmp(hash,entry->hash); JS_FreeCString(ctx,hash);
    if(!valid) return JS_ThrowInternalError(ctx,"Kernel layout hash mismatch; rebuild the native binary and bundle together");
    JSValue length_value=JS_GetPropertyStr(ctx,argv[3],"length"); int32_t query_count; JS_ToInt32(ctx,&query_count,length_value); JS_FreeValue(ctx,length_value);
    if(query_count!=entry->query_count) return JS_ThrowTypeError(ctx,"Kernel query count mismatch; rebuild the bundle");
    rn_query_view *views=calloc((size_t)query_count,sizeof(*views)); rn_js_journal *journal=calloc(1,sizeof(*journal));
    if(!views || !journal) { free(views); free(journal); return JS_ThrowOutOfMemory(ctx); }
    journal->views=JS_DupValue(ctx,argv[3]); journal->resources=JS_DupValue(ctx,argv[4]);
    JSValue result=JS_EXCEPTION; size_t resource_count=0;
    const double *resources=typed_pointer(ctx,argv[4],JS_TYPED_ARRAY_FLOAT64,&resource_count);
    if(resource_count!=(size_t)entry->resource_count || (resource_count && !resources)) goto cleanup;
    for(int i=0;i<query_count;i++) {
        JSValue view=JS_GetPropertyUint32(ctx,argv[3],(uint32_t)i);
        JSValue count_value=JS_GetPropertyStr(ctx,view,"count"); JS_ToInt32(ctx,&views[i].count,count_value); JS_FreeValue(ctx,count_value);
        JSValue slots_value=JS_GetPropertyStr(ctx,view,"slots"); size_t slot_count=0;
        views[i].slots=typed_pointer(ctx,slots_value,JS_TYPED_ARRAY_INT32,&slot_count); JS_FreeValue(ctx,slots_value);
        if(views[i].count<0 || (size_t)views[i].count>slot_count || (slot_count && !views[i].slots)) { JS_FreeValue(ctx,view); goto cleanup; }
        int32_t maximum=-1; for(int32_t s=0;s<views[i].count;s++) { int32_t slot=views[i].slots[s]; if(slot<0) { JS_FreeValue(ctx,view); goto cleanup; } if(slot>maximum) maximum=slot; }
        views[i].columns=calloc((size_t)entry->columns[i]+1,sizeof(double*)); views[i].marks=calloc((size_t)entry->marks[i]+1,sizeof(int32_t*));
        if(!views[i].columns || !views[i].marks) { JS_FreeValue(ctx,view); goto cleanup; }
        JSValue cols=JS_GetPropertyStr(ctx,view,"columns"), marks=JS_GetPropertyStr(ctx,view,"marks");
        for(int c=0;c<entry->columns[i];c++) {
            JSValue array=JS_GetPropertyUint32(ctx,cols,(uint32_t)c); size_t length=0;
            ((double**)views[i].columns)[c]=typed_pointer(ctx,array,JS_TYPED_ARRAY_FLOAT64,&length); JS_FreeValue(ctx,array);
            if(maximum>=0 && ((size_t)maximum>=length || !views[i].columns[c])) valid=false;
        }
        for(int m=0;m<entry->marks[i];m++) {
            JSValue array=JS_GetPropertyUint32(ctx,marks,(uint32_t)m); size_t length=0;
            ((int32_t**)views[i].marks)[m]=typed_pointer(ctx,array,JS_TYPED_ARRAY_INT32,&length); JS_FreeValue(ctx,array);
            if(maximum>=0 && ((size_t)maximum*3+1>=length || !views[i].marks[m])) valid=false;
        }
        JS_FreeValue(ctx,cols); JS_FreeValue(ctx,marks); JS_FreeValue(ctx,view);
        if(!valid) goto cleanup;
    }
    if(JS_HasException(ctx)) goto cleanup;
    {
        rn_kernel_args args={views,resources,tick,&journal->journal,0}; entry->fn(&args); e->kernel_runs++;
        if(args.failed) { rn_journal_rollback(&journal->journal); JS_ThrowInternalError(ctx,"Native kernel allocation failed; reduce entity count or increase memory"); goto cleanup; }
    }
    result=JS_NewObjectClass(ctx,e->journal_class);
    if(JS_IsException(result)) { rn_journal_rollback(&journal->journal); goto cleanup; }
    JS_SetOpaque(result,journal); journal=NULL;
    JS_SetPropertyStr(ctx,result,"tick",JS_NewInt32(ctx,tick));
    JS_SetPropertyStr(ctx,result,"commit",JS_NewCFunctionMagic(ctx,journal_method,"commit",0,JS_CFUNC_generic_magic,0));
    JS_SetPropertyStr(ctx,result,"rollback",JS_NewCFunctionMagic(ctx,journal_method,"rollback",0,JS_CFUNC_generic_magic,1));
    JS_SetPropertyStr(ctx,result,"release",JS_NewCFunctionMagic(ctx,journal_method,"release",0,JS_CFUNC_generic_magic,2));
cleanup:
    for(int i=0;i<query_count;i++) { free((void*)views[i].columns); free((void*)views[i].marks); } free(views);
    if(journal) { rn_journal_release(&journal->journal); JS_FreeValue(ctx,journal->views); JS_FreeValue(ctx,journal->resources); free(journal); }
    if(JS_IsException(result) && !JS_HasException(ctx)) return JS_ThrowTypeError(ctx,"Native kernel buffer layout is invalid; rebuild the native bundle");
    return result;
}
static JSValue bridge(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    (void)self; rn_engine *e=JS_GetContextOpaque(ctx);
    if(argc<1) return JS_ThrowTypeError(ctx,"Native bridge operation is required");
    const char *op=JS_ToCString(ctx,argv[0]); if(!op) return JS_EXCEPTION;
    double a[6]={0}; for(int i=1;i<argc && i<=6;i++) if(JS_IsNumber(argv[i])) JS_ToFloat64(ctx,&a[i-1],argv[i]);
    JSValue result=JS_UNDEFINED; bool ok=true;
    if(!strcmp(op,"kernel")) { JS_FreeCString(ctx,op); return run_kernel(ctx,argc,argv); }
    if(!strcmp(op,"kernelsEnabled")) { const char *mode=getenv("RITMO_NATIVE_KERNELS"); result=JS_NewBool(ctx,(!mode || strcmp(mode,"off")) && rn_kernel_count>0); }
    else if(!strcmp(op,"now")) result=JS_NewFloat64(ctx,rn_platform_now());
    else if(!strcmp(op,"width") || !strcmp(op,"height")) { int w,h; rn_platform_size(e->platform,&w,&h); result=JS_NewInt32(ctx,!strcmp(op,"width") ? w:h); }
    else if(!strncmp(op,"safe",4)) { int left,top,right,bottom; rn_platform_safe_area(e->platform,&left,&top,&right,&bottom); result=JS_NewInt32(ctx,!strcmp(op,"safeLeft") ? left:!strcmp(op,"safeTop") ? top:!strcmp(op,"safeRight") ? right:bottom); }
    else if(!strcmp(op,"node")) { int id=rn_scene_node(e->scene,(int)a[0],(int)a[1]); ok=id>=0; result=JS_NewInt32(ctx,id); }
    else if(!strcmp(op,"set") && argc>=4) {
        const char *field=JS_ToCString(ctx,argv[2]); const char *text=JS_IsString(argv[3]) ? JS_ToCString(ctx,argv[3]):NULL;
        ok=field && rn_scene_set(e->scene,(int)a[0],field,a[2],text ? text:""); JS_FreeCString(ctx,text); JS_FreeCString(ctx,field);
    }
    else if(!strcmp(op,"frame")) ok=rn_scene_frame(e->scene,(int)a[0],a[1],a[2],a[3],a[4]);
    else if(!strcmp(op,"attach")) ok=rn_scene_attach(e->scene,(int)a[0],(int)a[1]);
    else if(!strcmp(op,"remove")) ok=rn_scene_remove(e->scene,(int)a[0]);
    else if(!strcmp(op,"freeTexture")) ok=rn_scene_free_texture(e->scene,(int)a[0]);
    else if(!strcmp(op,"draw")) ok=rn_scene_draw(e->scene,(uint32_t)a[0]);
    else if(!strcmp(op,"texture") && argc>=2) {
        const char *name=JS_ToCString(ctx,argv[1]); char path[4096]; int w=0,h=0;
        int length=name ? snprintf(path,sizeof(path),"%s/%s",e->assets,name):-1;
        int id=length>=0 && (size_t)length<sizeof(path) ? rn_scene_texture(e->scene,path,&w,&h):-1;
        JS_FreeCString(ctx,name); ok=id>=0; result=JS_NewObject(ctx);
        JS_SetPropertyStr(ctx,result,"id",JS_NewInt32(ctx,id)); JS_SetPropertyStr(ctx,result,"width",JS_NewInt32(ctx,w)); JS_SetPropertyStr(ctx,result,"height",JS_NewInt32(ctx,h));
    }
    else if(!strcmp(op,"fail") && argc>=2) {
        const char *message=JS_ToCString(ctx,argv[1]); e->failed=true;
        result=JS_ThrowInternalError(ctx,"%s",message ? message:"Game failed"); JS_FreeCString(ctx,message);
    }
    else ok=false;
    JS_FreeCString(ctx,op);
    if(!ok) { JS_FreeValue(ctx,result); return JS_ThrowInternalError(ctx,"Native operation failed: %s. Check node lifetime, assets and arguments.",rn_platform_error()); }
    return result;
}
static bool drain(rn_engine *e) { JSContext *ctx; int status; while((status=JS_ExecutePendingJob(e->runtime,&ctx))>0) {} if(status<0) return !exception(e,JS_EXCEPTION); return true; }
rn_engine *rn_engine_create(rn_platform *platform,rn_scene *scene,const char *assets) {
    rn_engine *e=calloc(1,sizeof(*e)); if(!e) return NULL;
    e->control=JS_UNDEFINED; e->platform=platform; e->scene=scene; e->assets=assets; e->runtime=JS_NewRuntime();
    if(!e->runtime) { free(e); return NULL; }
    JS_SetMaxStackSize(e->runtime,4*1024*1024); JS_SetMemoryLimit(e->runtime,512*1024*1024);
    e->context=JS_NewContext(e->runtime); if(!e->context) { JS_FreeRuntime(e->runtime); free(e); return NULL; }
    JS_SetContextOpaque(e->context,e); JS_SetRuntimeOpaque(e->runtime,e);
    JS_NewClassID(e->runtime,&e->journal_class);
    JSClassDef definition={0}; definition.class_name="RitmoKernelJournal"; definition.finalizer=journal_finalizer;
    if(JS_NewClass(e->runtime,e->journal_class,&definition)<0) { rn_engine_destroy(e); return NULL; }
    return e;
}
static JSValue invoke(rn_engine *e,const char *name,int argc,JSValue *argv) {
    JSValue fn=JS_GetPropertyStr(e->context,e->control,name);
    JSValue result=JS_Call(e->context,fn,e->control,argc,argv); JS_FreeValue(e->context,fn); return result;
}
void rn_engine_destroy(rn_engine *e) {
    if(!e) return;
    if(JS_IsObject(e->control)) { JSValue value=invoke(e,"stop",0,NULL); exception(e,value); JS_FreeValue(e->context,value); }
    if(getenv("RITMO_NATIVE_STATS")) printf("Native kernel invocations: %llu\n",(unsigned long long)e->kernel_runs);
    JS_FreeValue(e->context,e->control); JS_FreeContext(e->context); JS_FreeRuntime(e->runtime); free(e);
}
bool rn_engine_load(rn_engine *e,const char *source,bool headless,const char *input,int width,int height) {
    JSContext *ctx=e->context;
    JSValue code;
    if(source) {
        FILE *file=fopen(source,"rb"); if(!file) { fprintf(stderr,"Cannot open bundle %s\n",source); return false; }
        if(fseek(file,0,SEEK_END)) { fclose(file); return false; } long length=ftell(file); rewind(file);
        char *buffer=length>=0 ? malloc((size_t)length+1):NULL;
        if(!buffer || fread(buffer,1,(size_t)length,file)!=(size_t)length) { free(buffer); fclose(file); return false; }
        buffer[length]=0; fclose(file); code=JS_Eval(ctx,buffer,(size_t)length,source,JS_EVAL_TYPE_GLOBAL); free(buffer);
    } else { code=JS_ReadObject(ctx,rn_bundle,rn_bundle_size,JS_READ_OBJ_BYTECODE); if(!JS_IsException(code)) code=JS_EvalFunction(ctx,code); }
    bool ok=!exception(e,code); JS_FreeValue(ctx,code); if(!ok) return false;
    JSValue global=JS_GetGlobalObject(ctx); JSValue game=JS_GetPropertyStr(ctx,global,"__ritmoGame"); JS_FreeValue(ctx,global);
    JSValue fn=JS_GetPropertyStr(ctx,game,"start"); JSValue host=JS_NewObject(ctx);
    JS_SetPropertyStr(ctx,host,"call",JS_NewCFunction(ctx,bridge,"call",1));
    JSValue options=JS_NewObject(ctx); JS_SetPropertyStr(ctx,options,"headless",JS_NewBool(ctx,headless));
    JS_SetPropertyStr(ctx,options,"width",JS_NewInt32(ctx,width)); JS_SetPropertyStr(ctx,options,"height",JS_NewInt32(ctx,height));
    JSValue timeline=JS_ParseJSON(ctx,input,strlen(input),"--input");
    if(exception(e,timeline)) { JS_FreeValue(ctx,options); JS_FreeValue(ctx,host); JS_FreeValue(ctx,fn); JS_FreeValue(ctx,game); return false; }
    JS_SetPropertyStr(ctx,options,"input",timeline);
    JSValue args[2]={host,options}; JSValue promise=JS_Call(ctx,fn,game,2,args);
    JS_FreeValue(ctx,options); JS_FreeValue(ctx,host); JS_FreeValue(ctx,fn); JS_FreeValue(ctx,game);
    ok=!exception(e,promise) && drain(e);
    if(ok && JS_PromiseState(ctx,promise)==JS_PROMISE_FULFILLED) e->control=JS_PromiseResult(ctx,promise);
    else { if(ok && JS_PromiseState(ctx,promise)==JS_PROMISE_REJECTED) { JSValue error=JS_PromiseResult(ctx,promise); JS_Throw(ctx,error); exception(e,JS_EXCEPTION); } ok=false; }
    JS_FreeValue(ctx,promise); return ok;
}
bool rn_engine_frame(rn_engine *e,double delta_ms) { JSValue delta=JS_NewFloat64(e->context,delta_ms); JSValue result=invoke(e,"frame",1,&delta); bool ok=!exception(e,result) && drain(e); JS_FreeValue(e->context,delta); JS_FreeValue(e->context,result); return ok && !e->failed; }
bool rn_engine_snapshot(rn_engine *e,FILE *out) {
    JSValue result=invoke(e,"snapshot",0,NULL); bool ok=!exception(e,result); const char *line=ok ? JS_ToCString(e->context,result):NULL;
    if(line) ok=fprintf(out,"%s\n",line)>=0; else ok=false;
    JS_FreeCString(e->context,line); JS_FreeValue(e->context,result); return ok;
}
bool rn_engine_event(rn_engine *e,const rn_event *event) {
    JSContext *ctx=e->context; JSValue obj=JS_NewObject(ctx);
    JS_SetPropertyStr(ctx,obj,"type",JS_NewString(ctx,event->type)); JS_SetPropertyStr(ctx,obj,"key",JS_NewString(ctx,event->key)); JS_SetPropertyStr(ctx,obj,"code",JS_NewString(ctx,event->code));
    JS_SetPropertyStr(ctx,obj,"repeat",JS_NewBool(ctx,event->repeat)); JS_SetPropertyStr(ctx,obj,"clientX",JS_NewFloat64(ctx,event->x)); JS_SetPropertyStr(ctx,obj,"clientY",JS_NewFloat64(ctx,event->y));
    JS_SetPropertyStr(ctx,obj,"button",JS_NewInt32(ctx,event->button)); JS_SetPropertyStr(ctx,obj,"pointerId",JS_NewFloat64(ctx,(double)event->pointer)); JS_SetPropertyStr(ctx,obj,"pointerType",JS_NewString(ctx,event->pointer_type));
    JSValue result=invoke(e,"event",1,&obj); bool ok=!exception(e,result); JS_FreeValue(ctx,obj); JS_FreeValue(ctx,result); return ok;
}
bool rn_engine_failed(rn_engine *e) { return e->failed; }
