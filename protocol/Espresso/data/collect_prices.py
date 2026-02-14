#!/usr/bin/env python3
"""
Espresso Tiramisu DA — ETH/USD price collection

Fetches 90 days of hourly ETH/USD from CoinGecko. This is the second
table (alongside blocks/ day-files) needed for cost analysis.

Usage:
  python3 data/collect_prices.py [--days 90]

Outputs (in data/):
  prices.csv       — hourly: timestamp_ms, date, eth_usd
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

DEFAULT_DAYS = 90
WEI_PER_ETH = 10**18
BYTES_PER_MIB = 2**20
DA_RETENTION_DAYS_TARGET = 7

SCRIPT_DIR = Path(__file__).resolve().parent
DIR = SCRIPT_DIR


def fetch_eth_prices(days: int) -> list[dict]:
    """Fetch hourly ETH/USD from CoinGecko free API."""
    url = "https://api.coingecko.com/api/v3/coins/ethereum/market_chart"
    params = {"vs_currency": "usd", "days": str(days)}
    print(f"Fetching {days}-day hourly ETH/USD from CoinGecko...")
    resp = requests.get(url, params=params, timeout=60)
    resp.raise_for_status()
    prices = resp.json().get("prices", [])
    result = []
    for ts_ms, price in prices:
        result.append({
            "timestamp_ms": int(ts_ms),
            "date": datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat(),
            "eth_usd": round(price, 2),
        })
    print(f"  {len(result)} price points")
    return result


def load_chain_config() -> dict:
    """Load chain_config.json from data/ if available."""
    cfg_path = SCRIPT_DIR / "chain_config.json"
    if cfg_path.exists():
        return json.loads(cfg_path.read_text())
    return {}


def main():
    parser = argparse.ArgumentParser(description="Espresso DA price collection")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS,
                        help=f"Days of price history (default: {DEFAULT_DAYS})")
    args = parser.parse_args()

    # Load chain config for base_fee (or default)
    chain_cfg = load_chain_config()
    base_fee = int(chain_cfg.get("config", {}).get("baseFee", 1))
    max_block_size = int(chain_cfg.get("config", {}).get("maxBlockSize", 1_000_000))
    print(f"Chain config: base_fee={base_fee} wei/byte, max_block_size={max_block_size}")

    # Fetch prices
    prices = fetch_eth_prices(args.days)
    if not prices:
        print("No price data from CoinGecko.", file=sys.stderr)
        sys.exit(1)

    # Derived cost
    cost_per_mib_eth = (base_fee * BYTES_PER_MIB) / WEI_PER_ETH
    current_eth_usd = prices[-1]["eth_usd"]
    current_cost_per_mib_usd = cost_per_mib_eth * current_eth_usd

    # Write prices.csv
    csv_path = DIR / "prices.csv"
    with open(csv_path, "w") as f:
        f.write("timestamp_ms,date,eth_usd\n")
        for p in prices:
            f.write(f"{p['timestamp_ms']},{p['date']},{p['eth_usd']}\n")
    print(f"CSV -> {csv_path}  ({len(prices)} rows)")

    # Summary
    print()
    print("=" * 70)
    print("  ETH/USD PRICE COLLECTION SUMMARY")
    print("=" * 70)
    print(f"  Price points:        {len(prices)} (hourly, {args.days} days)")
    print(f"  ETH/USD range:       ${min(p['eth_usd'] for p in prices):,.2f} – ${max(p['eth_usd'] for p in prices):,.2f}")
    print(f"  Current ETH/USD:     ${current_eth_usd:,.2f}")
    print(f"  base_fee:            {base_fee} wei/byte")
    print(f"  Cost/MiB (ETH):      {cost_per_mib_eth:.18f}")
    print(f"  Cost/MiB (USD now):  ${current_cost_per_mib_usd:.10f}")
    print("=" * 70)
    print()


if __name__ == "__main__":
    main()
