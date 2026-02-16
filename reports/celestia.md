# Celestia DA Layer Specification Research Report

## Architectural evolution of Celestia’s DA pipeline

Celestia’s data-availability (DA) design is built around a *data square* that is committed to in the consensus header, and a *separate DA P2P network* (implemented by celestia-node) that serves and samples shares. The key architectural decision that makes Celestia “DA-first” is that the consensus header’s *data hash* commits to an erasure-coded square (rather than a simple Merkle root over transactions), enabling permissionless data availability sampling (DAS). citeturn41view0turn20view0turn13view1

A concise DA-relevant upgrade history (focusing on architectural decisions and protocol surface area) is:

- **Header commitment to an erasure-coded data square (core architectural shift)**  
  Celestia’s fork of entity["organization","CometBFT","tendermint consensus engine"] modifies how `DataHash` is computed: instead of hashing only transactions, it becomes the Merkle root over **row and column roots of the erasure-coded data square**, so the header commits to the square needed for DAS. citeturn41view0turn13view1

- **Lemongrass era: DA-network foundations (pruning and DA messaging direction)**  
  The **Lemongrass upgrade** write-up explicitly calls out DA-side work, including **blob pruning** (CIP-4) and the introduction of *Shwap* as a DA messaging framework direction (CIP-19). citeturn36view0

- **Ginger era: throughput/latency knobs that indirectly change DA operating envelopes**  
  The **Ginger upgrade (celestia-app v3)** made timeouts versioned (CIP-26) and reduced block time from 12s to 6s, increasing the cadence at which data is published and must be propagated/sampled. citeturn35view1turn34view3  
  Ginger also introduced a protocol-enforced transaction size limit (CIP-28), which bounds “single-transaction bursts” that could destabilise propagation. citeturn35view0turn30view1

- **Matcha/v6 era (2025–2026): big DA-operational changes (windows, pruning, propagation)**  
  The Matcha/v6 package is where several DA-operational parameters get redefined:
  - **Trusting period / sampling window to 7 days (CIP-36)**, explicitly tying the light-node sampling window to a 7-day weak-subjectivity/trusting period. citeturn33view0turn43view0  
  - **Minimum pruning window to 7 days + 1 hour (CIP-34)**, reducing minimum retention requirements for DA bridge nodes, with explicit storage-scaling rationale in the CIP text. citeturn44view0turn20view4  
  - **High-throughput block propagation / recovery enabling 128 MiB blocks and square size 512 (CIP-38)** as a protocol-level capability (even if networks ratchet parameters gradually). citeturn30view0turn20view4

- **Current deployed state as of 12 Feb 2026 (Mainnet Beta)**  
  Celestia’s own Mainnet Beta page lists **celestia-app v6.4.10** and **celestia-node v0.28.4**. citeturn26view0  
  On-chain parameter tracking via entity["organization","Celenium","blockchain explorer"] shows Mainnet settings consistent with app v6 defaults: **`blob.gov_max_square_size = 256`** and **`consensus.block_max_bytes = 32 MiB`** (i.e., *the chain is configured for 32 MiB blocks at the consensus max-bytes layer and 256×256 as the governance square-size cap*). citeturn28view0turn27view0turn29view1  
  The app v6 specification also states that **SquareSizeUpperBound = 512 (hard-coded)** and that **`blob.GovMaxSquareSize` is a governance parameter (default 256)**, while **`consensus.block.MaxBytes` is governance-controlled (default 32 MiB)**. citeturn29view1  
  *Important reconciliation note:* the Mainnet Beta docs page contains a “current max square size” sentence that appears inconsistent with the v6 parameter specification and Celenium’s on-chain parameter display. For a specification paper, treat **on-chain parameters + app specs** as authoritative for “current limits”, and treat the doc sentence as likely stale editorial content. citeturn26view0turn29view1turn28view0

## What “DA security” means in Celestia

### Threat model: what can go wrong

At a DA-layer level, the core question is: *after a block header is finalised, can an arbitrary verifier retrieve the data that header commits to?* Celestia’s documentation frames DA as the question “has this block’s data been published and can it be downloaded?” citeturn20view0

The primary DA threat is **data withholding**, where an adversary causes consensus to accept a header that commits to data which is *not sufficiently retrievable* by the network at large. Even when the header is valid cryptographically, withholding can prevent full verification and fraud-proof generation by parties that did not receive the data. This is precisely why Celestia leans on *DAS plus erasure coding*. citeturn20view0turn37view0

### Who can withhold data in Celestia’s model

In Celestia’s architecture, the most relevant withholding-capable actors are:

- **The block proposer / block producer** (because the proposer assembles available data into shares and produces the commitments committed in the header). Celestia’s specs state that the header commits to the DA commitments, and the DA commitments are commitments to the erasure-coded data. citeturn14view0turn13view1turn20view0  
- **A coalition of validators / consensus nodes** who may receive the block data to vote, yet choose not to serve or rebroadcast it broadly. Celestia uses stake-weighted BFT finality (2/3 precommit threshold), so a coalition that can reach 2/3 can finalise headers. citeturn14view0turn15view3  
- **Network-level adversaries** (eclipse / selective connectivity) that prevent light clients from reaching honest peers or force sampling queries through malicious relays. Celestia’s DA protocol work (e.g., Shwap) explicitly references assumptions about “1/N honest peers connected possessing the data” and aims to reduce round trips and protocol weaknesses to make sampling practical at scale. citeturn45view0  

Celestia does **not** rely on a permissioned committee/DAC for DA (committees are described in the Celestia glossary as a distinct concept, but Celestia’s DA network is designed to be permissionless). citeturn18search10turn20view0

### Honest threshold and what it means for DA guarantees

Celestia combines:

- **Deterministic consensus safety** requirements (Tendermint/CometBFT-style BFT safety requires < 1/3 Byzantine voting power), and  
- **Probabilistic DA detection** via sampling.

On the DA side, the classic framing from the underlying fraud/DA proof literature is that fraud proofs can remove the “honest majority” *validity* assumption if there is **at least one honest full node** to generate/propagate fraud proofs; but DA assurance requires that data is recoverable/available—hence probabilistic sampling and erasure coding. citeturn37view0turn15view1turn20view0

Celestia’s own docs describe the operational assumption as: light nodes query for random shares + proofs; if they get valid responses for all samples, then “there is a high probability guarantee” the whole block data is available. citeturn20view0  
Additionally, the docs state that sampled shares are gossiped, and that if light nodes “sample together enough data shares (i.e., at least k×k unique shares), the full block can be recovered by honest bridge nodes.” citeturn20view0

That gives two “honesty” lenses you can use in a spec:

- **Detection lens (per-light-client):** at least one honest, non-eclipsed light client performing adequate random sampling will—with high probability—detect withholding that removes a non-trivial fraction of the square (see sampling discussion below). citeturn20view0turn39search5  
- **Recovery lens (system-wide):** at least one honest participant (often a bridge/full node) must be able to *collect enough shares* from the network to reconstruct, and the network should allow sampled shares to diffuse. citeturn20view0turn45view0

### Safety vs liveness under withholding

Celestia’s consensus layer finalises blocks with a **2/3 voting power commit**, giving “single-slot” style finality once a block is committed, under standard BFT assumptions. citeturn14view0turn15view3

Under **withholding aimed at validators**, the most direct effect is **liveness degradation**: if enough voting power cannot obtain/validate the block data needed to validate the header commitments, they will not precommit, and the chain can stall until a valid proposal propagates. Celestia’s consensus rules describe that the header and available-data commitments must be verified, and the block’s available data must parse and match commitments for the block to be valid. citeturn14view0turn15view1turn13view1

Under **withholding aimed at non-validators (light clients / external verifiers)**, the chain can still finalise (because the committing set had the data), but external actors may fail DAS and treat the chain as unsafe for their purposes. Celestia’s docs explicitly tie DA failure to stalling/exploitation risk, motivating why light verification includes DA checks. citeturn20view0turn40search4

### Slashing / accountability for withholding

Celestia has **strong accountability for equivocation** in CometBFT-like consensus (e.g., fork/equivocation evidence conditions and standard PoS slashing), but **data withholding is not straightforward to slash** because it is classically hard to *prove a negative* (“this data was not available to the network”). The core fraud/DA proof literature positions DA as probabilistic and relies on reconstruction and honest rebroadcast assumptions rather than “cryptographic non-availability proofs.” citeturn37view0turn20view0

What Celestia *can* prove and penalise more directly is **incorrect erasure coding / bad commitments** via fraud proofs: Celestia’s specs explicitly include **Bad Encoding Fraud Proofs (BEFPs)** so light clients can verify that parity data was encoded correctly, and consensus nodes must verify correctness before accepting blocks. citeturn15view1turn15view0turn13view1

## DA mechanism and cryptographic structure

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["Celestia data availability sampling 2D Reed-Solomon encoding diagram","Namespaced Merkle Tree Celestia diagram","Celestia data square row roots column roots availableDataRoot diagram"],"num_per_query":1}

### Commitments in the header

Celestia commits to DA via:

- **Row and column roots over a 2k×2k extended data square**, where each row/column is committed via a **Namespaced Merkle Tree (NMT)** (the specs describe computing an NMT per row/column and then compacting to a hash digest). citeturn13view1turn20view0  
- A final **Merkle root over the sequence of row roots followed by column roots**, producing `availableDataRoot` (Celestia’s “data root” in the header). citeturn13view1turn14view0turn41view0

This is explicitly *not* a polynomial commitment scheme like KZG; it is a Merkle/NMT-based commitment structure. citeturn13view1turn41view0

### Namespaced Merkle Trees and why they matter

An NMT is a Merkle tree where internal nodes are tagged with the min/max namespace of their children, and leaves are ordered by namespace. This allows proofs that a namespace’s data is included (and, importantly, proofs that *all* items for a namespace are present in a range), which is what makes “download only my rollup’s data” viable. citeturn13view0turn40search4turn20view0

### Share structure and sizing

Celestia splits available data into fixed-size **shares** (the atomic units of the data square). citeturn13view0turn13view1  
Protocol constants specify:

- **`SHARE_SIZE = 512 bytes`** citeturn14view0  
- **`NAMESPACE_SIZE = 29 bytes`** (1 byte namespace version + 28 byte namespace ID) citeturn14view0turn13view0  
- **1 byte share “info”** and **4 bytes sequence length on the first share in a sequence**, leaving **478 bytes payload in the first share** and **482 bytes in subsequent shares** for blob data—values that the blob submission docs call out explicitly for maximum blob sizing calculations. citeturn13view0turn14view0turn25view0

### Erasure coding scheme

Celestia uses **2D Reed–Solomon encoding**:

- Original data is arranged into a **k×k** matrix (`Q0`) and extended into a **2k×2k** matrix by computing parity shares across rows and columns (`Q1–Q3`). citeturn13view1turn20view0  
- The header stores **2k row roots and 2k column roots**. citeturn13view1turn14view0

This structure is what makes DAS viable: random sampling in the extended square yields strong detection probability if a significant fraction of shares is withheld. citeturn20view0turn37view0

### Sampling model and confidence targets

At the documentation level, Celestia defines DAS as:

1) choose random coordinates in the extended data square,  
2) query for the share + an inclusion proof against the row/column commitment, and  
3) accept availability with “high probability” if all samples verify. citeturn20view0

Some concrete sampling-confidence intuition (useful for a spec paper) appears in celestia-node’s historical design discussions: **16 samples ≈ 1/100 failure rate; 32 ≈ 1/10,000; 64 ≈ 1/100,000,000; 100 ≈ 1 in ~3 trillion** (as a rough, model-dependent back-of-envelope). citeturn39search5

For “current default sample counts” in 2026, the *protocol* does not hardcode a single universal number in the same way it hardcodes share size; rather, sampling is implemented by node software and is configurable/iterated alongside DA-network protocol improvements (e.g., Shwap is motivated by removing `log₂(k)` round trips for sampling). citeturn45view0turn20view0  
In a specification paper, it is therefore useful to specify:
- the **security target** (maximum acceptable probability of false availability), and  
- the **operational constraints** (round trips, bandwidth),  
then map those to concrete sample counts per client implementation and network size assumptions. citeturn45view0turn39search5

### Retrieval protocol and who serves the data

Celestia’s docs describe retrieval as **P2P queries against bridge nodes**:

- Light nodes query **bridge nodes** for shares + Merkle proofs at chosen coordinates. citeturn20view0turn19search0  
- celestia-node’s own repository describes bridge nodes as relaying blocks from the consensus network into the DA network, and light nodes as verifying availability by sampling the DA network. citeturn40search1turn19search2

Over time, DA P2P protocol decisions evolved:

- Early DA networking adopted Bitswap/IPLD scaffolding, but before launch Celestia moved block sync to **ShrEx** and leveraged CAR/DAGStore-based storage for block sync and namespace retrieval. citeturn45view0  
- **Shwap (CIP-19)** is a later effort to standardise message formats and reduce sampling round trips (from `log₂(k)` to O(1) request/response patterns for grouped share containers). citeturn45view0

For historical and older data, Celestia’s docs are explicit that DA ≠ permanent storage: data older than the recency window may be pruned by default on light nodes, and “archival nodes (or providers)” are expected to keep older data retrievable. citeturn43view0turn20view0

## Capacity, overhead, and scalability knobs

### Current mainnet limits and the knobs that control them

As of app v6:

- **SquareSizeUpperBound = 512 (hardcoded)** caps the maximum k for the original data square at 512. citeturn29view1turn30view0  
- **`blob.GovMaxSquareSize` is governance-controlled** and defaults to 256 in v6 specs. citeturn29view1  
- **`consensus.block.MaxBytes` is governance-controlled** and defaults to **32 MiB** in v6 specs. citeturn29view1turn28view0  
- **`MaxTxSize = 8 MiB`** (hard limit per transaction in v6). citeturn29view1turn25view0turn30view0

On Mainnet, parameter tracking shows **`gov_max_square_size = 256`** and **`block_max_bytes = 32 MiB`**, consistent with the default v6 parameter set and with the on-chain parameter-change proposal record. citeturn28view0turn27view0turn29view1

### Raw vs effective payload per block (and why it differs)

Let:
- `k` = original square size (shares per side),  
- share size = 512 bytes,  
- blob payload per share ≈ 478 bytes for the first share, 482 bytes for subsequent shares. citeturn14view0turn25view0turn13view0

Then *raw* data capacity in the original data square (ignoring reserved namespaces and non-blob shares) is:

- **Raw bytes per block (original square):** `k² × 512`. citeturn14view0turn13view1

For **Mainnet’s governance setting `k = 256`**:

- Raw original-square bytes: `256² × 512 = 33,554,432 bytes` (≈ 32 MiB). citeturn14view0turn29view1turn28view0

But the *effective blob payload* is lower, because each share includes namespace+metadata overhead. A useful upper-bound style approximation (mirroring Celestia’s own @512×512 estimate approach) is:

- Reserve at least one share for the PayForBlobs (PFB) share, then:
  - payload ≈ `478 + (k² − 2) × 482` bytes (first blob share uses 478; remaining blob shares use 482). citeturn26view0turn25view0turn13view0

Celestia’s docs explicitly run this kind of calculation for a 512×512 square (Arabica example), yielding ~126.35 MB of blob bytes under those assumptions. citeturn26view0turn25view0

### Redundancy factor and “network bytes per 1 published byte”

The erasure-coded extended data square is **2k×2k**, with the original data `Q0` occupying **k×k**. That implies a **4× expansion in share count** between the original and extended square. citeturn13view1turn20view0

How that translates to “network bytes per published byte” depends on *what the network replicates*:

- **Consensus-node replication:** historically Celestia “fully replicated” blocks across validators; CIP-38’s rationale explicitly contrasts this with a new propagation/recovery mechanism designed for much larger blocks. citeturn30view0turn20view4  
- **DA-network storage/serving:** Shwap explicitly describes containers that may store *only the original portion* and compute redundant halves on demand, which can reduce stored redundancy even though the commitments are to the full extended square. citeturn45view0turn13view1  
- **Light-node sampling overhead:** light nodes do not download all data; they download a sample set plus proofs, and their overhead scales with sample count and proof size rather than block size. citeturn20view0turn39search5turn45view0

### What breaks first as you scale?

Empirically, Celestia’s own upgrade track suggests the first bottlenecks are *networking and operator cost*, not cryptography:

- CIP-38 exists specifically because the prior approach “relies on full replication of block data across all validators” and needs a new propagation/recovery mechanism to scale safely to much larger blocks. citeturn30view0turn20view4  
- CIP-34 exists specifically because storage scales quickly at higher throughput: the CIP estimates **~1 TB/day** at “32 MB blocks every 6 seconds,” and uses this to justify reducing the minimum pruning window to keep bridge-node storage feasible. citeturn44view0turn35view1  
- CIP-19 exists because sampling and retrieval protocol efficiency becomes a limiting factor as `k` grows; it explicitly calls out `log₂(k)` round trips per sample as not scalable. citeturn45view0

## Latency and resource costs by role

### The three DA-relevant latencies

**Time-to-availability (for full/bridge nodes)**  
For consensus to accept a block, nodes must be able to parse and validate the `availableData` against the header’s commitments; the consensus specification describes acquiring `availableData` and checking that commitments match. citeturn14view0turn13view1  
CIP-38 focuses exactly on reducing the “data propagation to validators” latency and failure modes by using erasure-coded block parts and pull-based broadcast trees. citeturn30view0turn20view4

**Time-to-confidence (for light clients)**  
Light nodes receive `ExtendedHeaders` and perform sampling. citeturn19search0turn43view0  
The critical latency contributors are:
- number of samples needed for the desired confidence level, and citeturn39search5turn20view0  
- the number of network round trips per sample request pattern (CIP-19’s key motivation is reducing this). citeturn45view0

**Time-to-finality (for the chain)**  
Celestia uses CometBFT/Tendermint-style BFT finality: blocks are final once they have a valid commit (≥2/3 voting power). citeturn14view0turn15view3  
Block-time reductions and versioned timeouts (CIP-26) reduce finality latency in practice; the ecosystem has referenced ~5 seconds per block in mainnet-era parameter discussions. citeturn34view3turn24search2turn20view4

A DA-layer nuance to highlight in a spec paper is that **consensus finality is not identical to “global data retrievability finality”**: the chain can finalise a header when the committing set had the data, while some external verifiers may still fail to retrieve the corresponding shares if data was not sufficiently served into the DA network they can reach. citeturn20view0turn37view0

### Operational roles and their dominant resource costs

**Validator / consensus node (celestia-app + celestia-core)**  
Validators must receive and validate blocks and their DA commitments; the consensus rules require checking the header, DA header, then parsing and validating `availableData` against commitments. citeturn14view0turn13view1turn15view1  
Key cost drivers at high throughput:
- **Bandwidth:** roughly proportional to block size × block rate; CIP-38 is specifically designed to change the propagation regime for larger blocks. citeturn30view0turn35view1  
- **CPU:** reconstructing/validating the data square and encoding correctness (BEFP enforcement implies the square must be consistent with commitments). citeturn15view1turn13view1  
- **Storage:** consensus nodes store chain history; evidence windows and pruning settings affect how long data must remain available for accountability. citeturn34view1turn29view1turn28view0

**Bridge node (celestia-node)**  
Bridge nodes bridge blocks between consensus and the DA network. citeturn19search2turn40search1turn20view0  
Their dominant costs are:
- **Storage & retention:** governed by **MinimumPruningWindow**; CIP-34 sets the minimum to **169 hours (7 days + 1 hour)** and explicitly motivates this in terms of terabytes retained at high throughput. citeturn44view0turn20view4  
- **Serving load / bandwidth egress:** bridge nodes are queried by light nodes for samples and by other nodes for retrieval; the docs describe light nodes querying bridge nodes for shares + proofs. citeturn20view0turn43view0

**Light node**  
As of celestia-app v6, Celestia’s docs say celestia-node implements a **7-day sampling window** (per CIP-36), and that data older than the recency window is pruned by default on light nodes. citeturn43view0turn33view0  
Key costs:
- **Bandwidth:** sampling traffic per new header, plus initial “catch-up” sampling when a node is behind. citeturn33view0turn20view0turn39search5  
- **Storage:** reduced via *header pruning* (CIP-35) and by retaining only a sampling window; CIP-35’s goal is to avoid storing all historical extended headers. citeturn44view1turn43view0

**Archival nodes / providers**  
Celestia docs explicitly state DA layers do not guarantee indefinite historical retrievability, and that rollups should not rely solely on free archival nodes; instead, rollups should store their own historical data and/or use professional archival providers. citeturn43view0turn20view0  
The Mainnet Beta docs even list production providers such as entity["company","QuickNode","rpc provider"] and entity["company","Grove","rpc provider"] for production endpoints, reinforcing a “paid infrastructure for stronger retrievability guarantees” operating model. citeturn26view0turn43view0

## Robustness, failure behaviour, and economics

### Failure behaviour and fallbacks

**Missing peers / partial outages**  
At a protocol level, light nodes can query multiple peers (bridge/full/archival) for shares; the system is designed so availability is inferred from successful sampling responses and proofs. citeturn20view0turn43view0  
Where peer availability is poor, latency to reach sampling confidence becomes dominated by P2P responsiveness and protocol round trips—exactly what Shwap (CIP-19) targets by standardising messages and grouping share requests. citeturn45view0

**Fallback modes**  
Celestia does not describe a committee→P2P fallback (it is P2P-first), but it does have *engineering fallbacks* in its propagation layer: CIP-38 states that during the upgrade, nodes run both old and new propagation reactors, and if needed they can coordinate switching back. citeturn30view0turn20view4

**Observed network incidents / abnormal propagation signals**  
Public status postings show routine upgrade maintenance on mainnet (e.g., celestia-app v6.4.10 upgrade) and testnet upgrade coordination (Mocha upgrade to app version 6 at a specific height). citeturn23view0turn23view1  
Separately, protocol documents provide evidence of historically suboptimal behaviour that motivated upgrades:
- CIP-19 describes how earlier DAS networking required `log₂(k)` round trips and notes that block sync could be slower than block production, motivating protocol redesigns (ShrEx adoption, CAR/DAGStore optimisations, then Shwap). citeturn45view0turn36view0  
- CIP-34 frames pruning-window changes as necessary for feasible operation at higher throughput (implying that without pruning, storage cost becomes a practical liveness/participation risk). citeturn44view0turn20view4

### Fee market and cost model for DA publishing

Celestia’s blob publication is paid via gas, with a large part of the gas consumption linear in blob bytes:

- The blob submission docs state that PFB gas has a fixed cost component (~65,000 gas) and a dynamic component based on blob size, calculated via shares-needed × share-size × `gasPerByte`, plus a per-blob static amount. citeturn20view1turn25view0  
- In app v6 parameters, **`blob.GasPerBlobByte = 8`** (listed as not governance-changeable in the v6 parameter table). citeturn29view1turn28view0  
- The network uses a standard prioritised mempool where higher gas-price transactions are prioritised; importantly, the blob submission docs note that (historically, at least as of v1.0.0) there was not an Ethereum EIP-1559-style base fee, and that unused gas is not refunded (so overestimating gas can overpay). citeturn20view1turn25view0  
- Lemongrass-era “price enforcement” work exists to enforce minimum gas price (spam resistance); app v6 parameters include **`minfee.NetworkMinGasPrice`**, indicating a consensus-enforced minimum. citeturn36view0turn29view1

#### Cost per GB and “cost per GB-year” caveat

**On-chain publication cost per GB (conceptual):**  
Because cost is linear in bytes (via `GasPerBlobByte`), you can express marginal cost as:

- `gas ≈ GasPerBlobByte × bytes × gasPrice` (plus fixed overhead per transaction). citeturn20view1turn29view1

However, **Celestia cannot put 1 GB into a single transaction** because app v6 enforces **`MaxTxSize = 8 MiB`**. citeturn29view1turn25view0  
So “per GB” is inherently “per GB published over many transactions/blocks,” and actual cost depends on prevailing gas prices and congestion.

**“Cost per GB-year” is not a native DA-layer guarantee in Celestia.**  
Celestia’s own docs stress that DA layers “do not inherently guarantee that historical data will be permanently stored”, and that older data may be pruned by default on light nodes, with archival retrievability depending on archival nodes/providers. citeturn43view0turn20view0  
Therefore, a specification paper should separate:

- **(A) publication cost** (on-chain fees to post bytes), from  
- **(B) retrievability/storage cost** (running or buying archival services to keep data available for a year).

CIP-34 provides an anchor for storage-cost reasoning at scale: at the (illustrative) throughput of “32 MB blocks every 6 seconds”, it estimates up to **~30 TB** for a 30-day window and **~7 TB** for a 7-day window, showing how quickly “GB-year of retrievability” turns into real operator spend at high throughput. citeturn44view0turn20view4

### Who gets paid vs what is burned

From the v6 parameter tables, Celestia clearly routes **a community tax of 2%** (of inflation) to the community pool and defines proposer reward parameters (set to zero in the shown defaults), but the fee split specifics (validators vs burning) are not described in the excerpts used for this report and should be verified against the live chain configuration and the relevant Cosmos SDK fee-collection flow used by Celestia. citeturn29view1turn28view0

### Hidden costs for rollups and users

Celestia’s docs explicitly enumerate “non-obvious” operational costs that are easy to miss in a DA-only cost model:

- **Historical sync costs**: rollups may need historical data to sync new rollup nodes; Celestia recommends rollups store their own historical data, use archival providers, produce snapshots, or implement their own P2P historical sync. citeturn43view0  
- **DA-network infrastructure costs**: if rollups depend on reliable historic retrieval, they may pay for archival endpoints/providers. citeturn43view0turn26view0  
- **Cross-chain settlement/bridging costs**: if a rollup posts data to Celestia but settles elsewhere (e.g., entity["organization","Ethereum","smart contract blockchain"]), then settlement-layer posting/verification costs (gas, proof systems like Blobstream variants) sit outside Celestia’s DA fee model and must be included for end-to-end economics. Celestia’s architecture/upgrade notes explicitly discuss Blobstream evolution and its removal from consensus as part of simplifying the base layer. citeturn36view0turn43view0

### Near-term trajectory beyond the current state

The latest celestia-app release stream includes a **v7.0.0 release candidate** described as “not intended for deployment,” and intended for downstream consumers to prepare for v7, with v7 containing the CIPs listed in “CIP-047.” citeturn22search4  
For a “current-state” DA spec (as of Feb 2026), the safe framing is:
- **Mainnet runs v6.x** (e.g., v6.4.10 per docs/status), with **governance-configured square/byte limits**; citeturn26view0turn23view0  
- **v7 is in preparation**, and any DA changes in v7 must be treated as *planned* until activated on mainnet. citeturn22search4turn33view5