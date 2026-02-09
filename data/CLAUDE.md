# Market Data: Raw Dukascopy Output

**Parent**: [/CLAUDE.md](/CLAUDE.md) | **Child**: [alpha-forge/CLAUDE.md](alpha-forge/CLAUDE.md) | **Sibling**: [src/CLAUDE.md](/src/CLAUDE.md)

**Purpose**: Raw hourly (H1) OHLCV data for XAU/XAG spot metals, downloaded via dukascopy-node CLI.

## File Inventory

| File                                         | Compression | Size   | Rows   | Git-Tracked |
| -------------------------------------------- | ----------- | ------ | ------ | ----------- |
| `xauusd-h1-bid-2003-05-05-2026-02-09.csv`    | none        | 1.4 MB | 23,169 | no          |
| `xauusd-h1-bid-...csv.br`                    | brotli      | 314 KB | --     | yes         |
| `xauusd-h1-bid-...csv.gz`                    | gzip        | 417 KB | --     | yes         |
| `xauusd-h1-ask-2003-05-05-2026-02-09.csv`    | none        | 1.6 MB | 25,908 | no          |
| `xauusd-h1-ask-...csv.br`                    | brotli      | 356 KB | --     | yes         |
| `xauusd-h1-ask-...csv.gz`                    | gzip        | 468 KB | --     | yes         |
| `xagusd-h1-bid-2003-05-04T23-2026-02-09.csv` | none        | 1.2 MB | 21,992 | no          |
| `xagusd-h1-bid-...csv.br`                    | brotli      | 242 KB | --     | yes         |
| `xagusd-h1-bid-...csv.gz`                    | gzip        | 326 KB | --     | yes         |
| `xagusd-h1-ask-2003-05-04T23-2026-02-09.csv` | none        | 2.1 MB | 38,361 | no          |
| `xagusd-h1-ask-...csv.br`                    | brotli      | 434 KB | --     | yes         |
| `xagusd-h1-ask-...csv.gz`                    | gzip        | 583 KB | --     | yes         |

## Column Format

```
timestamp,open,high,low,close,volume
2003-05-05 00:00:00,340.345,340.843,339.81,340.036,0.0804
```

- **timestamp**: `YYYY-MM-DD HH:mm:ss` (implicit UTC, no timezone suffix)
- **OHLCV**: float prices in USD, volume in Dukascopy lots

## Decompression

```bash
brotli -d <file>.csv.br        # produces <file>.csv
gunzip <file>.csv.gz           # produces <file>.csv
```

## Regeneration

```bash
./download.sh xauusd 2003-05-05 bid    # download XAUUSD bid from given start date
./download.sh xagusd 2003-05-04 ask    # download XAGUSD ask
```

**download.sh** wraps `bunx tsx src/cli/index.ts` with flags: `-t h1 -f csv -df "YYYY-MM-DD HH:mm:ss" -dir data -bs 30 -bp 500`. Runs on littleblack workstation (DNS resolution required for `datafeed.dukascopy.com`).

## Git Policy

- **Tracked**: Only compressed files (`.br` and `.gz`) are committed
- **Untracked**: Raw CSVs exist locally but are never added to git
- **1 MB limit**: Pre-commit hook rejects files over 1 MB. All compressed files stay under this threshold.
- **No .gitignore rule**: Raw CSVs are untracked by convention, not by gitignore

## Data Quality Notes

- **XAG bid anomaly**: Only 21,992 rows (starts 2005-11-01) vs XAG ask's 38,361 rows (starts 2003-06-02). This is a Dukascopy data availability difference, not a bug.
- **XAG filename `T23`**: `xagusd-h1-ask-2003-05-04T23-...` reflects the CLI recording the exact first-available timestamp.
- **Metadata vs actual dates**: XAGUSD metadata says 2003-05-04 but actual bid data starts 2005-11-01. Always verify empirically.

## Downstream

Raw CSVs are consumed by `transform.py` to produce alpha-forge panel format. See [alpha-forge/CLAUDE.md](alpha-forge/CLAUDE.md).

## Related

- [/CLAUDE.md](/CLAUDE.md) -- Project hub
- [alpha-forge/CLAUDE.md](alpha-forge/CLAUDE.md) -- Transformed panel data
- [src/CLAUDE.md](/src/CLAUDE.md) -- Source pipeline that produces this data
- [GitHub Issue #1](https://github.com/terrylica/dukascopy-node/issues/1) -- Data download provenance
