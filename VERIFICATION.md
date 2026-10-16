# Verification map

Each factual or numeric claim in the paper (`paper-latex/`) and the source or command that reproduces it. Commands run from the repository root.

"Data" means: `python3 protocol/<Protocol>/data/transform.py`, then `python3 protocol/shared/make_tables.py`. Raw blocks in `protocol/<Protocol>/data/blocks/` can be re-collected, and checked against each network's public RPC, with `./collect.sh <protocol>` (or `docker run da-research <protocol>`).

## Protocol parameters in force during the window (15 Nov 2025 – 14 Feb 2026)

| Claim | Source or command |
|---|---|
| Polkadot: 100 cores, 10 MiB max PoV, 600 validators | Relay `configuration.activeConfig` at in-window heights; `protocol/Polkadot/data/throughput/chain_config.json` |
| Polkadot: ~58–62 bulk-assigned cores, ~40 on-demand | `coretimeAssignmentProvider.coreDescriptors` at blocks 28.70M, 29.00M, 29.40M, 29.90M |
| Polkadot: 41 active cores, 26.6 inclusions per block (18 Nov) | `protocol/Polkadot/data/pov/inclusions_2025-11-18.csv` (from `events.py`) |
| Ethereum fork blocks and blob-fee update fractions | consensus-specs `mainnet.yaml` (FULU and BPO epochs); geth `params/config.go`; `protocol/Ethereum/data/transform.py` |
| Celestia 8 MiB, then 32 MiB from 3 Dec 2025 | Governance proposals #5 and #8; first square-256 block 8,794,914; observed `square_size` in the block data |
| Celestia 7-day sampling window (30-day default storage on full nodes) | CIP-036; celestia-node v0.25.3 |
| NEAR gas schedule, 9 shards, 0.616 s blocks | `EXPERIMENTAL_protocol_config` at heights 172,665,547 and 185,299,415; block timestamps |
| NEAR 5-epoch garbage-collection window | nearcore `DEFAULT_GC_NUM_EPOCHS_TO_KEEP` |
| Avail 4 MiB blocks, 20 s, block bodies retained by default | `kate_blockLength` at in-window heights; runtime `MILLISECS_PER_BLOCK`; Substrate `--blocks-pruning` default |
| Espresso 1 MB maximum block, 1 wei/byte fee | `/v1/availability/header/{h}` `chain_config` at in-window heights |
| Ethereum ~18-day blob retention | consensus-specs `MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS` = 4096 |
| Polkadot 25 h availability store | polkadot-sdk `KEEP_FINALIZED_FOR_LIVE_NETWORKS` |

## Measured results

| Claim | Source or command |
|---|---|
| Throughput, cost and annualized-cost tables | Data; output in `paper-latex/tables/*.tex` |
| Figures | `FGCS_COMPACT=1 python3 protocol/<Protocol>/analysis/plot.py`; `protocol/Ethereum/analysis/plot_fgcs.py`; `protocol/shared/cross_protocol_fgcs.py` |
| Polkadot PoV estimate (1.13 / 0.29 MiB per candidate) | `python3 protocol/Polkadot/data/pov/estimate_pov.py` |
| NEAR marginal DA cost (~60 Tgas/MiB) | Gas schedule above; `protocol/Near/data/transform.py` |
| Ethereum fee at the 1-wei floor until Fusaka | Data (`pct_at_floor` by era) |
| Ethereum VWAP concentration (two days, 78% of spend) | Data (`daily_blob_spend_usd`) |
| Celestia 16–21 Dec load test | status.celestia.org notice of 16 Dec 2025; data (daily throughput and fees) |
| Data gaps (NEAR 11–14 Feb; Espresso and Avail 15 Nov) | Data (`_day` coverage in each `daily.csv`) |

## Active tests (Aug–Dec 2025)

| Claim | Source or command |
|---|---|
| Submission, retrieval, inclusion and throughput tests on five networks | `protocol/active-tests/`; transaction list with explorer links in `protocol/active-tests/evidence/` |

## Qualitative claims

| Claim | Source |
|---|---|
| Encoding, commitments, verification paradigms, trust assumptions, withholding enforcement | Specifications and papers cited in Sections 3 and 6 of the paper |
