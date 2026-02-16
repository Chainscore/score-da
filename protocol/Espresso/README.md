# Espresso (Tiramisu DA)

## References

- [HotShot + Tiramisu Design](https://hackmd.io/@EspressoSystems/HotShot-and-Tiramisu/edit)
- [Espresso Sequencing Network Paper](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ITCS.2026.116) ([arXiv](https://arxiv.org/pdf/2310.03616))
- [HotShot Light Client Audit](https://www.commonprefix.com/static/clients/espresso/espresso_hotshot_light_client_audit.pdf)

## Setup

```bash
cd protocol/Espresso
pip install -e .
```

## Data Collection

```bash
# Fetch all blocks for the last 90 days (~2.9M blocks)
python3 data/collect.py [--days 90] [--workers 20]

# Fetch ETH/USD prices (90d hourly from CoinGecko)
python3 data/collect_prices.py [--days 90]
```

Block collection is resumable — re-run the same command to pick up where it left off.

## Transform & Plot

```bash
# Aggregate blocks/ + prices.csv → daily.csv + hourly.csv
python3 data/transform.py

# Generate figures from daily.csv → analysis/out/*.png
python3 analysis/plot.py
```

## Dune Dashboard

[dune.com/prasad_chainscore/espresso-tiramisu-da](https://dune.com/prasad_chainscore/espresso-tiramisu-da)

## Structure

```
Espresso/
├── data/
│   ├── collect.py           # block collector (Espresso explorer API)
│   ├── collect_prices.py    # ETH/USD price collector (CoinGecko)
│   ├── transform.py         # blocks/ + prices → daily.csv + hourly.csv
│   ├── chain_config.json
│   ├── prices.csv
│   └── blocks/              # per-day CSVs
├── queries/                 # Dune SQL queries
│   ├── espresso-daily.sql
│   └── espresso-hourly.sql
├── analysis/
│   ├── plot.py              # daily.csv → out/*.png
│   ├── daily.csv
│   ├── hourly.csv
│   └── out/                 # generated figures (PNG + SVG)
├── pyproject.toml
└── README.md
```

## Cost Model

`base_fee` = 1 wei/byte since genesis. Cost/MiB tracks ETH/USD directly:
`cost_per_mib_usd = 1 * 2^20 / 10^18 * ETH_USD`. DA retention target: 7 days.
