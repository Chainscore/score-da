# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
"""
Espresso DA Block-Based TPS Benchmark
Optimized for testing maximum throughput with 10k+ transactions per block
"""
import asyncio
import base64
import time
import statistics
from typing import Optional, List, Tuple, Set
from dataclasses import dataclass

import aiohttp

# ====================================================================
# CONFIGURATION - OPTIMIZED FOR MAX THROUGHPUT
# ====================================================================
CONFIG = {
    "BASE_URL": "https://query.main.net.espresso.network",
    "API_VERSION": "v0",
    
    # Block-based testing
    "TRANSACTIONS_PER_TEST": 10000,  # All submitted as fast as possible
    "NUM_TESTS": 3,                   # Number of test runs
    "CONCURRENCY": 1000,               # High concurrency for max speed
    "PAYLOAD_SIZE": 32,               # Minimal payload
    
    # Timeouts
    "SUBMIT_TIMEOUT": 10,
    "HTTP_TIMEOUT": 30,
    "CONNECT_TIMEOUT": 10,
    "SOCK_READ_TIMEOUT": 20,
    
    # Polling config
    "POLL_SAMPLE_SIZE": 50,           # Only poll a sample of transactions
    "POLL_INTERVAL": 2,               # Poll every 2 seconds
    "MAX_POLL_TIME": 300,             # 5 minutes max to find first inclusion
    
    "NAMESPACE": 1_000_000,
}

@dataclass
class BlockTestResult:
    test_num: int
    total_submitted: int
    submission_time: float
    first_inclusion_time: Optional[float]
    block_height: Optional[int]
    sampled_inclusions: int
    sample_size: int
    success: bool
    error: Optional[str] = None
    
    @property
    def submission_tps(self) -> float:
        """TPS based on submission speed"""
        if self.submission_time > 0:
            return self.total_submitted / self.submission_time
        return 0.0
    
    @property
    def block_tps(self) -> float:
        """TPS based on time to first inclusion (estimated block TPS)"""
        if self.first_inclusion_time and self.first_inclusion_time > 0:
            return self.total_submitted / self.first_inclusion_time
        return 0.0

# ====================================================================

class FastEspressoClient:
    """Optimized client for high-throughput testing"""
    
    def __init__(self, base_url: str, api_version: str, config: dict):
        base = base_url.rstrip("/")
        ver = f"/{api_version}" if api_version else ""
        self.submit_url = f"{base}{ver}/submit/submit"
        self.availability_base = f"{base}{ver}/availability"
        self._session: Optional[aiohttp.ClientSession] = None
        
        self._timeout = aiohttp.ClientTimeout(
            total=config["HTTP_TIMEOUT"],
            connect=config["CONNECT_TIMEOUT"],
            sock_connect=config["CONNECT_TIMEOUT"],
            sock_read=config["SOCK_READ_TIMEOUT"]
        )
        
        # High-performance connector
        self._connector = aiohttp.TCPConnector(
            limit=config["CONCURRENCY"] * 2,  # Higher limit
            limit_per_host=config["CONCURRENCY"] * 2,
            ttl_dns_cache=300,
            enable_cleanup_closed=True,
            force_close=False,  # Reuse connections
        )

    async def __aenter__(self):
        self._session = aiohttp.ClientSession(
            timeout=self._timeout,
            connector=self._connector
        )
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self._session:
            await self._session.close()
        if self._connector:
            await self._connector.close()

    async def submit(self, namespace: int, payload: bytes) -> Optional[str]:
        """Fast submit with minimal retries"""
        if not self._session:
            raise RuntimeError("Session not created")

        body = {
            "namespace": int(namespace),
            "payload": base64.b64encode(payload).decode("ascii")
        }
        
        try:
            async with self._session.post(
                self.submit_url,
                json=body,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                }
            ) as resp:
                if resp.status == 200:
                    text = await resp.text()
                    try:
                        data = await resp.json(content_type=None)
                        if isinstance(data, str):
                            return data
                        if isinstance(data, dict):
                            for k in ("hash", "tx_hash", "txHash", "tagged", "result"):
                                v = data.get(k)
                                if isinstance(v, str) and v:
                                    return v
                    except Exception:
                        pass
                    
                    if text.strip():
                        return text.strip()
                
                return None
                
        except Exception:
            return None

    async def check_inclusion(self, tx_hash: str) -> Optional[dict]:
        """Quick inclusion check"""
        if not self._session:
            return None
        
        url = f"{self.availability_base}/transaction/hash/{tx_hash.strip()}"
        
        try:
            async with self._session.get(url, headers={"Accept": "application/json"}) as resp:
                if resp.status == 200:
                    return await resp.json()
        except Exception:
            pass
        
        return None


def mk_payload(idx: int, size: int) -> bytes:
    """Generate minimal payload"""
    base = b"ETPS"
    s = base + f"#{idx}#".encode("ascii")
    if len(s) >= size:
        return s[:size]
    return (s * (size // len(s) + 1))[:size]


async def submit_all_fast(
    client: FastEspressoClient,
    namespace: int,
    count: int,
    concurrency: int
) -> Tuple[List[str], float]:
    """Submit all transactions as fast as possible"""
    
    print(f"\n🚀 Submitting {count:,} transactions with {concurrency} concurrent workers...")
    
    semaphore = asyncio.Semaphore(concurrency)
    submitted_hashes: List[str] = []
    progress_lock = asyncio.Lock()
    progress_counter = [0]
    
    start_time = time.time()
    
    async def submit_one(idx: int):
        payload = mk_payload(idx, CONFIG["PAYLOAD_SIZE"])
        try:
            async with semaphore:
                txh = await asyncio.wait_for(
                    client.submit(namespace, payload),
                    timeout=CONFIG["SUBMIT_TIMEOUT"]
                )
                
                if txh:
                    submitted_hashes.append(txh)
                
                # Progress updates
                async with progress_lock:
                    progress_counter[0] += 1
                    if progress_counter[0] % 500 == 0:
                        elapsed = time.time() - start_time
                        current_tps = progress_counter[0] / elapsed if elapsed > 0 else 0
                        print(f"   Progress: {progress_counter[0]:,}/{count:,} "
                              f"({current_tps:.1f} TPS)")
                
        except Exception:
            pass
    
    # Fire all submissions concurrently
    tasks = [asyncio.create_task(submit_one(i)) for i in range(count)]
    await asyncio.gather(*tasks, return_exceptions=True)
    
    end_time = time.time()
    submission_time = end_time - start_time
    
    print(f"   ✅ Submission complete: {len(submitted_hashes):,}/{count:,} in {submission_time:.2f}s")
    print(f"   📊 Submission TPS: {len(submitted_hashes)/submission_time:.2f}")
    
    return submitted_hashes, submission_time


async def wait_for_first_inclusion(
    client: FastEspressoClient,
    tx_hashes: List[str],
    sample_size: int
) -> Tuple[Optional[float], Optional[int], int]:
    """
    Poll a SAMPLE of transactions until first inclusion found.
    Returns: (time_to_first_inclusion, block_height, total_found_in_sample)
    """
    
    if not tx_hashes:
        return None, None, 0
    
    # Sample transactions to poll (don't poll all 10k!)
    import random
    sample = random.sample(tx_hashes, min(sample_size, len(tx_hashes)))
    
    print(f"\n⏳ Polling {len(sample)} sampled transactions for inclusion...")
    print(f"   (Checking every {CONFIG['POLL_INTERVAL']}s, timeout: {CONFIG['MAX_POLL_TIME']}s)")
    
    start_poll_time = time.time()
    deadline = start_poll_time + CONFIG["MAX_POLL_TIME"]
    
    first_inclusion_time = None
    block_height = None
    found_count = 0
    found_hashes: Set[str] = set()
    
    poll_round = 0
    
    while time.time() < deadline:
        poll_round += 1
        check_tasks = []
        
        # Check all sampled transactions in parallel
        for txh in sample:
            if txh not in found_hashes:
                check_tasks.append(asyncio.create_task(client.check_inclusion(txh)))
        
        if not check_tasks:
            break
        
        results = await asyncio.gather(*check_tasks, return_exceptions=True)
        
        for i, result in enumerate(results):
            txh = [t for t in sample if t not in found_hashes][i] if i < len(sample) else None
            
            if isinstance(result, dict) and result:
                found_count += 1
                if txh:
                    found_hashes.add(txh)
                
                # Record FIRST inclusion time
                if first_inclusion_time is None:
                    first_inclusion_time = time.time() - start_poll_time
                    block_height = result.get("block_height") or result.get("blockHeight") or result.get("height")
                    try:
                        if block_height is not None:
                            block_height = int(block_height)
                    except Exception:
                        pass
                    
                    print(f"   🎉 First inclusion found at {first_inclusion_time:.2f}s! Block: {block_height}")
        
        if found_count > 0:
            print(f"   📊 Poll round {poll_round}: Found {found_count}/{len(sample)} transactions")
        
        # If we found at least a few, we can estimate block inclusion
        if found_count >= max(3, len(sample) * 0.1):
            print(f"   ✅ Sufficient sample found ({found_count}/{len(sample)})")
            break
        
        await asyncio.sleep(CONFIG["POLL_INTERVAL"])
    
    elapsed = time.time() - start_poll_time
    
    if first_inclusion_time is None:
        print(f"   ⚠️ No inclusions found after {elapsed:.2f}s")
    
    return first_inclusion_time, block_height, found_count


async def run_block_test(
    client: FastEspressoClient,
    test_num: int
) -> BlockTestResult:
    """Run a single block-level test"""
    
    print(f"\n{'='*70}")
    print(f"🧪 TEST {test_num}: {CONFIG['TRANSACTIONS_PER_TEST']:,} transactions")
    print(f"{'='*70}")
    
    try:
        # Phase 1: Submit all transactions FAST
        tx_hashes, submission_time = await submit_all_fast(
            client,
            namespace=CONFIG["NAMESPACE"],
            count=CONFIG["TRANSACTIONS_PER_TEST"],
            concurrency=CONFIG["CONCURRENCY"]
        )
        
        if not tx_hashes:
            return BlockTestResult(
                test_num=test_num,
                total_submitted=0,
                submission_time=submission_time,
                first_inclusion_time=None,
                block_height=None,
                sampled_inclusions=0,
                sample_size=0,
                success=False,
                error="All submissions failed"
            )
        
        # Phase 2: Poll sample for inclusion
        first_inclusion_time, block_height, found_count = await wait_for_first_inclusion(
            client,
            tx_hashes,
            sample_size=CONFIG["POLL_SAMPLE_SIZE"]
        )
        
        result = BlockTestResult(
            test_num=test_num,
            total_submitted=len(tx_hashes),
            submission_time=submission_time,
            first_inclusion_time=first_inclusion_time,
            block_height=block_height,
            sampled_inclusions=found_count,
            sample_size=min(CONFIG["POLL_SAMPLE_SIZE"], len(tx_hashes)),
            success=first_inclusion_time is not None
        )
        
        # Print results
        print(f"\n📊 Test {test_num} Results:")
        print(f"   Submitted: {result.total_submitted:,} in {result.submission_time:.2f}s")
        print(f"   Submission TPS: {result.submission_tps:.2f}")
        
        if result.success:
            print(f"   First inclusion: {result.first_inclusion_time:.2f}s")
            print(f"   Block height: {result.block_height}")
            print(f"   Sample found: {result.sampled_inclusions}/{result.sample_size}")
            print(f"   🏆 Estimated Block TPS: {result.block_tps:.2f}")
        else:
            print(f"   ❌ No inclusions detected")
        
        return result
        
    except Exception as e:
        print(f"   ❌ Test {test_num} failed: {e}")
        return BlockTestResult(
            test_num=test_num,
            total_submitted=0,
            submission_time=0,
            first_inclusion_time=None,
            block_height=None,
            sampled_inclusions=0,
            sample_size=0,
            success=False,
            error=str(e)
        )


async def main_async():
    print("🚀 Espresso DA Block-Based TPS Benchmark")
    print(f"   Target: {CONFIG['BASE_URL']}")
    print(f"   Strategy: Submit {CONFIG['TRANSACTIONS_PER_TEST']:,} txs per test")
    print(f"   Tests: {CONFIG['NUM_TESTS']}")
    print(f"   Concurrency: {CONFIG['CONCURRENCY']}")
    print("=" * 70)
    
    async with FastEspressoClient(
        base_url=CONFIG["BASE_URL"],
        api_version=CONFIG["API_VERSION"],
        config=CONFIG
    ) as client:
        
        results: List[BlockTestResult] = []
        
        for i in range(1, CONFIG['NUM_TESTS'] + 1):
            result = await run_block_test(client, i)
            results.append(result)
            
            # Delay between tests
            if i < CONFIG['NUM_TESTS']:
                print(f"\n⏸️  Waiting 10 seconds before next test...")
                await asyncio.sleep(10)
        
        # === FINAL STATISTICS ===
        print("\n" + "=" * 70)
        print("📊 FINAL BENCHMARK RESULTS")
        print("=" * 70)
        
        successful = [r for r in results if r.success]
        
        if successful:
            print(f"\n✅ Successful Tests: {len(successful)}/{len(results)}")
            
            submission_tps_values = [r.submission_tps for r in successful]
            block_tps_values = [r.block_tps for r in successful if r.block_tps > 0]
            
            print(f"\n📤 SUBMISSION SPEED:")
            print(f"   Average: {statistics.mean(submission_tps_values):.2f} TPS")
            print(f"   Peak: {max(submission_tps_values):.2f} TPS")
            print(f"   Median: {statistics.median(submission_tps_values):.2f} TPS")
            
            if block_tps_values:
                print(f"\n🎯 BLOCK INCLUSION TPS (Actual Throughput):")
                print(f"   Average: {statistics.mean(block_tps_values):.2f} TPS")
                print(f"   Peak: {max(block_tps_values):.2f} TPS")
                print(f"   Median: {statistics.median(block_tps_values):.2f} TPS")
                
                print(f"\n📋 Test Details:")
                for r in successful:
                    print(f"   Test {r.test_num}: {r.total_submitted:,} txs → "
                          f"{r.first_inclusion_time:.2f}s → {r.block_tps:.2f} TPS "
                          f"(block {r.block_height})")
            
            total_txs = sum(r.total_submitted for r in successful)
            print(f"\n📈 Total transactions submitted: {total_txs:,}")
            
        else:
            print("\n❌ No successful tests completed.")
            for r in results:
                if not r.success:
                    print(f"   Test {r.test_num}: {r.error}")
        
        print("\n" + "=" * 70)
        print("✅ Benchmark complete!")


if __name__ == "__main__":
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        print("\n⚠️ Aborted by user")
    except Exception as e:
        print(f"\n💥 Fatal error: {e}")
        import traceback
        traceback.print_exc()