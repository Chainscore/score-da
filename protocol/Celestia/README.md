# Celestia

## References

- [Shares](https://celestiaorg.github.io/celestia-app/shares.html) | [Data Square Layout](https://celestiaorg.github.io/celestia-app/data_square_layout.html) | [Data Structures](https://celestiaorg.github.io/celestia-app/data_structures.html)
- [Submitting Data Blobs](https://docs.celestia.org/learn/TIA/submit-data/) (max tx size, gas-cost formula)
- [CIPs](https://github.com/celestiaorg/CIPs) | [CIP Forum](https://forum.celestia.org/c/celestia-improvement-proposal-cip/31)
- [Blob Module](https://github.com/celestiaorg/celestia-app/blob/main/x/blob/README.md) | [Node Public API ADR](https://github.com/celestiaorg/celestia-node/blob/main/docs/adr/adr-009-public-api.md)

## Protocol Eras

| Era | App Version | Block Time | Max Square | Max DA |
|-----|-------------|------------|------------|--------|
| Lemongrass | 1-2 | ~12s | 64x64 | 2 MiB |
| Ginger | 3-5 | ~6s | 64x64 | 2 MiB |
| Current | 6+ | ~6s | 128x128 | 8 MiB |

DA availability window: ~30 days (CIP-4).

## Setup

```bash
cd protocol/Celestia
pip install -e .
```

## Data Collection

Data sourced from [Celenium API](https://api-mainnet.celenium.io) (free tier, 3 RPS / 100K RPD) and CoinGecko.

```bash
# Full 90-day collection (~77 min)
python3 data/collect.py --days 90

# Resume interrupted run
python3 data/collect.py --days 90 --resume

# Only refresh TIA/USD prices
python3 data/collect.py --prices-only
```

## Structure

```
Celestia/
├── data/
│   ├── collect.py          # block + price collector (Celenium + CoinGecko)
│   ├── chain_config.json
│   ├── prices.csv
│   └── blocks/             # per-day CSVs (~14K rows/day)
├── queries/                # Dune SQL queries
│   ├── celestia-daily.sql
│   └── celestia-hourly.sql
├── analysis/               # Dune chart screenshots
├── collect.log
├── pyproject.toml
└── research.md
```
