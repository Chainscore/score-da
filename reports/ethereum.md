# Ethereum Data Availability Layer Research Status as of February 2026

## Evolution of Ethereum’s DA architecture

Ethereum’s “data availability (DA) layer” has evolved from a classic “every full node downloads full blocks” regime to a rollup‑centric architecture in which Ethereum provides (a) consensus security and (b) a DA service optimised specifically for rollups via *blob* data, and—since late 2025—probabilistic DA scaling via PeerDAS. citeturn33view1turn13view0turn12view0

A DA‑relevant timeline of protocol decisions and upgrades is:

- **Calldata‑as‑DA era (pre‑blobs)**  
  Rollups originally posted their data to Ethereum using transaction calldata (permanently stored as part of block history). Gas repricings therefore functioned as “DA policy”. A major DA‑relevant shift was **Istanbul (2019)**, which reduced calldata cost (EIP‑2028). citeturn0search6

- **Shift to Proof of Stake and fixed slot timing (consensus‑layer impact on DA liveness)**  
  Post‑merge, Ethereum’s consensus runs in **12‑second slots** and **32‑slot epochs (6.4 minutes)**. citeturn15search4  
  This matters for DA because (a) bandwidth and verification work must fit inside a slot and (b) “finality” is framed in epoch terms. citeturn15search4turn15search22

- **Deneb/Cancun (Dencun, March 2024): Proto‑danksharding via EIP‑4844**  
  Dencun introduced *blob‑carrying transactions* and a separate “blob gas” pricing mechanism, with blob data transported as **sidecars** rather than embedded in the beacon block body. citeturn14view0turn33view1turn19search3  
  Key architectural decision: **“sidecar” black‑boxes `is_data_available()`** so that later upgrades can swap “download everything” for DAS without changing the beacon block structure. citeturn19search3turn33view1

- **Prague/Electra (Pectra, May 2025): DA supply and calldata policy adjustments**  
  Pectra explicitly included (a) **EIP‑7691 (blob throughput increase)** and (b) **EIP‑7623 (increase calldata cost)**—a deliberate rebalancing that pushes rollups toward blob DA and away from calldata DA. citeturn13view0

- **Fulu/Osaka (Fusaka, December 2025): PeerDAS and a DA fee‑market stabiliser**  
  Fusaka included **PeerDAS (EIP‑7594)** and also **EIP‑7918**, which bounds blob base fees by execution costs (addressing fee‑market pathologies where blob base fee could drift to a 1‑wei floor). citeturn12view0turn5view1turn10view1

- **Blob‑Parameter‑Only (BPO) mini‑forks for incremental DA scaling (Dec 2025–Jan 2026)**  
  Ethereum adopted a mechanism for “BPO hardforks” to change only blob parameters (target, max, baseFeeUpdateFraction) with lower operational overhead than a full fork. citeturn7view0turn8search0  
  On mainnet, **BPO1 (Dec 9, 2025)** raised blob target/max to **10/15**, and **BPO2 (Jan 7, 2026)** raised to **14/21**. citeturn8search0turn12view0turn11search5

## DA security meaning and threat model

In Ethereum’s context, “DA security” is best defined relative to **which data must be available**, **to whom**, and **when**, such that honest participants can (a) verify or (b) reconstruct the correct state/transitions (L1 or L2) without trusting a private party.

Because Ethereum now has two distinct “data planes”, DA security has two threat models:

- **Execution payload data (transactions, receipts, etc.)**: historically and still, the base security model is that *verifiers download the full block body*. The data commitment is ultimately the block header’s roots (state/txs/receipts), but practical verification requires the actual body data. citeturn32view2turn33view1  
- **Blob DA (rollup data)**: the protocol explicitly targets rollup needs: data must be available reliably for a limited window, not necessarily forever. EIP‑4844 states that blobs are persisted by the consensus layer for DA and are designed to be deletable after a relatively short delay. citeturn33view1turn5view0

### Who can withhold data

**Block producer / proposer pipeline.**  
With EIP‑4844, the proposer (and the block production pipeline behind them) is the obvious first withholding point: if a proposer fails to make blob data available, validators cannot validate blob sidecars/columns and should reject or fail to attest. EIP‑4844 explicitly assigns the honest validator the duty to “produce beacon blocks with blobs” and “sign and publish the associated blob sidecars.” citeturn33view1

**Blob transaction senders / builders (proof production work).**  
PeerDAS adds *cell* proofs; EIP‑7594 notes that producing these proofs is expensive and therefore requires transaction senders to compute and include them (so block producers don’t have to). citeturn5view1  
This introduces a new “withholding lever”: if proof material is missing or malformed, transactions cannot be gossiped/accepted correctly.

**P2P custodians and servers.**  
With PeerDAS, no single node is required to download or store all blob data. Instead, nodes (a) custody specific columns and (b) sample additional columns. If custodians refuse to serve, or eclipse/partitioning prevents requests from reaching honest custodians, DA can fail despite correct commitments. citeturn30view1turn29view0turn31view2

### Honest threshold for DA guarantees

Ethereum’s DA thresholds differ by the guarantee you care about:

**Guarantee A: “A data‑withheld block will not finalise.”**  
Finality in Ethereum PoS requires supermajority voting (Casper FFG). If a sufficiently large fraction of validators refuses to attest to data‑unavailable blocks, finality halts. This yields a practical “honest‑stake” threshold: a minority large enough to prevent supermajority votes can stop finality on withheld data. citeturn15search22turn15search4

**Guarantee B: “The data can be reconstructed by honest parties (DA as a service).”**  
Under PeerDAS, reconstruction depends on **custody distribution** and the availability of enough columns/cells, not purely stake weight. The spec’s reconstruction rule is explicit: if a node obtains **50%+ of columns**, it can reconstruct the full data matrix. citeturn30view1turn5view1  
Thus, at minimum, DA requires (i) enough independent honest custodians collectively serving columns and (ii) at least one actor capable of reconstruction propagating recovered columns when needed (see “supernodes” below). citeturn31view2turn30view1

### Safety versus liveness under withholding

**Under EIP‑4844 (proto‑danksharding)**  
EIP‑4844 introduced blob sidecars precisely to ensure that blocks referencing blobs are only accepted when blob data is available via the consensus networking rules, while setting the stage for future DAS. citeturn33view1turn19search3  
If a proposer withholds blob data, the expected outcome is **liveness degradation** (missed block, rejection, fewer attestations) rather than “finalise anyway,” because the honest validator path includes checking and publishing sidecars. citeturn33view1

**Under PeerDAS (Fulu/Fusaka)**  
The DA layer becomes **probabilistic for non‑supernodes**: nodes sample columns each slot; if sampling fails due to missing columns, nodes can fall back to Req/Resp and reconstruction/cross‑seeding flows. citeturn30view1turn29view0  
Therefore, withholding tends to manifest as:
- increased per‑slot sampling failures and retry traffic, and/or  
- a need for reconstruction/cross‑seeding by higher‑resource nodes (supernodes). citeturn30view1turn31view2

### Slashing and accountability

**Protocol‑level slashing is not a primary DA enforcement mechanism.**  
Ethereum’s core slashing conditions target equivocation (double proposals, double votes, surround votes), not “failed DA serving” behaviour. citeturn15search1

**PeerDAS enforcement is largely off‑chain (network‑level).**  
Fulu networking specifies that because custody is deterministic, peers can be scored: if a peer fails to respond to samples of its custodied columns, nodes may downscore or disconnect it. citeturn31view2turn30view1turn29view0  
This is accountability, but it is not slashing: it penalises network connectivity/reputation rather than stake.

## DA mechanisms and cryptographic structure

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["Ethereum EIP-4844 blob sidecar diagram","Ethereum PeerDAS data availability sampling columns diagram","Ethereum danksharding roadmap diagram blobs data availability"],"num_per_query":1}

### Data commitments in block headers and consensus objects

**Execution data commitments (legacy L1).**  
EIP‑4844’s header extension shows Ethereum’s execution header remains an RLP‑encoded structure carrying (among other values) roots such as `txs_root` and `receipts_root`, plus new blob accounting fields—highlighting that the base L1 still relies on classic Merkle‑root commitments for transaction inclusion and execution results. citeturn32view2

**Blob data commitments (proto‑danksharding and beyond).**  
EIP‑4844 uses **KZG commitments**: blob transactions carry versioned hashes derived from KZG commitments, and the protocol adds a point‑evaluation precompile for verifying KZG proofs. citeturn33view1turn5view0turn33view3  
Ethereum also ran a multi‑participant KZG trusted setup (“KZG Ceremony”), which underpins the security of these polynomial commitments. citeturn1search7turn5view0

### Erasure coding scheme and share sizing

**Proto‑danksharding (EIP‑4844): no erasure coding in‑protocol.**  
EIP‑4844 is explicit that “for now” blobs are downloaded by all consensus nodes, and that “an actual implementation of data availability sampling” remains future work. citeturn5view0turn32view1

**PeerDAS (Fulu/Fusaka): one‑dimensional Reed–Solomon extension**  
The Fulu DAS Core spec states blobs are extended using a **one‑dimensional erasure coding extension**, and reconstruction is possible with **50%+ of columns**. citeturn30view1turn5view1  
In polynomial‑commitment sampling, an extended blob is explicitly defined as **2×** the base blob in field elements: `FIELD_ELEMENTS_PER_EXT_BLOB = 2 * FIELD_ELEMENTS_PER_BLOB`. citeturn30view3turn5view0  
This implies a **coding rate ≈ 1/2**, i.e., a 2× redundancy at the encoding layer.

**Cell (“share”) sizing.**  
Fulu polynomial‑commitment sampling defines:
- `FIELD_ELEMENTS_PER_CELL = 64` and  
- `BYTES_PER_FIELD_ELEMENT = 32`, so  
- `BYTES_PER_CELL = 64 * 32 = 2048 bytes (2 KiB)`. citeturn30view3turn5view0  
An extended blob has `CELLS_PER_EXT_BLOB` cells (and the Fulu DAS Core sets `NUMBER_OF_COLUMNS = CELLS_PER_EXT_BLOB = 128`). citeturn30view0turn30view3

### Sampling model and confidence dynamics

**Sampling schedule (protocol‑defined minimum).**  
Fulu DAS Core defines `SAMPLES_PER_SLOT = 8` as the minimum number of samples for an honest node. citeturn30view2turn15search4  
The sampling procedure is specified: each slot, a node downloads at least `sampling_size = max(SAMPLES_PER_SLOT, custody_group_count)` custody groups and their corresponding columns; sampling succeeds only if it retrieves all selected columns. citeturn30view1turn31view0

**What “confidence” means in Ethereum PeerDAS.**  
Ethereum does not currently specify a single “light‑client confidence target” constant in the way some standalone DA layers do; instead, it specifies a minimum per‑slot sampling workload (8 columns) and explicit recovery/fallback paths. citeturn30view1turn30view2turn29view0  
Confidence is therefore *emergent*: it depends on (a) the number of independent sampling nodes, (b) sample diversity, and (c) networking robustness. The protocol gives the building blocks, but “how many samples yield X% security” is a system‑level analysis rather than a single on‑chain threshold. citeturn30view1turn31view2

### Retrieval and serving protocols

**EIP‑4844 (Deneb): blob sidecars.**  
Deneb networking defines request/response endpoints for blob sidecars (e.g., `BlobSidecarsByRange`) and requires nodes to serve blob sidecars within a time window (`MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS`, used to define a “blob serve range”). citeturn20search1turn19search3

**Fulu (PeerDAS): data column sidecars, custody metadata, and subnets.**  
Fulu networking defines:
- **128 data‑column subnets** (`DATA_COLUMN_SIDECAR_SUBNET_COUNT = 128`). citeturn29view0turn31view0  
- A required serving window: `MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS = 4096 epochs (~18 days)`. citeturn29view0turn31view0  
- A peer metadata field `custody_group_count` so peers can advertise how many custody groups they serve; clients may reject peers advertising less than the minimum custody requirement. citeturn31view0turn30view2  
- Gossip topics where `data_column_sidecar_{subnet_id}` becomes the primary propagation mechanism, and the older `blob_sidecar` topic is deprecated. citeturn31view0turn29view0

## Performance: capacity, overhead, and latency

### Capacity and throughput

**Proto‑danksharding baseline (Dencun / EIP‑4844).**  
EIP‑4844 fixed blob size via `FIELD_ELEMENTS_PER_BLOB = 4096` and `BYTES_PER_FIELD_ELEMENT = 32`, implying **131,072 bytes (128 KiB) per blob**, and set blob throughput targets/limits equivalent to **3 blobs target and 6 blobs max** per block, i.e. ~0.375 MB target and ~0.75 MB max. citeturn5view0turn32view1

**Pre‑Fusaka state (Pectra blob settings).**  
Immediately before Fusaka, mainnet blob capacity stood at **target 6 / max 9**, as referenced as the “from 6 & 9 respectively” baseline in Fusaka’s BPO schedule discussion. citeturn8search0turn13view0

**Post‑BPO2 state (current as of Feb 12, 2026).**  
Fusaka introduced two scheduled BPO adjustments:
- **BPO1:** target/max **10/15**  
- **BPO2:** target/max **14/21** citeturn8search0turn11search5  

Thus, as of February 2026, the *raw* blob payload capacity is:
- **Target:** 14 blobs × 128 KiB ≈ **1.75 MiB per slot** (≈ 146 KiB/s baseline at target)  
- **Max:** 21 blobs × 128 KiB ≈ **2.63 MiB per slot** (≈ 219 KiB/s at max) citeturn8search0turn5view0turn15search4  

### Overhead and redundancy factor

**Encoding‑layer redundancy (PeerDAS).**  
PeerDAS doubles blob length in field elements: `FIELD_ELEMENTS_PER_EXT_BLOB = 2 * FIELD_ELEMENTS_PER_BLOB`. citeturn30view3turn5view0  
This means **2× erasure‑coding redundancy** at the data‑encoding level, before accounting for proofs and networking duplication.

**Proof overhead (cells).**  
PeerDAS authenticates cells with KZG proofs. The Fulu polynomial‑commitments‑sampling spec makes cell granularity explicit (`BYTES_PER_CELL` computed from field elements), and PeerDAS introduces “cell KZG proofs” to enable downloading only specific cells rather than full blobs. citeturn30view3turn5view1  
The key design trade‑off is that proof verification is cheaper than proof computation, so EIP‑7594 offloads proof computation to senders. citeturn5view1turn10view1

**Network‑level redundancy (gossip).**  
Beyond encoding, Ethereum’s gossipsub propagation implies additional duplication (messages are forwarded to multiple peers). The protocol does not define a single network “redundancy factor”; it is topology‑dependent. However, the design intent of PeerDAS is that **per‑node bandwidth stays roughly bounded** even as total blob throughput rises, by sampling only a small number of columns per slot. citeturn30view1turn30view2turn31view2

### Latency: availability, confidence, and finality

**Time‑to‑availability for full nodes (retrievability).**  
For Fulu, nodes must serve data column sidecars for **4096 epochs (~18 days)**, which provides a concrete on‑protocol retrievability window for rollup participants to fetch data after inclusion. citeturn29view0turn31view0  
This is a *retention guarantee*, distinct from “propagation latency” inside a slot.

**Time‑to‑confidence for sampling nodes.**  
PeerDAS sampling is per‑slot: an honest node samples at least **8 columns per slot**. citeturn30view2turn15search4  
If columns are missing on gossip, nodes can request missing columns via Req/Resp and/or rely on reconstruction/cross‑seeding if enough columns are obtained. citeturn30view1turn29view0  
In practice, confidence is achieved when sampling succeeds consistently across diverse peers, and when the network has enough well‑behaved custodians and at least one reconstruction‑capable participant. citeturn31view2turn30view1

**Time‑to‑finality (and whether DA is required before finality).**  
Ethereum PoS time structure is **12‑second slots** and **6.4‑minute epochs**. citeturn15search4  
Casper FFG finalises checkpoints in **two epochs (~12.8 minutes)** under normal conditions. citeturn15search22  
In the intended design, validators only attest to blocks they can validate, meaning DA failures should reduce attestations and thus delay finality rather than finalising withheld data. citeturn33view1turn30view1

## Operational roles, resource costs, and robustness

### Resource cost by role

Because PeerDAS explicitly *decouples total blob throughput from per‑node download volume*, the most useful way to present “real constraints” is to separate (a) **minimum honest nodes**, (b) **supernodes**, and (c) **archival/history operators**.

**Validating node (typical, non‑supernode)**  
Minimum mandated sampling and custody parameters are:
- `SAMPLES_PER_SLOT = 8` (download/successfully sample at least 8 custody groups/columns per slot) citeturn30view2turn30view1  
- `CUSTODY_REQUIREMENT = 4` (custody and serve at least 4 custody groups/columns) citeturn30view2turn31view0  
- Column count: `NUMBER_OF_COLUMNS = 128`, with `BYTES_PER_CELL = 2048 bytes`. citeturn30view0turn30view3  

**Implication (bandwidth scale at BPO2 max):** if a block carries 21 blobs (rows), each sampled column contains 21 cells × 2 KiB = ~42 KiB of raw cell data. Sampling 8 columns is then ~336 KiB of cell payload per slot (plus proofs/overheads). This is *deliberately* in the same order as the pre‑PeerDAS “download all blobs” regime at much lower blob counts. citeturn30view1turn30view3turn8search0  

**CPU:** Validators must verify KZG proofs (whole‑blob in Deneb, cell‑level in PeerDAS), and this cost is explicitly recognised in the blob fee market design—EIP‑7918’s motivation discusses KZG proof verification as a non‑trivial compute burden and ties a reserve price to execution base fee. citeturn10view1turn33view1  

**Storage/retention:** peers must serve data column sidecars for ~18 days. citeturn29view0turn31view0

**Supernode (high‑resource DA backbone)**  
Fulu networking defines “supernodes” as nodes that subscribe to all data column sidecar subnets, custody all data columns, and perform reconstruction/cross‑seeding. The spec also states that **to reconstruct missing data, there must be at least one supernode on the network**. citeturn31view2turn30view1  
Additionally, due to validator custody requirements, any node connected to validators with combined balance ≥ 4096 ETH must be a supernode. citeturn31view2  
This implies professional operators with large consolidated validator balances are expected to bear the “full matrix” bandwidth/storage/CPU load.

**Non‑validating full node**  
A non‑validating node can run with the honest minimum custody/sampling settings (still participating in gossip, sampling, and serving for the retention window). The protocol allows higher `custody_group_count` advertisements but permits rejecting peers below the minimum. citeturn31view0turn30view1  

**Light client**  
Ethereum light clients rely on sync‑committee based header updates (Altair light‑client specs), which is distinct from DA sampling. citeturn15search2turn15search6  
PeerDAS provides a pathway for constrained clients to reason about blob DA by sampling cells, but as of February 2026, Ethereum’s light‑client specs are primarily about **consensus header tracking**, not a fully specified end‑to‑end “DAS light client” with an explicit statistical confidence target. citeturn15search2turn30view2turn5view1  

**Archival / history storage operators**  
Blob data is *not intended for permanent storage by all nodes*: EIP‑4844’s motivation explicitly frames blob DA as “available once … long enough … but not forever,” and the protocol provides a fixed retention window (now ~18 days) rather than indefinite storage. citeturn5view0turn29view0  
Therefore “archival blob storage” is, by design, an *optional ecosystem service* rather than a universally replicated protocol obligation. citeturn33view1turn29view0  

### Robustness, outages, and recovery paths

**Missing peers / partial outages: fallback is explicit.**  
Fulu DAS Core specifies that if a node fails to get columns on column subnets, it can use Req/Resp to query missing columns. citeturn30view1turn29view0  
Nodes that obtain 50%+ of columns should reconstruct the full data matrix and cross‑seed reconstructed columns back to the network, which functions as a recovery amplifier during partial outages. citeturn30view1turn31view2

**Failure escalation mode is “network + reconstruction,” not “committee fallback.”**  
PeerDAS’s core escalation is:
1) sample via gossip and peer requests;  
2) if missing, request via Req/Resp;  
3) if sufficient partial data exists, reconstruct and cross‑seed;  
4) apply peer scoring/disconnect to misbehaving custodians. citeturn30view1turn31view2turn29view0  

**Central robustness assumption: at least one supernode exists.**  
Fulu networking is unusually explicit: reconstruction of missing data requires at least one supernode. citeturn31view2  
This is a *qualitative* shift compared with the pre‑PeerDAS world, where every consensus node downloaded all blob data and no dedicated “supernode” role was required for reconstruction. citeturn5view0turn31view2  

**Observed incidents (evidence base).**  
The protocol documents and network‑upgrade announcements used here do not enumerate a specific “mainnet blob unavailability incident” through Feb 12, 2026; instead, the protocol focus has been proactive: staged throughput increases (BPO1/BPO2) and explicit monitoring expectations as capacity ramps. citeturn8search0turn10view0turn31view2  
A rigorous incident catalogue would require an operational dataset (client telemetry, custody monitoring dashboards, etc.), which is outside what core specs alone provide. citeturn31view2turn30view1  

## Economics of DA

### Fee market structure for data publishing

**Blob gas is priced separately from execution gas, with its own base fee mechanism.**  
EIP‑4844 introduces “blob gas” as a new type of gas with an independent targeting rule similar to EIP‑1559, using `excess_blob_gas` to compute a dynamic `base_fee_per_blob_gas`. citeturn32view1turn32view2

**Blob fees are burned.**  
EIP‑4844 is explicit: the blob fee computed as `get_total_blob_gas(tx) * get_base_fee_per_blob_gas(header)` is deducted and **burned** (not refunded even if transaction execution fails). citeturn32view2turn33view1

**No separate blob “priority fee” field.**  
Blob transactions include `max_fee_per_blob_gas` but do not introduce a distinct `max_priority_fee_per_blob_gas`. The priority fee concept remains on the execution gas side. citeturn33view1  
So in the strict EIP‑4844 accounting model: blob fees are primarily a *burned* DA payment, while proposer compensation continues to come from execution priority fees and MEV (and, post‑PeerDAS, possibly from equilibrium changes in execution fee dynamics rather than a direct “blob tip”). citeturn33view1turn32view2

### Fee‑market stability and “reserve pricing” (EIP‑7918)

EIP‑7918 addresses a failure mode where blob base fees could collapse to the 1‑wei minimum when execution costs dominate, causing slow fee recovery and spiky resource usage. citeturn10view1turn5view0  
It introduces `BLOB_BASE_COST = 2**13` and ties a **reserve price** for blobs to the execution base fee, effectively ensuring blob consumers pay at least a relevant fraction of execution‑resource market rates and stabilising the blob fee market’s control signal. citeturn10view1turn12view0

### Cost per GB and “cost per GB per year” interpretation

A critical nuance: Ethereum’s blob DA is **explicitly not permanent storage**. Post‑Fusaka, nodes must serve data column sidecars for ~18 days (4096 epochs), not a year. citeturn29view0turn31view0turn5view0  
Therefore:

- **Cost per GB (publishing)** is meaningful: it is the cost to publish rollup data to Ethereum’s DA layer for the protocol retention window.  
- **Cost per GB per year** is *not* a native Ethereum blob concept, because the protocol does not provide year‑long blob retention; achieving “GB/year” would require external archival services or repeated republishing. citeturn5view0turn29view0

That said, a publish‑cost model can be stated cleanly from EIP‑4844:

- Blob size is 128 KiB (131,072 bytes). citeturn5view0turn33view1  
- `GAS_PER_BLOB = 131,072` and blob fee is `GAS_PER_BLOB * base_fee_per_blob_gas` (burned). citeturn32view2turn5view0  

Because `GAS_PER_BLOB` numerically matches bytes per blob, the **blob base fee per blob gas is effectively “wei per byte”** for blob payload, in the base‑fee component. citeturn5view0turn32view2  

From there, a paper can present:
- a **symbolic formula** (preferred for research correctness), and  
- scenario analyses at different observed `base_fee_per_blob_gas` regimes (e.g., low demand vs congestion), with the explicit note that post‑Fusaka the blob target/max schedule (14/21) affects congestion dynamics and fee responsiveness. citeturn8search0turn12view0turn32view2  

### Who gets paid versus what is burned

- **Burned:** the blob base fee portion (`blob_fee`) is burned per EIP‑4844. citeturn32view2turn33view1  
- **Paid to validators/proposers:** EIP‑4844 does not create a separate blob tip; validators continue to receive execution‑layer priority fees and other proposer/builder revenues. citeturn33view1  
- **Indirect incentives:** bounding blob fees by execution costs (EIP‑7918) also aligns DA usage with the fact that nodes spend compute verifying KZG proofs. citeturn10view1turn33view1  

### Hidden and non‑obvious costs

**Proof computation burden shifted to senders.**  
EIP‑7594 explicitly introduces cell KZG proofs and states that proof computation for a blob is expensive, so blob transaction senders (not block producers) must compute and include these proofs in the blob transaction pool wrapper. citeturn5view1turn33view1  
For rollups, this is a real operational cost: proof generation time, engineering complexity, and potentially the need for specialised libraries/hardware acceleration.

**Verification compute borne by the network.**  
EIP‑7918 justifies a reserve price partly because nodes must verify KZG proofs and this is computationally expensive enough to warrant keeping blob prices tied (at least in part) to execution‑compute market rates. citeturn10view1turn33view1  

**DA is time‑bounded; “archival” is external.**  
If rollups or researchers require blob data beyond the protocol window (~18 days), the cost shifts from protocol fees to external archival infrastructure (which may be decentralised, centralised, or hybrid), and that “GB/year” cost is outside the Ethereum protocol fee market. citeturn29view0turn5view0