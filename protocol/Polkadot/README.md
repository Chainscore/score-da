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
cd protocol/polkadot
npm install
```

## Usage

```bash
# Throughput: collect block data + generate charts
npm run throughput -- --blocks 5000
npm run throughput:plot

# Cost: collect coretime pricing + generate charts
npm run cost
npm run cost:plot
```

## Key Governance Changes

| Ref | Date | Change |
|-----|------|--------|
| #1200 | 2024-10-25 | Validators 400->500 (cores 80->100) |
| #1484 | 2025-03-16 | Validators 500->600 (cores 100->120) |
| #1480 | 2025-03-29 | PoV limit 5->10 MiB |
| #1536 | 2025-04-29 | Cores 62->66 |
| #1629 | 2025-07-09 | Cores 66->100 |

## Structure

```
polkadot/
├── throughput/
│   ├── collect.ts
│   ├── plot.ts
│   └── analysis/        # CSV + SVG output
├── cost/
│   ├── collect.ts
│   ├── plot.ts
│   └── analysis/        # CSV + SVG output
├── polkadot_add_data.js # Paseo testnet tx tool
├── package.json
└── research.md
```
