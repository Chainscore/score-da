"""Espresso Tiramisu DA: Local transform pipeline.

Replicates espresso-daily.sql and espresso-hourly.sql locally.

Cost model: constant 1 wei/byte (verified heights 1K–10.3M).
Chain params: 1 MB max block size, 7 days DA retention.
"""

import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.transform_utils import (
    MiB, load_blocks, load_prices, safe_div,
    add_rolling, add_cumulative, ensure_output_dir, write_output,
)

import numpy as np
import pandas as pd

# ── Parameters ──────────────────────────────────────────────────────────────
BASE_FEE_WEI = 1
MAX_BLOCK_SIZE = 1_000_000  # 1 MB
DA_RETENTION_DAYS = 7.0

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
BLOCKS_DIR = os.path.join(DATA_DIR, "blocks")
PRICES_PATH = os.path.join(DATA_DIR, "prices.csv")


def build_period(blocks: pd.DataFrame, prices: pd.DataFrame, period: str):
    """Aggregate blocks to *period* ('day' or 'hour') and join with prices."""
    pcol = f"_{period}"  # _day or _hour
    g = blocks.groupby(pcol)

    stats = g.agg(
        block_count=("height", "size"),
        total_bytes=("size_bytes", "sum"),
        total_txs=("num_transactions", "sum"),
        non_empty_blocks=("size_bytes", lambda s: (s > 0).sum()),
    ).reset_index()

    # Block-time percentiles (exclude zero)
    def bt_percentiles(grp):
        bt = grp.loc[grp["block_time_ms"] > 0, "block_time_ms"].astype(float)
        if bt.empty:
            return pd.Series({
                "avg_block_time_ms": np.nan,
                "p10_block_time_ms": np.nan,
                "p50_block_time_ms": np.nan,
                "p90_block_time_ms": np.nan,
            })
        return pd.Series({
            "avg_block_time_ms": bt.mean(),
            "p10_block_time_ms": bt.quantile(0.10),
            "p50_block_time_ms": bt.quantile(0.50),
            "p90_block_time_ms": bt.quantile(0.90),
        })

    bt_stats = g.apply(bt_percentiles, include_groups=False).reset_index()

    # Payload percentiles
    def payload_percentiles(grp):
        s = grp["size_bytes"].astype(float)
        return pd.Series({
            "p50_payload_bytes": s.quantile(0.50),
            "p90_payload_bytes": s.quantile(0.90),
            "p99_payload_bytes": s.quantile(0.99),
        })

    pl_stats = g.apply(payload_percentiles, include_groups=False).reset_index()

    df = stats.merge(bt_stats, on=pcol).merge(pl_stats, on=pcol)

    # ── Derived columns ─────────────────────────────────────────────────────
    period_label = "daily" if period == "day" else "hourly"

    df[f"{period_label}_mib"] = df["total_bytes"].astype(float) / MiB

    elapsed_s = df["block_count"].astype(float) * df["p50_block_time_ms"].fillna(0) / 1000.0
    df["actual_mib_per_s"] = safe_div(df[f"{period_label}_mib"], elapsed_s)

    df["max_mib_per_s"] = safe_div(
        pd.Series(MAX_BLOCK_SIZE / MiB, index=df.index),
        df["p50_block_time_ms"] / 1000.0,
    )

    df["utilization_pct"] = safe_div(
        df["total_bytes"].astype(float),
        df["block_count"].astype(float) * MAX_BLOCK_SIZE,
    ) * 100.0

    # ── Prices ───────────────────────────────────────────────────────────────
    if period == "day":
        pr = prices.groupby("_day").agg(
            avg_eth_usd=("eth_usd", "mean"),
            p10_eth_usd=("eth_usd", lambda s: s.quantile(0.10)),
            p50_eth_usd=("eth_usd", lambda s: s.quantile(0.50)),
            p90_eth_usd=("eth_usd", lambda s: s.quantile(0.90)),
        ).reset_index()
        df = df.merge(pr, left_on="_day", right_on="_day", how="left")
    else:
        pr = prices.groupby("_hour").agg(
            avg_eth_usd=("eth_usd", "mean"),
            p10_eth_usd=("eth_usd", lambda s: s.quantile(0.10)),
            p50_eth_usd=("eth_usd", lambda s: s.quantile(0.50)),
            p90_eth_usd=("eth_usd", lambda s: s.quantile(0.90)),
        ).reset_index()
        df = df.merge(pr, left_on="_hour", right_on="_hour", how="left")

    # Cost: base_fee=1 wei/byte → cost_per_mib_eth = MiB / 1e18
    df["cost_per_mib_usd"] = (MiB / 1e18) * df["avg_eth_usd"]
    df["cost_per_mib_day_usd"] = df["cost_per_mib_usd"] / DA_RETENTION_DAYS

    df["cost_per_mib_usd_p10"] = (MiB / 1e18) * df["p10_eth_usd"]
    df["cost_per_mib_usd_p50"] = (MiB / 1e18) * df["p50_eth_usd"]
    df["cost_per_mib_usd_p90"] = (MiB / 1e18) * df["p90_eth_usd"]

    # DA spend
    df[f"{period_label}_da_spend_usd"] = (df["total_bytes"].astype(float) / 1e18) * df["avg_eth_usd"]

    # ── Rolling & Cumulative ─────────────────────────────────────────────────
    mib_col = f"{period_label}_mib"
    spend_col = f"{period_label}_da_spend_usd"

    if period == "day":
        window, suffix = 7, "7d"
    else:
        window, suffix = 24, "24h"

    df = add_rolling(df, pcol, ["actual_mib_per_s", "utilization_pct", mib_col, "cost_per_mib_usd"], window, suffix)
    df = add_cumulative(df, pcol, [mib_col, spend_col])

    return df


def main():
    print("Espresso: loading data...")
    blocks = load_blocks(BLOCKS_DIR)
    prices = load_prices(PRICES_PATH, "date", "eth_usd")

    out_dir = ensure_output_dir(__file__)

    print("Espresso: building daily...")
    daily = build_period(blocks, prices, "day")
    write_output(daily, out_dir, "daily")

    print("Espresso: building hourly...")
    hourly = build_period(blocks, prices, "hour")
    write_output(hourly, out_dir, "hourly")

    print("Espresso: done.")


if __name__ == "__main__":
    main()
