# CLAUDE.md

Node.js library + CLI for downloading historical/real-time market data from [Dukascopy](https://www.dukascopy.com/) (Forex, Crypto, Stocks, ETFs, CFDs). Published to npm as `dukascopy-node`.

**Fork**: [Leo4815162342/dukascopy-node](https://github.com/Leo4815162342/dukascopy-node) | **Status**: Active fork | **Additions**: `download.sh`, `transform.py`, `data/`

---

## Quick Start

```bash
pnpm install          # Install dependencies
pnpm build            # ESM + CJS + types via tsup
pnpm test             # Vitest single run
pnpm lint             # ESLint (flat config)
pnpm type-check       # tsc --noEmit --skipLibCheck
```

Run a single test: `npx vitest run src/aggregator/tests/aggregator.test.ts`

---

## Navigation

| Area            | Location                                                 | Purpose                                                         |
| --------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Source pipeline | [src/CLAUDE.md](src/CLAUDE.md)                           | Module map, data pipeline stages, binary formats, test patterns |
| Market data     | [data/CLAUDE.md](data/CLAUDE.md)                         | Raw downloads, compression strategy, git policy                 |
| Panel data      | [data/alpha-forge/CLAUDE.md](data/alpha-forge/CLAUDE.md) | Alpha-forge panel format, 2H resampling, verification           |
| API docs        | [dukascopy-node.app](https://www.dukascopy-node.app/)    | Full CLI + Node.js API specification                            |
| Instruments     | [README.md](README.md)                                   | Auto-generated instrument tables (~1500 instruments)            |
| Usage examples  | [examples/](examples/)                                   | Six demos: basic formats, cache, batching, ticks, TypeScript    |
| Changelog       | [CHANGELOG.md](CHANGELOG.md)                             | Version history (conventional commits)                          |

---

## Architecture

### Data Pipeline

```
Config -> Validate -> Normalize Dates -> Generate URLs -> Fetch .bi5 -> Decompress (LZMA) -> Normalize -> Aggregate -> Format Output
                                                                                                                    |
                                                                                                           stream-writer (CLI)
```

| Module              | Role                                                    |
| ------------------- | ------------------------------------------------------- |
| `config-validator/` | Validate input via fastest-validator schemas            |
| `dates-normaliser/` | Normalize dates to UTC, clamp to instrument boundaries  |
| `url-generator/`    | Build Dukascopy CDN URLs from date ranges + instruments |
| `buffer-fetcher/`   | HTTP fetch with retry, batching, cache integration      |
| `decompressor/`     | LZMA decompression of `.bi5` binary data                |
| `data-normaliser/`  | Scale prices by `decimalFactor`, convert timestamps     |
| `aggregator/`       | Ticks to OHLC candles, resample across timeframes       |
| `processor/`        | Orchestrates decompress -> normalise -> aggregate       |
| `output-formatter/` | Format results as array/json/csv                        |
| `stream-writer/`    | File streaming with backpressure (CLI batch output)     |
| `cache-manager/`    | Local file cache for downloaded `.bi5` buffers          |

**Full details**: [src/CLAUDE.md](src/CLAUDE.md)

### Entry Points

| Entry       | File               | Key Exports                                                                      |
| ----------- | ------------------ | -------------------------------------------------------------------------------- |
| Library API | `src/index.ts`     | `getHistoricalRates()`, `getRealTimeRates()`, `instrumentMetaData`, config types |
| CLI         | `src/cli/index.ts` | Binaries: `dukascopy-cli`, `dukascopy-node`                                      |

### Instrument Metadata

**Config file**: `src/config/instruments-metadata.ts` (re-exports generated JSON)
**Generated artifacts**: `src/utils/instrument-meta-data/generated/` (enum, JSON, markdown)
**Regenerate**: `pnpm run gen:meta` then `pnpm run gen:instruments-md`

---

## CLI Gotchas

| Gotcha                       | Detail                                                  | Fix                                          |
| ---------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| `-d` is debug, not directory | `-d` enables `DEBUG=dukascopy-node:*` logging           | Use `-dir data` for output directory         |
| CLI writes files, not stdout | Output goes to files via `createWriteStream`            | Use `-dir` flag; file path logged to console |
| No 2H timeframe              | Supported: tick, s1, m1, m5, m15, m30, h1, h4, d1, mn1  | Download h1 and resample externally          |
| Metadata dates != actual     | XAGUSD bid metadata says 2003-05, actual starts 2005-11 | Verify data start dates empirically          |
| Bid/ask row counts differ    | Separate streams + `ignoreFlats` filtering              | Expected behavior, not a bug                 |
| DNS on macOS                 | `datafeed.dukascopy.com` may fail to resolve locally    | Use littleblack workstation for downloads    |

---

## Data Pipeline (Fork-Specific)

```
download.sh                          transform.py (uv run)
  |                                     |
  |  dukascopy CLI -> H1 CSV            |  pandas: rename, resample 1H->2H,
  |  per instrument/price-type           |  oracle verify, concat panels
  v                                     v
data/*.csv.{br,gz}                   data/alpha-forge/metals_{h1,h2}_*.csv.{br,gz}
```

- **download.sh**: Wrapper around CLI. Args: `INSTRUMENT FROM_DATE PRICE_TYPE`. Uses `-bs 30 -bp 500`.
- **transform.py**: PEP 723 inline script. Run: `uv run transform.py`. Produces alpha-forge panel format.
- **Git policy**: Only compressed files (.br/.gz) are tracked. Raw CSVs are local-only.

**Full details**: [data/CLAUDE.md](data/CLAUDE.md) | [data/alpha-forge/CLAUDE.md](data/alpha-forge/CLAUDE.md)

---

## Build & Release

| Task         | Command                       | Notes                                                           |
| ------------ | ----------------------------- | --------------------------------------------------------------- |
| Build        | `pnpm build`                  | tsup: `dist/index.js` (CJS) + `dist/esm/index.js` (ESM) + types |
| Release      | `pnpm release`                | standard-version -> push tags -> build -> npm publish           |
| Beta release | `pnpm release:beta`           | Build + publish with `--tag beta`                               |
| Format       | `pnpm format`                 | Prettier (singleQuote, no trailing comma, 100 width)            |
| Coverage     | `pnpm coverage`               | Vitest with coverage                                            |
| Gen metadata | `pnpm run gen:meta`           | Fetches + regenerates instrument metadata JSON                  |
| Gen docs     | `pnpm run gen:instruments-md` | Regenerates README instrument tables                            |

---

## Fork Notes

**Upstream**: [Leo4815162342/dukascopy-node](https://github.com/Leo4815162342/dukascopy-node) (MIT, by Leonid Pyrlia)
**Fork**: [terrylica/dukascopy-node](https://github.com/terrylica/dukascopy-node)

**Our additions** (not in upstream):

- `download.sh` -- Batch download wrapper for metals data
- `transform.py` -- Alpha-forge panel format transformer with oracle verification
- `data/` -- XAU/XAG spot metals H1 bid+ask (2003-2026, compressed)
- `CLAUDE.md` -- This file and spoke files

**Sync strategy**: Manual cherry-pick from upstream as needed. No automated sync configured.

**SRED trailers**: Data commits use `SRED-Type: support-work` / `SRED-Claim: ALPHA-FORGE-DATA`.

**Push auth**: SSH key mismatch requires HTTPS with token (see global CLAUDE.md GitHub auth section).
