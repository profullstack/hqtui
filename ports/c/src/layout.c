#include "internal.h"
typedef struct { double value,fr,min,max; } resolved;
int hq_solve(int total,const hq_constraint *items,size_t n,int gap,int *out) {
    if(gap<0) return 0;
    if(n<2) return hq_solve_gaps(total,items,n,NULL,out);
    int local[64];
    int *gaps=n-1<=64 ? local:malloc((n-1)*sizeof(*gaps));
    if(!gaps) return 0;
    for(size_t i=0;i+1<n;++i) gaps[i]=gap;
    int ok=hq_solve_gaps(total,items,n,gaps,out);
    if(gaps!=local) free(gaps);
    return ok;
}

int hq_solve_gaps(int total,const hq_constraint *items,size_t n,const int *gaps,int *out) {
    if(total<0 || n>4096 || (n && (!items || !out)) || (n>1 && !gaps)) return 0;
    if(!n) return 1;
    resolved local[64];
    resolved *p=n<=64 ? local:malloc(n*sizeof(*p));
    if(!p) return 0;
    int64_t gap_total=0;
    for(size_t i=0;i+1<n;++i) gap_total+=gaps[i];
    int64_t a=(int64_t)total-gap_total;
    double available=(double)(a>0 ? a:0),used=0,fr=0;
    for(size_t i=0;i<n;++i) {
        hq_constraint c=items[i];
        double v=isfinite(c.value) ? c.value:0;
        p[i]=(resolved){0,0,(double)hq_max(c.min,0),c.max<0 ? INFINITY:(double)c.max};
        switch(c.kind) {
            case HQ_CELLS: p[i].value=v; break;
            case HQ_PERCENT: p[i].value=floor(available*v/100+.5); break;
            case HQ_FR: p[i].fr=v>0 ? v:1; break;
            case HQ_FILL: p[i].fr=1; break;
            case HQ_AUTO: p[i].value=hq_max(0,c.intrinsic); break;
            default: if(p!=local) free(p); return 0;
        }
        if(p[i].fr>0) { fr+=p[i].fr; out[i]=-1; }
        else { double val=hq_clamp(floor(p[i].value+.5),p[i].min,fmin(p[i].max,available));
            out[i]=(int)hq_clamp(val,0,INT_MAX); used+=out[i]; }
    }
    double pool=fmax(0,available-used),remaining=fr;
    if(fr>0) {
        int changed=1;
        while(changed) {
            changed=0;
            for(size_t i=0;i<n;++i) if(out[i]==-1) {
                double share=remaining>0 ? pool*p[i].fr/remaining:0;
                double clamped=hq_clamp(share,p[i].min,p[i].max);
                if(clamped!=share) {
                    out[i]=(int)hq_clamp(floor(clamped+.5),0,INT_MAX);
                    pool-=out[i]; remaining-=p[i].fr; changed=1;
                }
            }
        }
        size_t last=n;
        for(size_t i=0;i<n;++i) if(out[i]==-1) last=i;
        double assigned=0;
        for(size_t i=0;i<n;++i) if(out[i]==-1) {
            double v=i==last ? fmax(0,pool-assigned) : floor(remaining>0 ? pool*p[i].fr/remaining:0);
            out[i]=(int)hq_clamp(v,0,INT_MAX); assigned+=out[i];
        }
    }
    int64_t sum=0;
    for(size_t i=0;i<n;++i) sum+=out[i];
    int64_t avail=(int64_t)available;
    for(int pass=0;pass<2 && sum>avail;++pass) for(size_t i=n;i-->0 && sum>avail;) {
        int64_t spare=(int64_t)out[i]-(pass ? 0:(int64_t)p[i].min);
        int64_t shrink=spare<sum-avail ? spare:sum-avail;
        if(shrink>0) { out[i]-=(int)shrink; sum-=shrink; }
    }
    if(p!=local) free(p);
    return 1;
}
int hq_stack(hq_rect r,const hq_constraint *items,size_t n,int horizontal,int gap,hq_rect *out) {
    if(gap<0) return 0;
    if(n<2) return hq_stack_gaps(r,items,n,horizontal,NULL,out);
    int local[64];
    int *gaps=n-1<=64 ? local:malloc((n-1)*sizeof(*gaps));
    if(!gaps) return 0;
    for(size_t i=0;i+1<n;++i) gaps[i]=gap;
    int ok=hq_stack_gaps(r,items,n,horizontal,gaps,out);
    if(gaps!=local) free(gaps);
    return ok;
}

int hq_stack_gaps(hq_rect r,const hq_constraint *items,size_t n,int horizontal,const int *gaps,hq_rect *out) {
    if(n>4096 || (n && (!out || !items)) || (n>1 && !gaps) || r.width<0 || r.height<0) return 0;
    if(!n) return 1;
    int local[64];
    int *sizes=n<=64 ? local:malloc(n*sizeof(*sizes));
    if(!sizes) return 0;
    if(!hq_solve_gaps(horizontal ? r.width:r.height,items,n,gaps,sizes)) { if(sizes!=local) free(sizes); return 0; }
    int64_t offset=horizontal ? r.x:r.y;
    for(size_t i=0;i<n;++i) {
        if(offset<INT_MIN || offset>INT_MAX) { if(sizes!=local) free(sizes); return 0; }
        out[i]=horizontal ? (hq_rect){(int)offset,r.y,sizes[i],r.height} : (hq_rect){r.x,(int)offset,r.width,sizes[i]};
        offset+=(int64_t)sizes[i]+(i+1<n ? gaps[i]:0);
    }
    if(sizes!=local) free(sizes);
    return 1;
}
