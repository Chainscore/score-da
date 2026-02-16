"""Polkadot DA — Generate research paper figures from daily.csv.

Extra charts: pipeline efficiency, core engagement, coretime cost.
No hourly cost (too sparse).
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from shared.plot_style import (
    apply_style, parse_day, save, fmt_date_axis,
    plot_throughput, plot_utilization, plot_data_volume,
    plot_cost_bands, plot_cumulative, plot_line,
    C_PRIMARY, C_ROLLING, C_BAND_LO, C_BAND_MID, C_BAND_HI,
    SZ_FULL, SZ_WIDE,
)

ANALYSIS_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ANALYSIS_DIR, "out")
PROTO = "Polkadot"


def main():
    apply_style()
    df = pd.read_csv(os.path.join(ANALYSIS_DIR, "daily.csv"))
    d = parse_day(df)

    print(f"{PROTO}: generating plots...")

    # Throughput — Polkadot max is ~167 MiB/s vs actual ~43 → log not needed
    save(plot_throughput(
        d, df["actual_mib_per_s"], df["max_mib_per_s"], df["actual_mib_per_s_7d"],
        f"{PROTO} — Throughput Upper Bound (MiB/s)",
    ), OUT_DIR, "throughput")

    save(plot_utilization(
        d, df["utilization_pct"], df["utilization_pct_7d"],
        f"{PROTO} — DA Utilization (%)",
    ), OUT_DIR, "utilization")

    save(plot_data_volume(
        d, df["daily_data_mib"], df["daily_data_mib_7d"],
        f"{PROTO} — Daily Data Volume Upper Bound (MiB)",
    ), OUT_DIR, "data_volume")

    # Cost bands from bulk coretime purchases (sparse — only days with purchases)
    has_cost = df["bulk_p50_cost_per_mib_usd"].notna()
    if has_cost.sum() > 3:
        cost_df = df[has_cost].copy()
        cost_d = parse_day(cost_df)
        save(plot_cost_bands(
            cost_d,
            cost_df["bulk_p10_cost_per_mib_usd"],
            cost_df["bulk_p50_cost_per_mib_usd"],
            cost_df["bulk_p90_cost_per_mib_usd"],
            cost_df["bulk_p50_cost_per_mib_usd"],  # use p50 as rolling proxy (sparse)
            f"{PROTO} — Bulk Coretime Cost per MiB (USD)",
            log_scale=True,
        ), OUT_DIR, "cost_bands")

    save(plot_cumulative(
        d, df["cumulative_daily_data_mib"], df["cumulative_daily_total_spend_usd"],
        f"{PROTO} — Cumulative Data & Spend",
    ), OUT_DIR, "cumulative")

    # Pipeline efficiency
    save(plot_line(
        d, df["pipeline_efficiency_pct"],
        f"{PROTO} — Pipeline Efficiency (included/backed)",
        ylabel="%", label="Efficiency",
        rolling=df["pipeline_efficiency_pct_7d"], rolling_label="7d avg",
    ), OUT_DIR, "pipeline_efficiency")

    # Core engagement
    save(plot_line(
        d, df["core_engagement_pct"],
        f"{PROTO} — Core Engagement (%)",
        ylabel="%", label="Engagement",
        rolling=df["core_engagement_pct_7d"], rolling_label="7d avg",
    ), OUT_DIR, "core_engagement")

    # Parachain diversity: distinct parachains + core engagement on dual axes
    fig, ax1 = plt.subplots(figsize=SZ_FULL)
    ax1.plot(d, df["avg_distinct_paras"], color=C_PRIMARY, lw=1.2, label="Distinct parachains")
    ax1.set_ylabel("Distinct parachains / day", color=C_PRIMARY)
    ax1.tick_params(axis="y", labelcolor=C_PRIMARY)

    ax2 = ax1.twinx()
    ax2.plot(d, df["core_engagement_pct"], color=C_ROLLING, lw=1.2, ls="--",
             label="Core engagement %")
    ax2.set_ylabel("Core engagement (%)", color=C_ROLLING)
    ax2.tick_params(axis="y", labelcolor=C_ROLLING)
    ax2.spines["right"].set_visible(True)

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper right", framealpha=0.9)
    ax1.set_title(f"{PROTO} — Parachain Diversity & Core Engagement")
    fmt_date_axis(ax1, d)
    fig.tight_layout()
    save(fig, OUT_DIR, "parachain_diversity")

    print(f"{PROTO}: done.")


if __name__ == "__main__":
    main()
