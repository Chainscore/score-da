#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
"""
block_bloat_test.py

Goal:
 - Snapshot node telemetry (RPC-only) BEFORE.
 - Submit a large batch of remark extrinsics to bloat a block close to the size limit.
 - Snapshot telemetry AFTER.
 - Report the block that carried the batch and approximate its extrinsics byte size.

Dependencies:
    pip install substrate-interface

Examples:
    python3 block_bloat_test.py
    python3 block_bloat_test.py --rpc http://127.0.0.1:9944 --chunk-bytes 4096 --start-calls 100
    python3 block_bloat_test.py --seed //Bob
"""

import argparse
import json
import time
import urllib.request
import urllib.error

from typing import Optional, Tuple, List

# ------------- RPC helpers (no extra deps) -------------
def http_post(url: str, payload: dict, timeout: float = 10.0) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def rpc_call(url: str, method: str, params=None, id_=1):
    if params is None:
        params = []
    resp = http_post(url, {"jsonrpc": "2.0", "id": id_, "method": method, "params": params})
    if "error" in resp:
        raise RuntimeError(f"RPC {method} error: {resp['error']}")
    return resp["result"]

def hex_to_int(h: Optional[str]) -> Optional[int]:
    if not isinstance(h, str):
        return None
    if h.startswith("0x"):
        return int(h, 16)
    try:
        return int(h)
    except Exception:
        return None

def telemetry_snapshot(rpc_url: str) -> dict:
    snap = {"ts": int(time.time())}
    def put(k, fn):
        try:
            snap[k] = fn()
        except Exception as e:
            snap[k+"_error"] = str(e)

    put("system_name",      lambda: rpc_call(rpc_url, "system_name"))
    put("system_version",   lambda: rpc_call(rpc_url, "system_version"))
    put("system_chain",     lambda: rpc_call(rpc_url, "system_chain"))
    put("health",           lambda: rpc_call(rpc_url, "system_health"))
    put("sync_state",       lambda: rpc_call(rpc_url, "system_syncState"))
    put("peer_id",          lambda: rpc_call(rpc_url, "system_localPeerId"))

    # heads
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

    return snap

def block_extrinsics_size_bytes(rpc_url: str, block_hash: str) -> int:
    """Approximate extrinsics bytes by summing hex lengths of each extrinsic in the block."""
    blk = rpc_call(rpc_url, "chain_getBlock", [block_hash])
    exs = blk["block"]["extrinsics"]
    total_hex_chars = sum(len(x) - 2 for x in exs if isinstance(x, str) and x.startswith("0x"))
    return total_hex_chars // 2

# ------------- Bloater (py-substrate-interface) -------------
def bloat_block(
    rpc_url: str,
    seed_uri: str,
    chunk_bytes: int,
    start_calls: int,
    max_calls: int,
    wait_finalized: bool = True
) -> Tuple[str, int, int]:
    """
    Try to submit a batch of N remark_with_event calls where each remark is `chunk_bytes`.
    Auto-tune N (downwards) until it fits. Returns (block_hash, calls_sent, payload_bytes_total).
    """
    from substrateinterface import SubstrateInterface, Keypair
    from substrateinterface.exceptions import SubstrateRequestException

    # Connect
    substrate = SubstrateInterface(
        url=rpc_url,
        ss58_format=42,                # generic; doesn't matter for //Alice dev
        type_registry_preset='substrate-node-template'  # generic types
    )
    keypair = Keypair.create_from_uri(seed_uri)

    # Build one remark call; pick remark_with_event if available, else remark.
    remark_data = bytes([0x42]) * chunk_bytes
    def make_remark_call():
        try:
            return substrate.compose_call(
                call_module='System', call_function='remark_with_event', call_params={'remark': remark_data}
            )
        except Exception:
            return substrate.compose_call(
                call_module='System', call_function='remark', call_params={'remark': remark_data}
            )

    # Compose a batch from N remarks
    def make_batch(n):
        calls = [make_remark_call() for _ in range(n)]
        try:
            return substrate.compose_call(call_module='Utility', call_function='batch', call_params={'calls': calls})
        except Exception:
            # Fallback to batch_all
            return substrate.compose_call(call_module='Utility', call_function='batch_all', call_params={'calls': calls})

    # Try to submit with N, return (True, receipt) if included/finalized; else (False, reason)
    def try_submit(n):
        call = make_batch(n)
        extrinsic = substrate.create_signed_extrinsic(call=call, keypair=keypair)
        try:
            receipt = substrate.submit_extrinsic(
                extrinsic, wait_for_inclusion=not wait_finalized, wait_for_finalization=wait_finalized
            )
            if receipt.is_success:
                return True, receipt
            return False, f"DispatchError: {receipt.error_message}"
        except SubstrateRequestException as e:
            # Common: "Transaction is too large", "ExhaustsResources", "Invalid Transaction: Excessive length"
            return False, str(e)
        except Exception as e:
            return False, str(e)

    # Auto-tune N: start from start_calls, back off by half until success, then try to grow (optional simple binary-ish search)
    low, high = 1, max(1, min(max_calls, start_calls))
    ok_receipt = None
    # Decrease until success
    n = high
    while n >= 1:
        ok, res = try_submit(n)
        if ok:
            ok_receipt = res
            break
        # too big, back off
        n //= 2
        time.sleep(0.5)

    if ok_receipt is None:
        raise RuntimeError("Could not find a batch size that fits; try smaller --chunk-bytes or lower --start-calls.")

    # Optional: small ramp up to see if we can pack a bit more (greedy +10%)
    best_n = n
    best_receipt = ok_receipt
    probe = min(max_calls, int(n * 1.1) + 1)
    while probe > best_n and probe <= max_calls:
        ok, res = try_submit(probe)
        if ok:
            best_n, best_receipt = probe, res
            probe = min(max_calls, int(probe * 1.1) + 1)
        else:
            break

    # Pull the block hash carrying the extrinsic
    block_hash = best_receipt.block_hash
    total_payload = best_n * chunk_bytes
    return block_hash, best_n, total_payload

# ------------- CLI orchestration -------------
def main():
    ap = argparse.ArgumentParser(description="Bloat a block with batched remark extrinsics and show before/after telemetry.")
    ap.add_argument("--rpc", default="http://127.0.0.1:9944", help="Node RPC HTTP endpoint")
    ap.add_argument("--seed", default="//Alice", help="Signer seed URI (e.g., //Alice)")
    ap.add_argument("--chunk-bytes", type=int, default=4096, help="Bytes per remark payload (default 4096)")
    ap.add_argument("--start-calls", type=int, default=100, help="Initial number of calls to try in a batch (default 100)")
    ap.add_argument("--max-calls", type=int, default=1000, help="Upper bound on calls (default 1000)")
    ap.add_argument("--no-finalize-wait", action="store_true", help="Wait only for inclusion, not finalization")
    args = ap.parse_args()

    print("=== Telemetry BEFORE ===")
    before = telemetry_snapshot(args.rpc)
    print(json.dumps(before, indent=2))

    print("\n=== Submitting bloat batch ===")
    t0 = time.time()
    try:
        block_hash, calls_sent, total_payload = bloat_block(
            rpc_url=args.rpc,
            seed_uri=args.seed,
            chunk_bytes=args.chunk_bytes,
            start_calls=args.start_calls,
            max_calls=args.max_calls,
            wait_finalized=not args.no_finalize_wait
        )
    except Exception as e:
        print(f"Batch submission failed: {e}")
        return

    elapsed = time.time() - t0
    size_bytes = block_extrinsics_size_bytes(args.rpc, block_hash)
    print(json.dumps({
        "block_hash": block_hash,
        "calls_sent": calls_sent,
        "bytes_per_call": args.chunk_bytes,
        "approx_total_payload_bytes": total_payload,
        "approx_block_extrinsics_bytes": size_bytes,
        "submit_elapsed_sec": round(elapsed, 3)
    }, indent=2))

    # Give the node a beat to update, then snapshot AFTER
    time.sleep(1.0)
    print("\n=== Telemetry AFTER ===")
    after = telemetry_snapshot(args.rpc)
    print(json.dumps(after, indent=2))

    # Quick delta view
    print("\n=== Delta (AFTER - BEFORE) ===")
    delta = {}
    for k in ("best_number", "finalized_number"):
        if isinstance(before.get(k), int) and isinstance(after.get(k), int):
            delta[k] = after[k] - before[k]
    if "health" in before and "health" in after:
        try:
            delta["peers"] = after["health"].get("peers", 0) - before["health"].get("peers", 0)
        except Exception:
            pass
    print(json.dumps(delta, indent=2))

if __name__ == "__main__":
    main()
