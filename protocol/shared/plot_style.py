"""Shared matplotlib styling and plotting helpers for DA research paper figures.

All protocols import this to get a consistent visual language.
"""

import os
from datetime import date

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import pandas as pd

# ── Research paper style ─────────────────────────────────────────────────────
STYLE = {
    "font.family": "serif",
    "font.size": 9,
    "axes.titlesize": 11,
    "axes.labelsize": 9,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "legend.fontsize": 8,
    "figure.dpi": 200,
    "savefig.dpi": 200,
    "savefig.bbox": "tight",
    "savefig.pad_inches": 0.15,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "grid.linewidth": 0.5,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.linewidth": 0.6,
    "lines.linewidth": 1.2,
    "lines.markersize": 3,
}

# Color palette — muted, print-friendly
C_PRIMARY = "#3366CC"     # bars, primary lines
C_ROLLING = "#CC3333"     # rolling average lines
C_MAX = "#999999"         # max capacity reference
C_TARGET = "#E6A817"      # target/expected reference
C_BAND_LO = "#B3CDE3"    # p10 band fill
C_BAND_MID = "#6497B1"   # p50 line
C_BAND_HI = "#005B96"    # p90 band fill
C_FILL = "#B3CDE3"        # area fill
C_CUMUL = "#2D5F91"       # cumulative line
C_SPEND = "#CC6633"       # spend line
C_ERA = "#888888"          # era boundary lines

# Figure sizes (width, height) in inches — for two-column paper layout
SZ_FULL = (7.0, 2.8)       # full-width main charts
SZ_HALF = (3.4, 2.4)       # half-width secondary charts
SZ_WIDE = (7.0, 2.0)       # full-width but shorter (cumulative, simple lines)


def apply_style():
    """Apply the research paper matplotlib rcParams."""
    plt.rcParams.update(STYLE)


def parse_day(df: pd.DataFrame, col: str = "_day") -> pd.Series:
    """Parse a day column to datetime for plotting."""
    return pd.to_datetime(df[col])


def fmt_date_axis(ax, df_dates: pd.Series):
    """Format x-axis as dates with sensible tick spacing."""
    span = (df_dates.max() - df_dates.min()).days
    if span > 365:
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
    elif span > 90:
        ax.xaxis.set_major_locator(mdates.MonthLocator())
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
    else:
        ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=2))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    plt.setp(ax.get_xticklabels(), rotation=30, ha="right")


def save(fig, out_dir: str, name: str):
    """Save figure as both PNG and SVG."""
    os.makedirs(out_dir, exist_ok=True)
    for ext in ("png", "svg"):
        path = os.path.join(out_dir, f"{name}.{ext}")
        fig.savefig(path)
    plt.close(fig)
    print(f"  {name}")


# ── Reusable chart templates ─────────────────────────────────────────────────

def plot_throughput(dates, actual, max_val, rolling, title,
                    expected=None, log_scale=False, size=SZ_FULL):
    """Throughput chart: bars for actual, horizontal/step lines for max/expected, rolling line."""
    fig, ax = plt.subplots(figsize=size)
    ax.bar(dates, actual, width=0.8, color=C_PRIMARY, alpha=0.7, label="Actual", zorder=2)
    ax.plot(dates, rolling, color=C_ROLLING, lw=1.5, label="7d avg", zorder=4)

    # Max as step line
    ax.plot(dates, max_val, color=C_MAX, lw=1.0, ls="--", label="Max capacity", zorder=3)
    if expected is not None:
        ax.plot(dates, expected, color=C_TARGET, lw=1.0, ls=":", label="Target", zorder=3)

    if log_scale:
        ax.set_yscale("log")
        ax.yaxis.set_major_formatter(mticker.ScalarFormatter())
        ax.yaxis.set_minor_formatter(mticker.NullFormatter())
    ax.set_ylabel("MiB/s")
    ax.set_title(title)
    ax.legend(loc="upper right", framealpha=0.9)
    fmt_date_axis(ax, dates)
    fig.tight_layout()
    return fig


def plot_utilization(dates, util, rolling, title, size=SZ_FULL):
    """Utilization area chart with rolling average overlay."""
    fig, ax = plt.subplots(figsize=size)
    ax.fill_between(dates, 0, util, color=C_FILL, alpha=0.6, label="Utilization")
    ax.plot(dates, rolling, color=C_ROLLING, lw=1.5, label="7d avg", zorder=3)
    ax.set_ylabel("%")
    ax.set_title(title)
    ax.legend(loc="upper right", framealpha=0.9)
    fmt_date_axis(ax, dates)
    fig.tight_layout()
    return fig


def plot_data_volume(dates, volume, rolling, title, ylabel="MiB", size=SZ_FULL):
    """Daily data volume bar chart with rolling average."""
    fig, ax = plt.subplots(figsize=size)
    ax.bar(dates, volume, width=0.8, color=C_PRIMARY, alpha=0.7, label="Daily", zorder=2)
    ax.plot(dates, rolling, color=C_ROLLING, lw=1.5, label="7d avg", zorder=3)
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.legend(loc="upper right", framealpha=0.9)
    fmt_date_axis(ax, dates)
    fig.tight_layout()
    return fig


def plot_cost_bands(dates, p10, p50, p90, rolling, title,
                    log_scale=False, ylabel="$/MiB", size=SZ_FULL):
    """Cost quantile bands: p10-p90 shaded area, p50 line, rolling mean line."""
    fig, ax = plt.subplots(figsize=size)
    ax.fill_between(dates, p10, p90, color=C_BAND_LO, alpha=0.4, label="p10–p90", zorder=1)
    ax.fill_between(dates, p10, p50, color=C_BAND_MID, alpha=0.3, zorder=2)
    ax.plot(dates, p50, color=C_BAND_MID, lw=1.0, label="p50", zorder=3)
    ax.plot(dates, rolling, color=C_ROLLING, lw=1.5, label="7d avg", zorder=4)
    if log_scale:
        ax.set_yscale("log")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.legend(loc="upper right", framealpha=0.9)
    fmt_date_axis(ax, dates)
    fig.tight_layout()
    return fig


def plot_cumulative(dates, cum_mib, cum_spend, title, size=SZ_WIDE):
    """Dual-axis cumulative chart: MiB on left, USD spend on right."""
    fig, ax1 = plt.subplots(figsize=size)
    ax1.plot(dates, cum_mib, color=C_CUMUL, lw=1.5, label="Cumulative MiB")
    ax1.set_ylabel("MiB", color=C_CUMUL)
    ax1.tick_params(axis="y", labelcolor=C_CUMUL)

    ax2 = ax1.twinx()
    ax2.plot(dates, cum_spend, color=C_SPEND, lw=1.5, ls="--", label="Cumulative USD")
    ax2.set_ylabel("USD", color=C_SPEND)
    ax2.tick_params(axis="y", labelcolor=C_SPEND)
    ax2.spines["right"].set_visible(True)

    # Combined legend
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper left", framealpha=0.9)

    ax1.set_title(title)
    fmt_date_axis(ax1, dates)
    fig.tight_layout()
    return fig


def plot_block_time_bands(dates, p10, p50, p90, title, size=SZ_FULL):
    """Block time p10/p50/p90 band chart."""
    fig, ax = plt.subplots(figsize=size)
    ax.fill_between(dates, p10, p90, color=C_BAND_LO, alpha=0.4, label="p10–p90")
    ax.plot(dates, p50, color=C_BAND_MID, lw=1.2, label="p50")
    ax.set_ylabel("ms")
    ax.set_title(title)
    ax.legend(loc="upper right", framealpha=0.9)
    fmt_date_axis(ax, dates)
    fig.tight_layout()
    return fig


def plot_line(dates, values, title, ylabel, label=None,
              rolling=None, rolling_label="7d avg",
              log_scale=False, size=SZ_FULL):
    """Simple line chart with optional rolling average."""
    fig, ax = plt.subplots(figsize=size)
    ax.plot(dates, values, color=C_PRIMARY, lw=1.2, label=label, zorder=2)
    if rolling is not None:
        ax.plot(dates, rolling, color=C_ROLLING, lw=1.5, label=rolling_label, zorder=3)
    if log_scale:
        ax.set_yscale("log")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    if label or rolling is not None:
        ax.legend(loc="upper right", framealpha=0.9)
    fmt_date_axis(ax, dates)
    fig.tight_layout()
    return fig


# ── Cross-protocol comparison palettes ───────────────────────────────────────

# Distinct colors for 6 protocols (colorblind-friendly, print-safe)
PROTO_COLORS = {
    "Polkadot":  "#E6194B",   # red
    "Ethereum":  "#3366CC",   # blue
    "Celestia":  "#F58231",   # orange
    "Espresso":  "#911EB4",   # purple
    "NEAR":      "#42D4F4",   # cyan
    "Avail":     "#3CB44B",   # green
}
PROTO_ORDER = ["Polkadot", "Ethereum", "Celestia", "Espresso", "NEAR", "Avail"]

SZ_CROSS = (7.0, 3.5)   # cross-protocol comparison charts (slightly taller)


def plot_multi_line(series_dict, title, ylabel, log_scale=False,
                    ref_lines=None, size=SZ_CROSS):
    """Overlay multiple protocol time series on one chart.

    Parameters
    ----------
    series_dict : dict[str, (dates, values)]
        Mapping protocol name → (dates array, values array).
    ref_lines : dict[str, float] or None
        Mapping protocol name → horizontal reference value (e.g. max capacity).
    """
    fig, ax = plt.subplots(figsize=size)
    for name in PROTO_ORDER:
        if name not in series_dict:
            continue
        dates, vals = series_dict[name]
        color = PROTO_COLORS[name]
        ax.plot(dates, vals, color=color, lw=1.3, label=name, zorder=2)
    if ref_lines:
        for name, val in ref_lines.items():
            color = PROTO_COLORS.get(name, C_MAX)
            ax.axhline(val, color=color, lw=0.7, ls=":", alpha=0.4)
    if log_scale:
        ax.set_yscale("log")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.legend(loc="best", framealpha=0.9, ncol=2, fontsize=7)
    # Use first series for date formatting
    first_dates = next(iter(series_dict.values()))[0]
    fmt_date_axis(ax, first_dates)
    fig.tight_layout()
    return fig


def plot_grouped_bar(categories, groups, title, ylabel, log_scale=False,
                     group_colors=None, size=SZ_CROSS):
    """Grouped bar chart for comparing metrics across protocols.

    Parameters
    ----------
    categories : list[str]
        Category labels (e.g. protocol names) for the x-axis.
    groups : dict[str, list[float]]
        Mapping group_name → list of values (one per category).
    group_colors : dict[str, str] or None
        Mapping group_name → color.
    """
    n_cats = len(categories)
    n_groups = len(groups)
    width = 0.7 / n_groups
    x = np.arange(n_cats)

    fig, ax = plt.subplots(figsize=size)
    default_colors = [C_PRIMARY, C_ROLLING, C_BAND_MID, C_SPEND, C_CUMUL, C_ERA]
    for i, (gname, gvals) in enumerate(groups.items()):
        color = (group_colors or {}).get(gname, default_colors[i % len(default_colors)])
        offset = (i - n_groups / 2 + 0.5) * width
        ax.bar(x + offset, gvals, width=width, color=color, alpha=0.8, label=gname)
    ax.set_xticks(x)
    ax.set_xticklabels(categories, rotation=30, ha="right")
    if log_scale:
        ax.set_yscale("log")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.legend(loc="best", framealpha=0.9)
    fig.tight_layout()
    return fig


def plot_scatter_bubble(x_vals, y_vals, sizes, labels, title,
                        xlabel, ylabel, log_x=False, log_y=False,
                        colors=None, size=SZ_CROSS):
    """Scatter/bubble chart for protocol capacity vs cost summary.

    Parameters
    ----------
    x_vals, y_vals : list[float]
        Coordinates for each protocol.
    sizes : list[float]
        Bubble sizes (will be scaled for visibility).
    labels : list[str]
        Protocol names to annotate each point.
    colors : list[str] or None
        Per-point colors; defaults to PROTO_COLORS lookup.
    """
    fig, ax = plt.subplots(figsize=size)
    # Scale sizes so the largest bubble is reasonable
    size_arr = np.array(sizes, dtype=float)
    size_arr = size_arr / size_arr.max() * 800 + 50  # 50–850 pt range

    point_colors = colors or [PROTO_COLORS.get(l, C_PRIMARY) for l in labels]
    ax.scatter(x_vals, y_vals, s=size_arr, c=point_colors, alpha=0.7, edgecolors="white", lw=0.8)

    for xi, yi, lbl in zip(x_vals, y_vals, labels):
        ax.annotate(lbl, (xi, yi), textcoords="offset points",
                    xytext=(8, 6), fontsize=8, fontweight="bold")

    if log_x:
        ax.set_xscale("log")
    if log_y:
        ax.set_yscale("log")
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    fig.tight_layout()
    return fig
