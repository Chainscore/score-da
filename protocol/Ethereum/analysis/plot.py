"""Ethereum EIP-4844 Blob DA — Generate research paper figures from daily.csv.

Extra charts: pct_time_at_floor, era transitions as vertical lines.
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
    C_PRIMARY, C_ROLLING, C_MAX, C_TARGET, C_ERA,
    C_BAND_LO, C_BAND_MID, C_BAND_HI,
    SZ_FULL, SZ_WIDE,
)

# Era colors for segmented charts
ERA_COLORS = {"Dencun": "#3366CC", "Pectra": "#E6A817", "BPO1": "#999999"}

ANALYSIS_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ANALYSIS_DIR, "out")
PROTO = "Ethereum"


def _add_era_lines(ax, dates, eras):
    """Add vertical dashed lines at era transitions."""
    prev = eras.iloc[0]
    for i in range(1, len(eras)):
        if eras.iloc[i] != prev:
            ax.axvline(dates.iloc[i], color=C_ERA, ls=":", lw=0.8, alpha=0.7)
            ax.text(dates.iloc[i], ax.get_ylim()[1] * 0.95, eras.iloc[i],
                    fontsize=6, rotation=90, va="top", ha="right", color=C_ERA)
            prev = eras.iloc[i]


def main():
    apply_style()
    df = pd.read_csv(os.path.join(ANALYSIS_DIR, "daily.csv"))
    d = parse_day(df)

    print(f"{PROTO}: generating plots...")

    # Throughput with expected (target) line
    fig = plot_throughput(
        d, df["actual_mib_per_s"], df["max_mib_per_s"], df["actual_mib_per_s_7d"],
        f"{PROTO} — Throughput (MiB/s)",
        expected=df["expected_mib_per_s"],
    )
    _add_era_lines(fig.axes[0], d, df["era"])
    save(fig, OUT_DIR, "throughput")

    # Utilization with era lines
    fig = plot_utilization(
        d, df["utilization_pct"], df["utilization_pct_7d"],
        f"{PROTO} — DA Utilization (%)",
    )
    _add_era_lines(fig.axes[0], d, df["era"])
    save(fig, OUT_DIR, "utilization")

    save(plot_data_volume(
        d, df["daily_data_mib"], df["daily_data_mib_7d"],
        f"{PROTO} — Daily Blob Data Volume (MiB)",
    ), OUT_DIR, "data_volume")

    # Cost bands — use cost_per_mib_day ($/MiB/day) which is the standard ETH DA metric
    save(plot_cost_bands(
        d, df["p10_cost_per_mib_day_usd"], df["p50_cost_per_mib_day_usd"],
        df["p90_cost_per_mib_day_usd"], df["vwap_cost_per_mib_day_usd_7d"],
        f"{PROTO} — Cost per MiB/day (USD) — Quantile Bands",
        log_scale=True, ylabel="$/MiB/day",
    ), OUT_DIR, "cost_bands")

    save(plot_cumulative(
        d, df["cumulative_daily_data_mib"], df["cumulative_daily_blob_spend_usd"],
        f"{PROTO} — Cumulative Data & Spend",
    ), OUT_DIR, "cumulative")

    # Ethereum-specific: pct time at floor
    save(plot_line(
        d, df["pct_time_at_floor"],
        f"{PROTO} — Pct Time at Blob Fee Floor",
        ylabel="%", label="% blocks at 1 wei floor",
    ), OUT_DIR, "pct_at_floor")

    # Target vs actual utilization with era boundary lines
    fig, ax = plt.subplots(figsize=SZ_FULL)
    ax.plot(d, df["utilization_pct"], color=C_PRIMARY, lw=1.2, label="Actual utilization", zorder=2)
    ax.plot(d, df["target_utilization_pct"], color=C_TARGET, lw=1.2, ls="--",
            label="Target utilization", zorder=3)
    ax.axhline(100, color=C_MAX, lw=0.8, ls=":", alpha=0.5)
    ax.set_ylabel("%")
    ax.set_title(f"{PROTO} — Target vs Actual Utilization (%)")
    _add_era_lines(ax, d, df["era"])
    ax.legend(loc="upper right", framealpha=0.9)
    fmt_date_axis(ax, d)
    fig.tight_layout()
    save(fig, OUT_DIR, "target_vs_actual_utilization")

    # ── Era-segmented cost bands (color-coded by era) ───────────────────────
    fig, ax = plt.subplots(figsize=SZ_FULL)
    for era in df["era"].unique():
        mask = df["era"] == era
        color = ERA_COLORS.get(era, C_PRIMARY)
        era_d = d[mask]
        ax.fill_between(era_d,
                        df.loc[mask, "p10_cost_per_mib_day_usd"],
                        df.loc[mask, "p90_cost_per_mib_day_usd"],
                        color=color, alpha=0.25)
        ax.plot(era_d, df.loc[mask, "p50_cost_per_mib_day_usd"],
                color=color, lw=1.2, label=era)
    ax.set_yscale("log")
    ax.set_ylabel("$/MiB/day")
    ax.set_title(f"{PROTO} — Cost Quantile Bands by Era")
    ax.legend(loc="upper right", framealpha=0.9)
    fmt_date_axis(ax, d)
    fig.tight_layout()
    save(fig, OUT_DIR, "cost_eras")

    # ── Per-era cost summary bar chart ──────────────────────────────────────
    eras = [e for e in df["era"].unique()]
    era_stats = []
    for era in eras:
        sub = df[df["era"] == era]
        era_stats.append({
            "era": era,
            "p10": sub["p10_cost_per_mib_day_usd"].median(),
            "p50": sub["p50_cost_per_mib_day_usd"].median(),
            "p90": sub["p90_cost_per_mib_day_usd"].median(),
        })

    x = np.arange(len(eras))
    width = 0.25
    fig, ax = plt.subplots(figsize=SZ_FULL)
    ax.bar(x - width, [s["p10"] for s in era_stats], width, label="p10",
           color=C_BAND_LO, alpha=0.8)
    ax.bar(x, [s["p50"] for s in era_stats], width, label="p50",
           color=C_BAND_MID, alpha=0.8)
    ax.bar(x + width, [s["p90"] for s in era_stats], width, label="p90",
           color=C_BAND_HI, alpha=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels(eras)
    ax.set_yscale("log")
    ax.set_ylabel("$/MiB/day")
    ax.set_title(f"{PROTO} — Cost Summary by Era")
    ax.legend(loc="upper right", framealpha=0.9)
    fig.tight_layout()
    save(fig, OUT_DIR, "cost_summary")

    print(f"{PROTO}: done.")


if __name__ == "__main__":
    main()
