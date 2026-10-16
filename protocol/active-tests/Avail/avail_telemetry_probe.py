# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
"""
#Objective 
1. Fetch node telemetary from running local instance  (running avail node loacally we can modify the instance if needed)
2. Bloat Block size and limit test it.

"""

#!/usr/bin/env python3
"""
avail_telemetry_probe.py

Quick telemetry probe for a local Avail/Substrate node.

- Pulls key runtime stats via JSON-RPC (HTTP).
- Optionally scrapes a Prometheus /metrics endpoint for a few gauges.
- No external dependencies (uses urllib).

Usage:
  python3 avail_telemetry_probe.py
  python3 avail_telemetry_probe.py --rpc http://127.0.0.1:9944
  python3 avail_telemetry_probe.py --metrics http://127.0.0.1:9615/metrics
  python3 avail_telemetry_probe.py --out telemetry.json
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error

DEFAULT_RPC = "http://127.0.0.1:9944"

def http_post(url: str, payload: dict, timeout: float = 5.0) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        return json.loads(body.decode("utf-8"))

def http_get_text(url: str, timeout: float = 5.0) -> str:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")

def rpc_call(url: str, method: str, params=None, id_=1):
    if params is None:
        params = []
    payload = {"jsonrpc": "2.0", "id": id_, "method": method, "params": params}
    resp = http_post(url, payload)
    if "error" in resp:
        raise RuntimeError(f"RPC {method} error: {resp['error']}")
    return resp.get("result")

def hex_to_int(h: str) -> int | None:
    if not isinstance(h, str):
        return None
    h = h.lower()
    if h.startswith("0x"):
        return int(h, 16)
    try:
        return int(h)
    except Exception:
        return None

def grab_rpc_snapshot(rpc_url: str) -> dict:
    snap = {"rpc_url": rpc_url, "ts": int(time.time())}

    def try_put(key, func):
        try:
            snap[key] = func()
        except Exception as e:
            snap[f"{key}_error"] = str(e)

    try_put("system_name",      lambda: rpc_call(rpc_url, "system_name"))
    try_put("system_version",   lambda: rpc_call(rpc_url, "system_version"))
    try_put("system_chain",     lambda: rpc_call(rpc_url, "system_chain"))
    try_put("node_roles",       lambda: rpc_call(rpc_url, "system_nodeRoles"))
    try_put("health",           lambda: rpc_call(rpc_url, "system_health"))
    try_put("sync_state",       lambda: rpc_call(rpc_url, "system_syncState"))
    try_put("peer_id",          lambda: rpc_call(rpc_url, "system_localPeerId"))

    # Peers (sample only first few)
    try:
        peers = rpc_call(rpc_url, "system_peers") or []
        snap["peers_count"] = len(peers)
        snap["peers_sample"] = [
            {
                "peer_id": p.get("peerId"),
                "roles": p.get("roles"),
                "best": p.get("bestNumber"),
                "protocol_version": p.get("protocolVersion"),
            }
            for p in peers[:3]
        ]
    except Exception as e:
        snap["peers_error"] = str(e)

    # Best / finalized heads
    try:
        best_hash = rpc_call(rpc_url, "chain_getBlockHash")
        best_header = rpc_call(rpc_url, "chain_getHeader", [best_hash]) if best_hash else None
        snap["best_hash"] = best_hash
        snap["best_number"] = hex_to_int(best_header.get("number")) if best_header else None
    except Exception as e:
        snap["best_error"] = str(e)

    try:
        fin_hash = rpc_call(rpc_url, "chain_getFinalizedHead")
        fin_header = rpc_call(rpc_url, "chain_getHeader", [fin_hash]) if fin_hash else None
        snap["finalized_hash"] = fin_hash
        snap["finalized_number"] = hex_to_int(fin_header.get("number")) if fin_header else None
    except Exception as e:
        snap["finalized_error"] = str(e)

    try_put("properties",       lambda: rpc_call(rpc_url, "system_properties"))
    return snap

def scrape_metrics(metrics_url: str) -> dict:
    text = http_get_text(metrics_url)
    out = {"metrics_url": metrics_url, "raw_sample": None, "parsed": {}}
    # strip comments/help lines
    lines = [ln.strip() for ln in text.splitlines() if ln and not ln.startswith("#")]
    out["raw_sample"] = lines[:20]  # keep a small preview

    def parse_line(ln: str):
        name = ln.split("{", 1)[0].strip()
        rest = ln[len(name):].strip()
        labels = {}
        valstr = None
        if rest.startswith("{"):
            try:
                label_part, after = rest[1:].split("}", 1)
                for kv in label_part.split(","):
                    if "=" in kv:
                        k, v = kv.split("=", 1)
                        labels[k.strip()] = v.strip().strip('"')
                valstr = after.strip()
            except ValueError:
                return None
        else:
            valstr = rest
        tok = valstr.split()
        try:
            val = float(tok[0])
        except Exception:
            return None
        return name, labels, val

    parsed = {}
    for ln in lines:
        pl = parse_line(ln)
        if not pl:
            continue
        name, labels, val = pl
        if name.startswith("substrate_block_height"):
            status = labels.get("status", "unknown")
            parsed.setdefault("block_height", {})[status] = val
        elif "sync_peers" in name and "substrate" in name:
            parsed["sync_peers"] = val
        elif "txpool" in name and ("queued" in name or "validations" in name):
            parsed["txpool"] = val
        elif "grandpa" in name and ("round" in name or "votes" in name):
            parsed.setdefault("grandpa", {})[name] = val
        elif "peers" in name and "network" in name:
            parsed["network_peers"] = val

    out["parsed"] = parsed
    return out

def main():
    ap = argparse.ArgumentParser(description="Fetch basic telemetry from a local Avail/Substrate node (RPC + optional Prometheus metrics).")
    ap.add_argument("--rpc", default=DEFAULT_RPC, help=f"JSON-RPC HTTP endpoint (default: {DEFAULT_RPC})")
    ap.add_argument("--metrics", default=None, help="Prometheus metrics URL (e.g., http://127.0.0.1:9615/metrics)")
    ap.add_argument("--out", default=None, help="Write full JSON snapshot to this file")
    args = ap.parse_args()

    snapshot = {"ts": int(time.time())}

    try:
        snapshot["rpc"] = grab_rpc_snapshot(args.rpc)
    except Exception as e:
        snapshot["rpc_error"] = str(e)

    if args.metrics:
        try:
            snapshot["metrics"] = scrape_metrics(args.metrics)
        except Exception as e:
            snapshot["metrics_error"] = str(e)

    print(json.dumps(snapshot, indent=2))
    if args.out:
        try:
            with open(args.out, "w") as f:
                json.dump(snapshot, f, indent=2)
            print(f"\nWrote snapshot to {args.out}", file=sys.stderr)
        except Exception as e:
            print(f"Failed to write {args.out}: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
