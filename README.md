# DA Research

Empirical throughput and cost analysis of Data Availability protocols.

## Structure

```
da-rsrch/
├── protocol/           # Per-protocol data collection and analysis
│   ├── ethereum/       # EIP-4844 blobs (BigQuery + TypeScript collector)
│   ├── espresso/       # Tiramisu DA (Python collector)
│   ├── celestia/       # Celenium API (Python collector)
│   ├── avail/          # Substrate RPC (TypeScript collector)
│   ├── near/           # NEAR Lake S3 + RPC (TypeScript collector)
│   ├── polkadot/       # Relay chain + Coretime (TypeScript collector)
│   └── shared/         # Common Python utilities (transform + plot helpers)
├── paper-latex/        # IEEE paper (LaTeX)
├── dashboard/          # Next.js benchmarking dashboard
├── Dockerfile
└── docker-compose.yml
```

See each subdirectory's README for setup and usage.

## Data Pipeline (Docker)

Build the image once:

```bash
docker build -t da-research .
```

Each protocol supports three actions: **collect**, **transform**, and **plot**.

```
docker run da-research <protocol> [action] [options]
```

| Action | Description | Input | Output |
|--------|-------------|-------|--------|
| `collect` (default) | Fetch raw block data from chain APIs | Chain RPCs / APIs | `data/blocks/*.csv`, `data/prices.csv` |
| `transform` | Aggregate blocks into daily/hourly metrics | `data/blocks/`, `data/prices.csv` | `analysis/daily.csv`, `analysis/hourly.csv` |
| `plot` | Generate research paper figures | `analysis/daily.csv` | `analysis/out/*.png` |

### Collect

| Protocol | Command | Env Vars | Notes |
|----------|---------|----------|-------|
| Celestia | `docker run da-research celestia --days 1` | None | Celenium API (free) |
| Espresso | `docker run da-research espresso --days 1` | None | Explorer API (free) |
| Avail | `docker run da-research avail --days 1` | None | Public WSS RPCs |
| NEAR (RPC) | `docker run da-research near --blocks 5000` | None | Public RPC (slower) |
| NEAR (Lake) | `docker run -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... da-research near --days 1` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | NEAR Lake S3 (requester-pays) |
| Ethereum | `docker run -e GOOGLE_APPLICATION_CREDENTIALS=/creds/key.json -v ./key.json:/creds/key.json da-research ethereum --days 1` | `GOOGLE_APPLICATION_CREDENTIALS` | Google BigQuery (free public dataset, needs GCP service account) |
| Polkadot (throughput) | `docker run da-research polkadot-throughput --days 1` | None | Public WSS RPCs |
| Polkadot (cost) | `docker run da-research polkadot-cost` | None | Subscan + RPC |
| All | `docker run da-research all --days 1` | Optional: AWS, GCP creds | Runs all in parallel |

### Transform & Plot

```bash
# Transform raw data into daily/hourly CSVs
docker run -v ./protocol:/app/protocol da-research celestia transform
docker run -v ./protocol:/app/protocol da-research all transform

# Generate figures from daily.csv
docker run -v ./protocol:/app/protocol da-research celestia plot
docker run -v ./protocol:/app/protocol da-research all plot

# Full pipeline: collect, transform, then plot
docker run -v ./protocol:/app/protocol da-research celestia --days 1
docker run -v ./protocol:/app/protocol da-research celestia transform
docker run -v ./protocol:/app/protocol da-research celestia plot
```

Note: mount `./protocol` to persist outputs and share data between steps.

### docker compose

```bash
# Collect
docker compose run --rm collect celestia --days 1
docker compose run --rm collect all --days 1

# Transform & plot (protocol dir is mounted by default)
docker compose run --rm collect celestia transform
docker compose run --rm collect celestia plot

# Interactive shell
docker compose run --rm da-research
```

Run `docker run da-research` with no arguments to see full usage.
