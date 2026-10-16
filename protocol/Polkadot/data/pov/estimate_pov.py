# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
"""Estimate Polkadot DA throughput from parachain-side PoV size samples.

PoV size is not exposed on the relay chain. As a proxy we sample each parachain's
System.BlockWeight proof_size plus encoded extrinsic bytes (samples/pov_<para>.json,
collected with multi.py / para_pov.py) and weight by each parachain's share of
relay-chain inclusions on 2025-11-18 (inclusions_2025-11-18.csv, from events.py).

The proxy is an uncompressed upper estimate of the real (compressed) PoV.
Hydration (2034) and Darwinia (2046) report a constant proof_size that looks like a
fixed weight reservation, so we report the estimate with and without them.
"""
import csv, glob, json, os, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
RESERVED = {2034, 2046}


def load():
    share = {}
    with open(os.path.join(HERE, "inclusions_2025-11-18.csv")) as f:
        for r in csv.DictReader(f):
            share[int(r["para_id"])] = float(r["share"])
    pov = {}
    for p in glob.glob(os.path.join(HERE, "samples", "pov_*.json")):
        pid = int(os.path.basename(p)[4:-5])
        rows = [x for x in json.load(open(p)) if x[2] is not None]
        pov[pid] = statistics.mean(x[2] + x[3] for x in rows)  # bytes
    return share, pov


def weighted(share, pov, exclude=()):
    paras = [p for p in pov if p in share and p not in exclude]
    w = sum(share[p] for p in paras)
    return sum(share[p] * pov[p] for p in paras) / w, w


if __name__ == "__main__":
    share, pov = load()
    all_mean, cov = weighted(share, pov)
    ex_mean, cov_ex = weighted(share, pov, RESERVED)
    out = {
        "parachains_sampled": len(pov),
        "inclusion_share_covered": round(cov, 4),
        "weighted_mean_pov_bytes": round(all_mean),
        "weighted_mean_pov_bytes_excl_reserved": round(ex_mean),
        "per_para_mean_bytes": {str(k): round(v) for k, v in sorted(pov.items())},
    }
    json.dump(out, open(os.path.join(HERE, "summary.json"), "w"), indent=2)
    print(json.dumps({k: v for k, v in out.items() if k != "per_para_mean_bytes"}, indent=2))
