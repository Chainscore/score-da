# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import json, struct, urllib.request
M=(1<<64)-1
P1=0x9E3779B185EBCA87;P2=0xC2B2AE3D27D4EB4F;P3=0x165667B19E3779F9;P4=0x85EBCA77C2B2AE63;P5=0x27D4EB2F165667C5
def rotl(x,r): return ((x<<r)|(x>>(64-r)))&M
def rnd(acc,inp): acc=(acc+inp*P2)&M; acc=rotl(acc,31); return (acc*P1)&M
def mrg(acc,v): v=rnd(0,v); acc^=v; return (acc*P1+P4)&M
def xxh64(d,seed=0):
    n=len(d); i=0
    if n>=32:
        v1=(seed+P1+P2)&M; v2=(seed+P2)&M; v3=seed; v4=(seed-P1)&M
        while i+32<=n:
            v1=rnd(v1,struct.unpack_from('<Q',d,i)[0]); v2=rnd(v2,struct.unpack_from('<Q',d,i+8)[0])
            v3=rnd(v3,struct.unpack_from('<Q',d,i+16)[0]); v4=rnd(v4,struct.unpack_from('<Q',d,i+24)[0]); i+=32
        h=(rotl(v1,1)+rotl(v2,7)+rotl(v3,12)+rotl(v4,18))&M
        for v in (v1,v2,v3,v4): h=mrg(h,v)
    else: h=(seed+P5)&M
    h=(h+n)&M
    while i+8<=n:
        k=rnd(0,struct.unpack_from('<Q',d,i)[0]); h^=k; h=(rotl(h,27)*P1+P4)&M; i+=8
    if i+4<=n:
        h^=(struct.unpack_from('<I',d,i)[0]*P1)&M; h=(rotl(h,23)*P2+P3)&M; i+=4
    while i<n:
        h^=(d[i]*P5)&M; h=(rotl(h,11)*P1)&M; i+=1
    h^=h>>33; h=(h*P2)&M; h^=h>>29; h=(h*P3)&M; h^=h>>32
    return h
def twox(d,bits=128):
    if isinstance(d,str): d=d.encode()
    return b''.join(xxh64(d,s).to_bytes(8,'little') for s in range(bits//64))
def skey(pallet,item): return '0x'+(twox(pallet)+twox(item)).hex()
class RPC:
    def __init__(s,url): s.url=url; s.id=0
    def post(s,body,timeout=120):
        req=urllib.request.Request(s.url,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','User-Agent':'audit/1.0'})
        for a in range(4):
            try:
                with urllib.request.urlopen(req,timeout=timeout) as resp: return json.loads(resp.read())
            except Exception as e:
                if a==3: raise
                import time; time.sleep(2*(a+1))
    def call(s,method,params):
        s.id+=1
        j=s.post({"jsonrpc":"2.0","id":s.id,"method":method,"params":params})
        if 'error' in j: raise Exception(j['error'])
        return j['result']
    def batch(s,calls):
        body=[{"jsonrpc":"2.0","id":i,"method":m,"params":p} for i,(m,p) in enumerate(calls)]
        j=s.post(body)
        if isinstance(j,dict): raise Exception(j)
        j=sorted(j,key=lambda x:x['id'])
        return [x.get('result') for x in j]
def compact(b,o):
    m=b[o]&3
    if m==0: return b[o]>>2,o+1
    if m==1: return (int.from_bytes(b[o:o+2],'little'))>>2,o+2
    if m==2: return (int.from_bytes(b[o:o+4],'little'))>>2,o+4
    l=(b[o]>>2)+4; return int.from_bytes(b[o+1:o+1+l],'little'),o+1+l
