"""Ethereum EIP-4844 Blob DA: Local transform pipeline.

Replicates the Dune cost-quantile-bands-viz, utilization-viz, and throughput queries locally.
Produces daily.csv and hourly.csv combining throughput, utilization, cost, and rolling stats.

Fork-aware blob base fee: blob_base_fee = exp(excess_blob_gas / update_fraction).
Eras: Dencun → Pectra → BPO1 → BPO2.
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
BYTES_PER_BLOB = 131_072      # 128 KiB
MIB_PER_BLOB = BYTES_PER_BLOB / MiB  # 0.125
AVG_BLOCK_TIME_S = 12.0
AVAILABILITY_DAYS = 18.0

# Fork-specific EIP-4844 update_fraction (denominator for exp pricing)
DENOM_PRAGUE = 5_007_716    # Dencun + Pectra
DENOM_BPO1 = 8_346_193
DENOM_BPO2 = 11_684_671

# Regime definitions by block_number ranges
# (start_block, era_name, target_blobs, max_blobs, denominator)
REGIMES = [
    (0,        "pre-Dencun",       0,  0,  DENOM_PRAGUE),
    (19426587, "Dencun",           3,  6,  DENOM_PRAGUE),
    (22222222, "Pectra",           6,  9,  DENOM_PRAGUE),   # approximate
    (23975796, "BPO1",            10, 15,  DENOM_BPO1),
    (24500000, "BPO2",            14, 21,  DENOM_BPO2),     # approximate
]

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
BLOCKS_DIR = os.path.join(DATA_DIR, "blocks")
PRICES_PATH = os.path.join(DATA_DIR, "eth_prices.csv")


def assign_era(block_numbers: pd.Series):
    """Assign era info to each block based on block_number."""
    era = pd.Series("", index=block_numbers.index)
    target = pd.Series(0, index=block_numbers.index, dtype=int)
    max_b = pd.Series(0, index=block_numbers.index, dtype=int)
    denom = pd.Series(DENOM_PRAGUE, index=block_numbers.index, dtype=float)

    for start, name, tgt, mx, den in REGIMES:
        mask = block_numbers >= start
        era[mask] = name
        target[mask] = tgt
        max_b[mask] = mx
        denom[mask] = den

    return era, target, max_b, denom


def compute_blob_base_fee(excess_blob_gas: pd.Series, denominator: pd.Series) -> pd.Series:
    """blob_base_fee = max(1, exp(excess_blob_gas / denominator))."""
    ebg = excess_blob_gas.astype(float).fillna(0)
    fee = np.where(ebg == 0, 1.0, np.exp(ebg / denominator))
    return pd.Series(np.maximum(fee, 1.0), index=excess_blob_gas.index)


def build_period(blocks: pd.DataFrame, prices: pd.DataFrame, period: str):
    pcol = f"_{period}"

    # ── Per-block derived columns ────────────────────────────────────────────
    era, target_blobs, max_blobs, denom = assign_era(blocks["block_number"])
    blocks["_era"] = era
    blocks["_target_blobs"] = target_blobs
    blocks["_max_blobs"] = max_blobs
    blocks["_denom"] = denom

    blocks["_blob_base_fee_wei"] = compute_blob_base_fee(blocks["excess_blob_gas"], denom)
    blocks["_blob_base_fee_gwei"] = blocks["_blob_base_fee_wei"] / 1e9

    # Whether blob_base_fee is at the floor (1 wei)
    blocks["_at_floor"] = (blocks["_blob_base_fee_wei"] <= 1.0).astype(int)

    g = blocks.groupby(pcol)

    # ── Aggregations ─────────────────────────────────────────────────────────
    stats = g.agg(
        block_count=("block_number", "size"),
        total_blobs=("blob_count", "sum"),
        blocks_with_blobs=("blob_count", lambda s: (s > 0).sum()),
        at_floor_count=("_at_floor", "sum"),
    ).reset_index()

    # Era: take the era of the last block in the period
    era_info = g.agg(
        era=("_era", "last"),
        target_blobs=("_target_blobs", "last"),
        max_blobs=("_max_blobs", "last"),
    ).reset_index()

    # Blob base fee percentiles
    def fee_pctls(grp):
        f = grp["_blob_base_fee_gwei"]
        return pd.Series({
            "p10_blob_base_fee_gwei": f.quantile(0.10),
            "p50_blob_base_fee_gwei": f.quantile(0.50),
            "p90_blob_base_fee_gwei": f.quantile(0.90),
        })
    fp = g.apply(fee_pctls, include_groups=False).reset_index()

    # VWAP: sum(fee_gwei × blob_count) / sum(blob_count)
    blocks["_fee_x_blobs"] = blocks["_blob_base_fee_gwei"] * blocks["blob_count"]
    vwap_df = blocks.groupby(pcol).agg(
        sum_fee_x_blobs=("_fee_x_blobs", "sum"),
        sum_blobs_for_vwap=("blob_count", "sum"),
    ).reset_index()

    df = stats.merge(era_info, on=pcol).merge(fp, on=pcol).merge(vwap_df, on=pcol)

    df["vwap_blob_base_fee_gwei"] = safe_div(df["sum_fee_x_blobs"], df["sum_blobs_for_vwap"])
    df.drop(columns=["sum_fee_x_blobs", "sum_blobs_for_vwap"], inplace=True)

    # ── Throughput / utilization ─────────────────────────────────────────────
    period_label = "daily" if period == "day" else "hourly"
    df[f"{period_label}_data_mib"] = df["total_blobs"].astype(float) * BYTES_PER_BLOB / MiB

    avg_blobs_per_block = df["total_blobs"].astype(float) / df["block_count"].astype(float)
    df["actual_mib_per_s"] = avg_blobs_per_block * BYTES_PER_BLOB / MiB / AVG_BLOCK_TIME_S
    df["max_mib_per_s"] = df["max_blobs"].astype(float) * BYTES_PER_BLOB / MiB / AVG_BLOCK_TIME_S
    df["expected_mib_per_s"] = df["target_blobs"].astype(float) * BYTES_PER_BLOB / MiB / AVG_BLOCK_TIME_S

    df["utilization_pct"] = safe_div(avg_blobs_per_block, df["max_blobs"].astype(float)) * 100.0
    df["target_utilization_pct"] = safe_div(avg_blobs_per_block, df["target_blobs"].astype(float)) * 100.0

    df["pct_time_at_floor"] = safe_div(df["at_floor_count"].astype(float), df["block_count"].astype(float)) * 100.0

    # ── Prices ───────────────────────────────────────────────────────────────
    if period == "day":
        pr = prices.groupby("_day").agg(avg_eth_usd=("eth_usd", "mean")).reset_index()
        df = df.merge(pr, left_on="_day", right_on="_day", how="left")
    else:
        pr = prices.groupby("_hour").agg(avg_eth_usd=("eth_usd", "mean")).reset_index()
        df = df.merge(pr, left_on="_hour", right_on="_hour", how="left")

    eth_usd = df["avg_eth_usd"].fillna(0)

    # Cost per MiB/day using VWAP blob base fee
    vwap_wei = df["vwap_blob_base_fee_gwei"] * 1e9
    df["vwap_cost_per_mib_day_usd"] = (vwap_wei * BYTES_PER_BLOB / 1e18 / MIB_PER_BLOB) / AVAILABILITY_DAYS * eth_usd

    # Cost per MiB/day percentiles from blob_base_fee percentiles
    for pctl in ["p10", "p50", "p90"]:
        fee_gwei = df[f"{pctl}_blob_base_fee_gwei"]
        fee_wei = fee_gwei * 1e9
        df[f"{pctl}_cost_per_mib_day_usd"] = (fee_wei * BYTES_PER_BLOB / 1e18 / MIB_PER_BLOB) / AVAILABILITY_DAYS * eth_usd

    # Daily blob spend
    df[f"{period_label}_blob_spend_usd"] = (
        df["total_blobs"].astype(float) * df["vwap_blob_base_fee_gwei"] * 1e9 * BYTES_PER_BLOB / 1e18
    ) * eth_usd

    # ── Rolling & Cumulative ─────────────────────────────────────────────────
    mib_col = f"{period_label}_data_mib"
    spend_col = f"{period_label}_blob_spend_usd"
    if period == "day":
        window7, suffix7 = 7, "7d"
        window30, suffix30 = 30, "30d"
        df = add_rolling(df, pcol, [
            "actual_mib_per_s", "utilization_pct", mib_col, "vwap_cost_per_mib_day_usd",
        ], window7, suffix7)
        df = add_rolling(df, pcol, [
            "actual_mib_per_s", "utilization_pct",
        ], window30, suffix30)
    else:
        window, suffix = 24, "24h"
        df = add_rolling(df, pcol, [
            "actual_mib_per_s", "utilization_pct", mib_col, "vwap_cost_per_mib_day_usd",
        ], window, suffix)

    df = add_cumulative(df, pcol, [mib_col, spend_col])
    return df


def main():
    print("Ethereum: loading data...")
    blocks = load_blocks(BLOCKS_DIR)
    prices = load_prices(PRICES_PATH, "date", "eth_usd")

    out_dir = ensure_output_dir(__file__)

    print("Ethereum: building daily...")
    daily = build_period(blocks, prices, "day")
    write_output(daily, out_dir, "daily")

    print("Ethereum: building hourly...")
    hourly = build_period(blocks, prices, "hour")
    write_output(hourly, out_dir, "hourly")

    print("Ethereum: done.")


if __name__ == "__main__":
    main()
