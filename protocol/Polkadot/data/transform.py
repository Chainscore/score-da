"""Polkadot DA: Local transform pipeline.

Replicates polkadot-daily.sql and polkadot-hourly.sql locally.

Throughput upper bound = included × max_pov / cadence (no actual PoV sizes).
Utilization = included / effective_cores.
Bulk cost/MiB = region_price / max_mib_per_region.
Chain params: 6s cadence, backing_group_size=5, 1 DOT = 1e10 planck.
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
CADENCE_S = 6.0
BACKING_GROUP_SIZE = 5
DOT_PLANCK = 1e10
MAX_POV_MIB = 10.0           # post-#1480
REGION_LENGTH_TS = 5040       # timeslices per region
TIMESLICE_PERIOD = 80         # blocks per timeslice
BLOCKS_PER_DAY = 86400 / CADENCE_S  # 14400
BLOCKS_PER_HOUR = 3600 / CADENCE_S  # 600

# Governance regimes: (start_block, effective_cores, max_pov_bytes, era)
REGIMES = [
    (0,        62,  5242880,  "pre-#1200"),
    (23120301, 62,  5242880,  "#1200 (val 400→500)"),
    (25164320, 62,  5242880,  "#1484 (val 500→600)"),
    (25342222, 62,  10485760, "#1480 (PoV 10 MiB)"),
    (25786439, 66,  10485760, "#1536 (66 cores)"),
    (26803000, 100, 10485760, "#1629 (100 cores)"),
]

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
THROUGHPUT_BLOCKS_DIR = os.path.join(DATA_DIR, "throughput", "blocks")
COST_DIR = os.path.join(DATA_DIR, "cost")
PRICES_PATH = os.path.join(COST_DIR, "dot_prices.csv")


def assign_regime(block_number: float):
    """Given a median block number, return (era, effective_cores, max_pov_bytes)."""
    result = REGIMES[0]
    for start, cores, pov, era in REGIMES:
        if block_number >= start:
            result = (era, cores, pov)
    return result


def load_cost_data():
    """Load purchases, renewals, and sales CSVs.

    The renewals CSV has a JSON 'workload' column with unescaped commas,
    so we read only the first 8 columns we need.
    """
    purchases = pd.read_csv(os.path.join(COST_DIR, "purchases.csv"))
    # Only read columns we need (workload JSON breaks csv parsing)
    renewals = pd.read_csv(
        os.path.join(COST_DIR, "renewals.csv"),
        usecols=range(8),
        names=["ct_block", "timestamp", "who", "old_core", "core", "begin", "price", "duration"],
        header=0,
        on_bad_lines="skip",
    )
    sales = pd.read_csv(os.path.join(COST_DIR, "sales.csv"))
    return purchases, renewals, sales


def build_daily(blocks: pd.DataFrame, prices: pd.DataFrame,
                purchases: pd.DataFrame, renewals: pd.DataFrame, sales: pd.DataFrame):
    pcol = "_day"
    g = blocks.groupby(pcol)

    # ── Throughput aggregation ───────────────────────────────────────────────
    stats = g.agg(
        sample_count=("block_number", "size"),
        avg_included=("included", lambda s: s.astype(float).mean()),
        avg_backed=("backed", lambda s: s.astype(float).mean()),
        avg_cores_active=("cores_active", lambda s: s.astype(float).mean()),
        avg_distinct_paras=("distinct_paras", lambda s: s.astype(float).mean()),
        avg_bitfields=("bitfields", lambda s: s.astype(float).mean()),
        total_timed_out=("timed_out", lambda s: s.astype(float).sum()),
        total_disputes=("disputes", lambda s: s.astype(float).sum()),
        median_block=("block_number", "median"),
    ).reset_index()

    # Mean availability (excluding zeros)
    def mean_avail(grp):
        s = grp.loc[grp["avg_avail"] > 0, "avg_avail"]
        return s.mean() if len(s) > 0 else np.nan
    avail = g.apply(mean_avail, include_groups=False).reset_index()
    avail.columns = [pcol, "mean_availability"]

    # Included percentiles
    def inc_pctls(grp):
        s = grp["included"].astype(float)
        return pd.Series({
            "p10_included": s.quantile(0.10), "p50_included": s.quantile(0.50),
            "p90_included": s.quantile(0.90),
        })
    ip = g.apply(inc_pctls, include_groups=False).reset_index()

    df = stats.merge(avail, on=pcol).merge(ip, on=pcol)

    # ── Regime assignment ────────────────────────────────────────────────────
    regime_info = df["median_block"].apply(assign_regime)
    df["era"] = regime_info.apply(lambda x: x[0])
    df["effective_cores"] = regime_info.apply(lambda x: x[1]).astype(int)
    df["max_pov_bytes"] = regime_info.apply(lambda x: x[2]).astype(float)
    df["max_pov_mib"] = df["max_pov_bytes"] / MiB

    # ── Throughput derived ───────────────────────────────────────────────────
    df["actual_mib_per_s"] = df["avg_included"] * df["max_pov_bytes"] / CADENCE_S / MiB
    df["max_mib_per_s"] = df["effective_cores"].astype(float) * df["max_pov_bytes"] / CADENCE_S / MiB
    df["utilization_pct"] = safe_div(df["avg_included"], df["effective_cores"].astype(float)) * 100.0
    df["daily_data_mib"] = df["avg_included"] * df["max_pov_bytes"] / MiB * BLOCKS_PER_DAY

    # Pipeline health
    df["pipeline_efficiency_pct"] = safe_div(df["avg_included"], df["avg_backed"]) * 100.0
    df["timed_out_rate_pct"] = safe_div(
        df["total_timed_out"], df["sample_count"].astype(float) * df["avg_backed"],
    ) * 100.0
    df["core_engagement_pct"] = safe_div(df["avg_cores_active"], df["effective_cores"].astype(float)) * 100.0
    df["para_diversity_ratio"] = safe_div(df["avg_distinct_paras"], df["avg_cores_active"])

    # ── Cost data: purchases ─────────────────────────────────────────────────
    purchases["_day"] = pd.to_datetime(purchases["timestamp"], unit="s", utc=True).dt.date
    purchases["_price_dot"] = purchases["price"].astype(float) / DOT_PLANCK

    dp = purchases.groupby("_day").agg(
        purchase_count=("price", "size"),
        bulk_p10_price_dot=("_price_dot", lambda s: s.quantile(0.10)),
        bulk_p50_price_dot=("_price_dot", lambda s: s.quantile(0.50)),
        bulk_p90_price_dot=("_price_dot", lambda s: s.quantile(0.90)),
        daily_bulk_spend_dot=("_price_dot", "sum"),
    ).reset_index()

    # Total MiB capacity per region (uses current 10 MiB PoV; all data is post-#1480)
    mib_per_region = REGION_LENGTH_TS * TIMESLICE_PERIOD * MAX_POV_MIB
    for pctl in ["p10", "p50", "p90"]:
        dp[f"bulk_{pctl}_cost_per_mib_dot"] = dp[f"bulk_{pctl}_price_dot"] / mib_per_region

    # ── Cost data: renewals ──────────────────────────────────────────────────
    renewals["_day"] = pd.to_datetime(renewals["timestamp"], unit="s", utc=True).dt.date
    renewals["_price_dot"] = renewals["price"].astype(float) / DOT_PLANCK

    dr = renewals.groupby("_day").agg(
        renewal_count=("price", "size"),
        renewal_p50_price_dot=("_price_dot", lambda s: s.quantile(0.50)),
        daily_renewal_spend_dot=("_price_dot", "sum"),
    ).reset_index()
    dr["renewal_p50_cost_per_mib_dot"] = dr["renewal_p50_price_dot"] / mib_per_region

    # ── Cost data: sales ─────────────────────────────────────────────────────
    sales["_day"] = pd.to_datetime(sales["timestamp"], unit="s", utc=True).dt.date
    sales["_start_price_dot"] = sales["start_price"].astype(float) / DOT_PLANCK
    sales["_end_price_dot"] = sales["end_price"].astype(float) / DOT_PLANCK

    ds = sales.groupby("_day").agg(
        sales_started=("ct_block", "size"),
        sale_cores_offered=("cores_offered", "mean"),
        sale_start_price_dot=("_start_price_dot", "mean"),
        sale_end_price_dot=("_end_price_dot", "mean"),
    ).reset_index()

    # ── Prices ───────────────────────────────────────────────────────────────
    pr = prices.groupby("_day").agg(avg_dot_usd=("dot_usd", "mean")).reset_index()

    # ── Join all ─────────────────────────────────────────────────────────────
    df = df.merge(dp, on="_day", how="left")
    df = df.merge(dr, on="_day", how="left")
    df = df.merge(ds, on="_day", how="left")
    df = df.merge(pr, on="_day", how="left")

    # Cost per core DOT
    df["bulk_p50_price_per_core_dot"] = df["bulk_p50_price_dot"]
    df["renewal_p50_price_per_core_dot"] = df["renewal_p50_price_dot"]

    # ── DOT → USD ────────────────────────────────────────────────────────────
    usd = df["avg_dot_usd"].fillna(0)
    for pctl in ["p10", "p50", "p90"]:
        df[f"bulk_{pctl}_cost_per_mib_usd"] = df[f"bulk_{pctl}_cost_per_mib_dot"] * usd
    df["renewal_p50_cost_per_mib_usd"] = df["renewal_p50_cost_per_mib_dot"] * usd

    df["bulk_p50_price_per_core_usd"] = df["bulk_p50_price_per_core_dot"] * usd
    df["renewal_p50_price_per_core_usd"] = df["renewal_p50_price_per_core_dot"] * usd

    df["daily_bulk_spend_usd"] = df["daily_bulk_spend_dot"].fillna(0) * usd
    df["daily_renewal_spend_usd"] = df["daily_renewal_spend_dot"].fillna(0) * usd
    df["daily_total_spend_usd"] = df["daily_bulk_spend_usd"] + df["daily_renewal_spend_usd"]

    # ── Rolling & Cumulative ─────────────────────────────────────────────────
    df = add_rolling(df, pcol, [
        "actual_mib_per_s", "utilization_pct", "daily_data_mib",
        "bulk_p50_cost_per_mib_usd", "pipeline_efficiency_pct", "core_engagement_pct",
    ], 7, "7d")
    df = add_rolling(df, pcol, [
        "actual_mib_per_s", "utilization_pct",
    ], 30, "30d")
    df = add_cumulative(df, pcol, ["daily_data_mib", "daily_total_spend_usd"])

    return df


def build_hourly(blocks: pd.DataFrame, prices: pd.DataFrame):
    """Hourly: throughput + pipeline only (cost too sparse)."""
    pcol = "_hour"
    g = blocks.groupby(pcol)

    stats = g.agg(
        sample_count=("block_number", "size"),
        avg_included=("included", lambda s: s.astype(float).mean()),
        avg_backed=("backed", lambda s: s.astype(float).mean()),
        avg_cores_active=("cores_active", lambda s: s.astype(float).mean()),
        avg_distinct_paras=("distinct_paras", lambda s: s.astype(float).mean()),
        avg_bitfields=("bitfields", lambda s: s.astype(float).mean()),
        total_timed_out=("timed_out", lambda s: s.astype(float).sum()),
        median_block=("block_number", "median"),
    ).reset_index()

    def mean_avail(grp):
        s = grp.loc[grp["avg_avail"] > 0, "avg_avail"]
        return s.mean() if len(s) > 0 else np.nan
    avail = g.apply(mean_avail, include_groups=False).reset_index()
    avail.columns = [pcol, "mean_availability"]

    def inc_pctls(grp):
        s = grp["included"].astype(float)
        return pd.Series({
            "p10_included": s.quantile(0.10), "p50_included": s.quantile(0.50),
            "p90_included": s.quantile(0.90),
        })
    ip = g.apply(inc_pctls, include_groups=False).reset_index()

    df = stats.merge(avail, on=pcol).merge(ip, on=pcol)

    # Regime assignment
    regime_info = df["median_block"].apply(assign_regime)
    df["era"] = regime_info.apply(lambda x: x[0])
    df["effective_cores"] = regime_info.apply(lambda x: x[1]).astype(int)
    df["max_pov_bytes"] = regime_info.apply(lambda x: x[2]).astype(float)
    df["max_pov_mib"] = df["max_pov_bytes"] / MiB

    # Throughput
    df["actual_mib_per_s"] = df["avg_included"] * df["max_pov_bytes"] / CADENCE_S / MiB
    df["max_mib_per_s"] = df["effective_cores"].astype(float) * df["max_pov_bytes"] / CADENCE_S / MiB
    df["utilization_pct"] = safe_div(df["avg_included"], df["effective_cores"].astype(float)) * 100.0
    df["hourly_data_mib"] = df["avg_included"] * df["max_pov_bytes"] / MiB * BLOCKS_PER_HOUR

    # Pipeline
    df["pipeline_efficiency_pct"] = safe_div(df["avg_included"], df["avg_backed"]) * 100.0
    df["timed_out_rate_pct"] = safe_div(
        df["total_timed_out"], df["sample_count"].astype(float) * df["avg_backed"],
    ) * 100.0
    df["core_engagement_pct"] = safe_div(df["avg_cores_active"], df["effective_cores"].astype(float)) * 100.0

    # Prices (daily granularity joined to hourly)
    pr = prices.groupby("_day").agg(avg_dot_usd=("dot_usd", "mean")).reset_index()
    df["_day_from_hour"] = pd.to_datetime(df["_hour"]).dt.date
    df = df.merge(pr, left_on="_day_from_hour", right_on="_day", how="left")
    df.drop(columns=["_day_from_hour", "_day"], inplace=True)

    # Rolling & Cumulative
    df = add_rolling(df, pcol, [
        "actual_mib_per_s", "utilization_pct", "hourly_data_mib",
        "pipeline_efficiency_pct", "core_engagement_pct",
    ], 24, "24h")
    df = add_cumulative(df, pcol, ["hourly_data_mib"])

    return df


def main():
    print("Polkadot: loading data...")
    blocks = load_blocks(THROUGHPUT_BLOCKS_DIR, timestamp_col="timestamp")
    prices = load_prices(PRICES_PATH, "date", "dot_usd")
    purchases, renewals, sales = load_cost_data()

    out_dir = ensure_output_dir(os.path.join(DATA_DIR, "transform.py"))

    print("Polkadot: building daily...")
    daily = build_daily(blocks, prices, purchases, renewals, sales)
    write_output(daily, out_dir, "daily")

    print("Polkadot: building hourly...")
    hourly = build_hourly(blocks, prices)
    write_output(hourly, out_dir, "hourly")

    print("Polkadot: done.")


if __name__ == "__main__":
    main()
