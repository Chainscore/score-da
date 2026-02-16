# DA Research

Empirical throughput and cost analysis of Data Availability protocols.

## Structure

```
da-rsrch/
├── protocol/           # Per-protocol data collection and analysis
│   ├── ethereum/       # EIP-4844 blobs (BigQuery + TypeScript collector)
│   ├── Espresso/       # Tiramisu DA (Python collector)
│   ├── Celestia/       # Celenium API (Python collector)
│   ├── avail/          # Substrate RPC (TypeScript collector)
│   ├── near/           # NEAR Lake S3 + RPC (TypeScript collector)
│   └── polkadot/       # Relay chain + Coretime (TypeScript collector)
├── paper-latex/        # IEEE paper (LaTeX)
├── dashboard/          # Next.js benchmarking dashboard
├── Dockerfile
└── docker-compose.yml
```

See each subdirectory's README for setup and usage.
