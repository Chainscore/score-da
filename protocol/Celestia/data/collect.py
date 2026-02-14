#!/usr/bin/env python3
from __future__ import annotations
"""
Celestia DA — 90-day block & price collector

Fetches ~90 days of per-block data from Celenium API and TIA/USD prices
from CoinGecko.  Blocks are partitioned into daily CSV files under blocks/.

Outputs:
  blocks/{YYYY-MM-DD}.csv — per-block data for that UTC day
  prices.csv              — TIA/USD hourly prices (90d from CoinGecko)
  chain_config.json       — protocol config, eras, summary stats

Usage:
  python3 data/collect.py                # collect 90 days + prices
  python3 data/collect.py --days 30      # collect 30 days
  python3 data/collect.py --resume       # resume interrupted collection
  python3 data/collect.py --prices-only  # only collect prices
  python3 data/collect.py --workers 1    # sequential (slower, gentler)

Rate limits (Celenium free tier): 3 RPS, 100K RPD
"""

import argparse
import csv
import json
import math
import os
import re
import signal
import statistics
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CELENIUM_BASE = "https://api-mainnet.celenium.io"
PAGE_SIZE = 100
MAX_RETRIES = 3
RPS_LIMIT = 2.8      # stay under 3 RPS
BLOCKS_PER_DAY = 14_400  # ~6s block time

MiB = 1_048_576
UTIA_PER_TIA = 1_000_000
SHARE_SIZE = 512

DIR = Path(__file__).parent
BLOCKS_DIR = DIR / "blocks"
CHECKPOINT_FILE = DIR / ".checkpoint.json"

CSV_COLUMNS = [
    "height", "time", "timestamp_ms", "version_app", "hash",
    "proposer_address", "proposer_moniker",
    "tx_count", "events_count", "blobs_size", "blobs_count",
    "block_time_ms", "square_size", "fill_rate", "fee_utia",
    "gas_used", "gas_limit", "bytes_in_block",
    "supply_change", "inflation_rate", "rewards", "commissions",
]

ERAS = [
    {
        "label": "Lemongrass",
        "maxAppVersion": 2,
        "maxSquareSize": 64,
        "avgBlockTimeS": 12,
        "maxDataBytes": 64 * 64 * SHARE_SIZE,
    },
    {
        "label": "Ginger",
        "minAppVersion": 3,
        "maxAppVersion": 5,
        "maxSquareSize": 64,
        "avgBlockTimeS": 6,
        "maxDataBytes": 64 * 64 * SHARE_SIZE,
    },
    {
        "label": "Current",
        "minAppVersion": 6,
        "maxSquareSize": 128,
        "avgBlockTimeS": 6,
        "maxDataBytes": 128 * 128 * SHARE_SIZE,
    },
]

DA_AVAILABILITY_DAYS = 30.042

# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------

shutdown_requested = False


def _handle_sigint(sig, frame):
    global shutdown_requested
    if shutdown_requested:
        print("\nForce exit.")
        sys.exit(1)
    shutdown_requested = True
    print("\nGraceful shutdown — saving progress after current batch...")


signal.signal(signal.SIGINT, _handle_sigint)

# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------


class RateLimiter:
    """Thread-safe token-bucket rate limiter."""

    def __init__(self, rps: float):
        self.min_interval = 1.0 / rps
        self._lock = threading.Lock()
        self._last = 0.0

    def acquire(self):
        with self._lock:
            now = time.monotonic()
            wait = self.min_interval - (now - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------


def api_get(url: str, params: dict = None, retries: int = MAX_RETRIES):
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=30)
            if resp.status_code == 429:
                wait = 2 ** (attempt + 1)
                print(f"  429 rate-limited, backoff {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            if attempt < retries - 1:
                time.sleep(1.0 * (attempt + 1))
            else:
                raise RuntimeError(f"Failed after {retries} retries: {url} — {e}") from e


def get_block_count() -> int:
    return int(api_get(f"{CELENIUM_BASE}/v1/block/count"))


def get_era(version_app: int) -> dict:
    for era in reversed(ERAS):
        if version_app >= era.get("minAppVersion", 0):
            return era
    return ERAS[0]


# ---------------------------------------------------------------------------
# Timestamp parsing (Python 3.9 compatible)
# ---------------------------------------------------------------------------

_FRAC_RE = re.compile(r"^(.+\.\d+)(\+.*)$")


def parse_iso_ts(ts: str) -> tuple[int, str]:
    """Parse ISO 8601 timestamp → (unix_ms, date_str YYYY-MM-DD)."""
    raw = ts
    ts = ts.replace("Z", "+00:00")
    m = _FRAC_RE.match(ts)
    if m:
        base, tz_part = m.group(1), m.group(2)
        dot_idx = base.rfind(".")
        frac = (base[dot_idx + 1:] + "000000")[:6]
        ts = base[:dot_idx + 1] + frac + tz_part
    dt = datetime.fromisoformat(ts)
    return int(dt.timestamp() * 1000), dt.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Block parsing
# ---------------------------------------------------------------------------


def parse_block(b: dict) -> dict:
    """Parse a Celenium block response into a flat CSV row."""
    stats = b.get("stats") or {}
    proposer = b.get("proposer") or {}
    ts_str = b.get("time", "")
    ts_ms, date_str = parse_iso_ts(ts_str)

    def _int(v):
        try:
            return int(v)
        except (TypeError, ValueError):
            return 0

    def _float(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    def _str(v):
        return str(v).replace(",", " ") if v else ""  # sanitize commas for CSV

    return {
        "height": _int(b.get("height")),
        "time": ts_str,
        "timestamp_ms": ts_ms,
        "version_app": _int(b.get("version_app")),
        "hash": _str(b.get("hash")),
        "proposer_address": _str(proposer.get("cons_address")),
        "proposer_moniker": _str(proposer.get("moniker")),
        "tx_count": _int(stats.get("tx_count")),
        "events_count": _int(stats.get("events_count")),
        "blobs_size": _int(stats.get("blobs_size")),
        "blobs_count": _int(stats.get("blobs_count")),
        "block_time_ms": _int(stats.get("block_time")),
        "square_size": _int(stats.get("square_size")),
        "fill_rate": _float(stats.get("fill_rate")),
        "fee_utia": _int(stats.get("fee")),
        "gas_used": _int(stats.get("gas_used")),
        "gas_limit": _int(stats.get("gas_limit")),
        "bytes_in_block": _int(stats.get("bytes_in_block")),
        "supply_change": _str(stats.get("supply_change")),
        "inflation_rate": _str(stats.get("inflation_rate")),
        "rewards": _str(stats.get("rewards")),
        "commissions": _str(stats.get("commissions")),
        "_date": date_str,  # internal, for partitioning
    }


# ---------------------------------------------------------------------------
# Checkpoint
# ---------------------------------------------------------------------------


def save_checkpoint(pages_done: int, tip: int, total_pages: int):
    CHECKPOINT_FILE.write_text(json.dumps({
        "pages_done": pages_done,
        "tip_height": tip,
        "total_pages": total_pages,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }) + "\n")


def load_checkpoint() -> dict | None:
    if CHECKPOINT_FILE.exists():
        try:
            return json.loads(CHECKPOINT_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return None


def clear_checkpoint():
    if CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()


# ---------------------------------------------------------------------------
# Block collection
# ---------------------------------------------------------------------------


def fetch_page(offset: int, limiter: RateLimiter) -> list[dict]:
    """Fetch one page of 100 blocks from Celenium."""
    limiter.acquire()
    data = api_get(
        f"{CELENIUM_BASE}/v1/block",
        params={"limit": PAGE_SIZE, "offset": offset, "sort": "desc", "stats": "true"},
    )
    if not data:
        return []
    return [parse_block(b) for b in data]


def collect_blocks(days: int, workers: int, resume: bool) -> list[dict]:
    """
    Fetch all blocks for the given number of days using concurrent workers.

    Uses sort=desc (newest first) with offset pagination.
    Returns blocks sorted ascending by height.
    """
    global shutdown_requested

    tip = get_block_count()
    total_blocks = int(days * BLOCKS_PER_DAY)
    total_pages = math.ceil(total_blocks / PAGE_SIZE)

    print(f"Chain tip:     {tip:,}")
    print(f"Target:        ~{total_blocks:,} blocks ({days} days)")
    print(f"API calls:     {total_pages:,} pages × {PAGE_SIZE} blocks")
    print(f"Workers:       {workers}")
    print(f"Rate limit:    {RPS_LIMIT} RPS")

    est_seconds = total_pages / RPS_LIMIT
    print(f"Estimated:     {est_seconds/60:.0f} min\n")

    # Check for resume
    start_page = 0
    if resume:
        ckpt = load_checkpoint()
        if ckpt and abs(ckpt.get("tip_height", 0) - tip) < 2000:
            start_page = ckpt["pages_done"]
            print(f"Resuming from page {start_page}/{total_pages}")
        elif ckpt:
            print(f"Tip shifted too much ({ckpt.get('tip_height')} → {tip}), starting fresh")

    limiter = RateLimiter(RPS_LIMIT)
    all_blocks = []
    lock = threading.Lock()

    # If resuming, load blocks from existing daily files
    if start_page > 0:
        existing = load_existing_blocks()
        all_blocks.extend(existing)
        print(f"Loaded {len(existing):,} blocks from existing daily files\n")

    offsets = [p * PAGE_SIZE for p in range(start_page, total_pages)]

    def _fetch(offset):
        return fetch_page(offset, limiter)

    t0 = time.monotonic()
    pages_done = start_page

    with ThreadPoolExecutor(max_workers=workers) as pool:
        # pool.map preserves order and provides backpressure
        for i, page_blocks in enumerate(pool.map(_fetch, offsets)):
            if shutdown_requested:
                break

            with lock:
                all_blocks.extend(page_blocks)
                pages_done = start_page + i + 1

            # Progress
            if (i + 1) % 50 == 0 or (i + 1) == len(offsets):
                elapsed = time.monotonic() - t0
                rate = (i + 1) / elapsed if elapsed > 0 else 0
                eta = (len(offsets) - i - 1) / rate if rate > 0 else 0
                print(
                    f"  {pages_done}/{total_pages} pages  "
                    f"({len(all_blocks):,} blocks)  "
                    f"{rate:.1f} pg/s  "
                    f"ETA {int(eta//60)}m{int(eta%60):02d}s",
                    flush=True,
                )

            # Checkpoint every 200 pages
            if (i + 1) % 200 == 0:
                save_checkpoint(pages_done, tip, total_pages)

    # Final checkpoint
    save_checkpoint(pages_done, tip, total_pages)

    if shutdown_requested:
        print(f"\nInterrupted at page {pages_done}/{total_pages}")
        print(f"Run with --resume to continue\n")

    # Deduplicate by height (in case of overlap from resume)
    seen = set()
    unique = []
    for b in all_blocks:
        h = b["height"]
        if h not in seen:
            seen.add(h)
            unique.append(b)

    # Sort ascending
    unique.sort(key=lambda b: b["height"])
    return unique


def load_existing_blocks() -> list[dict]:
    """Load all blocks from existing blocks/{date}.csv files."""
    blocks = []
    for csv_file in sorted(BLOCKS_DIR.glob("????-??-??.csv")):
        with open(csv_file) as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Reconstruct the _date from the filename
                date_str = csv_file.stem
                row["_date"] = date_str
                # Ensure numeric types
                for k in ["height", "timestamp_ms", "version_app", "tx_count",
                           "events_count", "blobs_size", "blobs_count",
                           "block_time_ms", "square_size", "fee_utia",
                           "gas_used", "gas_limit", "bytes_in_block"]:
                    try:
                        row[k] = int(row.get(k, 0) or 0)
                    except (ValueError, TypeError):
                        row[k] = 0
                try:
                    row["fill_rate"] = float(row.get("fill_rate", 0) or 0)
                except (ValueError, TypeError):
                    row["fill_rate"] = 0.0
                blocks.append(row)
    return blocks


# ---------------------------------------------------------------------------
# Price collection
# ---------------------------------------------------------------------------


def fetch_tia_prices(days: int = 90) -> list[dict]:
    """Fetch TIA/USD from CoinGecko (free API, hourly granularity)."""
    print(f"Fetching {days}-day hourly TIA/USD from CoinGecko...")
    url = "https://api.coingecko.com/api/v3/coins/celestia/market_chart"
    data = api_get(url, params={"vs_currency": "usd", "days": str(days)})
    prices_raw = data.get("prices", [])

    result = []
    for ts_ms, price in prices_raw:
        result.append({
            "timestamp_ms": int(ts_ms),
            "date": datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat(),
            "tia_usd": round(price, 6),
        })

    print(f"  {len(result)} price points")
    return result


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------


def write_daily_csvs(blocks: list[dict]) -> int:
    """Partition blocks by date and write one CSV per day. Returns file count."""
    by_date = defaultdict(list)
    for b in blocks:
        by_date[b["_date"]].append(b)

    BLOCKS_DIR.mkdir(parents=True, exist_ok=True)
    for date_str in sorted(by_date.keys()):
        rows = sorted(by_date[date_str], key=lambda b: b["height"])
        csv_path = BLOCKS_DIR / f"{date_str}.csv"
        with open(csv_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)

    return len(by_date)


def write_prices(prices: list[dict]) -> None:
    csv_path = DIR / "prices.csv"
    with open(csv_path, "w") as f:
        f.write("timestamp_ms,date,tia_usd\n")
        for p in prices:
            f.write(f"{p['timestamp_ms']},{p['date']},{p['tia_usd']}\n")
    print(f"CSV -> {csv_path}  ({len(prices)} rows)")


def write_config(blocks: list[dict], prices: list[dict]) -> dict:
    block_times = [b["block_time_ms"] for b in blocks if b["block_time_ms"] > 0]
    avg_bt = statistics.mean(block_times) if block_times else 6000
    med_bt = statistics.median(block_times) if block_times else 6000

    versions = [b["version_app"] for b in blocks]
    predominant_v = max(set(versions), key=versions.count) if versions else 0
    current_era = get_era(predominant_v)

    max_data_bytes = current_era["maxDataBytes"]
    max_mib = max_data_bytes / MiB
    proto_max = max_mib / (med_bt / 1000) if med_bt > 0 else 0

    blobs_blocks = [b for b in blocks if b["blobs_size"] > 0 and b["fee_utia"] > 0]
    if blobs_blocks:
        ref_costs = [(b["fee_utia"] / UTIA_PER_TIA) / (b["blobs_size"] / MiB)
                     for b in blobs_blocks]
        ref_cost_tia = statistics.median(ref_costs)
    else:
        ref_cost_tia = 0.0

    config = {
        "blockRange": {
            "start": blocks[0]["height"],
            "end": blocks[-1]["height"],
            "count": len(blocks),
        },
        "config": {
            "shareSize": SHARE_SIZE,
            "maxSquareSize": current_era["maxSquareSize"],
            "maxDataBytes": max_data_bytes,
            "maxMib": max_mib,
            "avgBlockTimeMs": round(avg_bt, 1),
            "medianBlockTimeMs": round(med_bt, 1),
            "protocolMaxMibps": round(proto_max, 4),
            "predominantAppVersion": predominant_v,
            "currentEra": current_era["label"],
            "availabilityWindowDays": DA_AVAILABILITY_DAYS,
        },
        "gas": {
            "refCostPerMibTia": round(ref_cost_tia, 6),
            "utiaPerTia": UTIA_PER_TIA,
        },
        "eras": ERAS,
        "priceRange": None,
        "collectedAt": datetime.now(timezone.utc).isoformat(),
    }

    if prices:
        tia_vals = [p["tia_usd"] for p in prices]
        latest = prices[-1]["tia_usd"]
        config["priceRange"] = {
            "min_usd": round(min(tia_vals), 4),
            "max_usd": round(max(tia_vals), 4),
            "latest_usd": latest,
            "from": prices[0]["date"],
            "to": prices[-1]["date"],
            "points": len(prices),
        }
        config["gas"]["currentTiaUsd"] = latest
        config["gas"]["currentCostPerMibUsd"] = round(ref_cost_tia * latest, 8)

    config_path = DIR / "chain_config.json"
    config_path.write_text(json.dumps(config, indent=2) + "\n")
    print(f"JSON -> {config_path}")
    return config


# ---------------------------------------------------------------------------
# Percentile helper
# ---------------------------------------------------------------------------


def pctl(vals: list, p: float) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    k = max(0, min(int(math.ceil(p / 100 * len(s))) - 1, len(s) - 1))
    return s[k]


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


def print_summary(blocks: list[dict], config: dict, prices: list[dict]) -> None:
    cc = config["config"]
    gas = config["gas"]
    br = config["blockRange"]

    bt = [b["block_time_ms"] for b in blocks if b["block_time_ms"] > 0]
    bs = [b["blobs_size"] for b in blocks]
    bc = [b["blobs_count"] for b in blocks]
    fees = [b["fee_utia"] for b in blocks if b["fee_utia"] > 0]
    tps = []
    for b in blocks:
        if b["block_time_ms"] > 0 and b["blobs_size"] > 0:
            tps.append((b["blobs_size"] / MiB) / (b["block_time_ms"] / 1000))

    def row(label, vals, fmt=".4f"):
        if not vals:
            return f"  {label:<22s}  (no data)"
        return (
            f"  {label:<22s}  "
            f"p10={pctl(vals,10):{fmt}}  "
            f"p50={pctl(vals,50):{fmt}}  "
            f"p90={pctl(vals,90):{fmt}}  "
            f"p99={pctl(vals,99):{fmt}}  "
            f"mean={statistics.mean(vals):{fmt}}"
        )

    dates = sorted(set(b["_date"] for b in blocks))
    blobs_blocks = sum(1 for b in blocks if b["blobs_size"] > 0)

    print()
    print("=" * 90)
    print("  CELESTIA DA — COLLECTION SUMMARY")
    print("=" * 90)
    print(f"  Blocks:        {len(blocks):,}  ({br['start']:,} – {br['end']:,})")
    print(f"  Date range:    {dates[0]} → {dates[-1]}  ({len(dates)} days)")
    print(f"  Era:           {cc['currentEra']}  (app_v{cc['predominantAppVersion']})")
    print(f"  Max capacity:  {cc['maxMib']:.0f} MiB  ({cc['maxSquareSize']}² × {cc['shareSize']}B)")
    print(f"  Protocol max:  {cc['protocolMaxMibps']:.4f} MiB/s")
    print(f"  With blobs:    {blobs_blocks:,} / {len(blocks):,} ({100*blobs_blocks/len(blocks):.1f}%)")
    print(f"  Ref cost/MiB:  {gas['refCostPerMibTia']:.6f} TIA")
    print("-" * 90)
    print(row("Block time (ms)", bt, ".0f"))
    print(row("Blobs size (B)", bs, ".0f"))
    print(row("Blobs count", bc, ".0f"))
    print(row("Fee (utia)", fees, ".0f"))
    print(row("Throughput MiB/s", tps))

    if prices:
        tia = [p["tia_usd"] for p in prices]
        latest = prices[-1]["tia_usd"]
        print("-" * 90)
        print(f"  TIA/USD:       ${latest:.4f}  (range: ${min(tia):.4f} – ${max(tia):.4f})")
        print(f"  Cost/MiB USD:  ${gas.get('currentCostPerMibUsd', 0):.8f}")
        print(f"  Price points:  {len(prices)}")

    print("=" * 90)
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Celestia DA — 90-day block & price collector")
    parser.add_argument("--days", type=int, default=90,
                        help="Days of block history (default: 90)")
    parser.add_argument("--workers", type=int, default=3,
                        help="Concurrent fetch workers (default: 3)")
    parser.add_argument("--resume", action="store_true",
                        help="Resume from last checkpoint")
    parser.add_argument("--prices-only", action="store_true",
                        help="Only collect TIA/USD prices")
    parser.add_argument("--skip-prices", action="store_true",
                        help="Skip price collection")
    args = parser.parse_args()

    DIR.mkdir(parents=True, exist_ok=True)

    # Prices only mode
    if args.prices_only:
        prices = fetch_tia_prices(days=args.days)
        if prices:
            write_prices(prices)
        return

    # Collect blocks
    blocks = collect_blocks(days=args.days, workers=args.workers, resume=args.resume)

    if not blocks:
        print("No blocks collected.", file=sys.stderr)
        sys.exit(1)

    # Write daily CSVs
    n_files = write_daily_csvs(blocks)
    print(f"\nCSV -> blocks/  ({n_files} daily files, {len(blocks):,} blocks total)")

    # Collect prices
    prices = []
    if not args.skip_prices:
        try:
            prices = fetch_tia_prices(days=args.days)
        except Exception as e:
            print(f"Price fetch failed: {e}")
            # Try loading cached
            cached_path = DIR / "prices.csv"
            if cached_path.exists():
                with open(cached_path) as f:
                    reader = csv.DictReader(f)
                    prices = [
                        {"timestamp_ms": int(r["timestamp_ms"]),
                         "date": r["date"],
                         "tia_usd": float(r["tia_usd"])}
                        for r in reader
                    ]
                print(f"  Using cached prices ({len(prices)} points)")

    if prices:
        write_prices(prices)

    # Write config
    config = write_config(blocks, prices)

    # Clear checkpoint on successful completion
    if not shutdown_requested:
        clear_checkpoint()

    # Summary
    print_summary(blocks, config, prices)


if __name__ == "__main__":
    main()
