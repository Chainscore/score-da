#!/usr/bin/env python3
"""
Espresso Tiramisu DA — Full block collection (mainnet)

Fetches ALL blocks for N days into blocks/{YYYY-MM-DD}.csv day-files.
Resumable: on restart, picks up from the highest collected height.
Uses concurrent workers hitting the explorer API at 100 blocks/page
(~1,630 blocks/s throughput, ~30 min for 90 days / ~2.9M blocks).

Usage:
  python3 data/collect.py [--days 90] [--workers 20] [--base-url URL]

Outputs:
  blocks/{YYYY-MM-DD}.csv — height,timestamp_ms,size_bytes,num_transactions,block_time_ms
  chain_config.json       — protocol config + collection metadata
  collect.log             — append-mode log (in protocol/Espresso/)
"""

import argparse
import csv
import json
import logging
import statistics
import sys
import time as time_mod
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import requests

DEFAULT_BASE_URL = "https://query.main.net.espresso.network"
DEFAULT_DAYS = 90
DEFAULT_WORKERS = 20
PAGE_SIZE = 100
MAX_RETRIES = 5
RETRY_DELAY_S = 1.0

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / "blocks"
LOG_PATH = SCRIPT_DIR.parent / "collect.log"

MILESTONES = [
    {"label": "Cappuccino testnet", "date": "2024-05-01", "note": "VID (Savoiardi) integration"},
    {"label": "Decaf testnet", "date": "2024-09-01", "note": "Larger operator set"},
    {"label": "Mainnet 0 launch", "date": "2024-11-01", "note": "Initial permissioned mainnet"},
    {"label": "PoS testnet (Decaf)", "date": "2025-04-01", "note": "v1 API + PoS support"},
]


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging() -> logging.Logger:
    logger = logging.getLogger("espresso")
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

    fh = logging.FileHandler(LOG_PATH, mode="a")
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(sh)

    return logger


# ---------------------------------------------------------------------------
# HTTP session (connection pooling for concurrency)
# ---------------------------------------------------------------------------

_session = requests.Session()
_adapter = requests.adapters.HTTPAdapter(pool_connections=25, pool_maxsize=25)
_session.mount("https://", _adapter)
_session.mount("http://", _adapter)


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def api_get(base_url: str, path: str, retries: int = MAX_RETRIES):
    """GET with retries and exponential backoff."""
    url = f"{base_url}{path}"
    for attempt in range(retries):
        try:
            resp = _session.get(url, timeout=30)
            if resp.status_code == 429:
                wait = RETRY_DELAY_S * (2 ** attempt)
                time_mod.sleep(wait)
                continue
            resp.raise_for_status()
            ct = resp.headers.get("content-type", "")
            if ct.startswith("application/json"):
                return resp.json()
            text = resp.text.strip()
            try:
                return int(text)
            except ValueError:
                return text
        except requests.RequestException as e:
            if attempt < retries - 1:
                wait = RETRY_DELAY_S * (2 ** attempt)
                time_mod.sleep(wait)
            else:
                raise RuntimeError(f"Failed after {retries} attempts: {url} — {e}") from e


def get_tip(base_url: str) -> int:
    return int(api_get(base_url, "/v0/node/block-height"))


def get_header(base_url: str, height: int) -> dict:
    return api_get(base_url, f"/v0/availability/header/{height}")


def header_timestamp(base_url: str, height: int) -> int:
    """Get the unix timestamp (seconds) from a header."""
    h = get_header(base_url, height)
    fields = h.get("fields", h)
    return int(fields["timestamp"])


def extract_chain_config(header: dict) -> dict:
    """Walk header JSON to find chain_config fields."""
    if not isinstance(header, dict):
        return {}
    fields = header.get("fields", header)
    cc_wrapper = fields.get("chain_config", {})
    if isinstance(cc_wrapper, dict):
        inner = cc_wrapper.get("chain_config", cc_wrapper)
        if isinstance(inner, dict) and "Left" in inner:
            return inner["Left"]
        if "base_fee" in inner or "max_block_size" in inner:
            return inner
    return {}


def parse_block_time(ts) -> int:
    """Parse ISO string or unix-seconds int to epoch milliseconds."""
    if isinstance(ts, (int, float)):
        v = int(ts)
        return v * 1000 if v < 1e12 else v
    s = str(ts)
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return int(datetime.fromisoformat(s).timestamp() * 1000)


def find_height_at_timestamp(base_url: str, target_ts: int,
                             lo: int, hi: int) -> int:
    """Binary search for the block height closest to target_ts (unix seconds)."""
    while hi - lo > 100:
        mid = (lo + hi) // 2
        ts = header_timestamp(base_url, mid)
        if ts < target_ts:
            lo = mid
        else:
            hi = mid
    return lo


# ---------------------------------------------------------------------------
# Page fetching
# ---------------------------------------------------------------------------

def fetch_page(base_url: str, from_height: int, limit: int) -> list[dict]:
    """Fetch one page of block summaries.

    API: GET /v0/explorer/blocks/:from/:limit — returns blocks in descending
    order from :from, up to :limit blocks.
    """
    data = api_get(base_url, f"/v0/explorer/blocks/{from_height}/{limit}")
    if not isinstance(data, dict):
        return []
    summaries = data.get("block_summaries", [])
    blocks = []
    for s in summaries:
        blocks.append({
            "height": int(s["height"]),
            "timestamp_ms": parse_block_time(s["time"]),
            "size_bytes": int(s["size"]),
            "num_transactions": int(s["num_transactions"]),
        })
    return blocks


# ---------------------------------------------------------------------------
# Resumability — scan existing day-files
# ---------------------------------------------------------------------------

def scan_existing_data() -> Tuple[int, Optional[int]]:
    """Scan data/*.csv files to find max collected height and its timestamp_ms.

    Returns (max_height, last_timestamp_ms). If no data, returns (-1, None).
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    csv_files = sorted(DATA_DIR.glob("????-??-??.csv"))
    if not csv_files:
        return -1, None

    max_height = -1
    last_ts = None

    # Check the last file (most recent date) — max height should be there
    last_file = csv_files[-1]
    with open(last_file, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            h = int(row["height"])
            if h > max_height:
                max_height = h
                last_ts = int(row["timestamp_ms"])

    return max_height, last_ts


# ---------------------------------------------------------------------------
# Day-file writing
# ---------------------------------------------------------------------------

def ts_to_date(ts_ms: int) -> str:
    """Convert epoch ms to YYYY-MM-DD string (UTC)."""
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def write_day_files(blocks: list[dict], log: logging.Logger) -> int:
    """Write blocks to data/{date}.csv files. Appends to existing day-files.

    Returns the number of day-files written/appended.
    """
    by_date: Dict[str, List[dict]] = defaultdict(list)
    for b in blocks:
        date = ts_to_date(b["timestamp_ms"])
        by_date[date].append(b)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    files_written = 0

    for date, day_blocks in sorted(by_date.items()):
        day_blocks.sort(key=lambda b: b["height"])
        path = DATA_DIR / f"{date}.csv"

        if path.exists():
            with open(path, "a", newline="") as f:
                writer = csv.writer(f)
                for b in day_blocks:
                    writer.writerow([
                        b["height"], b["timestamp_ms"], b["size_bytes"],
                        b["num_transactions"], b["block_time_ms"],
                    ])
            log.info(f"  Appended {len(day_blocks)} rows to {path.name}")
        else:
            with open(path, "w", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(["height", "timestamp_ms", "size_bytes",
                                 "num_transactions", "block_time_ms"])
                for b in day_blocks:
                    writer.writerow([
                        b["height"], b["timestamp_ms"], b["size_bytes"],
                        b["num_transactions"], b["block_time_ms"],
                    ])
            log.info(f"  Created {path.name} ({len(day_blocks)} rows)")
        files_written += 1

    return files_written


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    log = setup_logging()

    parser = argparse.ArgumentParser(description="Espresso DA — full block collection")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS,
                        help=f"Number of days to collect (default: {DEFAULT_DAYS})")
    parser.add_argument("--blocks", type=int, default=None,
                        help="Number of blocks to collect (overrides --days)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS,
                        help=f"Concurrent fetch workers (default: {DEFAULT_WORKERS})")
    parser.add_argument("--base-url", type=str, default=DEFAULT_BASE_URL)
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    num_days = args.days
    num_workers = args.workers

    log.info("=" * 80)
    log.info("Espresso DA — Block Collection")
    log.info(f"  days={num_days}  workers={num_workers}  url={base_url}")

    # --- 1. Chain state ---
    tip = get_tip(base_url)
    tip_ts = header_timestamp(base_url, tip)
    tip_dt = datetime.fromtimestamp(tip_ts, tz=timezone.utc)
    log.info(f"Chain tip: height={tip}  time={tip_dt.isoformat()}")

    # Chain config from tip header
    header_tip = get_header(base_url, tip)
    cc = extract_chain_config(header_tip)
    max_block_size = int(cc.get("max_block_size", 1_000_000))
    base_fee = int(cc.get("base_fee", 1))
    fee_contract = cc.get("fee_contract", "")
    log.info(f"Chain config: max_block_size={max_block_size}  base_fee={base_fee} wei/byte")

    # --- 2. Find start height ---
    if args.blocks is not None:
        start_height = max(0, tip - args.blocks)
        actual_start_ts = header_timestamp(base_url, start_height)
        start_dt = datetime.fromtimestamp(actual_start_ts, tz=timezone.utc)
        log.info(f"Start: height={start_height}  time={start_dt.isoformat()} (--blocks {args.blocks})")
    else:
        start_ts = tip_ts - (num_days * 86400)
        log.info(f"Binary searching for height at {num_days} days ago...")
        start_height = find_height_at_timestamp(base_url, start_ts, 0, tip)
        actual_start_ts = header_timestamp(base_url, start_height)
        start_dt = datetime.fromtimestamp(actual_start_ts, tz=timezone.utc)
        log.info(f"Start: height={start_height}  time={start_dt.isoformat()}")
    total_blocks = tip - start_height
    log.info(f"Range: {total_blocks:,} blocks over ~{num_days} days")

    # --- 3. Check resumability ---
    max_collected, last_ts = scan_existing_data()
    if max_collected >= start_height:
        fetch_start = max_collected + 1
        prev_ts = last_ts
        skipped = fetch_start - start_height
        remaining = tip - fetch_start + 1
        log.info(f"Resuming: max collected height={max_collected}, "
                 f"skipping {skipped:,} blocks")
        log.info(f"  Remaining: {remaining:,} blocks ({fetch_start} -> {tip})")
    else:
        fetch_start = start_height
        prev_ts = None
        remaining = total_blocks
        log.info(f"Fresh start: collecting {remaining:,} blocks "
                 f"({fetch_start} -> {tip})")

    if fetch_start > tip:
        log.info("Already up to date — nothing to fetch.")
        return

    # --- 4. Generate page requests ---
    # API returns descending from :from, so to get blocks [X, X+99]
    # we request from=X+99, limit=100
    pages = []
    offset = 0
    while fetch_start + offset <= tip:
        page_start = fetch_start + offset
        page_end = min(page_start + PAGE_SIZE - 1, tip)
        limit = page_end - page_start + 1
        pages.append((page_end, limit))
        offset += PAGE_SIZE

    log.info(f"Pages to fetch: {len(pages):,} "
             f"({PAGE_SIZE} blocks/page, {num_workers} workers)")

    # --- 5. Fetch with concurrent workers ---
    all_blocks = []
    errors = 0
    t0 = time_mod.monotonic()
    fetched = 0

    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        future_to_page = {}
        for from_h, limit in pages:
            fut = executor.submit(fetch_page, base_url, from_h, limit)
            future_to_page[fut] = (from_h, limit)

        for fut in as_completed(future_to_page):
            from_h, limit = future_to_page[fut]
            try:
                blocks = fut.result()
                all_blocks.extend(blocks)
                fetched += len(blocks)
                if fetched % 10_000 < limit:
                    elapsed = time_mod.monotonic() - t0
                    rate = fetched / elapsed if elapsed > 0 else 0
                    log.info(f"  Progress: {fetched:,} / ~{remaining:,} blocks "
                             f"({rate:,.0f} blocks/s)")
            except Exception as e:
                errors += 1
                log.error(f"  Page from={from_h} limit={limit} failed: {e}")

    elapsed = time_mod.monotonic() - t0
    rate = fetched / elapsed if elapsed > 0 else 0
    log.info(f"Fetch complete: {fetched:,} blocks in {elapsed:.1f}s "
             f"({rate:,.0f} blocks/s), {errors} errors")

    if not all_blocks:
        log.error("No blocks fetched — aborting.")
        return

    # --- 6. Deduplicate, sort, compute block_time_ms ---
    seen: Set[int] = set()
    unique_blocks = []
    for b in all_blocks:
        if b["height"] not in seen and fetch_start <= b["height"] <= tip:
            seen.add(b["height"])
            unique_blocks.append(b)
    all_blocks = unique_blocks
    all_blocks.sort(key=lambda b: b["height"])

    for i, b in enumerate(all_blocks):
        if i == 0:
            if prev_ts is not None:
                b["block_time_ms"] = b["timestamp_ms"] - prev_ts
            else:
                b["block_time_ms"] = 0
        else:
            b["block_time_ms"] = b["timestamp_ms"] - all_blocks[i - 1]["timestamp_ms"]

    log.info(f"After dedup: {len(all_blocks):,} unique blocks")

    # --- 7. Write day files ---
    log.info("Writing day files...")
    files_written = write_day_files(all_blocks, log)

    # --- 8. Write chain_config.json ---
    block_times = [b["block_time_ms"] for b in all_blocks if b["block_time_ms"] > 0]
    avg_bt = statistics.mean(block_times) if block_times else 0
    median_bt = statistics.median(block_times) if block_times else 1000
    median_bt_s = median_bt / 1000
    protocol_max = (max_block_size / median_bt_s) / 1_048_576 if median_bt_s > 0 else 0

    config = {
        "blockRange": {
            "start": start_height,
            "end": tip,
            "count": total_blocks,
            "fetchedRows": len(all_blocks),
        },
        "config": {
            "maxBlockSize": max_block_size,
            "baseFee": base_fee,
            "feeContract": fee_contract,
            "avgBlockTimeMs": round(avg_bt, 1),
            "medianBlockTimeMs": round(median_bt, 1),
            "protocolMaxMibps": round(protocol_max, 4),
        },
        "milestones": MILESTONES,
        "collectedAt": datetime.now(timezone.utc).isoformat(),
        "baseUrl": base_url,
    }
    config_path = DATA_DIR / "chain_config.json"
    config_path.write_text(json.dumps(config, indent=2) + "\n")
    log.info(f"Config -> {config_path}")

    # --- 9. Summary ---
    total_bytes = sum(b["size_bytes"] for b in all_blocks)
    day_files = sorted(DATA_DIR.glob("????-??-??.csv"))

    log.info("=" * 80)
    log.info("COLLECTION SUMMARY")
    log.info(f"  Time range:     {num_days} days ({start_height} -> {tip})")
    log.info(f"  Blocks fetched: {len(all_blocks):,}")
    log.info(f"  Day files:      {len(day_files)} ({files_written} written this run)")
    log.info(f"  Total bytes:    {total_bytes:,} ({total_bytes / 1024**3:.2f} GiB)")
    log.info(f"  Max block size: {max_block_size:,} B")
    log.info(f"  Base fee:       {base_fee} wei/byte")
    log.info(f"  Avg block time: {avg_bt:.0f} ms")
    log.info(f"  Median BT:      {median_bt:.0f} ms")
    log.info(f"  Protocol max:   {protocol_max:.4f} MiB/s")
    log.info(f"  Fetch errors:   {errors}")
    log.info("=" * 80)


if __name__ == "__main__":
    main()
