# Source Code Guide

**Parent**: [/CLAUDE.md](/CLAUDE.md) | **Sibling**: [data/CLAUDE.md](/data/CLAUDE.md)

## Module Map

| Module              | Responsibility                                       | Key Files                            | Tests                        |
| ------------------- | ---------------------------------------------------- | ------------------------------------ | ---------------------------- |
| `config/`           | Enums, types, defaults (Instrument, Timeframe, etc.) | `index.ts`, `instruments.ts`         | none (pure types)            |
| `config-validator/` | Input validation via fastest-validator               | `index.ts`, `schema.ts`              | 14 case files                |
| `dates-normaliser/` | UTC normalisation, instrument date limits            | `index.ts`, `types.ts`               | 7 case files                 |
| `url-generator/`    | Dukascopy CDN URL construction for date ranges       | `index.ts`, `types.ts`               | 18 case files                |
| `buffer-fetcher/`   | HTTP fetch with retry, batching, cache integration   | `index.ts` (BufferFetcher class)     | 1 test                       |
| `cache-manager/`    | Local file-system cache for `.bi5` buffers           | `index.ts` (CacheManager class)      | 1 test                       |
| `decompressor/`     | LZMA decompression + binary struct unpacking         | `index.ts`, `types.ts`               | 5 case files                 |
| `data-normaliser/`  | Scale prices by decimalFactor, convert timestamps    | `index.ts`, `types.ts`               | 4 case files                 |
| `aggregator/`       | Tick-to-OHLC conversion, cross-timeframe resampling  | `index.ts`, `ohlc.ts`, `types.ts`    | 2 tests + 18 fixtures        |
| `processor/`        | Orchestrates decompress -> normalise -> aggregate    | `index.ts`, `types.ts`               | none                         |
| `output-formatter/` | Format results as array/json/csv                     | `index.ts`, `types.ts`               | 11 case files                |
| `stream-writer/`    | File streaming with backpressure (CLI output)        | `index.ts` (BatchStreamWriter class) | none                         |
| `cli/`              | CLI entry point (commander-based)                    | `cli.ts`, `config.ts`, `printer.ts`  | 1 test + 10 expected outputs |
| `utils/`            | Shared helpers (date, range, formatting)             | `date.ts`, `range.ts`, `general.ts`  | 2 tests                      |

## Data Pipeline Flow

```
config-validator/     Validate input config (fastest-validator)
       |
dates-normaliser/     Clamp dates to instrument limits, apply UTC offset
       |
url-generator/        Build CDN URLs: datafeed.dukascopy.com/datafeed/{INSTRUMENT}/{YYYY}/{MM}/{DD}/...
       |
buffer-fetcher/       Batch HTTP fetch .bi5 files (with retry + optional cache-manager/)
       |
processor/            Per-buffer orchestration:
  |-- decompressor/      LZMA decompress + binary struct unpack
  |-- data-normaliser/   Apply decimalFactor, convert timestamps, format volumes
  |-- aggregator/        Tick -> OHLC, resample timeframes
       |
output-formatter/     Convert to array/json/csv (Node API)
stream-writer/        Stream to file (CLI)
```

**Two consumers**: `getHistoricalRates.ts` (Node API) and `cli/cli.ts` (CLI app) both drive this pipeline.

## Binary Data Format (.bi5)

Files from Dukascopy CDN are LZMA-compressed binary structs:

| Timeframe | Struct  | Size     | Fields                                    |
| --------- | ------- | -------- | ----------------------------------------- |
| tick      | `>3i2f` | 20 bytes | `ms_offset, ask, bid, askVol, bidVol`     |
| candle    | `>5i1f` | 24 bytes | `sec_offset, open, close, low, high, vol` |

Prices are raw integers divided by instrument-specific `decimalFactor` from metadata.

## Dukascopy CDN URL Pattern

```
https://datafeed.dukascopy.com/datafeed/{INSTRUMENT}/{year}/{month_0indexed}/{day}/{file}.bi5
```

| Granularity | File Pattern             | Scope     |
| ----------- | ------------------------ | --------- |
| Tick        | `{HH}h_ticks.bi5`        | Per hour  |
| Minute (m1) | `BID_candles_min_1.bi5`  | Per day   |
| Hourly (h1) | `BID_candles_hour_1.bi5` | Per month |
| Daily (d1)  | `BID_candles_day_1.bi5`  | Per year  |

**Month is 0-indexed**: January = `00/`.

## Test Patterns

- **Framework**: Vitest
- **HTTP mocking**: MSW (Mock Service Worker) in `__mocks__/` with ~100 `.bi5` fixture files
- **Case-file pattern**: `tests/cases/*.ts` export `{ input, expected }`, runner uses `it.each()`
- **CLI snapshots**: `tests/expected-outputs/*.json` compared against CLI output
- **Fixture hierarchy**: `.bi5` files organised by `{INSTRUMENT}/{YYYY}/{MM}/{DD}/` matching CDN structure

## Common Patterns

- **British English**: `normalise`, `normaliser` (not "normalize")
- **Naming**: kebab-case directories, camelCase utility files
- **Type suffixes**: `*Input` for params (`AggregateInput`), `*Type` for enum key unions (`TimeframeType`)
- **Barrel exports**: each module has `index.ts` entry; `src/index.ts` is the public API surface
- **Types alongside code**: each module has `types.ts` for input/output interfaces

## Key Types and Enums

| Type/Enum    | Location                | Values                                      |
| ------------ | ----------------------- | ------------------------------------------- |
| `Instrument` | `config/instruments.ts` | ~1500 instruments (auto-generated enum)     |
| `Timeframe`  | `config/timeframes.ts`  | tick, s1, m1, m5, m15, m30, h1, h4, d1, mn1 |
| `Format`     | `config/format.ts`      | array, json, csv                            |
| `Price`      | `config/price-types.ts` | bid, ask                                    |
| `Config`     | `config/index.ts`       | Union of ConfigBase variants                |

## Instrument Metadata Generation

```
utils/instrument-meta-data/
  generate-data.ts              Fetch raw metadata from Dukascopy
  generate-meta.ts              Produce instrument-meta-data.json
  generate-instrument-enum.ts   Produce Instrument TypeScript enum
  generate-instrument-md.ts     Produce README instrument tables
  generated/                    Output artifacts (JSON + .ts + .md)
```

**Regenerate**: `pnpm run gen:meta` then `pnpm run gen:instruments-md`

## Related

- [/CLAUDE.md](/CLAUDE.md) -- Project hub
- [data/CLAUDE.md](/data/CLAUDE.md) -- Downloaded market data
- [README.md](/README.md) -- Full instrument tables
- <https://www.dukascopy-node.app/> -- External API documentation
