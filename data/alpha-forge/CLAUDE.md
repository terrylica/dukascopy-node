# Alpha-Forge Panel Data

**Parent**: [data/CLAUDE.md](/data/CLAUDE.md) | **Hub**: [/CLAUDE.md](/CLAUDE.md) | **Sibling**: [src/CLAUDE.md](/src/CLAUDE.md)

**Purpose**: Multi-symbol OHLCV panels in alpha-forge format for trading research. Transformed from raw Dukascopy H1 data.

## Column Format

```
ts,symbol,open,high,low,close,volume
2003-05-05 00:00:00+00:00,XAUUSD_ASK,340.757,341.253,340.376,340.546,0.0643
```

- **ts**: `YYYY-MM-DD HH:mm:ss+00:00` (explicit UTC offset)
- **symbol**: `{INSTRUMENT}_{PRICE_TYPE}` -- four symbols total
- **OHLCV**: float prices in USD, volume in Dukascopy lots

## Symbols

| Symbol       | Instrument | Price Type |
| ------------ | ---------- | ---------- |
| `XAUUSD_BID` | Gold       | bid        |
| `XAUUSD_ASK` | Gold       | ask        |
| `XAGUSD_BID` | Silver     | bid        |
| `XAGUSD_ASK` | Silver     | ask        |

## File Inventory

| File                      | Timeframe | Compression | Size   | Rows    | Git-Tracked |
| ------------------------- | --------- | ----------- | ------ | ------- | ----------- |
| `metals_h1.csv`           | 1H        | none        | 8.1 MB | 109,430 | no          |
| `metals_h2.csv`           | 2H        | none        | 4.3 MB | 56,163  | no          |
| `metals_h1_xauusd.csv.br` | 1H        | brotli      | 681 KB | 49,077  | yes         |
| `metals_h1_xauusd.csv.gz` | 1H        | gzip        | 914 KB | --      | yes         |
| `metals_h1_xagusd.csv.br` | 1H        | brotli      | 687 KB | 60,353  | yes         |
| `metals_h1_xagusd.csv.gz` | 1H        | gzip        | 944 KB | --      | yes         |
| `metals_h2_xauusd.csv.br` | 2H        | brotli      | 391 KB | 25,207  | yes         |
| `metals_h2_xauusd.csv.gz` | 2H        | gzip        | 498 KB | --      | yes         |
| `metals_h2_xagusd.csv.br` | 2H        | brotli      | 385 KB | 30,956  | yes         |
| `metals_h2_xagusd.csv.gz` | 2H        | gzip        | 518 KB | --      | yes         |

**Naming convention**: `metals_{timeframe}_{instrument}.csv.{br,gz}`

## Regeneration

```bash
uv run transform.py    # requires raw CSVs in parent data/ directory
```

**transform.py** (PEP 723 inline script, requires pandas):

1. Loads 4 raw CSVs from `data/`
2. Renames `timestamp` -> `ts`, injects `symbol` column, asserts UTC
3. Concatenates into combined H1 panel (`metals_h1.csv`)
4. Resamples H1 -> H2 with oracle-based verification
5. Writes combined H2 panel (`metals_h2.csv`)
6. Per-symbol splits are compressed manually after transform

## 2H Resampling Rules

| Field    | Aggregation |
| -------- | ----------- |
| `open`   | first       |
| `high`   | max         |
| `low`    | min         |
| `close`  | last        |
| `volume` | sum         |

### Oracle Verification (8 checks)

1. Independent recomputation from 1H source
2. Bit-exact OHLCV identity (exact float comparison, not approximate)
3. Timestamp identity
4. OHLC invariants: `high >= max(open, close, low)`, `low <= min(open, close, high)`
5. Volume conservation: sum of 1H volumes per 2H window == 2H volume
6. Fence-post: each 2H bar has exactly 1-2 source 1H bars
7. Boundary: 2H starts at or after first 1H
8. No duplicate `(ts, symbol)` pairs

## Git Policy

- **Tracked**: Per-symbol compressed splits (`.br`, `.gz`) only
- **Untracked**: Combined panels (`metals_h1.csv`, `metals_h2.csv`) are local convenience files
- **1 MB limit**: Per-symbol splits keep all files under pre-commit hook threshold

## Related

- [data/CLAUDE.md](/data/CLAUDE.md) -- Raw source data (upstream of this directory)
- [/CLAUDE.md](/CLAUDE.md) -- Project hub
- [GitHub Issue #1](https://github.com/terrylica/dukascopy-node/issues/1) -- Data download provenance
