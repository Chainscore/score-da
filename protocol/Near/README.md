# NEAR

## References

- [NEAR White Paper](https://pages.near.org/papers/the-official-near-white-paper/)
- [Nightshade Sharding](https://pages.near.org/downloads/Nightshade.pdf)
- [NEPs](https://github.com/near/NEPs) | [Nomicon Proposals](https://nomicon.io/Proposals/)
- [Gas Architecture](https://nomicon.io/architecture/how/gas.html) | [Protocol Docs](https://docs.near.org/protocol/architecture)

## Data Collection

Single collector (`collect.ts`) fetches per-block DA metrics and NEAR/USD prices. Auto-selects NEAR Lake S3 for large collections (>50K blocks) or RPC for smaller ones.

```bash
cd protocol/near
npm install

# Collect last day (RPC)
npx tsx collect.ts

# Collect 90 days (~13M blocks, uses Lake S3, ~13h)
npx tsx collect.ts --days 90

# Force source
npx tsx collect.ts --source lake --days 90 --concurrency 200
```

Incremental — re-run to resume from where it left off.

## Structure

```
near/
├── collect.ts
├── analysis/
│   ├── chain_config.json
│   ├── prices.csv
│   ├── collect.log
│   └── data/             # per-day CSVs
├── throughput/            # Dune SQL queries
├── cost/                  # Dune SQL queries
├── package.json
└── research.md
```
