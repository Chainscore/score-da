# Protocols

Each subdirectory collects 90-day block data and price feeds for one DA protocol.

| Protocol | Collector | Data Source | Block Time |
|----------|-----------|-------------|------------|
| [Ethereum](ethereum/) | None (Dune SQL) | Dune Analytics | 12s |
| [Espresso](Espresso/) | Python | Explorer API + CoinGecko | ~1s |
| [Celestia](Celestia/) | Python | Celenium API + CoinGecko | ~6s |
| [Avail](avail/) | TypeScript | RPC (WSS) + CoinGecko | 20s |
| [NEAR](near/) | TypeScript | NEAR Lake S3 / RPC + CoinGecko | ~1.3s |
| [Polkadot](polkadot/) | TypeScript | RPC (WSS) + CoinGecko | 6s |

## Common Layout

```
<protocol>/
├── data/       # collect script, chain_config, prices, blocks/
├── queries/    # Dune SQL queries
├── analysis/   # chart screenshots (PNG)
└── research.md
```
