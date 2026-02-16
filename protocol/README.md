# Protocols

Each subdirectory collects 90-day block data and price feeds for one DA protocol.

| Protocol | Collector | Data Source | Block Time |
|----------|-----------|-------------|------------|
| [Ethereum](Ethereum/) | TypeScript | Google BigQuery + CoinGecko | 12s |
| [Espresso](Espresso/) | Python | Explorer API + CoinGecko | ~1s |
| [Celestia](Celestia/) | Python | Celenium API + CoinGecko | ~6s |
| [Avail](Avail/) | TypeScript | RPC (WSS) + CoinGecko | 20s |
| [NEAR](Near/) | TypeScript | NEAR Lake S3 / RPC + CoinGecko | ~1.3s |
| [Polkadot](Polkadot/) | TypeScript | RPC (WSS) + CoinGecko | 6s |

## Common Layout

```
<Protocol>/
├── data/
│   ├── collect.{py,ts}     # block + price collector
│   ├── transform.py        # blocks/ + prices → daily.csv + hourly.csv
│   ├── chain_config.json
│   ├── prices.csv
│   └── blocks/             # per-day CSVs
├── queries/                # Dune SQL queries
├── analysis/
│   ├── plot.py             # daily.csv → out/*.png
│   ├── daily.csv
│   ├── hourly.csv
│   └── out/                # generated figures (PNG + SVG)
├── package.json            # (TypeScript protocols)
├── pyproject.toml          # (Python protocols)
└── README.md
```
