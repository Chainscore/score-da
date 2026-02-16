# Polkadot

## References

- [Host Spec (Availability & Validity)](https://spec.polkadot.network/part-polkadot-host)
- [Agile Coretime](https://docs.polkadot.com/polkadot-protocol/architecture/polkadot-chain/agile-coretime/)
- [On-Demand Coretime](https://docs.polkadot.com/develop/parachains/deployment/manage-coretime/)
- [Parachain Security Protocol](https://wiki.polkadot.com/learn/learn-parachains-protocol/)

## DA Model

Polkadot doesn't price DA per byte. Parachains buy **coretime** (execution + DA capacity) via:
- **Bulk coretime**: 28-day regions purchased on Coretime chain (Dutch auction)
- **On-demand coretime**: per-block orders on the Relay chain

Protocol max throughput = `effective_cores * max_pov / cadence`.

## Setup

```bash
cd protocol/Polkadot
npm install
```

## Usage

```bash
# Throughput: collect block data
npm run throughput -- --blocks 5000
npm run throughput -- --days 90

# Cost: collect coretime pricing
npm run cost
npm run cost -- --ondemand-blocks 5000
```

## Dune Dashboard

[dune.com/prasad_chainscore/polkadot-da-analysis](https://dune.com/prasad_chainscore/polkadot-da-analysis)

Collected data is uploaded to Dune under the `dune.prasad_chainscorelabs` namespace.

| Table | Source |
|-------|--------|
| `polkadot_blocks` | `data/throughput/blocks/*.csv` |
| `polkadot_sales` | `data/cost/sales.csv` |
| `polkadot_purchases` | `data/cost/purchases.csv` |
| `polkadot_renewals` | `data/cost/renewals.csv` |
| `polkadot_prices` | `data/cost/dot_prices.csv` |

Queries in `queries/`:
- **polkadot-daily.sql** — all dashboard metrics (throughput, utilization, data volume, cost, pipeline health, parachain diversity, availability, cumulative) with 7d/30d rolling averages
- **polkadot-hourly.sql** — throughput, utilization, data volume, pipeline health, diversity at hourly granularity with 24h rolling averages

## Key Governance Changes

| Ref | Date | Change |
|-----|------|--------|
| #1200 | 2024-10-25 | Validators 400->500 (cores 80->100) |
| #1484 | 2025-03-16 | Validators 500->600 (cores 100->120) |
| #1480 | 2025-03-29 | PoV limit 5->10 MiB |
| #1536 | 2025-04-29 | Cores 62->66 |
| #1629 | 2025-07-09 | Cores 66->100 |

## Transform & Plot

```bash
# Aggregate throughput/blocks/ + cost/ data → daily.csv + hourly.csv
python3 data/transform.py

# Generate figures from daily.csv → analysis/out/*.png
python3 analysis/plot.py
```

## Structure

```
Polkadot/
├── data/
│   ├── transform.py        # throughput + cost data → daily.csv + hourly.csv
│   ├── throughput/
│   │   ├── collect.ts
│   │   ├── chain_config.json
│   │   └── blocks/          # per-day CSVs
│   └── cost/
│       ├── collect.ts
│       ├── broker_config.json
│       ├── cost_config.json
│       ├── dot_prices.csv
│       ├── ondemand.csv
│       ├── purchases.csv
│       ├── renewals.csv
│       └── sales.csv
├── queries/
│   ├── polkadot-daily.sql
│   └── polkadot-hourly.sql
├── analysis/
│   ├── plot.py              # daily.csv → out/*.png
│   ├── daily.csv
│   ├── hourly.csv
│   └── out/                 # generated figures (PNG + SVG)
├── package.json
└── README.md
```
