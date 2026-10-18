#include "rn_kernel.h"
#include <stdlib.h>
bool rn_journal_write(rn_kernel_args *args,int query,int column,int mark,int32_t slot,double value) {
    rn_journal *j=args->journal;
    if(j->count==j->capacity) { size_t cap=j->capacity ? j->capacity*2:256; rn_write *writes=realloc(j->writes,cap*sizeof(*writes)); if(!writes) { args->failed=1; return false; } j->writes=writes; j->capacity=cap; }
    double *target=&args->queries[query].columns[column][slot]; int32_t *changed=&args->queries[query].marks[mark][slot*3+1];
    j->writes[j->count++]=(rn_write){target,*target,changed,*changed}; *target=value; return true;
}
void rn_journal_commit(rn_journal *j,int32_t tick) { for(size_t i=0;i<j->count;i++) *j->writes[i].mark=tick; j->committed=true; }
void rn_journal_rollback(rn_journal *j) { for(size_t i=j->count;i>0;i--) { rn_write *w=&j->writes[i-1]; *w->target=w->old; *w->mark=w->old_mark; } j->committed=false; }
void rn_journal_release(rn_journal *j) { free(j->writes); j->writes=NULL; j->count=j->capacity=0; }
