"""Celestia DA: Local transform pipeline.

Replicates celestia-daily.sql and celestia-hourly.sql locally.

Era detection via version_app: Lemongrass (v1-2), Ginger (v3-5), Current (v6+).
Cost model: gas_price × GasPerBlobByte(8) × MiB / 1e6 (utia → TIA).
DA retention ~30 days.
"""

import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.transform_utils import (
    MiB, load_blocks, load_prices, safe_div,
    add_rolling, add_cumulative, ensure_output_dir, write_output,
)

import numpy as np
import pandas as pd

GAS_PER_BLOB_BYTE = 8
DA_RETENTION_DAYS = 30.0

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
BLOCKS_DIR = os.path.join(DATA_DIR, "blocks")
PRICES_PATH = os.path.join(DATA_DIR, "prices.csv")


def detect_era(max_version_app):
    """Return (era_name, max_data_bytes, era_block_time_s) from version_app."""
    if max_version_app >= 6:
        return "Current (v6)", 8 * MiB, 6.0
    elif max_version_app >= 3:
        return "Ginger (v3-5)", 2 * MiB, 6.0
    else:
        return "Lemongrass (v1-2)", 2 * MiB, 12.0


def build_period(blocks: pd.DataFrame, prices: pd.DataFrame, period: str):
    pcol = f"_{period}"

    # Pre-compute per-block gas price
    blocks["_gas_price_utia"] = np.where(
        blocks["gas_used"] > 0,
        blocks["fee_utia"].astype(float) / blocks["gas_used"].astype(float),
        np.nan,
    )

    g = blocks.groupby(pcol)

    stats = g.agg(
        max_version_app=("version_app", "max"),
        block_count=("height", "size"),
        blocks_with_blobs=("blobs_count", lambda s: (s > 0).sum()),
        total_blobs_bytes=("blobs_size", lambda s: s.astype(float).sum()),
        total_blobs_count=("blobs_count", "sum"),
        total_bytes_in_block=("bytes_in_block", lambda s: s.astype(float).sum()),
        total_txs=("tx_count", "sum"),
        total_fee_utia=("fee_utia", lambda s: s.astype(float).sum()),
        total_gas_used=("gas_used", lambda s: s.astype(float).sum()),
        total_gas_limit=("gas_limit", lambda s: s.astype(float).sum()),
        avg_fill_rate=("fill_rate", "mean"),
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

    # Square size stats
    def sq_pctls(grp):
        s = grp["square_size"].astype(float)
        return pd.Series({"p50_square_size": s.quantile(0.50), "p90_square_size": s.quantile(0.90),
                          "max_square_size_seen": s.max()})
    sq = g.apply(sq_pctls, include_groups=False).reset_index()

    # Blob size percentiles
    def bl_pctls(grp):
        s = grp.loc[grp["blobs_size"] > 0, "blobs_size"].astype(float)
        if s.empty:
            return pd.Series({"p50_blobs_size": np.nan, "p90_blobs_size": np.nan, "p99_blobs_size": np.nan})
        return pd.Series({"p50_blobs_size": s.quantile(0.50), "p90_blobs_size": s.quantile(0.90),
                          "p99_blobs_size": s.quantile(0.99)})
    bl = g.apply(bl_pctls, include_groups=False).reset_index()

    # Gas price percentiles
    def gp_pctls(grp):
        s = grp["_gas_price_utia"].dropna()
        if s.empty:
            return pd.Series({"p10_gas_price_utia": np.nan, "p50_gas_price_utia": np.nan,
                              "p90_gas_price_utia": np.nan})
        return pd.Series({"p10_gas_price_utia": s.quantile(0.10), "p50_gas_price_utia": s.quantile(0.50),
                          "p90_gas_price_utia": s.quantile(0.90)})
    gp = g.apply(gp_pctls, include_groups=False).reset_index()

    df = stats.merge(bt, on=pcol).merge(sq, on=pcol).merge(bl, on=pcol).merge(gp, on=pcol)

    # ── Era detection ────────────────────────────────────────────────────────
    era_info = df["max_version_app"].apply(detect_era)
    df["era"] = era_info.apply(lambda x: x[0])
    df["max_data_bytes"] = era_info.apply(lambda x: x[1]).astype(float)
    df["era_block_time_s"] = era_info.apply(lambda x: x[2])

    # ── Derived columns ─────────────────────────────────────────────────────
    period_label = "daily" if period == "day" else "hourly"

    df[f"{period_label}_blob_mib"] = df["total_blobs_bytes"] / MiB
    df[f"{period_label}_block_mib"] = df["total_bytes_in_block"] / MiB

    bt_s = df["p50_block_time_ms"].fillna(6000) / 1000.0
    df["actual_mib_per_s"] = safe_div(
        df[f"{period_label}_blob_mib"],
        df["block_count"].astype(float) * bt_s,
    )
    df["utilization_pct"] = df["avg_fill_rate"] * 100.0
    df["max_mib_per_s"] = (df["max_data_bytes"] / MiB) / df["era_block_time_s"]

    # Gas-based cost
    df["avg_gas_price_utia"] = safe_div(df["total_fee_utia"], df["total_gas_used"])

    # ── Prices ───────────────────────────────────────────────────────────────
    if period == "day":
        pr = prices.groupby("_day").agg(avg_tia_usd=("tia_usd", "mean")).reset_index()
        df = df.merge(pr, left_on="_day", right_on="_day", how="left")
    else:
        pr = prices.groupby("_hour").agg(avg_tia_usd=("tia_usd", "mean")).reset_index()
        df = df.merge(pr, left_on="_hour", right_on="_hour", how="left")

    tia_usd = df["avg_tia_usd"].fillna(0)

    # cost_per_mib_tia = avg_gas_price × GasPerBlobByte × MiB / 1e6
    df["cost_per_mib_tia"] = df["avg_gas_price_utia"] * GAS_PER_BLOB_BYTE * MiB / 1e6
    df["cost_per_mib_usd"] = df["cost_per_mib_tia"] * tia_usd
    df["cost_per_mib_day_usd"] = df["cost_per_mib_usd"] / DA_RETENTION_DAYS

    df["cost_per_mib_usd_p10"] = df["p10_gas_price_utia"] * GAS_PER_BLOB_BYTE * MiB / 1e6 * tia_usd
    df["cost_per_mib_usd_p50"] = df["p50_gas_price_utia"] * GAS_PER_BLOB_BYTE * MiB / 1e6 * tia_usd
    df["cost_per_mib_usd_p90"] = df["p90_gas_price_utia"] * GAS_PER_BLOB_BYTE * MiB / 1e6 * tia_usd

    df[f"{period_label}_da_spend_usd"] = (df["total_fee_utia"] / 1e6) * tia_usd

    # ── Rolling & Cumulative ─────────────────────────────────────────────────
    mib_col = f"{period_label}_blob_mib"
    spend_col = f"{period_label}_da_spend_usd"
    if period == "day":
        window, suffix = 7, "7d"
    else:
        window, suffix = 24, "24h"

    df = add_rolling(df, pcol, ["actual_mib_per_s", "utilization_pct", mib_col, "cost_per_mib_usd"], window, suffix)
    df = add_cumulative(df, pcol, [mib_col, spend_col])
    return df


def main():
    print("Celestia: loading data...")
    blocks = load_blocks(BLOCKS_DIR)
    prices = load_prices(PRICES_PATH, "date", "tia_usd")

    out_dir = ensure_output_dir(__file__)

    print("Celestia: building daily...")
    daily = build_period(blocks, prices, "day")
    write_output(daily, out_dir, "daily")

    print("Celestia: building hourly...")
    hourly = build_period(blocks, prices, "hour")
    write_output(hourly, out_dir, "hourly")

    print("Celestia: done.")


if __name__ == "__main__":
    main()
