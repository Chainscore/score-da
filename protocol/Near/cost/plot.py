#!/usr/bin/env python3
"""
NEAR DA Cost — matplotlib SVG charts

Reads shared data from ../analysis/:
  - blocks.csv        — per-block data (from unified collector)
  - prices.csv        — NEAR/USD hourly prices (90d)
  - chain_config.json — protocol config + gas parameters

Joins blocks × prices at plot time to compute cost.

Generates:
  1. cost_per_mib.svg          — $/MiB over 90 days (hourly, from prices)
  2. cost_quantile_bands.svg   — daily p10/p50/p90 bands
  3. cost_per_block.svg        — per-block DA expenditure (recent)

Usage:
  python3 cost/plot.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.ticker as mticker

DIR = Path(__file__).resolve().parent.parent / "analysis"

MiB = 1_048_576
YOCTO = 1e24

plt.rcParams.update({
    "font.family": "Helvetica, Arial, sans-serif",
    "font.size": 9,
    "axes.titlesize": 11,
    "axes.labelsize": 9,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
    "axes.grid": True,
    "grid.alpha": 0.3,
    "grid.linewidth": 0.5,
})


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_blocks() -> pd.DataFrame:
    data_dir = DIR / "data"
    files = sorted(data_dir.glob("*.csv"))
    if not files:
        raise FileNotFoundError(f"No CSV files in {data_dir}")
    df = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)
    df.sort_values("block_height", inplace=True, ignore_index=True)
    df["date"] = pd.to_datetime(df["timestamp_ms"], unit="ms")
    return df


def load_prices() -> pd.DataFrame:
    df = pd.read_csv(DIR / "prices.csv")
    df["date"] = pd.to_datetime(df["date"])
    return df


def load_config() -> dict:
    return json.loads((DIR / "chain_config.json").read_text())


def compute_cost_over_time(prices: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """Compute $/MiB for each hourly price point using gas config."""
    gas = cfg["gas"]
    per_mib_near = gas["per_mib_near"]
    df = prices.copy()
    df["cost_per_mib_usd"] = per_mib_near * df["near_usd"]
    return df


def compute_block_costs(blocks: pd.DataFrame, prices: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """Join blocks with nearest hourly price to compute per-block cost."""
    gas = cfg["gas"]

    # For each block, find the nearest price by timestamp
    blocks = blocks.copy()
    prices_ts = prices["timestamp_ms"].values
    prices_usd = prices["near_usd"].values

    def nearest_price(ts: int) -> float:
        idx = np.searchsorted(prices_ts, ts)
        if idx == 0:
            return prices_usd[0]
        if idx >= len(prices_ts):
            return prices_usd[-1]
        # Pick the closer of the two neighbors
        if abs(prices_ts[idx] - ts) < abs(prices_ts[idx - 1] - ts):
            return prices_usd[idx]
        return prices_usd[idx - 1]

    blocks["near_usd"] = blocks["timestamp_ms"].apply(nearest_price)

    # Gas cost per block:
    # gas_for_block = receipt_gas + fn_call_base + fn_call_per_byte * encoded_bytes
    # cost_near = gas_price * gas_for_block / 1e24
    # cost_usd = cost_near * near_usd
    gas_price = float(gas["gas_price"])
    receipt_gas = gas["receipt_creation_gas"]
    fn_base = gas["fn_call_base_gas"]
    fn_per_byte = gas["fn_call_per_byte_gas"]

    gas_for_block = receipt_gas + fn_base + fn_per_byte * blocks["total_encoded_bytes"]
    blocks["block_cost_near"] = gas_price * gas_for_block / YOCTO
    blocks["block_cost_usd"] = blocks["block_cost_near"] * blocks["near_usd"]
    blocks["cost_per_mib_usd"] = np.where(
        blocks["total_encoded_bytes"] > 0,
        blocks["block_cost_usd"] / (blocks["total_encoded_bytes"] / MiB),
        0.0,
    )

    return blocks


# ---------------------------------------------------------------------------
# Formatters
# ---------------------------------------------------------------------------

def usd_fmt(x, _):
    if x == 0:
        return "$0"
    if x >= 1:
        return f"${x:.2f}"
    if x >= 0.01:
        return f"${x:.3f}"
    return f"${x:.4f}"


# ---------------------------------------------------------------------------
# Chart 1: $/MiB over 90 days
# ---------------------------------------------------------------------------

def plot_cost_per_mib(df: pd.DataFrame, cfg: dict) -> None:
    gas = cfg["gas"]

    fig, ax = plt.subplots(figsize=(10, 4.5))

    ax.fill_between(df["date"], df["cost_per_mib_usd"], alpha=0.08, color="#4361ee")
    ax.plot(df["date"], df["cost_per_mib_usd"], color="#4361ee", linewidth=0.8,
            alpha=0.6, label="$/MiB (hourly)")

    # 7-day rolling average
    rolling = df["cost_per_mib_usd"].rolling(window=7 * 24, min_periods=1).mean()
    ax.plot(df["date"], rolling, color="#e63946", linewidth=1.8, label="7-day avg")

    # Current cost
    current = gas["current_cost_per_mib_usd"]
    ax.axhline(y=current, color="#f77f00", linewidth=1, linestyle="--", alpha=0.7)
    ax.annotate(f"Current: ${current:.4f}/MiB", xy=(df["date"].iloc[-1], current),
                fontsize=7.5, color="#f77f00", ha="right", va="bottom")

    ax.set_yscale("log")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(usd_fmt))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=2))
    fig.autofmt_xdate(rotation=0, ha="center")

    ax.set_xlabel("Date")
    ax.set_ylabel("USD / MiB")
    ax.set_title("NEAR DA: Cost per MiB over Time",
                 fontweight="bold", loc="left")

    price_range = cfg.get("priceRange", {})
    n_points = price_range.get("points", len(df))
    ax.text(0, 1.02,
            f"Gas cost = {gas['per_mib_near']:.6f} NEAR/MiB (fixed) × NEAR/USD  ·  {n_points} hourly samples",
            transform=ax.transAxes, fontsize=7, color="#888")
    ax.legend(loc="upper right", fontsize=8, framealpha=0.9)

    fig.tight_layout()
    out = DIR / "cost_per_mib.svg"
    fig.savefig(out, format="svg")
    plt.close(fig)
    print(f"SVG -> {out}")


# ---------------------------------------------------------------------------
# Chart 2: Daily rolling quantile bands
# ---------------------------------------------------------------------------

def plot_quantile_bands(df: pd.DataFrame, cfg: dict) -> None:
    daily = df.set_index("date")["cost_per_mib_usd"].resample("D")
    daily_df = pd.DataFrame({
        "p10": daily.quantile(0.10),
        "p50": daily.quantile(0.50),
        "p90": daily.quantile(0.90),
        "mean": daily.mean(),
    }).dropna()

    fig, ax = plt.subplots(figsize=(10, 4.5))

    ax.fill_between(daily_df.index, daily_df["p10"], daily_df["p90"],
                     alpha=0.15, color="#4361ee", label="p10–p90 band")
    ax.plot(daily_df.index, daily_df["p50"], color="#4361ee", linewidth=2,
            label="Median (p50)")
    ax.plot(daily_df.index, daily_df["mean"], color="#e63946", linewidth=1.2,
            linestyle=":", label="Daily mean")

    ax.yaxis.set_major_formatter(mticker.FuncFormatter(usd_fmt))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=2))
    fig.autofmt_xdate(rotation=0, ha="center")

    ax.set_xlabel("Date")
    ax.set_ylabel("USD / MiB")
    ax.set_title("NEAR DA: Cost Quantile Bands ($/MiB/day)",
                 fontweight="bold", loc="left")
    ax.text(0, 1.02,
            "Daily p10/p50/p90 of hourly cost. Variance from intra-day NEAR/USD swings.",
            transform=ax.transAxes, fontsize=7, color="#888")
    ax.legend(loc="upper right", fontsize=8, framealpha=0.9)

    fig.tight_layout()
    out = DIR / "cost_quantile_bands.svg"
    fig.savefig(out, format="svg")
    plt.close(fig)
    print(f"SVG -> {out}")


# ---------------------------------------------------------------------------
# Chart 3: Per-block cost (recent blocks)
# ---------------------------------------------------------------------------

def plot_block_costs(df: pd.DataFrame, cfg: dict) -> None:
    gas = cfg["gas"]
    df_data = df[df["total_encoded_bytes"] > 0].copy()
    if df_data.empty:
        print("No blocks with DA data — skipping block cost chart")
        return

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), sharex=True,
                                    gridspec_kw={"height_ratios": [3, 2], "hspace": 0.08})

    # Top: cost per block
    ax1.fill_between(df_data["block_height"], df_data["block_cost_usd"],
                      alpha=0.1, color="#4361ee")
    ax1.plot(df_data["block_height"], df_data["block_cost_usd"],
             color="#4361ee", linewidth=0.5, alpha=0.5, label="Block cost")

    win = min(50, len(df_data) // 4 or 1)
    rolling = df_data["block_cost_usd"].rolling(window=win, min_periods=1).mean()
    ax1.plot(df_data["block_height"], rolling,
             color="#e63946", linewidth=1.5, label=f"{win}-block avg")

    ax1.set_yscale("log")
    ax1.yaxis.set_major_formatter(mticker.FuncFormatter(usd_fmt))
    ax1.set_ylabel("DA cost / block (USD)")
    ax1.legend(loc="upper right", fontsize=8, framealpha=0.9)

    ax1.set_title("NEAR DA: Per-Block Expenditure",
                   fontweight="bold", loc="left")
    ax1.text(0, 1.04,
             f"{len(df_data)} blocks with DA data  ·  NEAR/USD ${gas['current_near_usd']:.2f}",
             transform=ax1.transAxes, fontsize=7, color="#888")

    # Bottom: bytes per block
    ax2.bar(df_data["block_height"], df_data["total_encoded_bytes"],
            color="#2a9d8f", alpha=0.5, width=1.0)
    ax2.set_ylabel("Encoded bytes")
    ax2.set_xlabel("Block Height")
    ax2.yaxis.set_major_formatter(mticker.FuncFormatter(
        lambda x, _: f"{x/1024:.0f}K" if x >= 1024 else f"{x:.0f}"))

    fig.subplots_adjust(left=0.08, right=0.97, top=0.90, bottom=0.10, hspace=0.08)
    out = DIR / "cost_per_block.svg"
    fig.savefig(out, format="svg")
    plt.close(fig)
    print(f"SVG -> {out}")


# ---------------------------------------------------------------------------

def main():
    cfg = load_config()
    prices_df = load_prices()
    blocks_df = load_blocks()

    print(f"Loaded {len(blocks_df)} blocks, {len(prices_df)} price points")

    # Compute derived data
    cost_df = compute_cost_over_time(prices_df, cfg)
    block_cost_df = compute_block_costs(blocks_df, prices_df, cfg)

    plot_cost_per_mib(cost_df, cfg)
    plot_quantile_bands(cost_df, cfg)
    plot_block_costs(block_cost_df, cfg)


if __name__ == "__main__":
    main()
