"""Espresso DA — Generate research paper figures from daily.csv."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pandas as pd
from shared.plot_style import (
    apply_style, parse_day, save,
    plot_throughput, plot_utilization, plot_data_volume,
    plot_cost_bands, plot_cumulative, plot_block_time_bands,
)

ANALYSIS_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ANALYSIS_DIR, "out")
PROTO = "Espresso"


def main():
    apply_style()
    df = pd.read_csv(os.path.join(ANALYSIS_DIR, "daily.csv"))
    d = parse_day(df)

    print(f"{PROTO}: generating plots...")

    save(plot_throughput(
        d, df["actual_mib_per_s"], df["max_mib_per_s"], df["actual_mib_per_s_7d"],
        f"{PROTO} — Throughput (MiB/s)", log_scale=True,
    ), OUT_DIR, "throughput")

    save(plot_utilization(
        d, df["utilization_pct"], df["utilization_pct_7d"],
        f"{PROTO} — DA Utilization (%)",
    ), OUT_DIR, "utilization")

    save(plot_data_volume(
        d, df["daily_mib"], df["daily_mib_7d"],
        f"{PROTO} — Daily Data Volume (MiB)",
    ), OUT_DIR, "data_volume")

    save(plot_cost_bands(
        d, df["cost_per_mib_usd_p10"], df["cost_per_mib_usd_p50"], df["cost_per_mib_usd_p90"],
        df["cost_per_mib_usd_7d"],
        f"{PROTO} — Cost per MiB (USD) — Quantile Bands",
    ), OUT_DIR, "cost_bands")

    save(plot_cumulative(
        d, df["cumulative_daily_mib"], df["cumulative_daily_da_spend_usd"],
        f"{PROTO} — Cumulative Data & Spend",
    ), OUT_DIR, "cumulative")

    save(plot_block_time_bands(
        d, df["p10_block_time_ms"], df["p50_block_time_ms"], df["p90_block_time_ms"],
        f"{PROTO} — Block Time (ms)",
    ), OUT_DIR, "block_time")

    print(f"{PROTO}: done.")


if __name__ == "__main__":
    main()
