#!/usr/bin/env python3
"""
NEAR DA Throughput — matplotlib SVG charts

Reads ../analysis/blocks.csv + ../analysis/chain_config.json
and generates:
  1. throughput.svg       — per-block MiB/s (log scale) + rolling avg
  2. payload.svg          — encoded bytes per block (linear) + p50/p99
  3. da_utilization.svg   — DA utilization % (log) + p50/p99

Usage:
  python3 throughput/plot.py
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


def load_config() -> dict:
    return json.loads((DIR / "chain_config.json").read_text())


# ---------------------------------------------------------------------------
# Chart 1: Per-block throughput (MiB/s, log scale)
# ---------------------------------------------------------------------------

def plot_throughput(df: pd.DataFrame, cfg: dict) -> None:
    cc = cfg["config"]
    block_range = cfg["blockRange"]

    # Compute per-block MiB/s
    mibps = np.where(
        df["block_time_ms"] > 0,
        df["total_encoded_bytes"] / (df["block_time_ms"] / 1000) / MiB,
        0.0,
    )
    df = df.copy()
    df["mibps"] = mibps

    # Filter for positive values only (for log scale)
    mask = df["mibps"] > 0
    df_pos = df[mask].copy()

    if df_pos.empty:
        print("No positive throughput values — skipping throughput chart")
        return

    # Rolling average
    win = min(50, max(1, len(df_pos) // 4))
    df_pos["rolling"] = df_pos["mibps"].rolling(window=win, min_periods=1).mean()

    # Percentiles
    tp50 = float(np.percentile(df_pos["mibps"], 50))
    protocol_max = cc["protocolMaxMibps"]

    fig, ax = plt.subplots(figsize=(10, 4.5))

    ax.fill_between(df_pos["date"], df_pos["mibps"], alpha=0.08, color="#4361ee")
    ax.plot(df_pos["date"], df_pos["mibps"],
            color="#4361ee", linewidth=0.4, alpha=0.4, label="Actual (per block)")
    ax.plot(df_pos["date"], df_pos["rolling"],
            color="#e63946", linewidth=1.5, alpha=0.9, label=f"Rolling avg ({win} blocks)")

    # Protocol max hline
    ax.axhline(y=protocol_max, color="#2d6a4f", linewidth=1, linestyle="--",
               label=f"Protocol max ({protocol_max:.1f} MiB/s)")

    # Median hline
    median_label = (
        f"Median ({tp50:.1f} MiB/s)" if tp50 >= 1
        else f"Median ({tp50 * 1024:.0f} KiB/s)"
    )
    ax.axhline(y=tp50, color="#f4a261", linewidth=1, linestyle="--", label=median_label)

    ax.set_yscale("log")
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(
        lambda x, _: f"{x:.1f}" if x >= 1 else f"{x:.4f}"
    ))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d\n%H:%M"))
    fig.autofmt_xdate(rotation=0, ha="center")

    ax.set_xlabel("Time (UTC)")
    ax.set_ylabel("Throughput (MiB/s)")
    ax.set_title("NEAR DA Throughput per Block (log scale)",
                 fontweight="bold", loc="left")

    subtitle = (
        f"{len(df)} points  (blocks {block_range['start']}…{block_range['end']})  ·  "
        f"{cc['numShards']} shards  ·  proto v{cc['protocolVersion']}"
    )
    ax.text(0, 1.02, subtitle, transform=ax.transAxes, fontsize=7, color="#888")
    ax.legend(loc="upper right", fontsize=7.5, framealpha=0.9)

    fig.tight_layout()
    out = DIR / "throughput.svg"
    fig.savefig(out, format="svg")
    plt.close(fig)
    print(f"SVG -> {out}")


# ---------------------------------------------------------------------------
# Chart 2: DA payload size per block (encoded bytes, linear)
# ---------------------------------------------------------------------------

def plot_payload(df: pd.DataFrame, cfg: dict) -> None:
    cc = cfg["config"]
    block_range = cfg["blockRange"]

    p50 = float(np.percentile(df["total_encoded_bytes"], 50))
    p99 = float(np.percentile(df["total_encoded_bytes"], 99))

    def fmt_bytes(v: float) -> str:
        if v >= MiB:
            return f"{v / MiB:.1f} MiB"
        if v >= 1024:
            return f"{v / 1024:.0f} KiB"
        return f"{v:.0f} B"

    fig, ax1 = plt.subplots(figsize=(10, 4.5))

    ax1.fill_between(df["date"], df["total_encoded_bytes"], alpha=0.08, color="#4361ee")
    ax1.plot(df["date"], df["total_encoded_bytes"],
             color="#4361ee", linewidth=0.5, alpha=0.6, label="total_encoded_bytes")

    ax1.axhline(y=p99, color="#e63946", linewidth=1, linestyle="--",
                label=f"p99 ({fmt_bytes(p99)})")
    ax1.axhline(y=p50, color="#2a9d8f", linewidth=1, linestyle="--",
                label=f"p50 ({fmt_bytes(p50)})")

    ax1.set_ylim(bottom=0)
    ax1.yaxis.set_major_formatter(mticker.FuncFormatter(
        lambda x, _: f"{x / MiB:.1f}M" if x >= MiB else (f"{x / 1024:.0f}K" if x >= 1024 else f"{x:.0f}")
    ))
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%b %d\n%H:%M"))
    fig.autofmt_xdate(rotation=0, ha="center")

    ax1.set_xlabel("Time (UTC)")
    ax1.set_ylabel("Encoded bytes per block")
    ax1.set_title("NEAR DA Payload Size per Block",
                  fontweight="bold", loc="left")

    subtitle = (
        f"{len(df)} blocks  (blocks {block_range['start']}…{block_range['end']})  ·  "
        f"{cc['numShards']} shards  ·  proto v{cc['protocolVersion']}"
    )
    ax1.text(0, 1.02, subtitle, transform=ax1.transAxes, fontsize=7, color="#888")

    # Right axis: chunks produced
    ax2 = ax1.twinx()
    ax2.plot(df["date"], df["chunks_produced"],
             color="#7209b7", linewidth=0.8, alpha=0.5,
             label=f"Chunks produced (of {cc['numShards']})")
    ax2.set_ylim(0, cc["numShards"] * 1.1)
    ax2.set_ylabel("Chunks produced", color="#7209b7")
    ax2.tick_params(axis="y", labelcolor="#7209b7")

    # Combine legends
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2,
               loc="upper right", fontsize=7.5, framealpha=0.9)

    fig.tight_layout()
    out = DIR / "payload.svg"
    fig.savefig(out, format="svg")
    plt.close(fig)
    print(f"SVG -> {out}")


# ---------------------------------------------------------------------------
# Chart 3: DA utilization (used / protocol max %, log scale)
# ---------------------------------------------------------------------------

def plot_da_utilization(df: pd.DataFrame, cfg: dict) -> None:
    cc = cfg["config"]
    block_range = cfg["blockRange"]
    protocol_max = cc["protocolMaxMibps"]

    # Compute per-block MiB/s and utilization %
    mibps = np.where(
        df["block_time_ms"] > 0,
        df["total_encoded_bytes"] / (df["block_time_ms"] / 1000) / MiB,
        0.0,
    )
    da_util = (mibps / protocol_max) * 100

    df = df.copy()
    df["da_util"] = da_util

    mask = df["da_util"] > 0
    df_pos = df[mask].copy()

    if df_pos.empty:
        print("No positive utilization values — skipping utilization chart")
        return

    up50 = float(np.percentile(df_pos["da_util"], 50))
    up99 = float(np.percentile(df_pos["da_util"], 99))

    def fmt_pct(v: float) -> str:
        return f"{v:.1f}%" if v >= 1 else f"{v:.3f}%"

    fig, ax = plt.subplots(figsize=(10, 4.5))

    ax.fill_between(df_pos["date"], df_pos["da_util"], alpha=0.08, color="#4361ee")
    ax.plot(df_pos["date"], df_pos["da_util"],
            color="#4361ee", linewidth=0.8, label="Used / protocol max")

    ax.axhline(y=up99, color="#e63946", linewidth=1, linestyle="--",
               label=f"p99 ({fmt_pct(up99)})")
    ax.axhline(y=up50, color="#2a9d8f", linewidth=1, linestyle="--",
               label=f"p50 ({fmt_pct(up50)})")

    ax.set_yscale("log")
    ax.set_ylim(top=100)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(
        lambda x, _: f"{x:.0f}%" if x >= 1 else f"{x:.2g}%"
    ))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d\n%H:%M"))
    fig.autofmt_xdate(rotation=0, ha="center")

    ax.set_xlabel("Time (UTC)")
    ax.set_ylabel("DA utilization (%)")
    ax.set_title("NEAR DA Utilization (log scale)",
                 fontweight="bold", loc="left")

    subtitle = (
        f"{len(df)} blocks  (blocks {block_range['start']}…{block_range['end']})  ·  "
        f"Protocol max: {protocol_max:.1f} MiB/s"
    )
    ax.text(0, 1.02, subtitle, transform=ax.transAxes, fontsize=7, color="#888")
    ax.legend(loc="upper right", fontsize=7.5, framealpha=0.9)

    fig.tight_layout()
    out = DIR / "da_utilization.svg"
    fig.savefig(out, format="svg")
    plt.close(fig)
    print(f"SVG -> {out}")


# ---------------------------------------------------------------------------

def main():
    cfg = load_config()
    df = load_blocks()

    print(f"Loaded {len(df)} blocks from blocks.csv")
    plot_throughput(df, cfg)
    plot_payload(df, cfg)
    plot_da_utilization(df, cfg)
    print(f"\n{len(df)} rows plotted across 3 charts.")


if __name__ == "__main__":
    main()
