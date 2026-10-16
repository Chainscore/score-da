# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import sys, collections, json; sys.path.insert(0,'.')
from sub import *
r=RPC('https://rpc.polkadot.io')
def decode_events(b):
    n,o=compact(b,0); out=[]
    for _ in range(n):
        t=b[o]; o+=1
        para=struct.unpack_from('<I',b,o)[0]; o+=324
        hl,o=compact(b,o); o+=hl
        core=struct.unpack_from('<I',b,o)[0]; o+=4
        if t in (0,1): o+=4
        out.append((t,para,core))
    assert o==len(b), (o,len(b))
    return out
start=int(sys.argv[1]); count=int(sys.argv[2]); tag=sys.argv[3]
B=50
rows=[]
for s in range(start,start+count,B):
    nums=list(range(s,min(s+B,start+count)))
    hashes=r.batch([('chain_getBlockHash',[n]) for n in nums])
    res=r.batch([('state_call',['ParachainHost_candidate_events','0x',h]) for h in hashes])
    for n,x in zip(nums,res):
        if x is None: print('fail',n); continue
        ev=decode_events(bytes.fromhex(x[2:]))
        rows.append((n,ev))
json.dump(rows,open(f'ev_{tag}.json','w'))
inc=[[e for e in ev if e[0]==1] for n,ev in rows]
per_block=[len(x) for x in inc]
cores=collections.Counter(c for x in inc for (_,p,c) in x)
paras=collections.Counter(p for x in inc for (_,p,c) in x)
import statistics
print(tag,'blocks',len(rows),'mean included/block',statistics.mean(per_block),'median',statistics.median(per_block))
print(' distinct cores with >=1 inclusion',len(cores),' distinct paras',len(paras))
# inclusion frequency per core: fraction of blocks
freq=sorted(((v/len(rows)),c) for c,v in cores.items())
bins=collections.Counter()
for f,c in freq:
    if f>0.9: bins['~every block (6s)']+=1
    elif f>0.4: bins['~every 2nd block (12s)']+=1
    elif f>0.2: bins['~every 3-5 blocks']+=1
    elif f>0.01: bins['occasional']+=1
    else: bins['rare (<1%)']+=1
print(' core cadence bins',dict(bins))
print(' core indices used',sorted(cores))
