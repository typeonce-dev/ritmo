#include "rn_kernel.h"
#include <stdio.h>
#include <stdlib.h>
static void require(bool ok,const char *message) { if(!ok) { fprintf(stderr,"%s\n",message); exit(1); } }
int main(void) {
    require(rn_round(0.49999999999999994)==0.0,"round must not add 0.5 before flooring");
    require(signbit(rn_round(-0.5)) && rn_round(-0.5)==0.0,"round(-0.5) must be -0");
    require(rn_round(4503599627370495.5)==4503599627370496.0,"round near 2^52");
    require(signbit(rn_min(0.0,-0.0)),"min signed zero"); require(!signbit(rn_max(-0.0,0.0)),"max signed zero");
    require(isnan(rn_min(NAN,1.0)) && isnan(rn_max(1.0,NAN)),"min/max NaN propagation");
    require(signbit(rn_sign(-0.0)) && isnan(rn_sign(NAN)),"sign edge cases");
    double x=-0.0,y=2.0; double *columns[]={&x,&y}; int32_t marks_data[]={1,77,0},slot=0; int32_t *marks[]={marks_data};
    rn_query_view view={1,&slot,columns,marks}; rn_journal journal={0}; rn_kernel_args args={&view,NULL,99,&journal,0};
    require(rn_journal_write(&args,0,0,0,0,4.0),"journal write x"); require(rn_journal_write(&args,0,1,0,0,5.0),"journal write y");
    require(x==4.0 && y==5.0 && marks_data[1]==77,"writes stay uncommitted until success");
    rn_journal_commit(&journal,99); require(marks_data[1]==99,"commit stamps the system tick");
    rn_journal_rollback(&journal); require(x==0.0 && signbit(x) && y==2.0 && marks_data[1]==77,"rollback restores values and marks exactly");
    rn_journal_release(&journal); return 0;
}
