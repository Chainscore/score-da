# Avail

## References

- [Avail Whitepaper](https://framerusercontent.com/modules/assets/OJAXkwN41t89cBDzghITHtZu98~b3VGRHz3Q6j-4Bt9jedxKe-NhpD1SGMhbRXNE78YwgA.pdf)
- [Avail Node Repo](https://github.com/availproject/avail)
- [Alt-DA Server (Optimism Sidecar)](https://github.com/availproject/avail-alt-da-server)

## Data Collection

Connects to Avail mainnet RPC (WSS) via `avail-js-sdk`. Extracts `submitData` extrinsic bytes and `TransactionFeePaid` events per block. Prices from CoinGecko.

```bash
cd protocol/Avail
npm install

# Last 1000 blocks (~30s)
npx tsx data/collect.ts

# Full 90-day collection (day-files, resumable)
npx tsx data/collect.ts --days 90

# Only fetch AVAIL/USD prices
npx tsx data/collect.ts --prices-only
```

Rotates across 7 public RPC endpoints on failure. `--days` mode skips existing day-files on re-run.

## Transform & Plot

```bash
# Aggregate blocks/ + prices.csv → daily.csv + hourly.csv
python3 data/transform.py

# Generate figures from daily.csv → analysis/out/*.png
python3 analysis/plot.py
```

## Dune Dashboard

[dune.com/prasad_chainscore/avail-da-analysis](https://dune.com/prasad_chainscore/avail-da-analysis)

## Structure

```
Avail/
├── data/
│   ├── collect.ts          # block + price collector (RPC + CoinGecko)
│   ├── transform.py        # blocks/ + prices → daily.csv + hourly.csv
│   ├── chain_config.json
│   ├── prices.csv
│   └── blocks/             # per-day CSVs
├── queries/                # Dune SQL queries
│   ├── avail-daily.sql
│   └── avail-hourly.sql
├── analysis/
│   ├── plot.py             # daily.csv → out/*.png
│   ├── daily.csv
│   ├── hourly.csv
│   └── out/                # generated figures (PNG + SVG)
├── package.json
├── pyproject.toml
└── README.md
```
