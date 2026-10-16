# Changelog

## Unreleased

Corrections to the analysis. Raw block data is unchanged.

### Polkadot
- Throughput is now estimated from parachain-side PoV sizes (`System.BlockWeight` proof size plus extrinsic bytes; 17 parachains, 47% of inclusions; `protocol/Polkadot/data/pov/`). Mean estimated throughput is 4.9 MiB/s (1.2 MiB/s excluding two parachains with a fixed proof-size reservation). The previous figure, included candidates × 10 MiB (43 MiB/s), is retained as `ub_mib_per_s`.
- Utilization is estimated throughput divided by maximum throughput (2.9%). Per-block core occupancy (25.8%) is reported separately as `core_occupancy_pct`.

### NEAR
- DA cost is the marginal gas of posting 1 MiB as function-call input to a cross-account call, using the gas schedule in force during the window (protocol versions 81 and 82): about 60 Tgas/MiB, or $0.010/MiB at median. The previous metric (all gas burned divided by all chunk bytes, $0.53/MiB) is retained as `chain_avg_fee_per_mib_usd`.

### Celestia
- Capacity follows the governance-set maximum square in force at each block height (8 MiB, then 32 MiB from height 8,794,914 on 3 Dec 2025). Utilization is observed throughput divided by maximum throughput. The Celenium `fill_rate` field, which is relative to the genesis block size, is no longer used. Peak daily utilization is 22.5%; the window mean is 1.7%.
- Retention used for per-day cost is the 7-day light-node sampling window (CIP-036).

### Avail
- Maximum block size set to the in-window value of 4,194,304 bytes (`kate_blockLength`).

### Tooling
- `protocol/shared/make_tables.py` generates the paper's results tables from `daily.csv`.
- `collect.sh all transform` regenerates the tables; `all plot` also builds the cross-protocol figures. Path casing in the cross-protocol scripts fixed for case-sensitive file systems.
- Active test scripts (Aug–Dec 2025) restored under `protocol/active-tests/`, with a transaction list.
- SPDX license headers on all source files; `package.json` licenses corrected to Apache-2.0.
- Single pipeline image; per-test images under `protocol/active-tests/<Protocol>/`.

## v1.0.0 (2026-10-10)

### Ethereum
- Fork boundaries set to the first block at or after each activation slot (Pectra, Fusaka 23,935,694, BPO1 23,975,778, BPO2 24,179,383), each with its own blob-fee update fraction. The previous BPO2 boundary was a placeholder beyond the end of the dataset, so blocks from 7 Jan 2026 were priced with the BPO1 fraction; this overstated the daily median blob fee by a median factor of about 420 on those 39 days.
- Costs reported in $/MiB; a $/MiB/day column had previously been labelled $/MiB.

### Retention windows
- NEAR ~1.5 days (5 epochs at 0.616 s blocks); Celestia 7 days (CIP-036); Avail and Espresso have no protocol-defined window (Avail's 256-block default is state pruning; block bodies are retained).

### Tables
- Cost quantiles recomputed for every protocol on one basis: quantiles of the daily median $/MiB; VWAP is total spend divided by total volume.
