# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import sys, json, random, statistics; sys.path.insert(0,'.')
from sub import *
BW=skey('System','BlockWeight')
def dec_bw(hx):
    b=bytes.fromhex(hx[2:]); o=0; rt=0; ps=0
    for _ in range(3):
        a,o=compact(b,o); c,o=compact(b,o); rt+=a; ps+=c
    return rt,ps
def sample(url, nums):
    r=RPC(url); out=[]
    for i in range(0,len(nums),20):
        chunk=nums[i:i+20]
        hs=r.batch([('chain_getBlockHash',[n]) for n in chunk])
        bws=r.batch([('state_getStorage',[BW,h]) for h in hs])
        blks=r.batch([('chain_getBlock',[h]) for h in hs])
        for n,h,bw,bk in zip(chunk,hs,bws,blks):
            if bw is None or bk is None: out.append((n,None,None,None)); continue
            rt,ps=dec_bw(bw)
            ext=sum((len(x)-2)//2 for x in bk['block']['extrinsics'])
            out.append((n,rt,ps,ext))
    return out
if __name__=='__main__':
    url=sys.argv[1]; lo=int(sys.argv[2]); hi=int(sys.argv[3]); k=int(sys.argv[4]); tag=sys.argv[5]
    random.seed(1); nums=sorted(random.sample(range(lo,hi),k))
    res=sample(url,nums)
    json.dump(res,open(f'pov_{tag}.json','w'))
    ok=[x for x in res if x[2] is not None]
    ps=[x[2] for x in ok]; ext=[x[3] for x in ok]
    q=lambda a,p: sorted(a)[int(p*(len(a)-1))]
    print(f"{tag}: n={len(ok)}/{len(res)} proof_size KiB mean={statistics.mean(ps)/1024:.1f} p50={q(ps,.5)/1024:.1f} p90={q(ps,.9)/1024:.1f} p99={q(ps,.99)/1024:.1f} max={max(ps)/1024:.1f} | extrinsics KiB mean={statistics.mean(ext)/1024:.1f} p50={q(ext,.5)/1024:.1f} max={max(ext)/1024:.1f}")
