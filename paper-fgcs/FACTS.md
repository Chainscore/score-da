# Verified facts for the DA paper (observation window 15 Nov 2025 – 14 Feb 2026)

Compiled 2026-10-10. Every item is backed by a source I fetched. Confidence levels:
**High** means the official spec, code or config says it, or an on-chain query of the live chain confirms it.
**Medium** means the source is official but indirect (for example, a code default, not a network-wide rule).

"On-chain query" means I asked a public archive RPC for the chain's state or headers at heights inside the window. The method is given so a reviewer can repeat it.

---

## 1. Espresso (Tiramisu DA)

### Q1a. What are the official names of the three Tiramisu layers?
- **Answer:** **Savoiardi** is the VID layer (the base). **Mascarpone** is the small DA-committee layer (the middle). **Cocoa** is the CDN layer (the top). **"Ladyfinger" appears nowhere**, so it is wrong. Espresso's HackMD note and Figure 2 of the paper misspell it once as "Marscapone". Newer Espresso material calls the system "EspressoDA" and names the layers "VID Layer", "DA Committee Layer" and "CDN Layer". It describes Savoiardi, Mascarpone and Cocoa as "the original names of each layer when our DA solution was called TiramisuDA".
- **Confidence:** High.
- **Sources:**
  - Bearer et al., "The Espresso Sequencing Network: HotShot Consensus, Tiramisu Data-Availability, and Builder-Exchange", IACR ePrint 2024/1189: https://eprint.iacr.org/2024/1189 (PDF: https://eprint.iacr.org/2024/1189.pdf). The paper says: "Top layer. Cocoa: Web2 performance from a CDN"; "Mascarpone: a small DA committee for fast consensus"; "the Savoiardi layer…".
  - Espresso HackMD, "Designing the Espresso Network…", Part III: https://hackmd.io/@EspressoSystems/HotShot-and-Tiramisu#Part-III-Tiramisu-The-Three-Layered-Espresso-DA. It says: "Savoiardi is the VID Layer, Marscapone is the DA Committee Layer, and Cocoa is the CDN Layer."
  - Espresso docs changelog, which calls Savoiardi "a VID implementation forming the backbone of the Tiramisu DA solution": https://docs.espressosys.com/network/network/changelog.md

### Q1b. What was Espresso's max block (payload) size during the window?
- **Answer:** **1,000,000 bytes (1 MB)** for the whole window. Every mainnet header I sampled (15 Nov 2025, 15 Dec 2025, 15 Jan 2026 and 14 Feb 2026) has header version 0.2 and `chain_config.max_block_size = "1000000"`. The limit rose to **5,000,000 bytes (5 MB)** only after the window: a header from 10 Mar 2026 has version 0.4 and `max_block_size = 5000000`. This matches the Proof-of-Stake mainnet upgrade on 4 Mar 2026. The docs changelog for Mainnet 0 (Oct 2024) says "Initial block size 1 MB with planned scaling to 5 MB". The current genesis file sets the genesis header to `1mb` and the current chain_config to `10mb`, but 10 MB was **not** in force during the window.
- **Confidence:** High (on-chain).
- **Sources:**
  - On-chain: `https://query.main.net.espresso.network/v1/availability/header/{height}`. I sampled heights 7406035 (2025-11-15T00:00:00Z), 8251985 (2025-12-15), 9222867 (2026-01-15), 10318790 (2026-02-14) and 11264191 (2026-03-10).
  - https://docs.espressosys.com/network/network/changelog.md
  - https://raw.githubusercontent.com/EspressoSystems/espresso-network/main/data/genesis/mainnet.toml

### Q1c. What is Espresso's data retention?
- **Answer:** No single retention period applies to the whole network. It depends on how each operator configures their node.
  - **Query/availability nodes:** pruning is off by default, so an unconfigured node keeps everything. With pruning on, release `20251120` (the code current in the window) defaults to **target retention 7 days** and **minimum retention 1 day**, with a 3 TB disk threshold and a 1.5 h interval.
  - **Consensus storage:** garbage collection keeps at least **130,000 views**. The code describes this as "approximately 3 days … at an average view time of 2s".
  - **Current docs (2026):** they now recommend a 14-day retention for pruned non-archival nodes, and note that Merkle-state tables still default to 7 days.
  - **Archival nodes:** they keep all history.
- **Confidence:** High for the code defaults. Stating "Espresso retains X days" as a fact about the network would be wrong.
- **Sources:**
  - https://github.com/EspressoSystems/espresso-network/blob/20251120/hotshot-query-service/src/data_source/storage/pruning.rs (`impl Default for PrunerCfg`)
  - https://github.com/EspressoSystems/espresso-network/blob/20251120/sequencer/src/persistence/sql.rs (pruning defaults docstring; `consensus-storage-minimum-retention` default 130000)
  - https://docs.espressosys.com/network/developer/operators/run-a-node.md (section "Storage and retention")
- **Side note (on-chain):** the average Espresso block interval in the window was about 2–3 s. Averages over 100k blocks were 3.19 s (mid-Nov), 2.82 s (mid-Dec), 2.15 s (mid-Jan) and 1.95 s (mid-Feb).

---

## 2. NEAR

### Q2a. When did ~600 ms blocks activate on mainnet? Was block time ~0.6 s or ~1 s in the window?
- **Answer:**
  - **Release and protocol version:** nearcore **2.6.0** introduced Optimistic Block and **protocol version 77**. Voting started 2025-05-07 11:00 UTC, and the upgrade was expected around 2025-05-08 07:30 UTC. Its release notes say operators would afterwards be asked to update config values "to make the chain produce blocks at a faster rate".
  - **When the 600 ms default became code:** the mainnet default `MAINNET_MIN_BLOCK_PRODUCTION_DELAY` changed from `1_300` ms (tags 2.5.0–2.6.5) to `0_600` ms (from tag **2.7.0**).
  - **What the chain actually did:**
    - Protocol 77 became active at about height 146,030,048 (2025-05-08 06:56 UTC).
    - Block time was still about 1.1 s right after that.
    - It fell to about 0.6 s over **roughly 10–14 May 2025**, as validators updated their configs.
    - Averages were 1.16 s in Apr and early May 2025, 0.63 s from 15 May 2025, and 0.61 s through Jun–Aug 2025.
  - **So the speed-up was an operator config change, not a protocol upgrade.** It came after protocol 77 and before nearcore 2.7.0 (protocol 79, voting 18 Aug 2025).
  - **During the window, block time was ~0.6 s, not ~1 s.** Average from 2025-11-15 (height 172,665,547) to 2026-02-13 (height 185,299,415): 12,633,868 blocks in 7,775,993 s = **0.616 s**. Averages over 100k blocks at each sample point: 0.618 s (15 Nov), 0.649 s (15 Dec), 0.604 s (15 Jan) and 0.613 s (13 Feb).
  - **Protocol versions in the window:** 81 on 15 Nov 2025, then 82 from at least 15 Dec 2025 to 13 Feb 2026.
- **Confidence:** High (on-chain, release notes and code). I found no near.org blog page: the blog index loads its posts with JavaScript, so I could not read it.
- **Sources:**
  - https://github.com/near/nearcore/releases/tag/2.6.0
  - https://github.com/near/nearcore/releases/tag/2.7.0
  - https://github.com/near/nearcore/blob/2.6.5/nearcore/src/config.rs (1_300) and https://github.com/near/nearcore/blob/2.7.0/nearcore/src/config.rs (0_600)
  - https://docs.near.org/protocol/network/epoch ("Blocks are produced roughly every 0.6 seconds"; epoch = 43,200 blocks, about 7.2 h)
  - On-chain: NEAR archival RPC `https://archival-rpc.mainnet.fastnear.com`, methods `block` and `EXPERIMENTAL_protocol_config`

### Q2b. How many shards did NEAR have?
- **Answer:** **9 shards** for the whole window. The shard layout V2 gives shard_ids [10, 11, 1, 8, 9, 6, 7, 4, 5]. The 8→9 split, adding boundary "650", came with nearcore 2.7.0 (protocol 79, Aug 2025). The mainnet epoch configs are 8 shards at protocol 76/77 and 9 shards at protocol 78/80/81. An on-chain `EXPERIMENTAL_protocol_config` query returns 9 shards at 15 Nov, 15 Dec, 15 Jan and 13 Feb, and each block carries 9 chunks.
- **Confidence:** High.
- **Sources:**
  - https://github.com/near/nearcore/releases/tag/2.7.0
  - https://github.com/near/nearcore/tree/master/core/primitives/res/epoch_configs/mainnet
  - On-chain query as above

### Q2c. What is the max function-call upload size?
- **Answer:** `max_arguments_length` = **4,194,304 bytes (4 MiB)**. `max_contract_size` and `max_receipt_size` are also 4 MiB. However, `max_transaction_size` = **1,572,864 bytes (1.5 MiB)**, so a single signed transaction cannot carry 4 MiB of arguments. Only receipts created by contracts can reach the 4 MiB argument limit. The on-chain values at protocol 82 (window) match the values above.
- **Confidence:** High.
- **Sources:**
  - https://github.com/near/nearcore/blob/master/core/parameters/res/runtime_configs/parameters.yaml
  - On-chain `EXPERIMENTAL_protocol_config` at height 176,866,055 (15 Dec 2025), field `runtime_config.wasm_config.limit_config`

### Q2d. What is the garbage-collection window?
- **Answer:** **5 epochs** (`DEFAULT_GC_NUM_EPOCHS_TO_KEEP = 5`, a per-node client setting). 5 × 43,200 blocks × ~0.6 s ≈ 36 h, so about **1.5 days**. docs.near.org says "Nodes garbage collect blocks after 5 epochs", about 1.5 days. The **"~2.5 days" figure is out of date**: it assumes ~1 s blocks (5 × 43,200 s = 60 h). Archival nodes do not garbage-collect.
- **Confidence:** High.
- **Sources:**
  - https://github.com/near/nearcore/blob/master/core/chain-configs/src/client_config.rs
  - https://docs.near.org/protocol/network/epoch

---

## 3. Avail DA

### Q3a. What was Avail's max block size in the window?
- **Answer:** **4 MiB (4,194,304 bytes)**, not 64 MiB and not 2 MB. `kate_blockLength` returns the same value at every height I sampled in the window: `{"max":[4194304,4194304,4194304],"rows":256,"cols":512,"chunkSize":32}`. That is a matrix of 256 rows × 512 columns × 32-byte chunks, which equals 4 MiB. The value is the same from 2 Nov 2025 through 26 Feb 2026.
  - **What "64 MiB" refers to:** node release v2.3.4.0 (29 Sep 2025) says "Increased block size to support upto 64MiB". That is a capability limit in the software. The block length actually configured on-chain stayed at 4 MiB.
  - **What "2 MB" refers to:** older docs say "Avail's block size is initally at 2MB" (archived page). That is the launch-era value.
- **Confidence:** High (on-chain).
- **Sources:**
  - On-chain: `https://mainnet-rpc.avail.so/rpc`, methods `chain_getBlockHash` and `kate_blockLength(hash)`, with `Timestamp.now` used for dates. Sampled blocks: 2,150,518 (2025-11-14T08:09Z), 2,280,118 (2025-12-14), 2,414,038 (2026-01-14) and 2,543,638 (2026-02-13).
  - https://github.com/availproject/avail/releases/tag/v2.3.4.0
  - https://github.com/availproject/docs/blob/main/public/reserveDocs/overview.mdx

### Q3b. What is Avail's block time?
- **Answer:** **20 s** (`MILLISECS_PER_BLOCK = 20_000`, production runtime). On-chain, 393,120 blocks between 2025-11-14T08:09:20Z and 2026-02-13T08:54:00Z average **20.01 s**. Finality became 1 block (~20 s) with v2.3.4.0.
- **Confidence:** High.
- **Sources:**
  - https://github.com/availproject/avail/blob/main/runtime/src/constants.rs
  - https://github.com/availproject/avail/releases/tag/v2.3.4.0
  - On-chain query as above

### Q3c. How many cells does an Avail light client sample?
- **Answer:** **10 cells per block** at the default confidence of **99.9%**. The formula is cells = ceil(−log2(1 − confidence)): −log2(0.001) = 9.97, which rounds up to 10. The docs' log output shows "Confidence factor: 99.90234375", which equals 1 − 2⁻¹⁰, so it agrees. One code comment says the default is 92.0, which would give 4 cells. That comment is out of date: `RuntimeConfig::default` sets `confidence: 99.9`.
- **Confidence:** High for the default setting. Users can configure a different confidence.
- **Sources:**
  - https://github.com/availproject/avail-light/blob/main/core/src/network/rpc.rs (`cell_count_for_confidence`)
  - https://github.com/availproject/avail-light/blob/main/client/src/config.rs
  - https://github.com/availproject/docs/blob/main/content/docs/da/operate/run-a-light-client/light-client/index.mdx

### Q3d. What is Avail's data retention / pruning?
- **Answer:** The **256** figure is the Substrate `--state-pruning` default. It keeps the *state* of the last 256 finalized blocks. It is **not** a retention period for block data. Block bodies are controlled by a separate flag, `--blocks-pruning` (archive / archive-canonical / N). The Avail docs tell full-node operators to run with `--state-pruning archive --blocks-pruning archive`. I found no Avail document that sets a network-wide period for keeping DA data.
- **Confidence:** High that 256 is the state-pruning default. Unconfirmed that any network-wide DA retention period exists.
- **Sources:** https://github.com/availproject/docs/blob/main/content/docs/da/operate/run-a-full-node/full-node/index.mdx (says "[default: 256]" under `--state-pruning`)

---

## 4. Ethereum PeerDAS (Fulu / Fusaka)

### Q4a. What are the PeerDAS custody and sampling parameters?
- **Answer:** All of these are confirmed in the spec and in the mainnet config. In the spec they are now config values; earlier spec drafts listed some of them as presets.

| Parameter | Value | Spec file |
|---|---|---|
| `NUMBER_OF_COLUMNS` | 128 (= `CELLS_PER_EXT_BLOB`) | das-core.md |
| `NUMBER_OF_CUSTODY_GROUPS` | 128 | das-core.md, mainnet config |
| `CUSTODY_REQUIREMENT` | 4 | das-core.md, mainnet config |
| `SAMPLES_PER_SLOT` | 8 | das-core.md, mainnet config |
| `VALIDATOR_CUSTODY_REQUIREMENT` | 8 | validator.md, mainnet config |
| `BALANCE_PER_ADDITIONAL_CUSTODY_GROUP` | 32,000,000,000 Gwei (32 ETH) | validator.md, mainnet config |
| `DATA_COLUMN_SIDECAR_SUBNET_COUNT` | 128 | mainnet config |
| `MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS` | 4096 epochs (~18 days) | mainnet config |

- **Confidence:** High.
- **Sources:**
  - https://github.com/ethereum/consensus-specs/blob/master/specs/fulu/das-core.md
  - https://github.com/ethereum/consensus-specs/blob/master/specs/fulu/validator.md
  - https://github.com/eth-clients/mainnet/blob/main/metadata/config.yaml

### Q4b. When did Fusaka, BPO1 and BPO2 activate on mainnet?
- **Answer:** All three dates and epochs in the question are confirmed.
  - **Fusaka:** epoch **411392**, 2025-12-03 21:49:11 UTC (timestamp 1764798551). Fork ID 0x5167e2a6. Blob target/max stays at **6/9** (the Prague values) until BPO1.
  - **BPO1:** epoch **412672**, 2025-12-09 14:21:11 UTC (timestamp 1765290071). Target/max = **10/15**. `baseFeeUpdateFraction` = 8346193.
  - **BPO2:** epoch **419072**, 2026-01-07 01:01:11 UTC (timestamp 1767747671). Target/max = **14/21**. `baseFeeUpdateFraction` = 11684671.
  - **Where the targets come from:** the CL `config.yaml` lists only MAX_BLOBS_PER_BLOCK (15, then 21). The target values come from the EL chainspec `blobSchedule`.
- **Confidence:** High.
- **Sources:**
  - EIP-7607 (Fusaka meta, activation tables): https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7607.md (https://eips.ethereum.org/EIPS/eip-7607)
  - https://github.com/eth-clients/mainnet/blob/main/metadata/config.yaml (`FULU_FORK_EPOCH: 411392`, `BLOB_SCHEDULE`)
  - go-ethereum mainnet chainspec, `osakaTime`/`bpo1Time`/`bpo2Time` and `blobSchedule`: https://github.com/ethereum/go-ethereum/blob/master/params/chainspecs/mainnet.json
  - EIP-7892 (BPO mechanism): https://eips.ethereum.org/EIPS/eip-7892

### Q4c. What exactly is the EIP-7918 reserve price?
- **Answer:**
  - **Constant:** `BLOB_BASE_COST = 2**13` (8192).
  - **Reserve price per blob:** `BLOB_BASE_COST * base_fee_per_gas`. In other words, a blob must cost at least as much as 8192 units of execution gas. Since `GAS_PER_BLOB = 2**17`, the reserve blob base fee is `BLOB_BASE_COST * base_fee_per_gas / GAS_PER_BLOB = base_fee_per_gas / 16`.
  - **How it is enforced:** in `calc_excess_blob_gas`, when the condition `BLOB_BASE_COST * parent.base_fee_per_gas > GAS_PER_BLOB * get_base_fee_per_blob_gas(parent)` holds, the function returns `parent.excess_blob_gas + parent.blob_gas_used * (max - target) // max`. Normally it returns `excess + used - target_blob_gas`. Either way it first returns 0 when `excess + used < target_blob_gas`.
  - **What that means:** while the blob fee is below the reserve, the protocol does not subtract the target, so the blob fee cannot keep falling.
- **Confidence:** High.
- **Source:** https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7918.md (https://eips.ethereum.org/EIPS/eip-7918). EIP-7918 is part of Fusaka according to EIP-7607.

---

## 5. Celestia

### Q5a. What were the actual max square size and max block bytes on mainnet in the window?
On-chain values, read from a Celestia mainnet archive RPC. I read the header `version.app`, `consensus_params.block.max_bytes` and the `/celestia.blob.v1.Query/Params` field `gov_max_square_size` at each height.

| Date (UTC) | Height | App version | GovMaxSquareSize | Block `max_bytes` |
|---|---|---|---|---|
| 2025-09-01 / 10-15 / 11-01 | 7,264,369 / 8,007,564 / 8,293,830 | 5 | 128 | 8,388,608 (8 MiB) |
| 2025-11-15 | 8,511,910 | 5 | **128** | **8 MiB** |
| 2025-12-01 | 8,753,132 | 6 | 128 | 8 MiB |
| 2025-12-15 | 8,950,534 | 6 | **256** | **33,554,432 (32 MiB)** |
| 2026-01-01 / 01-15 / 02-14 | 9,190,746 / 9,389,318 / 9,814,741 | 6 | 256 | 32 MiB |

- **When things changed (exact heights from a binary search):**
  - **App version 5 → 6 (the v6 upgrade, CIP-042):** first v6 block is **8,662,013**, at **2025-11-24 12:33:23 UTC**.
  - **GovMaxSquareSize 128 → 256:** at height **8,794,914** (2025-12-03 23:03 UTC).
  - **`max_bytes` 8 MiB → 32 MiB:** at height **8,794,915**, the next block, 2025-12-03 23:03:20 UTC. The upgrade handler does not change these parameters, so they were changed by a parameter change after the v6 activation, not by the upgrade itself.
- **Monthly summary:**
  - **Nov 2025:** max square 128 (8 MiB) for the whole month, under app v5 until 24 Nov and app v6 after.
  - **Dec 2025:** 128 / 8 MiB until 3 Dec 23:03 UTC, then 256 / 32 MiB.
  - **Jan 2026:** 256 / 32 MiB.
  - **Feb 2026 (to 14 Feb):** 256 / 32 MiB.
- **Notes on the paper's claims:**
  - **"Squares of 256 from 15 Dec 2025":** this fits the data. 256 became *allowed* from 3 Dec, and the dataset first *observes* 256 squares on 15 Dec.
  - **A max of 64:** 64 was **not** the max square size in or near the window. The governance max was already 128 by 1 Sep 2025. 64 is the old v5 code default (`DefaultGovMaxSquareSize = 64` in app v5). A "64" in the dataset must be an *observed* square size, not the limit.
- **What v6 changed in the code:**
  - CIP-038 (in v6, under CIP-042) raised the hard-coded `SquareSizeUpperBound` from 128 to **512**, CometBFT `MaxBlockSizeBytes` from 100 MiB to **128 MiB**, and `MaxTxSize` from 2 MiB to 8 MiB.
  - The v6 code defaults are `DefaultGovMaxSquareSize = 256` and `DefaultMaxBytes = 32 MiB`, with an upper bound of 128 MiB.
  - The release notes describe the step to "128mb/6s" as a later bump from "32mb/6s". That step did **not** happen in the window: max_bytes stayed at 32 MiB through 14 Feb 2026.
  - **"128 MB" and "square 512" are hard upper bounds that became possible with v6. They were not the parameters in force during the window.**
- **Block time:** **~6 s.** On-chain: 1,302,831 blocks from 2025-11-15 to 2026-02-14 (7,862,400 s) average **6.03 s**.
- **Confidence:** High (on-chain, release notes, CIPs).
- **Sources:**
  - On-chain: Tendermint RPC `https://rpc.celestia.pops.one`, endpoints `/header?height=`, `/consensus_params?height=` and `/abci_query?path="/celestia.blob.v1.Query/Params"&height=`
  - celestia-app release notes (v6.0.0 and the "v6 - 128mb/6s" section): https://github.com/celestiaorg/celestia-app/blob/main/docs/release-notes/release-notes.md
  - CIP-038: https://github.com/celestiaorg/CIPs/blob/main/cips/cip-038.md
  - CIP-042 (v6 upgrade bundle): https://github.com/celestiaorg/CIPs/blob/main/cips/cip-042.md
  - v6 constants: https://github.com/celestiaorg/celestia-app/blob/v6.4.10/pkg/appconsts/initial_consts.go and https://github.com/celestiaorg/celestia-app/blob/v6.4.10/pkg/appconsts/app_consts.go
  - v5 constants: https://github.com/celestiaorg/celestia-app/blob/v5.0.12/pkg/appconsts/initial_consts.go
  - No v6 handler changes GovMaxSquareSize or MaxBytes: https://github.com/celestiaorg/celestia-app/blob/v6.4.10/app/upgrades.go
- **Not confirmed:**
  - I did not locate the governance proposal ID behind the 3 Dec 2025 parameter change.
  - I did not confirm the "Matcha" name from an official Celestia page in the window. blog.celestia.org's first page starts in Jan 2026, and docs.celestia.org's upgrade page lists only Lemongrass.

### Q5b. What is the Celestia light-node sampling window?
- **Answer:** **7 days**, not 30 days.
  - **The rule:** CIP-036 (Final) sets the trusting period, and with it the light-node `SamplingWindow`, to 7 days. CIP-034 (Final) lowers the minimum pruning window for bridge and full nodes from 721 h (30 days + 1 h) to 169 h (7 days + 1 h).
  - **In the code, sampling window:** celestia-node changed `SamplingWindow` from 30 days to `7 * 24h` in **v0.25.x**, citing CIP-036. v0.24.1 still has a 30-day `RequestWindow`.
  - **In the code, storage window:** v0.25.x and v0.26.x still set `StorageWindow` = 30 days + 1 h. **v0.28.x** sets it to `SamplingWindow + 1h` (7 days + 1 h).
- **Confidence:** High for the parameters. Which node version operators ran during the window was not checked.
- **Sources:**
  - https://github.com/celestiaorg/CIPs/blob/main/cips/cip-036.md
  - https://github.com/celestiaorg/CIPs/blob/main/cips/cip-034.md
  - https://github.com/celestiaorg/celestia-node/blob/v0.24.1/share/availability/window.go
  - https://github.com/celestiaorg/celestia-node/blob/v0.25.3/share/availability/window.go
  - https://github.com/celestiaorg/celestia-node/blob/v0.28.2/share/availability/window.go

### Q5c. How many samples does a Celestia light client take?
- **Answer:** **16** (`DefaultSampleAmount uint = 16`), the default minimum number of samples a light node must take per block.
- **Confidence:** High (current code default).
- **Source:** https://github.com/celestiaorg/celestia-node/blob/main/share/availability/light/options.go
