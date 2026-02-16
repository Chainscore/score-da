"""Cross-protocol comparison charts for the DA research paper.

Loads all 6 daily.csv files and generates combined figures:
  - Combined throughput over time (3a)
  - Combined utilization over time (3b)
  - Combined cost over time (3c)
  - Cumulative data volume comparison (3d)
  - Protocol capacity vs cost scatter (3e)
  - Per-byte overhead comparison bar chart (4a)
  - Retention-adjusted cost comparison bar chart (4b)
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime
import pandas as pd
import numpy as np
from shared.plot_style import (
    apply_style, parse_day, save,
    plot_multi_line, plot_grouped_bar, plot_scatter_bubble,
    PROTO_COLORS, PROTO_ORDER, SZ_CROSS,
)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

# ── Column mappings per protocol ─────────────────────────────────────────────

# Each entry: (csv_path, throughput_7d_col, utilization_7d_col, cost_p50_col, daily_mib_col, cumulative_mib_col)
PROTO_CONFIG = {
    "Polkadot": {
        "csv": "protocol/polkadot/analysis/daily.csv",
        "throughput_7d": "actual_mib_per_s_7d",
        "utilization_7d": "utilization_pct_7d",
        "cost_p50": "bulk_p50_cost_per_mib_usd",
        "daily_mib": "daily_data_mib",
        "cumulative_mib": "cumulative_daily_data_mib",
    },
    "Ethereum": {
        "csv": "protocol/ethereum/analysis/daily.csv",
        "throughput_7d": "actual_mib_per_s_7d",
        "utilization_7d": "utilization_pct_7d",
        "cost_p50": "p50_cost_per_mib_day_usd",
        "daily_mib": "daily_data_mib",
        "cumulative_mib": "cumulative_daily_data_mib",
    },
    "Celestia": {
        "csv": "protocol/celestia/analysis/daily.csv",
        "throughput_7d": "actual_mib_per_s_7d",
        "utilization_7d": "utilization_pct_7d",
        "cost_p50": "cost_per_mib_usd_p50",
        "daily_mib": "daily_blob_mib",
        "cumulative_mib": "cumulative_daily_blob_mib",
    },
    "Espresso": {
        "csv": "protocol/espresso/analysis/daily.csv",
        "throughput_7d": "actual_mib_per_s_7d",
        "utilization_7d": "utilization_pct_7d",
        "cost_p50": "cost_per_mib_usd_p50",
        "daily_mib": "daily_mib",
        "cumulative_mib": "cumulative_daily_mib",
    },
    "NEAR": {
        "csv": "protocol/near/analysis/daily.csv",
        "throughput_7d": "actual_mib_per_s_7d",
        "utilization_7d": "utilization_pct_7d",
        "cost_p50": "cost_per_mib_usd_p50",
        "daily_mib": "daily_data_mib",
        "cumulative_mib": "cumulative_daily_data_mib",
    },
    "Avail": {
        "csv": "protocol/avail/analysis/daily.csv",
        "throughput_7d": "actual_mib_per_s_7d",
        "utilization_7d": "utilization_pct_7d",
        "cost_p50": "cost_per_mib_usd_p50",
        "daily_mib": "daily_data_mib",
        "cumulative_mib": "cumulative_daily_data_mib",
    },
}

# Protocol max throughput (MiB/s) from Table I
MAX_THROUGHPUT = {
    "Polkadot": 167, "Ethereum": 0.22, "Celestia": 1.31,
    "Espresso": 0.37, "NEAR": 59, "Avail": 0.21,
}


# 90-day observation window boundaries
OBS_START = pd.Timestamp("2025-11-15")
OBS_END = pd.Timestamp("2026-02-14")


def _load_all():
    """Load all daily CSVs, filter to 90-day window, return dict[proto_name -> DataFrame]."""
    base = os.path.join(os.path.dirname(__file__), "..", "..")
    data = {}
    for name, cfg in PROTO_CONFIG.items():
        path = os.path.join(base, cfg["csv"])
        df = pd.read_csv(path)
        df["_date"] = parse_day(df)
        # Filter to 90-day observation window so all protocols share the same x-axis
        df = df[(df["_date"] >= OBS_START) & (df["_date"] <= OBS_END)].copy()
        data[name] = df
    return data


def chart_throughput(data):
    """3a: Combined throughput (7d rolling) on log-scale."""
    series = {}
    for name, df in data.items():
        col = PROTO_CONFIG[name]["throughput_7d"]
        series[name] = (df["_date"], df[col])
    return plot_multi_line(
        series, "Combined DA Throughput (7d rolling avg)",
        ylabel="MiB/s", log_scale=True,
        ref_lines=MAX_THROUGHPUT,
    )


def chart_utilization(data):
    """3b: Combined utilization (7d rolling) on linear scale."""
    series = {}
    for name, df in data.items():
        col = PROTO_CONFIG[name]["utilization_7d"]
        series[name] = (df["_date"], df[col])
    return plot_multi_line(
        series, "Combined DA Utilization (7d rolling avg)",
        ylabel="%", log_scale=False,
    )


def chart_cost(data):
    """3c: Combined p50 cost/MiB on log-scale."""
    series = {}
    for name, df in data.items():
        col = PROTO_CONFIG[name]["cost_p50"]
        if col in df.columns:
            vals = df[col].copy()
            # Drop NaN for sparse data (Polkadot)
            mask = vals.notna() & (vals > 0)
            if mask.sum() > 3:
                series[name] = (df.loc[mask, "_date"], vals[mask])
    return plot_multi_line(
        series, "Combined DA Cost — p50 ($/MiB)",
        ylabel="$/MiB", log_scale=True,
    )


def chart_cumulative_volume(data):
    """3d: Cumulative data volume comparison (computed within 90-day window)."""
    series = {}
    for name, df in data.items():
        daily_col = PROTO_CONFIG[name]["daily_mib"]
        # Recompute cumulative within the window (not from protocol genesis)
        cum_mib = df[daily_col].cumsum()
        # Convert to GiB for readability
        series[name] = (df["_date"], cum_mib / 1024)
    return plot_multi_line(
        series, "Cumulative DA Volume Over 90 Days",
        ylabel="GiB", log_scale=True,
    )


def chart_capacity_vs_cost(data):
    """3e: Scatter — max throughput (x) vs p50 cost (y), bubble size = utilization."""
    names, x_vals, y_vals, sizes = [], [], [], []
    for name in PROTO_ORDER:
        df = data[name]
        cfg = PROTO_CONFIG[name]
        cost_col = cfg["cost_p50"]
        if cost_col not in df.columns:
            continue
        cost_median = df[cost_col].dropna()
        cost_median = cost_median[cost_median > 0]
        if len(cost_median) == 0:
            continue
        names.append(name)
        x_vals.append(MAX_THROUGHPUT[name])
        y_vals.append(cost_median.median())
        util_col = cfg["utilization_7d"]
        sizes.append(max(df[util_col].mean(), 0.5))  # floor for visibility

    return plot_scatter_bubble(
        x_vals, y_vals, sizes, names,
        title="DA Protocol Landscape: Capacity vs Cost",
        xlabel="Max throughput (MiB/s)",
        ylabel="p50 cost ($/MiB)",
        log_x=True, log_y=True,
    )


def chart_encoding_overhead():
    """4a: Per-byte overhead comparison (static architecture data)."""
    protos = ["Celestia", "Polkadot", "Avail", "Ethereum", "NEAR", "Espresso"]
    encoding_rate = [4.0, 3.0, 2.0, 2.0, 1.0, 1.0]
    # Approximate proof overhead per sample (bytes)
    proof_bytes = [384, 1024, 48, 48, 0, 0]  # NMT ~384, Merkle ~1K, KZG ~48, none
    return plot_grouped_bar(
        protos,
        {"Encoding rate (×)": encoding_rate,
         "Proof size (bytes/sample)": proof_bytes},
        title="Per-Byte Overhead: Encoding Redundancy & Proof Size",
        ylabel="Value", log_scale=True,
        group_colors={"Encoding rate (×)": "#3366CC",
                      "Proof size (bytes/sample)": "#CC6633"},
    )


def chart_retention_adjusted_cost(data):
    """4b: Retention-adjusted cost comparison bar chart."""
    protos = ["Avail", "Polkadot", "NEAR", "Espresso", "Ethereum", "Celestia"]
    # Spot p50 cost ($/MiB) — from summary stats
    spot_p50 = {
        "Avail": 0.008,
        "Polkadot": 5e-6,
        "NEAR": 0.51,
        "Espresso": 3e-9,
        "Ethereum": 4e-4,
        "Celestia": 0.021,
    }
    # Reposts per year (from retention)
    reposts = {
        "Avail": 6176,
        "Polkadot": 350,
        "NEAR": 146,
        "Espresso": 52,
        "Ethereum": 21,
        "Celestia": 12,
    }

    spot_vals = [spot_p50[p] for p in protos]
    annual_vals = [spot_p50[p] * reposts[p] for p in protos]

    return plot_grouped_bar(
        protos,
        {"Spot p50 ($/MiB)": spot_vals,
         "Annualized ($/MiB/yr)": annual_vals},
        title="Retention-Adjusted DA Cost: Spot vs Annualized",
        ylabel="$/MiB", log_scale=True,
        group_colors={"Spot p50 ($/MiB)": "#3366CC",
                      "Annualized ($/MiB/yr)": "#CC3333"},
    )


def main():
    apply_style()
    print("Cross-protocol: loading data...")
    data = _load_all()

    print("Cross-protocol: generating charts...")

    save(chart_throughput(data), OUT_DIR, "combined_throughput")
    save(chart_utilization(data), OUT_DIR, "combined_utilization")
    save(chart_cost(data), OUT_DIR, "combined_cost")
    save(chart_cumulative_volume(data), OUT_DIR, "combined_cumulative")
    save(chart_capacity_vs_cost(data), OUT_DIR, "capacity_vs_cost")
    save(chart_encoding_overhead(), OUT_DIR, "encoding_overhead")
    save(chart_retention_adjusted_cost(data), OUT_DIR, "retention_adjusted_cost")

    print("Cross-protocol: done.")


if __name__ == "__main__":
    main()
