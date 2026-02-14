# Ethereum (EIP-4844 Blobs)

No local data collection - all analysis via Dune SQL queries.

## Key Forks

| Fork | Activation | DA Change |
|------|-----------|-----------|
| Dencun | Epoch 269568 | EIP-4844: 3 blob target / 6 max per block |
| Pectra | Epoch 364032 | — |
| BPO1 | Block 23975796 | Target 10 / max 15 blobs |
| BPO2 | Epoch 419072 | Target 14 / max 21 blobs |

## Structure

```
ethereum/
├── queries/          # Dune SQL queries
│   ├── throughput.sql
│   ├── throughput-detailed.sql
│   ├── utilization-viz.sql
│   ├── cost-analysis-fork-aware.sql
│   ├── cost-quantile-bands-viz.sql
│   └── cost-summary-stats.sql
├── analysis/         # Dune chart screenshots
│   ├── mib_s.png
│   ├── utilization.png
│   ├── cost_mb_blocks.png
│   ├── cost_time.png
│   ├── cost_time_grouped.png
│   └── usd_mib_day.png
└── research.md
```
