"""Avail DA: Local transform pipeline.

Replicates avail-daily.sql and avail-hourly.sql locally.

Fee model: base_fee + length_fee + weight_fee × congestion_multiplier × submitDataFeeModifier
Fees are actual on-chain fees from TransactionFeePaid events (in plancks, 1 AVAIL = 1e18 plancks).
Chain params: 20s block time, max 4,456,448 bytes per block.
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
MAX_BLOCK_BYTES = 4_456_448
TARGET_BLOCK_TIME_S = 20.0
AVAIL_DECIMALS = 18  # 1 AVAIL = 10^18 plancks

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
BLOCKS_DIR = os.path.join(DATA_DIR, "blocks")
PRICES_PATH = os.path.join(DATA_DIR, "prices.csv")


def build_period(blocks: pd.DataFrame, prices: pd.DataFrame, period: str):
    pcol = f"_{period}"
    g = blocks.groupby(pcol)

    stats = g.agg(
        block_count=("block_number", "size"),
        blocks_with_data=("submit_data_bytes", lambda s: (s > 0).sum()),
        total_data_bytes=("submit_data_bytes", lambda s: s.astype(float).sum()),
        total_submit_count=("submit_data_count", "sum"),
        total_fee_plancks=("block_fee_plancks", lambda s: s.astype(float).sum()),
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

    # Payload percentiles (blocks with data only)
    def pl_pctls(grp):
        s = grp.loc[grp["submit_data_bytes"] > 0, "submit_data_bytes"].astype(float)
        if s.empty:
            return pd.Series({"p50_payload_bytes": np.nan, "p90_payload_bytes": np.nan, "p99_payload_bytes": np.nan})
        return pd.Series({"p50_payload_bytes": s.quantile(0.50), "p90_payload_bytes": s.quantile(0.90),
                          "p99_payload_bytes": s.quantile(0.99)})
    pl = g.apply(pl_pctls, include_groups=False).reset_index()

    # Fee-per-byte percentiles (blocks with data only)
    def fee_pctls(grp):
        mask = grp["submit_data_bytes"] > 0
        sub = grp.loc[mask]
        if sub.empty:
            return pd.Series({"p10_fee_per_byte_plancks": np.nan, "p50_fee_per_byte_plancks": np.nan,
                              "p90_fee_per_byte_plancks": np.nan})
        fpb = sub["block_fee_plancks"].astype(float) / sub["submit_data_bytes"].astype(float)
        return pd.Series({"p10_fee_per_byte_plancks": fpb.quantile(0.10),
                          "p50_fee_per_byte_plancks": fpb.quantile(0.50),
                          "p90_fee_per_byte_plancks": fpb.quantile(0.90)})
    fp = g.apply(fee_pctls, include_groups=False).reset_index()

    df = stats.merge(bt, on=pcol).merge(pl, on=pcol).merge(fp, on=pcol)

    # ── Derived columns ─────────────────────────────────────────────────────
    period_label = "daily" if period == "day" else "hourly"
    df[f"{period_label}_data_mib"] = df["total_data_bytes"] / MiB

    bt_s = df["p50_block_time_ms"].fillna(20000) / 1000.0
    df["actual_mib_per_s"] = safe_div(
        df[f"{period_label}_data_mib"],
        df["block_count"].astype(float) * bt_s,
    )
    df["max_mib_per_s"] = MAX_BLOCK_BYTES / MiB / TARGET_BLOCK_TIME_S
    df["utilization_pct"] = safe_div(
        df["total_data_bytes"],
        df["block_count"].astype(float) * MAX_BLOCK_BYTES,
    ) * 100.0

    # Fee-based cost per MiB
    df["avg_cost_per_mib_avail"] = np.where(
        df["total_data_bytes"] > 0,
        safe_div(df["total_fee_plancks"], df["total_data_bytes"]) * MiB / 1e18,
        np.nan,
    )
    df["cost_per_mib_avail_p10"] = df["p10_fee_per_byte_plancks"] * MiB / 1e18
    df["cost_per_mib_avail_p50"] = df["p50_fee_per_byte_plancks"] * MiB / 1e18
    df["cost_per_mib_avail_p90"] = df["p90_fee_per_byte_plancks"] * MiB / 1e18

    # ── Prices ───────────────────────────────────────────────────────────────
    if period == "day":
        pr = prices.groupby("_day").agg(avg_avail_usd=("avail_usd", "mean")).reset_index()
        df = df.merge(pr, left_on="_day", right_on="_day", how="left")
    else:
        pr = prices.groupby("_hour").agg(avg_avail_usd=("avail_usd", "mean")).reset_index()
        df = df.merge(pr, left_on="_hour", right_on="_hour", how="left")

    usd = df["avg_avail_usd"].fillna(0)
    df["cost_per_mib_usd"] = df["avg_cost_per_mib_avail"] * usd
    df["cost_per_mib_usd_p10"] = df["cost_per_mib_avail_p10"] * usd
    df["cost_per_mib_usd_p50"] = df["cost_per_mib_avail_p50"] * usd
    df["cost_per_mib_usd_p90"] = df["cost_per_mib_avail_p90"] * usd
    df[f"{period_label}_da_spend_usd"] = (df["total_fee_plancks"] / 1e18) * usd

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
    print("Avail: loading data...")
    blocks = load_blocks(BLOCKS_DIR)
    prices = load_prices(PRICES_PATH, "date", "avail_usd")

    out_dir = ensure_output_dir(__file__)

    print("Avail: building daily...")
    daily = build_period(blocks, prices, "day")
    write_output(daily, out_dir, "daily")

    print("Avail: building hourly...")
    hourly = build_period(blocks, prices, "hour")
    write_output(hourly, out_dir, "hourly")

    print("Avail: done.")


if __name__ == "__main__":
    main()
