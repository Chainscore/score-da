"""NEAR DA: Local transform pipeline.

Replicates near-daily.sql and near-hourly.sql locally.

Cost model: cost_near = total_gas_used × gas_price / 1e24 (yoctoNEAR → NEAR)
Chain params: ~0.6s block time, 9 shards, 36 MiB max per block (9 × 4 MiB).
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
MAX_BLOCK_MIB = 36        # 9 shards × 4 MiB
NUM_SHARDS = 9
TARGET_BLOCK_TIME_S = 0.61
NEAR_DECIMALS = 24        # 1 NEAR = 10^24 yoctoNEAR

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
BLOCKS_DIR = os.path.join(DATA_DIR, "blocks")
PRICES_PATH = os.path.join(DATA_DIR, "prices.csv")


def build_period(blocks: pd.DataFrame, prices: pd.DataFrame, period: str):
    pcol = f"_{period}"

    # Pre-compute per-block derived columns before groupby
    blocks["_da_cost_near"] = blocks["total_gas_used"].astype(float) * blocks["gas_price"].astype(float) / 1e24
    blocks["_cost_per_byte_near"] = np.where(
        blocks["total_encoded_bytes"] > 0,
        blocks["_da_cost_near"] / blocks["total_encoded_bytes"].astype(float),
        np.nan,
    )

    g = blocks.groupby(pcol)

    stats = g.agg(
        block_count=("block_height", "size"),
        blocks_with_data=("total_encoded_bytes", lambda s: (s > 0).sum()),
        total_encoded_bytes=("total_encoded_bytes", lambda s: s.astype(float).sum()),
        total_gas_used=("total_gas_used", lambda s: s.astype(float).sum()),
        total_gas_limit=("total_gas_limit", lambda s: s.astype(float).sum()),
        total_chunks_produced=("chunks_produced", "sum"),
        total_da_cost_near=("_da_cost_near", "sum"),
    ).reset_index()

    # Block-time percentiles
    def bt_pctls(grp):
        bt = grp.loc[grp["block_time_ms"] > 0, "block_time_ms"].astype(float)
        if bt.empty:
            return pd.Series({"avg_block_time_ms": np.nan, "p10_block_time_ms": np.nan,
                              "p50_block_time_ms": np.nan, "p90_block_time_ms": np.nan})
        return pd.Series({"avg_block_time_ms": bt.mean(), "p10_block_time_ms": bt.quantile(0.10),
                          "p50_block_time_ms": bt.quantile(0.50), "p90_block_time_ms": bt.quantile(0.90)})
    bt = g.apply(bt_pctls, include_groups=False).reset_index()

    # Payload percentiles (blocks with data)
    def pl_pctls(grp):
        s = grp.loc[grp["total_encoded_bytes"] > 0, "total_encoded_bytes"].astype(float)
        if s.empty:
            return pd.Series({"p50_encoded_bytes": np.nan, "p90_encoded_bytes": np.nan, "p99_encoded_bytes": np.nan})
        return pd.Series({"p50_encoded_bytes": s.quantile(0.50), "p90_encoded_bytes": s.quantile(0.90),
                          "p99_encoded_bytes": s.quantile(0.99)})
    pl = g.apply(pl_pctls, include_groups=False).reset_index()

    # Cost-per-byte percentiles (blocks with data)
    def cost_pctls(grp):
        s = grp["_cost_per_byte_near"].dropna()
        if s.empty:
            return pd.Series({"p10_cost_per_byte_near": np.nan, "p50_cost_per_byte_near": np.nan,
                              "p90_cost_per_byte_near": np.nan})
        return pd.Series({"p10_cost_per_byte_near": s.quantile(0.10), "p50_cost_per_byte_near": s.quantile(0.50),
                          "p90_cost_per_byte_near": s.quantile(0.90)})
    cp = g.apply(cost_pctls, include_groups=False).reset_index()

    df = stats.merge(bt, on=pcol).merge(pl, on=pcol).merge(cp, on=pcol)

    # ── Derived columns ─────────────────────────────────────────────────────
    period_label = "daily" if period == "day" else "hourly"
    df[f"{period_label}_data_mib"] = df["total_encoded_bytes"] / MiB

    bt_s = df["p50_block_time_ms"].fillna(1300) / 1000.0
    df["actual_mib_per_s"] = safe_div(df[f"{period_label}_data_mib"], df["block_count"].astype(float) * bt_s)
    df["max_mib_per_s"] = MAX_BLOCK_MIB / TARGET_BLOCK_TIME_S
    df["utilization_pct"] = safe_div(
        df["total_encoded_bytes"],
        df["block_count"].astype(float) * MAX_BLOCK_MIB * MiB,
    ) * 100.0

    # Cost per MiB in NEAR
    df["avg_cost_per_mib_near"] = np.where(
        df["total_encoded_bytes"] > 0,
        df["total_da_cost_near"] / (df["total_encoded_bytes"] / MiB),
        np.nan,
    )
    df["cost_per_mib_near_p10"] = df["p10_cost_per_byte_near"] * MiB
    df["cost_per_mib_near_p50"] = df["p50_cost_per_byte_near"] * MiB
    df["cost_per_mib_near_p90"] = df["p90_cost_per_byte_near"] * MiB

    # ── Prices ───────────────────────────────────────────────────────────────
    if period == "day":
        pr = prices.groupby("_day").agg(avg_near_usd=("near_usd", "mean")).reset_index()
        df = df.merge(pr, left_on="_day", right_on="_day", how="left")
    else:
        pr = prices.groupby("_hour").agg(avg_near_usd=("near_usd", "mean")).reset_index()
        df = df.merge(pr, left_on="_hour", right_on="_hour", how="left")

    usd = df["avg_near_usd"].fillna(0)
    df["cost_per_mib_usd"] = df["avg_cost_per_mib_near"] * usd
    df["cost_per_mib_usd_p10"] = df["cost_per_mib_near_p10"] * usd
    df["cost_per_mib_usd_p50"] = df["cost_per_mib_near_p50"] * usd
    df["cost_per_mib_usd_p90"] = df["cost_per_mib_near_p90"] * usd
    df[f"{period_label}_da_spend_usd"] = df["total_da_cost_near"] * usd

    # ── Rolling & Cumulative ─────────────────────────────────────────────────
    mib_col = f"{period_label}_data_mib"
    spend_col = f"{period_label}_da_spend_usd"
    if period == "day":
        window, suffix = 7, "7d"
    else:
        window, suffix = 24, "24h"

    df = add_rolling(df, pcol, ["actual_mib_per_s", "utilization_pct", mib_col, "cost_per_mib_usd"], window, suffix)
    df = add_cumulative(df, pcol, [mib_col, spend_col])
    return df


def main():
    print("NEAR: loading data...")
    blocks = load_blocks(BLOCKS_DIR)
    prices = load_prices(PRICES_PATH, "date", "near_usd")

    out_dir = ensure_output_dir(__file__)

    print("NEAR: building daily...")
    daily = build_period(blocks, prices, "day")
    write_output(daily, out_dir, "daily")

    print("NEAR: building hourly...")
    hourly = build_period(blocks, prices, "hour")
    write_output(hourly, out_dir, "hourly")

    print("NEAR: done.")


if __name__ == "__main__":
    main()
