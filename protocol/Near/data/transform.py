# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 Chainscore Labs
"""NEAR DA: Local transform pipeline.

Replicates near-daily.sql and near-hourly.sql locally.

Cost model (DA): NEAR has no blob type or DA fee market; rollups post data as
function-call arguments. The DA cost per MiB is the marginal gas of posting 1 MiB as
the argument of a cross-account blob-store submit() call, from the protocol gas
schedule (nearcore core/parameters/res/runtime_configs/parameters.yaml):
  per byte: action_function_call_per_byte send_not_sir (47,683,715)
            + execution (2,235,934)
            + env::input() read: write_register + read_register + write_memory
              (3,801,564 + 98,562 + 2,723,772)
  fixed:    2 × receipt creation (108,059,500,000) + function-call base send/exec
            (200 Ggas + 780 Ggas)
cost_per_mib_near = (FIXED_GAS + PER_BYTE_GAS × 2^20) × gas_price / 1e24.
These costs are the in-window values: identical in EXPERIMENTAL_protocol_config at
heights 172,665,547 (2025-11-15, protocol 81) and 185,299,415 (2026-02-13, protocol 82).

The chain-wide average fee per byte (all gas burned / all chunk bytes) is kept as
chain_avg_fee_per_mib_*: it measures NEAR's general fee intensity, not DA cost.
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
PER_BYTE_GAS = 47_683_715 + 2_235_934 + 3_801_564 + 98_562 + 2_723_772
FIXED_GAS = 2 * 108_059_500_000 + 200_000_000_000 + 780_000_000_000
GAS_PER_MIB = FIXED_GAS + PER_BYTE_GAS * 1048576

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

    blocks["_marginal_cost_per_mib_near"] = GAS_PER_MIB * blocks["gas_price"].astype(float) / 1e24

    g = blocks.groupby(pcol)

    stats = g.agg(
        block_count=("block_height", "size"),
        blocks_with_data=("total_encoded_bytes", lambda s: (s > 0).sum()),
        total_encoded_bytes=("total_encoded_bytes", lambda s: s.astype(float).sum()),
        total_gas_used=("total_gas_used", lambda s: s.astype(float).sum()),
        total_gas_limit=("total_gas_limit", lambda s: s.astype(float).sum()),
        total_chunks_produced=("chunks_produced", "sum"),
        total_da_cost_near=("_da_cost_near", "sum"),
        p10_marginal_cost_per_mib_near=("_marginal_cost_per_mib_near", lambda s: s.quantile(0.10)),
        p50_marginal_cost_per_mib_near=("_marginal_cost_per_mib_near", lambda s: s.quantile(0.50)),
        p90_marginal_cost_per_mib_near=("_marginal_cost_per_mib_near", lambda s: s.quantile(0.90)),
        avg_marginal_cost_per_mib_near=("_marginal_cost_per_mib_near", "mean"),
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

    # Chain-wide average fee per MiB (all gas / all chunk bytes): fee intensity, not DA cost
    df["chain_avg_fee_per_mib_near"] = np.where(
        df["total_encoded_bytes"] > 0,
        df["total_da_cost_near"] / (df["total_encoded_bytes"] / MiB),
        np.nan,
    )
    df["chain_avg_fee_per_mib_near_p50"] = df["p50_cost_per_byte_near"] * MiB

    # DA cost per MiB in NEAR: marginal cost of posting 1 MiB of function-call input
    df["avg_cost_per_mib_near"] = df["avg_marginal_cost_per_mib_near"]
    df["cost_per_mib_near_p10"] = df["p10_marginal_cost_per_mib_near"]
    df["cost_per_mib_near_p50"] = df["p50_marginal_cost_per_mib_near"]
    df["cost_per_mib_near_p90"] = df["p90_marginal_cost_per_mib_near"]

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
    df["chain_avg_fee_per_mib_usd"] = df["chain_avg_fee_per_mib_near"] * usd
    df["chain_avg_fee_per_mib_usd_p50"] = df["chain_avg_fee_per_mib_near_p50"] * usd
    df[f"{period_label}_chain_fees_usd"] = df["total_da_cost_near"] * usd
    # Implied DA spend: chunk volume priced at the marginal DA cost
    df[f"{period_label}_da_spend_usd"] = df[f"{period_label}_data_mib"] * df["cost_per_mib_usd"]

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
