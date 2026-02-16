# Ethereum (EIP-4844 Blobs)

## DA Model

Ethereum prices DA via the **blob fee market** (EIP-4844). Each blob is 128 KiB.
The blob base fee adjusts via an exponential mechanism based on excess blob gas,
with a target and max blob count per block that change across forks.

## Key Forks

| Fork | Activation | DA Change |
|------|-----------|-----------|
| Dencun | Epoch 269568 | EIP-4844: 3 blob target / 6 max per block |
| Pectra | Epoch 364032 | EIP-7691: 6 target / 9 max |
| BPO1 | Block 23975796 | EIP-7892: 10 target / 15 max |
| BPO2 | Epoch 419072 | EIP-7892: 14 target / 21 max |

## Setup

```bash
cd protocol/Ethereum
npm install
```

Requires a Google Cloud service account key with BigQuery Job User role:

1. Go to GCP Console → IAM → Service Accounts
2. Create a service account, grant it "BigQuery Job User" role
3. Download the JSON key file
4. Set env var: 

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
```

## Usage

```bash
# Collect last 90 days (default)
npm run collect

# Collect since Dencun activation (full history)
npm run collect:all

# Custom range
npx tsx data/collect.ts --start-date 2024-03-13 --end-date 2025-01-01
```

## Dune Dashboard

[dune.com/prasad_chainscore/ethereum-da-analysis](https://dune.com/prasad_chainscore/ethereum-da-analysis)

Collected data is uploaded to Dune under the `dune.prasad_chainscorelabs` namespace.

| Table | Source |
|-------|--------|
| `ethereum_blocks` | `data/blocks/*.csv` |
| `ethereum_prices` | `data/eth_prices.csv` |

Queries in `queries/`:
- **throughput.sql** — hourly throughput with 24h/30d/90d rolling averages
- **throughput-detailed.sql** — per-slot throughput with 1h rolling average
- **utilization-viz.sql** — daily utilization vs target and max
- **cost-analysis-fork-aware.sql** — per-block cost with fork-aware blob base fee
- **cost-quantile-bands-viz.sql** — daily cost p10/p50/p90 bands, VWAP, time-at-floor
- **cost-summary-stats.sql** — summary statistics by era (p50/p90/p99/ES99)

## Transform & Plot

```bash
# Aggregate blocks/ + eth_prices.csv → daily.csv + hourly.csv
python3 data/transform.py

# Generate figures from daily.csv → analysis/out/*.png
python3 analysis/plot.py
```

## Structure

```
Ethereum/
├── data/
│   ├── collect.ts          # BigQuery + CoinGecko collector
│   ├── transform.py        # blocks/ + prices → daily.csv + hourly.csv
│   ├── chain_config.json   # fork params + collection metadata
│   ├── eth_prices.csv      # ETH/USD daily prices
│   └── blocks/             # per-day CSVs
├── queries/                # Dune SQL queries
│   ├── throughput.sql
│   ├── throughput-detailed.sql
│   ├── utilization-viz.sql
│   ├── cost-analysis-fork-aware.sql
│   ├── cost-quantile-bands-viz.sql
│   └── cost-summary-stats.sql
├── analysis/
│   ├── plot.py             # daily.csv → out/*.png
│   ├── daily.csv
│   ├── hourly.csv
│   └── out/                # generated figures (PNG + SVG)
├── package.json
└── README.md
```
