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
    return hq_stack_justified(r,items,n,horizontal,gaps,HQ_JUSTIFY_START,out);
}

/* How much slack sits before item i, as an exact fraction. Every mode is a
 * different answer to that one question, which is why they share the rounding
 * below rather than each growing their own off-by-one. */
static double hq_before(size_t i,double slack,size_t n,hq_justify j) {
    double fi=(double)i, fn=(double)n;
    switch(j) {
        case HQ_JUSTIFY_END: return slack;
        /* Floor, so an odd cell falls after the content rather than before. */
        case HQ_JUSTIFY_CENTER: return floor(slack/2.0);
        case HQ_JUSTIFY_SPACE_BETWEEN: return n>1 ? fi*slack/(fn-1.0):0.0;
        case HQ_JUSTIFY_SPACE_EVENLY: return (fi+1.0)*slack/(fn+1.0);
        case HQ_JUSTIFY_SPACE_AROUND: return (fi+0.5)*slack/fn;
        default: return 0.0;
    }
}

/* Cells are whole, and rounding each gap on its own loses one here and gains
 * one there. Rounding the cumulative offset and taking differences means the
 * parts always add up to exactly the slack. */
static int hq_at(size_t i,int slack,size_t n,hq_justify j) {
    return (int)floor(hq_before(i,(double)slack,n,j)+0.5);
}

int hq_distribute(int slack,size_t count,hq_justify justify,int *lead,int *seams) {
    if(!lead || count>4096 || (count>1 && !seams)) return 0;
    for(size_t i=0;i+1<count;++i) seams[i]=0;
    if(slack<=0 || count==0 || justify==HQ_JUSTIFY_START) { *lead=0; return 1; }
    for(size_t i=0;i+1<count;++i) {
        int d=hq_at(i+1,slack,count,justify)-hq_at(i,slack,count,justify);
        seams[i]=d>0 ? d:0;
    }
    *lead=hq_at(0,slack,count,justify);
    return 1;
}

int hq_stack_justified(hq_rect r,const hq_constraint *items,size_t n,int horizontal,const int *gaps,hq_justify justify,hq_rect *out) {
    if(n>4096 || (n && (!out || !items)) || (n>1 && !gaps) || r.width<0 || r.height<0) return 0;
    if(!n) return 1;
    int local[64];
    int *sizes=n<=64 ? local:malloc(n*sizeof(*sizes));
    if(!sizes) return 0;
    int axis=horizontal ? r.width:r.height;
    if(!hq_solve_gaps(axis,items,n,gaps,sizes)) { if(sizes!=local) free(sizes); return 0; }

    int64_t used=0;
    for(size_t i=0;i<n;++i) used+=sizes[i];
    for(size_t i=0;i+1<n;++i) used+=gaps[i];
    int64_t spare=(int64_t)axis-used;
    int slack=spare>0 ? (int)spare:0;

    int seam_local[64];
    int *extra=n-1<=64 ? seam_local:malloc((n?n-1:1)*sizeof(*extra));
    if(!extra) { if(sizes!=local) free(sizes); return 0; }
    int lead=0;
    if(!hq_distribute(slack,n,justify,&lead,extra)) {
        if(sizes!=local) free(sizes);
        if(extra!=seam_local) free(extra);
        return 0;
    }

    int64_t offset=(horizontal ? r.x:r.y)+lead;
    for(size_t i=0;i<n;++i) {
        if(offset<INT_MIN || offset>INT_MAX) {
            if(sizes!=local) free(sizes);
            if(extra!=seam_local) free(extra);
            return 0;
        }
        out[i]=horizontal ? (hq_rect){(int)offset,r.y,sizes[i],r.height} : (hq_rect){r.x,(int)offset,r.width,sizes[i]};
        offset+=(int64_t)sizes[i]+(i+1<n ? gaps[i]+extra[i]:0);
    }
    if(sizes!=local) free(sizes);
    if(extra!=seam_local) free(extra);
    return 1;
}
