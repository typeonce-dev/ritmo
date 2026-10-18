#ifndef RN_KERNEL_H
#define RN_KERNEL_H
#include <stdbool.h>
#include <stdint.h>
#include <math.h>
#include <stddef.h>
typedef struct { int32_t count; const int32_t *slots; double *const *columns; int32_t *const *marks; } rn_query_view;
typedef struct { double *target,old; int32_t *mark,old_mark; } rn_write;
typedef struct rn_journal { rn_write *writes; size_t count,capacity; bool committed; } rn_journal;
typedef struct { const rn_query_view *queries; const double *resources; int32_t tick; rn_journal *journal; int32_t failed; } rn_kernel_args;
typedef void (*rn_kernel_fn)(rn_kernel_args *args);
typedef struct { const char *name,*hash; rn_kernel_fn fn; int query_count,resource_count; const int *columns,*marks; } rn_kernel_entry;
extern const rn_kernel_entry rn_kernels[];
extern const size_t rn_kernel_count;
bool rn_journal_write(rn_kernel_args *args,int query,int column,int mark,int32_t slot,double value);
void rn_journal_commit(rn_journal *journal,int32_t tick);
void rn_journal_rollback(rn_journal *journal);
void rn_journal_release(rn_journal *journal);
static inline bool rn_truth(double x) { return x!=0.0 && !isnan(x); }
static inline double rn_round(double x) { if(!isfinite(x) || x==0.0 || fabs(x)>=0x1p52) return x; if(x>=-0.5 && x<0.0) return -0.0; double base=floor(x); return x-base>=0.5 ? base+1.0:base; }
static inline double rn_sign(double x) { return isnan(x) || x==0.0 ? x:x>0.0 ? 1.0:-1.0; }
static inline double rn_min(double a,double b) { if(isnan(a) || isnan(b)) return -NAN; if(a==0.0 && b==0.0) return signbit(a) || signbit(b) ? -0.0:0.0; return a<b ? a:b; }
static inline double rn_max(double a,double b) { if(isnan(a) || isnan(b)) return -NAN; if(a==0.0 && b==0.0) return signbit(a) && signbit(b) ? -0.0:0.0; return a>b ? a:b; }
#endif
