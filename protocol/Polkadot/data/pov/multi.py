# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import sys, json, random, statistics, concurrent.futures as cf; sys.path.insert(0,'.')
from para_pov import sample
heads=json.load(open('para_heads.json'))
eps={
 1000:['https://polkadot-asset-hub-rpc.polkadot.io'],
 1001:['https://polkadot-collectives-rpc.polkadot.io'],
 1002:['https://polkadot-bridge-hub-rpc.polkadot.io'],
 1004:['https://polkadot-people-rpc.polkadot.io'],
 1005:['https://polkadot-coretime-rpc.polkadot.io'],
 2000:['https://acala-rpc.dwellir.com','https://acala-rpc-0.aca-api.network'],
 2004:['https://rpc.api.moonbeam.network','https://moonbeam-rpc.dwellir.com'],
 2006:['https://rpc.astar.network','https://astar-rpc.dwellir.com'],
 2030:['https://hk.p.bifrost-rpc.liebi.com','https://bifrost-polkadot.ibp.network','https://bifrost-polkadot-rpc.dwellir.com'],
 2031:['https://fullnode.centrifuge.io','https://centrifuge-rpc.dwellir.com'],
 2032:['https://api.interlay.io/parachain','https://interlay-rpc.dwellir.com'],
 2034:['https://rpc.hydradx.cloud','https://hydration.ibp.network','https://hydration-rpc.n.dwellir.com'],
 2035:['https://api.phala.network/ws','https://phala-rpc.dwellir.com'],
 2037:['https://ws.unique.network','https://unique-rpc.dwellir.com'],
 2043:['https://parachain-rpc.origin-trail.network','https://neuroweb-rpc.dwellir.com'],
 2091:['https://0.rpc.frequency.xyz','https://frequency-rpc.dwellir.com'],
 3338:['https://peaq-rpc.dwellir.com','https://peaq.api.onfinality.io/public'],
 3344:['https://rpc.polimec.org'],
 3369:['https://polkadot-mythos-rpc.polkadot.io'],
}
def run(pid):
    pid=str(pid)
    lo=heads['28700000'].get(pid,[None])[0]; hi=heads['29900000'].get(pid,[None])[0]
    if lo is None or hi is None: return pid,'no range'
    random.seed(int(pid)); nums=sorted(random.sample(range(lo,hi),60))
    for url in eps[int(pid)]:
        try:
            res=sample(url,nums)
            ok=[x for x in res if x[2] is not None]
            if len(ok)<len(res)*0.8: 
                err=f'{url}: only {len(ok)}/{len(res)}'; continue
            json.dump(res,open(f'pov_{pid}.json','w'))
            ps=sorted(x[2] for x in ok); ext=sorted(x[3] for x in ok)
            q=lambda a,p: a[int(p*(len(a)-1))]
            return pid,f"{url} n={len(ok)} proof_size KiB mean={statistics.mean(ps)/1024:.1f} p50={q(ps,.5)/1024:.1f} p90={q(ps,.9)/1024:.1f} max={ps[-1]/1024:.1f} | ext KiB mean={statistics.mean(ext)/1024:.1f} p50={q(ext,.5)/1024:.1f} max={ext[-1]/1024:.1f}"
        except Exception as e:
            err=f'{url}: {str(e)[:120]}'
    return pid,'FAIL '+err
if __name__=="__main__":
  with cf.ThreadPoolExecutor(8) as ex:
    for pid,msg in ex.map(run, sorted(eps)):
        print(pid,msg,flush=True)
