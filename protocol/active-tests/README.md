# Active DA tests (Aug–Dec 2025)

These scripts submit, retrieve and stress-test data on each network. They ran between August and December 2025, alongside the 90-day passive collectors in `protocol/<Protocol>/data/`. They were removed from the repository on 2026-02-16 while it was being consolidated for Milestone 2 (commit `913c115`), and restored here from the original commits (`58ec122` through `6b3c62d`, preserved on GitHub).

The transactions they produced are listed with explorer links in [`evidence/README.md`](evidence/README.md); the raw per-transaction records are in the same folder.

| Folder | Network used | What the scripts do |
|---|---|---|
| `Avail/` | Turing testnet | `avail_test_data.js` / `avail_test_data_2.py`: `submitData` with app id 463. `avail_get_block.js`: read a submission back. `avail_max_tps.js`, `block_max_txn/`, `avail_max_tps/`: large-blob and batched submissions with inclusion latency. `block_bloat_test*.py`: fill a block with remarks (local node). `avail_telemetry_probe.py`: node RPC and Prometheus probe. `generate_avail_wallets.js`: test wallets. |
| `Celestia/` | Mocha testnet, through a local light node | `celestia_data.py`, `clestia_max_tps/measure_tps.js`, `block_max_txn/celestia_max_txns.js`: `blob.Submit` and `blob.GetAll` in single and batched runs. `celestia_tps.py`, `celestia_monitor/`: mainnet block stats from Celenium. |
| `Espresso/` | Mainnet query service | `espresso-da.py`: submit, wait for inclusion, retrieve by namespace. `espresso_max_tps.py`, `block_max_txn/`, `espresso_max_tps/measure_tps.py`: concurrent-submission stress tests (namespace 1000000). `espresso_tps.py`, `espresso_monitor/`: explorer block stats. |
| `Near/` | Testnet | `send_single_tx.py`, `block_max_txn/`, `near_max_tps/measure_tps.py`, `send_multiple_txs_in_block.py`: `submit_data` calls to our contract, single and batched. `tps_stress_test.js` (and earlier `tps_stress_test_v1.js`): throughput stress tests (`block_max_txn/tps_blast_summary.json` records the 21 Nov run, in which no transactions were accepted). `near_key_gen/`: access-key generation. `near_data_test.py`: blob-store client, not run on-chain. |
| `Polkadot/` | Westend and Paseo | `polkadot_add_data.js`, `estimate_fee_remark.js`: remark submission with fee estimate and wait for finalization. `polkadot_add_10_tx.js`: batched remarks. `submit_preimage.*`, `polkadot_storage_cost.py`, `estimate_preimagecost.js`: preimage storage cost. `polkadot_max_tps/measure_tps.js`: remark throughput test. |
| `common/` | — | `tps_script.py`: runs the TPS monitors for all protocols. |

## Running

Each script reads its key from an environment variable (`SEED`, `SEED_PHRASE`, `SENDER_SEED`, `NEAR_ACCOUNT_ID` / `NEAR_CONTRACT_ID`, or a Celestia light-node `AUTH_TOKEN`). Use funded **testnet** accounts only. Node.js scripts: `npm install` in the folder, then `node <script>`. Python scripts: `pip install requests substrate-interface py-near aiohttp`, then `python3 <script>`.

## Why these runs are not in the paper's comparison

Testnet throughput, latency and fees depend on each network's own validator set, load and fee policy, so they cannot be compared across protocols or with mainnet. The paper's comparison uses the 90-day mainnet block records instead; see `DEVIATIONS.md` at the repository root.

Testnet histories that are no longer served: Celestia relaunched Mocha as mocha-5 (Aug 2026), and Paseo restarted from a new genesis (Jul 2026). Those runs can be traced through an archive provider if needed.
