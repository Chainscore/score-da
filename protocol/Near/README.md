# NEAR

## References

- [NEAR White Paper](https://pages.near.org/papers/the-official-near-white-paper/)
- [Nightshade Sharding](https://pages.near.org/downloads/Nightshade.pdf)
- [NEPs](https://github.com/near/NEPs) | [Nomicon Proposals](https://nomicon.io/Proposals/)
- [Gas Architecture](https://nomicon.io/architecture/how/gas.html) | [Protocol Docs](https://docs.near.org/protocol/architecture)

## Data Collection

Single collector (`data/collect.ts`) fetches per-block DA metrics and NEAR/USD prices. Auto-selects NEAR Lake S3 for large collections (>50K blocks) or RPC for smaller ones.

```bash
cd protocol/near
npm install

# Collect last day (RPC)
npx tsx data/collect.ts

# Collect 90 days (~13M blocks, uses Lake S3, ~13h)
npx tsx data/collect.ts --days 90

# Force source
npx tsx data/collect.ts --source lake --days 90 --concurrency 200
```

Incremental — re-run to resume from where it left off.

## Dune Upload

Block and price CSVs are uploaded to Dune as:
- `dune.prasadkumkar.near_blocks` — all CSVs from `data/blocks/`
- `dune.prasadkumkar.near_prices` — `data/prices.csv`

## Structure

```
near/
├── data/
│   ├── collect.ts          # unified collector
│   ├── chain_config.json
│   ├── prices.csv
│   ├── collect.log
│   └── blocks/             # per-day CSVs
├── queries/
│   ├── near-daily.sql      # Dune: daily aggregation
│   └── near-hourly.sql     # Dune: hourly aggregation
├── analysis/               # Dune screenshots (future)
├── package.json
└── research.md
```
