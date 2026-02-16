"""Shared utilities for local DA protocol data transformations."""

import glob
import os

import numpy as np
import pandas as pd

MiB = 1_048_576


def safe_div(numerator, denominator):
    """Element-wise division returning NaN where denominator is 0/NaN."""
    return numerator / denominator.replace(0, np.nan)


def load_blocks(blocks_dir: str, timestamp_col: str = "timestamp_ms") -> pd.DataFrame:
    """Load all CSV files from a blocks directory, concat, and add time columns.

    Parses ``timestamp_col`` (milliseconds since epoch) into:
      - ``_datetime``  (UTC datetime)
      - ``_day``       (date, for daily groupby)
      - ``_hour``      (datetime truncated to hour, for hourly groupby)

    Returns the concatenated DataFrame sorted by the timestamp column.
    """
    files = sorted(glob.glob(os.path.join(blocks_dir, "*.csv")))
    if not files:
        raise FileNotFoundError(f"No CSV files in {blocks_dir}")
    dfs = [pd.read_csv(f) for f in files]
    df = pd.concat(dfs, ignore_index=True)
    df["_datetime"] = pd.to_datetime(df[timestamp_col], unit="ms", utc=True)
    df["_day"] = df["_datetime"].dt.date
    df["_hour"] = df["_datetime"].dt.floor("h")
    df = df.sort_values(timestamp_col).reset_index(drop=True)
    return df


def load_prices(path: str, date_col: str, price_col: str) -> pd.DataFrame:
    """Load a prices CSV and return it with ``_day`` and ``_hour`` columns.

    If the date column is already a date string (``YYYY-MM-DD``), it is parsed
    directly. If it looks like millisecond-epoch, it is converted via
    ``pd.to_datetime(..., unit='ms')``.
    """
    df = pd.read_csv(path)
    sample = str(df[date_col].iloc[0])
    try:
        # Try epoch milliseconds first (purely numeric, large values)
        vals = pd.to_numeric(df[date_col], errors="raise")
        df["_datetime"] = pd.to_datetime(vals, unit="ms", utc=True)
    except (ValueError, TypeError):
        df["_datetime"] = pd.to_datetime(df[date_col], format="ISO8601", utc=True)
    df["_day"] = df["_datetime"].dt.date
    df["_hour"] = df["_datetime"].dt.floor("h")
    return df


def add_rolling(df: pd.DataFrame, period_col: str, cols: list[str], window: int, suffix: str) -> pd.DataFrame:
    """Add rolling-mean columns for *cols* over *window* rows, ordered by *period_col*.

    New columns are named ``{col}_{suffix}``.
    """
    df = df.sort_values(period_col).reset_index(drop=True)
    for col in cols:
        df[f"{col}_{suffix}"] = df[col].rolling(window, min_periods=1).mean()
    return df


def add_cumulative(df: pd.DataFrame, period_col: str, cols: list[str], prefix: str = "cumulative") -> pd.DataFrame:
    """Add cumulative-sum columns for *cols*, ordered by *period_col*.

    New columns are named ``{prefix}_{col}``.
    """
    df = df.sort_values(period_col).reset_index(drop=True)
    for col in cols:
        df[f"{prefix}_{col}"] = df[col].cumsum()
    return df


def ensure_output_dir(script_file: str) -> str:
    """Create ``analysis/`` directory in the protocol root and return its path."""
    data_dir = os.path.dirname(os.path.abspath(script_file))
    protocol_dir = os.path.dirname(data_dir)
    out_dir = os.path.join(protocol_dir, "analysis")
    os.makedirs(out_dir, exist_ok=True)
    return out_dir


def write_output(df: pd.DataFrame, out_dir: str, name: str) -> None:
    """Write a DataFrame to ``{out_dir}/{name}.csv``, printing a summary."""
    path = os.path.join(out_dir, f"{name}.csv")
    df.to_csv(path, index=False)
    print(f"  {name}: {len(df)} rows -> {path}")
