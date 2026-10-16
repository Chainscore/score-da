#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
import base64
import time
from typing import Optional, Tuple, List, Dict

import requests


class EspressoDAClient:
    """
    Espresso DA Client for submitting and retrieving data.

    Endpoints used (Mainnet):
      POST /v1/submit/submit                        -> returns "TX~..." string
      GET  /v1/availability/transaction/hash/{tx}   -> tx inclusion & payload
      GET  /v1/availability/block/{height}/namespace/{ns}
      GET  /v1/availability/payload/block-hash/{block_hash} -> resolve height
    """

    def __init__(
        self,
        base_url: str = "https://query.main.net.espresso.network",
        api_version: str = "v1",
        timeout_sec: int = 30,
    ):
        self.base = base_url.rstrip("/")
        self.timeout = timeout_sec
        ver = f"/{api_version}" if api_version else ""
        # NOTE: submit is module + method
        self.submit_url = f"{self.base}{ver}/submit/submit"
        self.availability_url = f"{self.base}{ver}/availability"

    # --------------- Submit ---------------

    def submit(self, namespace: int, payload: bytes, verbose: bool = False) -> str:
        """
        Submit bytes to Espresso DA.
        Returns a tagged tx hash string like "TX~...".
        """
        if not (0 <= namespace <= 2**32 - 1):
            raise ValueError("namespace must fit in uint32 (0..4294967295)")

        body = {
            "namespace": int(namespace),
            "payload": base64.b64encode(payload).decode("ascii"),
        }

        if verbose:
            print(f"POST {self.submit_url}")
            print(
                f"Body: {{'namespace': {namespace}, 'payload': '...{len(body['payload'])} chars...'}}"
            )

        resp = requests.post(
            self.submit_url,
            json=body,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=self.timeout,
        )

        if verbose:
            print("Status:", resp.status_code)
            print("Raw:", resp.text[:300])

        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")

        # Expect a string (e.g. "TX~..."), but tolerate a dict wrapper.
        try:
            data = resp.json()
        except Exception:
            data = resp.text.strip()

        if isinstance(data, str) and data:
            return data
        if isinstance(data, dict):
            for k in ("hash", "tx_hash", "txHash", "tagged", "result"):
                v = data.get(k)
                if isinstance(v, str) and v:
                    return v

        raise ValueError(f"Unexpected submit response: {data!r}")

    # --------------- Inclusion Poll ---------------

    def get_tx_by_hash(self, tx_hash: str, verbose: bool = False) -> Optional[dict]:
        """
        Fetch inclusion info by tx hash; returns None if not yet found.
        """
        url = f"{self.availability_url}/transaction/hash/{tx_hash.strip()}"
        if verbose:
            print("GET", url)

        r = requests.get(url, headers={"Accept": "application/json"}, timeout=self.timeout)
        if r.status_code == 404:
            return None
        if r.status_code == 200:
            return r.json()
        if verbose:
            print(f"Availability check failed: {r.status_code} - {r.text[:200]}")
        return None

    def wait_for_inclusion(
        self,
        tx_hash: str,
        timeout_sec: int = 180,
        poll_every: float = 2.0,
        verbose: bool = False,
    ) -> Tuple[bool, Optional[dict]]:
        """
        Poll inclusion endpoint until found or timeout.
        """
        if verbose:
            print(f"Waiting for inclusion of {tx_hash[:16]}...")

        deadline = time.time() + timeout_sec
        attempts = 0

        while time.time() < deadline:
            attempts += 1
            info = self.get_tx_by_hash(tx_hash, verbose=verbose)
            if info:
                if verbose:
                    print(f"Transaction included after {attempts} attempts!")
                return True, info

            if verbose and attempts % 10 == 0:
                remaining = int(deadline - time.time())
                print(f"Still waiting... (attempt {attempts}, {remaining}s remaining)")

            time.sleep(poll_every)

        if verbose:
            print(f"Timeout after {attempts} attempts")
        return False, None

    # --------------- Helpers ---------------

    @staticmethod
    def _b64_to_bytes(b64: str) -> bytes:
        return base64.b64decode(b64.encode("ascii"))

    @staticmethod
    def _safe_try_text(b: bytes) -> Optional[str]:
        try:
            return b.decode("utf-8")
        except UnicodeDecodeError:
            return None

    # --------------- Reads / Recovery ---------------

    def read_tx_by_hash(self, tx_hash: str, verbose: bool = False) -> Optional[Dict]:
        """
        Recover a tx by its hash, including your original payload.
        Returns:
            {
              'namespace': int,
              'payload_b64': str,
              'payload_bytes': bytes,
              'payload_text': Optional[str],
              'block_height': int,
              'block_hash': str,
              'index': int
            } or None
        """
        url = f"{self.availability_url}/transaction/hash/{tx_hash.strip()}"
        if verbose:
            print("GET", url)

        r = requests.get(url, headers={"Accept": "application/json"}, timeout=self.timeout)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        data = r.json()

        # Expected shape: { transaction:{namespace, payload}, block_height, block_hash, index, ... }
        tx = data.get("transaction") or {}
        payload_b64 = tx.get("payload")
        ns = tx.get("namespace")

        if not isinstance(payload_b64, str) or ns is None:
            raise ValueError(f"Unexpected response (no transaction payload/namespace): {data}")

        payload_bytes = self._b64_to_bytes(payload_b64)
        return {
            "namespace": int(ns),
            "payload_b64": payload_b64,
            "payload_bytes": payload_bytes,
            "payload_text": self._safe_try_text(payload_bytes),
            "block_height": data.get("block_height"),
            "block_hash": data.get("block_hash"),
            "index": data.get("index"),
        }

    def read_block_namespace(self, height: int, namespace: int, verbose: bool = False) -> List[Dict]:
        """
        List ALL transactions in a given block for a namespace.
        Returns: [{ 'namespace', 'payload_b64', 'payload_bytes', 'payload_text' }, ...]
        """
        url = f"{self.availability_url}/block/{int(height)}/namespace/{int(namespace)}"
        if verbose:
            print("GET", url)

        r = requests.get(url, headers={"Accept": "application/json"}, timeout=self.timeout)
        if r.status_code == 404:
            return []
        r.raise_for_status()
        body = r.json()
        out: List[Dict] = []
        for tx in body.get("transactions", []):
            b64 = tx.get("payload")
            ns = tx.get("namespace")
            if isinstance(b64, str) and ns is not None:
                pb = self._b64_to_bytes(b64)
                out.append(
                    {
                        "namespace": int(ns),
                        "payload_b64": b64,
                        "payload_bytes": pb,
                        "payload_text": self._safe_try_text(pb),
                    }
                )
        return out

    def block_height_from_hash(self, block_hash: str, verbose: bool = False) -> Optional[int]:
        """
        Resolve a block hash to height via payload endpoint.
        """
        url = f"{self.availability_url}/payload/block-hash/{block_hash.strip()}"
        if verbose:
            print("GET", url)

        r = requests.get(url, headers={"Accept": "application/json"}, timeout=self.timeout)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        data = r.json()
        return data.get("height")

    def read_blockhash_namespace(self, block_hash: str, namespace: int, verbose: bool = False) -> List[Dict]:
        """
        Given a block hash + namespace, resolve height then list txs for that namespace.
        """
        h = self.block_height_from_hash(block_hash, verbose=verbose)
        if h is None:
            return []
        return self.read_block_namespace(h, namespace, verbose=verbose)


# ------------------ Quick demo ------------------
if __name__ == "__main__":
    # --- Submit + wait ---
    client = EspressoDAClient(api_version="v0", timeout_sec=30)
    ns = 1_000_000
    msg = b"Hello Espresso DA! This is test data from Python client."

    try:
        print(f"Submitting {len(msg)} bytes to namespace {ns}...")
        txh = client.submit(ns, msg, verbose=True)
        print("TX hash:", txh)

        print("Waiting for inclusion...")
        ok, meta = client.wait_for_inclusion(txh, timeout_sec=90, poll_every=3.0, verbose=True)
        if not ok:
            print("Not finalized within timeout.")
        else:
            print("Included:", meta)
            height = meta.get("block_height")
            bhash = meta.get("block_hash")

            # --- Recover directly via tx hash ---
            rec = client.read_tx_by_hash(txh, verbose=True)
            print("Recovered:", rec)
            
            if rec:
                print("Recovered bytes:", rec["payload_bytes"])
                print("Recovered text:", rec["payload_text"])

            # --- Or recover all txs for your namespace in the same block (by height) ---
            if height is not None:
                txs = client.read_block_namespace(height, ns, verbose=True)
                print(f"Block {height} ns {ns}: {len(txs)} tx(s)")

            # --- Or resolve height from block hash, then recover namespace slice ---
            if bhash:
                txs2 = client.read_blockhash_namespace(bhash, ns, verbose=True)
                print(f"[via block-hash] ns {ns}: {len(txs2)} tx(s)")
    except Exception as e:
        print("Error:", e)
