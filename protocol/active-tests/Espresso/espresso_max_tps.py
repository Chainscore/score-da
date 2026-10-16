#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
"""
espresso_stresstest_async.py

Submit many transactions concurrently to Espresso DA (async), wait for inclusion,
and print per-block counts + namespace contents.

Usage example:
python espresso_stresstest_async.py \
  --base https://query.main.net.espresso.network --api v0 \
  --namespace 1000000 --num 100 --concurrency 50 --payload-size 128 \
  --submit-timeout 15 --include-timeout 90
"""
import asyncio
import base64
import argparse
import json
import time
from typing import Optional, Dict, List, Tuple, Any

import aiohttp

# ---------------------- Async Espresso client ----------------------


class AsyncEspressoDAClient:
    def __init__(self, base_url: str = "https://query.main.net.espresso.network", api_version: str = "v1", timeout: int = 30):
        base = base_url.rstrip("/")
        ver = f"/{api_version}" if api_version else ""
        self.submit_url = f"{base}{ver}/submit/submit"
        self.availability_base = f"{base}{ver}/availability"
        # aiohttp session will be created in async context
        self._session: Optional[aiohttp.ClientSession] = None
        self._timeout = aiohttp.ClientTimeout(total=timeout, sock_connect=10, sock_read=10)

    async def __aenter__(self):
        self._session = aiohttp.ClientSession(timeout=self._timeout)
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self._session:
            await self._session.close()

    async def submit(self, namespace: int, payload: bytes, *, retries: int = 3, backoff_base: float = 0.25) -> str:
        """
        Submit bytes to Espresso DA. Returns tagged tx string like "TX~..."
        Retries with exponential backoff on transient failures.
        """
        if not self._session:
            raise RuntimeError("Session not created; use 'async with AsyncEspressoDAClient(...) as client'")

        if not (0 <= namespace <= 2**32 - 1):
            raise ValueError("namespace must fit in uint32")

        body = {"namespace": int(namespace), "payload": base64.b64encode(payload).decode("ascii")}
        last_exc = None
        for attempt in range(1, retries + 1):
            try:
                async with self._session.post(self.submit_url, json=body, headers={"Accept": "application/json", "Content-Type": "application/json"}) as resp:
                    text = await resp.text()
                    if resp.status != 200:
                        # treat 429/5xx as retryable; 4xx other than 429 as fatal
                        if resp.status in (429, 500, 502, 503, 504):
                            last_exc = RuntimeError(f"HTTP {resp.status}: {text}")
                            # fallthrough to retry
                        else:
                            raise RuntimeError(f"HTTP {resp.status}: {text}")
                    else:
                        # parse JSON or plain string
                        try:
                            data = await resp.json(content_type=None)
                        except Exception:
                            data = text.strip()
                        # try to extract tx string
                        if isinstance(data, str) and data:
                            return data
                        if isinstance(data, dict):
                            for k in ("hash", "tx_hash", "txHash", "tagged", "result"):
                                v = data.get(k)
                                if isinstance(v, str) and v:
                                    return v
                        # fallback: return text if it looks like TX~...
                        if isinstance(text, str) and text.strip():
                            return text.strip()
                        raise RuntimeError(f"Unexpected submit response: {data!r}")
            except Exception as e:
                last_exc = e
                if attempt < retries:
                    await asyncio.sleep(backoff_base * (2 ** (attempt - 1)))
                    continue
                break
        raise last_exc

    async def get_tx_by_hash(self, tx_hash: str) -> Optional[dict]:
        """Return JSON meta if included, or None if 404/not found"""
        if not self._session:
            raise RuntimeError("Session not created")
        url = f"{self.availability_base}/transaction/hash/{tx_hash.strip()}"
        async with self._session.get(url, headers={"Accept": "application/json"}) as resp:
            if resp.status == 404:
                return None
            if resp.status == 200:
                return await resp.json()
            # non-200 but non-404 -> treat as None for polling
            return None

    async def wait_for_inclusion(self, tx_hash: str, timeout_sec: int = 90, poll_every: float = 2.0) -> Tuple[bool, Optional[dict]]:
        """
        Poll inclusion endpoint until found or timeout.
        Returns (found, metadata-or-none)
        """
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            info = await self.get_tx_by_hash(tx_hash)
            if info:
                return True, info
            await asyncio.sleep(poll_every)
        return False, None

    async def read_block_namespace(self, height: int, namespace: int) -> List[Dict[str, Any]]:
        """List all transactions in a block for a namespace (returns list of tx dicts)"""
        if not self._session:
            raise RuntimeError("Session not created")
        url = f"{self.availability_base}/block/{int(height)}/namespace/{int(namespace)}"
        async with self._session.get(url, headers={"Accept": "application/json"}) as resp:
            if resp.status == 404:
                return []
            resp.raise_for_status()
            body = await resp.json()
            out = []
            for tx in body.get("transactions", []):
                b64 = tx.get("payload")
                ns = tx.get("namespace")
                if isinstance(b64, str) and ns is not None:
                    pb = base64.b64decode(b64.encode("ascii"))
                    try:
                        text = pb.decode("utf-8")
                    except Exception:
                        text = None
                    out.append({"namespace": int(ns), "payload_b64": b64, "payload_bytes": pb, "payload_text": text})
            return out


# ---------------------- Helper / runner ----------------------


def mk_payload(base: bytes, idx: int, size: int) -> bytes:
    """Generate deterministic-ish payload of approximately 'size' bytes"""
    s = base + f"#{idx}".encode("ascii") + b"-" + str(int(time.time() * 1000)).encode("ascii")
    if len(s) >= size:
        return s[:size]
    # repeat until we hit size
    pieces = []
    while sum(len(p) for p in pieces) < size:
        pieces.append(s)
    data = b"".join(pieces)[:size]
    return data


async def submit_many_and_wait(
    client: AsyncEspressoDAClient,
    namespace: int,
    num: int,
    concurrency: int,
    payload_size: int,
    submit_timeout: int,
    include_timeout: int,
) -> Tuple[List[Tuple[str, Optional[int]]], List[Tuple[str, str]]]:
    """
    Submit `num` txs concurrently (limit concurrency), wait for inclusion for each.
    Returns:
      - included: list of (tx_hash, block_height_or_None)
      - failed: list of (tx_hash_or_label, error_text)
    """
    semaphore = asyncio.Semaphore(concurrency)
    submitted_hashes: List[str] = []
    failed_submissions: List[Tuple[str, str]] = []
    base_msg = b"Espresso async stress test payload "

    async def do_submit(idx: int):
        nonlocal submitted_hashes
        payload = mk_payload(base_msg, idx, payload_size)
        try:
            # timeout for submit: use asyncio.wait_for around client.submit
            txh = await asyncio.wait_for(client.submit(namespace, payload, retries=4), timeout=submit_timeout)
            submitted_hashes.append(txh)
            return txh, None
        except Exception as e:
            err = str(e)
            failed_submissions.append((f"submit#{idx}", err))
            return None, err

    # Submit many (concurrent)
    submit_tasks = []

    async def submit_worker(i):
        async with semaphore:
            return await do_submit(i)

    for i in range(num):
        submit_tasks.append(asyncio.create_task(submit_worker(i)))

    # gather submissions
    results = await asyncio.gather(*submit_tasks)
    # collect successful tx hashes in order of creation
    tx_hashes = [r[0] for r in results if r[0] is not None]

    if not tx_hashes:
        return [], failed_submissions

    # Poll inclusion concurrently (but don't exceed concurrency)
    included: List[Tuple[str, Optional[int]]] = []
    included_failures: List[Tuple[str, str]] = []

    async def poll_one(txh: str):
        async with semaphore:
            found, meta = await client.wait_for_inclusion(txh, timeout_sec=include_timeout, poll_every=2.0)
            if found and meta:
                height = meta.get("block_height") or meta.get("blockHeight") or meta.get("height")
                # some APIs return block number as string; normalize to int when possible
                try:
                    if height is not None:
                        height = int(height)
                except Exception:
                    pass
                included.append((txh, height))
            else:
                included_failures.append((txh, "timeout"))

    poll_tasks = [asyncio.create_task(poll_one(h)) for h in tx_hashes]
    await asyncio.gather(*poll_tasks)

    # return included + submission failures as 'failed' with reason
    failed_all = failed_submissions + [(h, reason) for (h, reason) in included_failures]
    return included, failed_all


async def main_async(args):
    async with AsyncEspressoDAClient(base_url=args.base, api_version=args.api, timeout=args.http_timeout) as client:
        print(f"Connected to {args.base} (api={args.api}). Submitting {args.num} txs with concurrency {args.concurrency} ...")
        included, failed = await submit_many_and_wait(
            client,
            namespace=args.namespace,
            num=args.num,
            concurrency=args.concurrency,
            payload_size=args.payload_size,
            submit_timeout=args.submit_timeout,
            include_timeout=args.include_timeout,
        )

        print("\n--- Submission summary ---")
        print(f"Requested: {args.num}")
        print(f"Included count: {len(included)}")
        print(f"Failed count: {len(failed)}")
        if failed:
            print("Some failures (first 10):")
            for f in failed[:10]:
                print(" ", f)

        # Group by block
        by_block: Dict[Optional[int], List[str]] = {}
        for txh, h in included:
            by_block.setdefault(h, []).append(txh)
        print("\n=== Inclusion by block ===")
        if not by_block:
            print("No inclusions observed.")
        else:
            for h, lst in sorted(by_block.items(), key=lambda kv: (kv[0] if kv[0] is not None else -1)):
                label = f"block {h}" if h is not None else "no-block"
                print(f"{label}: {len(lst)} tx(s)")

        # If we have any block with >1 tx, fetch namespace slice for that block and print payloads
        target_block = None
        for h, lst in by_block.items():
            if h is not None and len(lst) > 1:
                target_block = h
                break
        # fallback to first included block
        if target_block is None and included:
            target_block = included[0][1]

        if target_block is not None:
            print(f"\nFetching namespace {args.namespace} contents for block {target_block} ...")
            txs = await client.read_block_namespace(target_block, args.namespace)
            print(f"Found {len(txs)} tx(s) in block {target_block} for namespace {args.namespace}")
            for i, t in enumerate(txs):
                preview = t["payload_text"] or f"<{len(t['payload_bytes'])} bytes binary>"
                print(f"  #{i+1}: {preview}")

        print("\nDone.")


# ---------------------- CLI ----------------------
def parse_args():
    p = argparse.ArgumentParser(description="Espresso DA async stress test")
    p.add_argument("--base", default="https://query.main.net.espresso.network", help="Espresso base URL")
    p.add_argument("--api", default="v0", help="API version (v0/v1)")
    p.add_argument("--namespace", type=int, default=1_000_000, help="Namespace (uint32)")
    p.add_argument("--num", type=int, default=10, help="Number of transactions to submit")
    p.add_argument("--concurrency", type=int, default=20, help="Concurrent submit / poll workers")
    p.add_argument("--payload-size", type=int, default=128, help="Bytes per payload")
    p.add_argument("--submit-timeout", type=int, default=15, help="Timeout (s) for each submit call")
    p.add_argument("--include-timeout", type=int, default=90, help="Timeout (s) to wait for inclusion per tx")
    p.add_argument("--http-timeout", type=int, default=30, help="HTTP client total timeout (s)")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("Aborted by user")
