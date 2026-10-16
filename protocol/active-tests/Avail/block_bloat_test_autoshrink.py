#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import argparse, time, json, math, binascii
from typing import Optional
from substrateinterface import SubstrateInterface, Keypair
try:
    from substrateinterface.exceptions import SubstrateRequestException
except Exception:
    class SubstrateRequestException(Exception): ...

# ----------------- helpers -----------------
def hex_to_int(h: Optional[str]) -> Optional[int]:
    if not isinstance(h, str):
        return None
    try:
        return int(h, 16) if h.startswith("0x") else int(h)
    except Exception:
        return None

def rpc(sub: SubstrateInterface, method: str, params=None):
    return sub.rpc_request(method, params or []).get("result")

def telemetry(sub: SubstrateInterface) -> dict:
    t = {"ts": int(time.time())}
    def put(key, method, params=None):
        try: t[key] = rpc(sub, method, params)
        except Exception as e: t[f"{key}_error"] = str(e)

    put("system_name", "system_name")
    put("system_version", "system_version")
    put("system_chain", "system_chain")
    put("health", "system_health")
    put("sync_state", "system_syncState")
    put("peer_id", "system_localPeerId")

    try:
        best_hash = rpc(sub, "chain_getBlockHash")
        hdr = rpc(sub, "chain_getHeader", [best_hash]) if best_hash else None
        t["best_hash"] = best_hash
        t["best_number"] = hex_to_int(hdr.get("number")) if hdr else None
    except Exception as e:
        t["best_error"] = str(e)

    try:
        fin_hash = rpc(sub, "chain_getFinalizedHead")
        fhdr = rpc(sub, "chain_getHeader", [fin_hash]) if fin_hash else None
        t["finalized_hash"] = fin_hash
        t["finalized_number"] = hex_to_int(fhdr.get("number")) if fhdr else None
    except Exception as e:
        t["finalized_error"] = str(e)

    return t

def approx_block_extrinsics_bytes(sub: SubstrateInterface, block_hash: str) -> int:
    blk = rpc(sub, "chain_getBlock", [block_hash])
    exs = blk["block"]["extrinsics"]
    total_hex_chars = sum(len(x)-2 for x in exs if isinstance(x, str) and x.startswith("0x"))
    return total_hex_chars // 2

def deterministic_payload(n_bytes: int) -> bytes:
    # deterministic pseudo-random bytes (no os.urandom needed)
    data = bytearray(n_bytes)
    x = 0x42
    for i in range(n_bytes):
        x = (x * 1664525 + 1013904223) & 0xFFFFFFFF
        data[i] = (x >> 24) & 0xFF
    return bytes(data)

# ----------------- core: submit a batch -----------------
def submit_batch(sub: SubstrateInterface, kp: Keypair, payload_size: int, n_calls: int, app_id: int, wait_finalized: bool):
    """
    Compose n_calls of a data-carrying extrinsic and send in Utility.batch.
    - Prefer Avail's DataAvailability.submit_data(data).
    - If that call isn't available, fall back to System.remark.
    Returns (ok, info, receipt_or_none)
    """
    data = deterministic_payload(payload_size)

    # Try DA pallet call; if unavailable, fall back to remark
    calls = []
    try:
        # probe once to see if pallet exists
        probe = sub.compose_call('DataAvailability', 'submit_data', {'data': data})
        calls = [probe] + [
            sub.compose_call('DataAvailability', 'submit_data', {'data': data})
            for _ in range(n_calls - 1)
        ]
        using_da = True
    except Exception:
        # fallback: System.remark with hex data
        remark_hex = "0x" + binascii.hexlify(data).decode()
        calls = [
            sub.compose_call('System', 'remark', {'remark': remark_hex})
            for _ in range(n_calls)
        ]
        using_da = False

    batch_call = None
    try:
        batch_call = sub.compose_call('Utility', 'batch', {'calls': calls})
    except Exception:
        batch_call = sub.compose_call('Utility', 'batch_all', {'calls': calls})

    nonce = sub.get_account_nonce(kp.ss58_address)

    try:
        xt = sub.create_signed_extrinsic(
            call=batch_call,
            keypair=kp,
            nonce=nonce,
            # Avail-specific signed extension requirement:
            signature_options={"app_id": app_id}
        )
    except Exception as e:
        return False, f"compose/sign failed: {repr(e)}", None

    try:
        # Wait for inclusion (fast), not finalization (slower)
        receipt = sub.submit_extrinsic(
            xt, wait_for_inclusion=True, wait_for_finalization=wait_finalized
        )
        if getattr(receipt, "is_success", False):
            return True, f"ok (using {'DA' if using_da else 'remark'}) xt={receipt.extrinsic_hash}", receipt
        else:
            return False, f"DispatchError: {receipt.error_message}", receipt
    except SubstrateRequestException as e:
        return False, str(e), None
    except Exception as e:
        return False, repr(e), None

# ----------------- auto-shrink search -----------------
def bloat_autoshrink(sub: SubstrateInterface, kp: Keypair, app_id: int,
                     start_bytes: int, start_calls: int, max_calls: int,
                     min_bytes: int, min_calls: int, wait_finalized: bool):
    size = max(min_bytes, int(start_bytes))
    n    = max(min_calls, int(start_calls))
    max_calls = max(min_calls, int(max_calls))

    while size >= min_bytes:
        print(f"[try] payload_size={size} bytes, start_calls={n}")
        nn = min(n, max_calls)
        last_err = None
        # shrink call count by halving until it fits or hits 1
        while nn >= min_calls:
            ok, info, rcpt = submit_batch(sub, kp, size, nn, app_id, wait_finalized)
            if ok:
                print(f"[ok]   size={size}B n={nn} -> {info}")
                # small greedy bump: +10%
                best_n, best_rcpt = nn, rcpt
                probe = min(max_calls, int(nn * 1.1) + 1)
                while probe > best_n and probe <= max_calls:
                    ok2, info2, rcpt2 = submit_batch(sub, kp, size, probe, app_id, wait_finalized)
                    if ok2:
                        print(f"[ok+]  size={size}B n={probe} -> {info2}")
                        best_n, best_rcpt = probe, rcpt2
                        probe = min(max_calls, int(probe * 1.1) + 1)
                    else:
                        print(f"[reject] size={size}B n={probe} -> {info2}")
                        break
                return size, best_n, best_rcpt
            else:
                print(f"[reject] size={size}B n={nn} -> {info}")
                last_err = info
                nn = max(min_calls, nn // 2)
                if nn == 1 and "too large" in (last_err or "").lower():
                    # fall through to payload shrink quickly for length errors
                    break

        # even n=min_calls failed -> shrink payload
        print(f"[shrink] even n={min_calls} failed at size={size}B -> {last_err}")
        if size <= min_bytes:
            raise RuntimeError("Could not fit any payload; lower --chunk-bytes further or relax runtime limits.")
        size //= 2
        # when we shrink payload, reset n back up a bit
        n = max(min_calls, start_calls // max(1, int(math.ceil(start_bytes / size))))

# ----------------- CLI -----------------
def main():
    pa = argparse.ArgumentParser(description="Avail block bloat test (auto-shrink) + telemetry")
    pa.add_argument("--endpoint", default="ws://127.0.0.1:9944")
    pa.add_argument("--seed", default="//Alice")
    pa.add_argument("--app-id", type=int, default=0, help="Avail AppID (0 for chain ops; use your real AppID for apps)")
    pa.add_argument("--chunk-bytes", type=int, default=8192)
    pa.add_argument("--start-calls", type=int, default=300)
    pa.add_argument("--max-calls", type=int, default=1000)
    pa.add_argument("--min-chunk", type=int, default=64)
    pa.add_argument("--min-calls", type=int, default=1)
    pa.add_argument("--wait-finalized", action="store_true", help="also wait for finalization (slower)")
    args = pa.parse_args()

    sub = SubstrateInterface(url=args.endpoint, ss58_format=42)
    kp  = Keypair.create_from_uri(args.seed)

    print("=== Telemetry BEFORE ===")
    print(json.dumps(telemetry(sub), indent=2))

    try:
        size, calls, receipt = bloat_autoshrink(
            sub=sub, kp=kp, app_id=args.app_id,
            start_bytes=args.chunk_bytes, start_calls=args.start_calls,
            max_calls=args.max_calls, min_bytes=args.min_chunk, min_calls=args.min_calls,
            wait_finalized=args.wait_finalized
        )
    except Exception as e:
        print(f"Batch submission failed: {e}")
        return

    block_hash = getattr(receipt, "block_hash", None) or "<unknown>"
    approx_bytes = approx_block_extrinsics_bytes(sub, block_hash) if block_hash and block_hash.startswith("0x") else None
    print(json.dumps({
        "endpoint": args.endpoint,
        "block_hash": block_hash,
        "calls_sent": calls,
        "bytes_per_call": size,
        "approx_block_extrinsics_bytes": approx_bytes,
        "extrinsic_hash": getattr(receipt, "extrinsic_hash", None)
    }, indent=2))

    time.sleep(1.0)
    print("\n=== Telemetry AFTER ===")
    print(json.dumps(telemetry(sub), indent=2))

if __name__ == "__main__":
    main()
