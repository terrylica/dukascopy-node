# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas"]
# ///
"""
Transform dukascopy-node 1H CSVs to alpha-forge panel format.
Produce 1H files (column rename + symbol injection) and 2H resampled files.
Oracle-based verification of 2H resampling against 1H source.
"""
import os
import sys
from pathlib import Path

import pandas as pd

DATA_DIR = Path(os.path.expanduser("~/fork-tools/dukascopy-node/data"))
OUT_DIR = DATA_DIR / "alpha-forge"
OUT_DIR.mkdir(exist_ok=True)

SOURCES = [
    ("xauusd-h1-bid", "XAUUSD_BID"),
    ("xauusd-h1-ask", "XAUUSD_ASK"),
    ("xagusd-h1-bid", "XAGUSD_BID"),
    ("xagusd-h1-ask", "XAGUSD_ASK"),
]


def find_source_file(prefix: str) -> Path:
    matches = list(DATA_DIR.glob(f"{prefix}*.csv"))
    if len(matches) != 1:
        raise FileNotFoundError(
            f"Expected 1 file matching {prefix}*, found {len(matches)}: {matches}"
        )
    return matches[0]


def load_and_transform_1h(src_path: Path, symbol: str) -> pd.DataFrame:
    df = pd.read_csv(src_path)
    df = df.rename(columns={"timestamp": "ts"})
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df["symbol"] = symbol
    df = df[["ts", "symbol", "open", "high", "low", "close", "volume"]]
    df = df.sort_values("ts").reset_index(drop=True)
    return df


def resample_to_2h(df_1h: pd.DataFrame) -> pd.DataFrame:
    symbol = df_1h["symbol"].iloc[0]
    df = df_1h.set_index("ts")
    df_2h = (
        df.resample("2h")
        .agg(
            {
                "open": "first",
                "high": "max",
                "low": "min",
                "close": "last",
                "volume": "sum",
            }
        )
        .dropna(subset=["open"])
    )
    df_2h["symbol"] = symbol
    df_2h = df_2h.reset_index()
    df_2h = df_2h[["ts", "symbol", "open", "high", "low", "close", "volume"]]
    return df_2h


def verify_2h_resampling(
    df_1h: pd.DataFrame, df_2h: pd.DataFrame, symbol: str
) -> None:
    """
    Oracle-based bit-exact verification of 2H resampling.
    Independently recompute from 1H source and assert numerical identity.
    """
    errors = []

    # 1. Independently recompute 2H from 1H (oracle)
    df_src = df_1h.set_index("ts")
    oracle = (
        df_src.resample("2h")
        .agg(
            {
                "open": "first",
                "high": "max",
                "low": "min",
                "close": "last",
                "volume": "sum",
            }
        )
        .dropna(subset=["open"])
        .reset_index()
    )

    # 2. Structural checks
    if len(df_2h) != len(oracle):
        errors.append(
            f"[{symbol}] Row count mismatch: resampled={len(df_2h)}, oracle={len(oracle)}"
        )

    # 3. Timestamp identity
    ts_match = (df_2h["ts"].values == oracle["ts"].values).all()
    if not ts_match:
        mismatches = df_2h["ts"].values != oracle["ts"].values
        n = mismatches.sum()
        errors.append(f"[{symbol}] {n} timestamp mismatches")

    # 4. Bit-exact OHLCV identity (not approximate — exact float comparison)
    for col in ["open", "high", "low", "close", "volume"]:
        resampled_vals = df_2h[col].values
        oracle_vals = oracle[col].values
        if len(resampled_vals) != len(oracle_vals):
            errors.append(
                f"[{symbol}] {col}: length mismatch "
                f"{len(resampled_vals)} vs {len(oracle_vals)}"
            )
            continue
        exact_match = (resampled_vals == oracle_vals).all()
        if not exact_match:
            diffs = resampled_vals != oracle_vals
            n_diff = diffs.sum()
            first_idx = diffs.argmax()
            errors.append(
                f"[{symbol}] {col}: {n_diff} mismatches. "
                f"First at idx={first_idx}, ts={df_2h['ts'].iloc[first_idx]}, "
                f"got={resampled_vals[first_idx]}, expected={oracle_vals[first_idx]}"
            )

    # 5. Boundary: first 2H bar starts at or after first 1H bar
    if len(df_2h) > 0 and len(df_1h) > 0 and df_2h["ts"].iloc[0] < df_1h["ts"].iloc[0]:
            errors.append(
                f"[{symbol}] 2H starts before 1H: "
                f"{df_2h['ts'].iloc[0]} < {df_1h['ts'].iloc[0]}"
            )

    # 6. Invariant: high >= max(open, close, low) and low <= min(open, close, low)
    if len(df_2h) > 0:
        bad_high = df_2h[
            (df_2h["high"] < df_2h["open"])
            | (df_2h["high"] < df_2h["close"])
            | (df_2h["high"] < df_2h["low"])
        ]
        if len(bad_high) > 0:
            errors.append(
                f"[{symbol}] {len(bad_high)} bars where high < other OHLC fields"
            )
        bad_low = df_2h[
            (df_2h["low"] > df_2h["open"])
            | (df_2h["low"] > df_2h["close"])
            | (df_2h["low"] > df_2h["high"])
        ]
        if len(bad_low) > 0:
            errors.append(
                f"[{symbol}] {len(bad_low)} bars where low > other OHLC fields"
            )

    # 7. Volume conservation: sum of 1H volumes per 2H window == 2H volume
    vol_oracle = df_src["volume"].resample("2h").sum().dropna()
    vol_oracle = vol_oracle[vol_oracle.index.isin(df_2h["ts"].values)]
    vol_2h = df_2h.set_index("ts")["volume"]
    common_idx = vol_oracle.index.intersection(vol_2h.index)
    vol_diff = (vol_oracle.loc[common_idx] - vol_2h.loc[common_idx]).abs()
    nonzero_diffs = vol_diff[vol_diff > 0]
    if len(nonzero_diffs) > 0:
        errors.append(
            f"[{symbol}] {len(nonzero_diffs)} bars with volume conservation violation"
        )

    # 8. Fence-post: each 2H bar contains exactly 1 or 2 source 1H bars
    for _, row_2h in df_2h.iterrows():
        window_start = row_2h["ts"]
        window_end = window_start + pd.Timedelta(hours=2)
        source_bars = df_1h[
            (df_1h["ts"] >= window_start) & (df_1h["ts"] < window_end)
        ]
        n_source = len(source_bars)
        if n_source < 1 or n_source > 2:
            errors.append(
                f"[{symbol}] 2H bar at {window_start} has {n_source} source 1H bars "
                f"(expected 1-2)"
            )
            if len(errors) > 20:
                errors.append("... truncated, too many errors")
                break

    if errors:
        print(f"\nVERIFICATION FAILED for {symbol}:")
        for e in errors:
            print(f"  ERROR: {e}")
        sys.exit(1)
    else:
        print(f"  VERIFIED: {symbol} - bit-exact match, all invariants hold")


def main():
    all_1h_frames = []
    all_2h_frames = []

    for prefix, symbol in SOURCES:
        src_path = find_source_file(prefix)
        print(f"\nProcessing {symbol} from {src_path.name}")

        df_1h = load_and_transform_1h(src_path, symbol)
        print(
            f"  1H: {len(df_1h)} rows, "
            f"{df_1h['ts'].min()} to {df_1h['ts'].max()}"
        )

        df_2h = resample_to_2h(df_1h)
        print(
            f"  2H: {len(df_2h)} rows, "
            f"{df_2h['ts'].min()} to {df_2h['ts'].max()}"
        )

        verify_2h_resampling(df_1h, df_2h, symbol)

        all_1h_frames.append(df_1h)
        all_2h_frames.append(df_2h)

    panel_1h = (
        pd.concat(all_1h_frames, ignore_index=True)
        .sort_values(["symbol", "ts"])
        .reset_index(drop=True)
    )
    panel_2h = (
        pd.concat(all_2h_frames, ignore_index=True)
        .sort_values(["symbol", "ts"])
        .reset_index(drop=True)
    )

    out_1h = OUT_DIR / "metals_h1.csv"
    out_2h = OUT_DIR / "metals_h2.csv"
    panel_1h.to_csv(out_1h, index=False)
    panel_2h.to_csv(out_2h, index=False)

    print("\n=== OUTPUT ===")
    print(f"1H panel: {out_1h} ({len(panel_1h)} rows)")
    print(f"2H panel: {out_2h} ({len(panel_2h)} rows)")

    for label, panel in [("1H", panel_1h), ("2H", panel_2h)]:
        dupes = panel.duplicated(subset=["ts", "symbol"], keep=False)
        if dupes.any():
            print(f"  WARNING: {label} has {dupes.sum()} duplicate (ts, symbol) rows")
            sys.exit(1)
        else:
            print(f"  {label}: no duplicate (ts, symbol) pairs")

    for label, panel in [("1H", panel_1h), ("2H", panel_2h)]:
        assert str(panel["ts"].dt.tz) == "UTC", f"{label} ts is not UTC!"
        print(f"  {label}: ts is tz-aware UTC")

    print("\nAll verifications passed.")


if __name__ == "__main__":
    main()
