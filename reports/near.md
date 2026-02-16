# Data Availability in NEAR: Security Model, Mechanisms, Performance and Economics

## Evolution of NEAR DA design from Nightshade to NEAR DA

The earliest widely-circulated sharding design for the network is the **Nightshade** paper (July 2019), which explicitly treats **data availability (DA)** as a first-class sharding requirement alongside state validity. citeturn33view0 That document proposes a *beacon-chain-style* main chain containing per-shard “chunks” (or “zero chunks” if a shard skips) and then focuses on *how to ensure chunk data is available to block producers and validators* even when not all participants store full shard data. citeturn34view0turn34view3

Nightshade’s **original DA approach (2019)** has the following identifying design features:

- **Erasure-coded chunk distribution**: after producing a chunk, the producer erasure-codes it into parts, commits to the parts with a Merkle root inside the chunk header, and distributes parts (via “onepart messages”). citeturn34view3turn34view2  
- **Gatekeeping block processing on DA evidence**: a block producer “doesn’t process” a main-chain block until it has the necessary onepart messages and can reconstruct chunks for shards whose state it maintains. citeturn34view3  
- **A DA liveness threshold framed around block-producer honesty**: “for a particular chunk to be available it is enough that ⌊w/6⌋+1 of the block producers have their parts and serve them,” and the paper states that with at most ⌊w/3⌋ malicious actors, a chain with >½ block producers extending it should not have unavailable chunks. citeturn34view0turn34view2  
- **A “lazy signer” accountability mechanism**: it is “impossible to prove later that the block producer didn’t have the onepart message,” so the paper proposes a red/blue per-part colouring and a slashable “incorrect bitmask” rule whose deterrence relies on a 50% chance of slashing if a producer signs “blindly” without knowing missing-part colours. citeturn34view0turn34view4turn34view5  

Between that early design and the 2025–2026 documentation for the reference client (“neard”), the network’s DA story becomes more implementation-specific and is described in **Nomicon** (the nearcore development/spec guide). In 2025–2026 nearcore documentation, a fully-synced node is described as (typically) tracking all shards on mainnet “today,” and it requests and reconstructs missing chunks using “chunk parts.” citeturn29view0 The block-processing rules likewise require that **all chunk parts are received** (or reconstructed) before block processing proceeds. citeturn29view1

A second, distinct thread is the (by 2026) explicitly productised **“Rollup Data Availability”** initiative, which aims to modularise DA for external rollups by providing a blob store contract, a DA-oriented light client, and RPC tooling. citeturn35view0turn35view2 This “NEAR DA” design intentionally avoids storing blob payloads in long-lived chain state (to reduce storage-staking cost) and instead relies on consensus over **receipts / function input data** with limited retention on non-archival nodes. citeturn35view0turn35view1

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["NEAR Nightshade sharding diagram chunk and block producers","NEAR Protocol chunk distribution onepart messages diagram","NEAR rollup data availability diagram blob store contract light client","NEAR sharding architecture Nightshade diagram"],"num_per_query":1}

## What “DA security” means for NEAR

### Threat model: what can go wrong and who can withhold data?

In this domain, “DA security” is best treated as the property that **once consensus has accepted some transaction/receipt payload as part of the canonical history, honest participants can still retrieve the underlying data** (not just its commitment) within the time horizon required to verify state transitions, serve clients, and support external verification (for example, a rollup bridge verifying blob inclusion). This is implicit in both the Nightshade sharding document and the 2026 Rollup DA documents, which treat DA as enabling verification rather than merely indexing. citeturn34view3turn35view1

There are two “withholding surfaces” depending on whether you are analysing **in-protocol shard/chunk DA** or **rollup blob DA**:

- **Shard/chunk DA (core protocol path)**  
  The actors with the most direct ability to reduce availability are:  
  - a **chunk producer** (it creates the chunk and the erasure-coded parts), and can fail to distribute parts or distribute them selectively; citeturn34view3turn29view1  
  - any parties expected to **hold and serve chunk parts** (in the 2019 design, block producers; in the 2025–2026 nearcore description, validators can have parts via “chunk parts forwarding,” and nodes reconstruct chunks by requesting parts from peers). citeturn34view3turn29view0  

- **Rollup blob DA (NEAR DA product path)**  
  The actors with the most direct ability to reduce availability shift to:  
  - the **RPC serving path** (since rollups submit via an RPC flow), and  
  - the set of nodes that will retain and serve function input data until pruning, plus archival/indexing infrastructure after pruning. citeturn35view0turn35view1  

Importantly, the Rollup DA document makes retention limits part of the security envelope: it states receipts can be pruned after “at least 3” epochs (each ~12 hours) and “in practice” around five epochs, and thereafter “it is the responsibility of archival nodes” (and indexers) to retain transaction data. citeturn35view1turn6view1 This means rollup DA is explicitly **time-bounded on non-archival nodes**, making “withholding” potentially as simple as *not fetching within the window* if the attacker can prevent access until pruning.

### Honest threshold: what assumption produces a DA guarantee?

**Nightshade (2019 threat model).**  
The 2019 Nightshade text presents a DA threshold framed around the number of block producers who hold parts: availability if ⌊w/6⌋+1 of them serve parts, and security (no unavailable chunks on the canonical chain) for chains extended by >½ of producers as long as malicious actors ≤ ⌊w/3⌋. citeturn34view0turn34view2

**Nearcore (2025–2026 operational model).**  
The nearcore operational documentation shifts the emphasis from “w/6” to a concrete reconstruction threshold: “for each chunk, 1/3 of all the parts (100) is sufficient to reconstruct a chunk.” citeturn29view0 Operationally, that implies: if the erasure code is an MDS-style “any k-of-n reconstruct” code (consistent with later documents referencing Reed–Solomon as an intended component), then the DA guarantee is roughly **≥ 1/3 of part-holders being reachable and cooperative**. citeturn35view2turn29view0

**Rollup DA (2026 doc model).**  
The Rollup DA document does not specify a formal “n-of-m” threshold; instead, it asserts that function input data is stored by full nodes “for at least three days,” after which archival nodes (and indexers) can provide longer retention. citeturn35view1turn6view1 The honest threshold is therefore qualitatively: at least one honest and reachable replication path must exist *within the pruning horizon*, and longer-term guarantees are explicitly delegated to archival/indexing infrastructure rather than consensus.

### Safety vs liveness under withholding

At the **node level**, nearcore documentation describes that if a node does not have all chunks it needs, it requests chunk parts and waits to reconstruct; meanwhile, newer blocks can accumulate in an “OrphanPool” waiting for missing data. citeturn29view0 This is a classic symptom of DA dependence: consensus might continue, but individual nodes can be unable to fully execute/validate until data arrives.

At the **protocol performance level**, the gas-parameter documentation describes a liveness-oriented fallback: if chunk production is slow, it delays block production and reduces throughput; if a chunk is “really late,” the block producer may omit it and “insert an empty chunk,” potentially including the delayed chunk in the next block. citeturn32view0turn29view1 This indicates the system prefers **global liveness** (keep producing blocks) over waiting indefinitely for a slow chunk, at the cost of delaying that shard’s throughput.

For **rollup blob DA**, the document’s stated pruning window implies a different “liveness” trade: the chain can finalise a blob submission (as a receipt) but the **retrievability window** is bounded unless you rely on archival systems. citeturn35view1 From a rollup perspective, the DA failure mode is therefore not “chain halts,” but “data can become unavailable after pruning unless fetched/replicated.”

### Slashing and accountability: can withholding be proven and penalised?

Nightshade (2019) is explicit that “there’s no risk for the block producer since it is impossible to prove later that the block producer didn’t have the onepart message,” and it proposes a probabilistic deterrent (red/blue part colouring + slashable incorrect bitmask) to make blind signing risky. citeturn34view0turn34view4

In contrast, the current canonical data-structure specification in Nomicon includes “Challenges, but they are not used today,” signalling that challenge-driven accountability (at least as represented in that block structure) is not active in the “today” state captured by the spec. citeturn40view0 Relatedly, operational validator guidance distinguishes between (a) being offline—where validators may be removed from the active set without necessarily being slashed—and (b) detected malicious behaviour—where slashing burns stake. citeturn24search0turn24search1

For rollup DA, the 2026 documentation explicitly describes *interactive* “Fisherman” monitoring as an example “in the initial stage of DA,” until a more non-interactive proof method such as KZG is implemented. citeturn35view0turn35view1 This suggests that, at least in the described architecture, some DA/security guarantees for rollups may initially depend on **active watchers** rather than purely non-interactive cryptographic enforcement.

## DA mechanisms and cryptographic commitments

### What is committed in headers?

In the **core protocol block format**, the block header contains Merkle roots over chunk-level aggregates, including:

- `chunk_receipts_root`, `chunk_headers_root`, and `chunk_tx_root` in the block header “inner rest.” citeturn40view0  
- per-block “challenges_root” (even if challenges are not used today). citeturn40view0  

In the **chunk header**, the `ShardChunkHeaderInner` explicitly includes:

- `encoded_merkle_root` (a `CryptoHash`) and `encoded_length` (u64). citeturn40view0  

This is a concrete signal that the network commits to an **encoded representation** of the chunk (via a Merkle root), not only to the decoded transaction list. It is also reflected in the chunk-hash calculation, which includes `encoded_merkle_root`. citeturn40view0

Nightshade (2019) describes this in conceptual terms: the chunk producer computes a Merkle tree of erasure-coded parts and “the header of each chunk contains the merkle root of such tree.” citeturn34view3turn34view2

For **rollup blob DA**, the commitment model described in 2026 is separate from chunk commitments: the blob store system creates a Merkle tree where leaves are SHA-256 hashes of 256-byte blob chunks, and the “root of the Merkle tree is the blob commitment,” which is posted (as `[transaction_id ++ commitment]`, 64 bytes) to an L1 verification contract. citeturn35view1

### Erasure coding scheme and reconstruction threshold

Nightshade’s 2019 construction uses an “optimal (w, ⌊w/6⌋+1) block code,” distributing one part to each block producer, and derives availability from at least ⌊w/6⌋+1 part-holders serving parts. citeturn34view3turn34view2

Nearcore’s 2025–2026 operational description provides a different, more implementation-grounded threshold: “1/3 of all the parts (100) is sufficient to reconstruct a chunk,” and nodes that do not have full chunks request them “by parts.” citeturn29view0 The Rollup DA document also points to **Reed–Solomon erasure coding** as part of the DA-enabled light client feature set (alongside KZG and storage connectors), suggesting an MDS-style coding approach is in-scope for DA tooling even if the document does not pin down exact matrix/parameters. citeturn35view2

Taken together, the best supported “current-state” claim is:

- **Core protocol DA** uses a chunk encoding committed by `encoded_merkle_root` and supports chunk reconstruction from a fraction of “parts,” operationally described as **1/3**. citeturn40view0turn29view0  
- **Rollup DA** today is described more as receipt-based availability with future upgrades (RS/KZG) surfaced in light-client tooling, not as a fully specified on-chain DAS scheme. citeturn35view1turn35view2  

### Sampling model (DAS) and escalation

No publicly exposed parameter schedule for **data availability sampling (DAS)** (sample counts, confidence targets, escalation rules) is described in the cited nearcore/Nomicon materials or the 2026 Rollup DA page. citeturn35view2turn29view0 Instead, the Rollup DA page frames the near-term approach as: verify inclusion (Merkle inclusion proofs for tx/receipt), then retrieve blob data from ecosystem actors, and (optionally) rely on a “Fisherman” pattern until more non-interactive proofs are implemented (e.g., KZG). citeturn35view1turn35view2

### Retrieval protocol and who serves data

For **core protocol chunk data**, nearcore describes a peer-to-peer retrieval loop:

- nodes request missing data “from peers by parts,”  
- reconstruct once enough parts arrive, and  
- re-send part requests if not answered within `chunk_request_retry_period` (400ms default). citeturn29view0  

For **rollup blob data**, the 2026 doc describes a layered serving model:

- an RPC path for blob submission,  
- full nodes storing the function input data for “at least three days,”  
- then reliance on archival nodes (and/or indexers) after pruning. citeturn35view1turn35view2  

## Capacity, overhead and latency

### Throughput and “max data per block/slot”

Two separate capacity regimes matter:

**Core protocol execution capacity is gas-bounded.**  
Nearcore documentation frames gas as enforcing a “strict schedule of 1 second execution time” for chunk production. citeturn32view0 It defines 10^15 gas as executable in ~1s on minimum hardware, and uses 1 Tgas = 10^12 gas as a conversational unit (≈1ms). citeturn32view0 The gas lifecycle documentation also states that the gas attached to function calls is capped by `max_total_prepaid_gas`, “300 Tgas since the mainnet launch,” with related limits evolving across protocol versions. citeturn39view0

**Rollup DA payload capacity is byte-bounded (as described).**  
The 2026 Rollup DA page claims “each 4MB allocated equals precisely 4MB of usable data,” and frames this as “substantial block space per shard.” citeturn35view0turn35view1 Separately, smart contract guidance stresses an application-level practical constraint: “There is a 4mb limit on how much you can upload at once,” tied to max gas constraints. citeturn25search4turn39view0

Because the Rollup DA design stores blob payloads as function input rather than long-lived state, “max data per slot” for DA blobs is primarily constrained by (a) the per-call upload limit and (b) the per-shard blockspace allocation and congestion dynamics described above, rather than by an explicit “blob field” analogous to some modular DA chains. citeturn35view1turn25search4

### Redundancy factor and network overhead

The redundancy factor depends on which DA path you mean:

- **Nightshade 2019 design factor**: an (w, ⌊w/6⌋+1) code implies an approximately ~6× expansion for large w (since w / (w/6) ≈ 6), with additional Merkle-proof and message overhead in “onepart messages.” citeturn34view3turn34view2  
- **Nearcore 2025–2026 operational factor**: reconstructability from “1/3 of all the parts” suggests an approximately ~3× erasure-code expansion if the system distributes all n parts and any n/3 reconstruct. citeturn29view0turn35view2  

For rollup blob DA as described in 2026, the system explicitly tries to avoid “unnecessary cryptographic bloat” and uses only a Merkle commitment (plus L1 posting of a 64-byte `[tx_id ++ commitment]`). citeturn35view0turn35view1 The overhead there is therefore dominated by transaction/receipt framing and the commitment computation, not by a mandatory erasure expansion in consensus storage.

### Scalability knobs and what breaks first

**Resharding is the primary “DA capacity knob”** described in nearcore documentation: resharding exists to “keep the shards small so that a node meeting minimum hardware requirements can safely keep up with the network.” citeturn31view0turn32view0 The resharding documentation enumerates shard-layout generations:

- v0: single shard,  
- “simple nightshade”: 4 shards,  
- “simple nightshade v2”: 5 shards, and it notes that mainnet/testnet used a fixed shard split at the time of writing. citeturn31view0

The same document states shard layout changes occur at epoch boundaries and must be manually configured per protocol version in `AllEpochConfig`, indicating that scaling via resharding is a **coordinated protocol upgrade path**, not an ad-hoc per-block knob. citeturn31view0

At the performance “breaking point,” the gas-parameter spec is explicit: if execution runs slow, chunk production delays block production; if it is “really late,” block producers may insert empty chunks. citeturn32view0 This suggests the first failure mode under load is **latency/throughput degradation and shard skipping**, not immediate safety failure.

### The three latencies

**Time-to-availability for full nodes.**  
Nearcore’s “How neard works” describes that a node checks whether it has all chunks; if not, it “will request them from peers by parts,” and it retries part requests after `chunk_request_retry_period` (400ms). citeturn29view0 In this model, availability is gated by: (a) the presence of reachable peers with parts and (b) the ability to obtain ≥1/3 parts to reconstruct. citeturn29view0

**Time-to-confidence for light clients.**  
The Rollup DA documentation positions the light client as providing inclusion proofs and future DA features (KZG, Reed–Solomon, storage connectors), but it does not specify a DAS sampling schedule or statistical confidence target. citeturn35view2 Today’s described verification loop is inclusion-proof oriented (tx/receipt inclusion) plus data retrieval from the network within the storage window. citeturn35view2turn35view1

**Time-to-finality.**  
The canonical block header format includes both a “doomslug finality” pointer (`last_ds_final_block`) and “full BFT finality” pointer (`last_final_block`). citeturn40view0 For operational integration guidance, the Integrator FAQ defines deterministic finality as requiring “at least 3 blocks … and (2/3+1) signatures,” and it also mentions a more conservative “120 blocks” notion for “full finality” in the presence of possible shard invalidity challenges. citeturn6view2 With “blocks … every second” as the target cadence, 3-block finality is on the order of ~3 seconds in the idealised case, while the conservative 120-block guideline is on the order of minutes. citeturn6view1turn6view2

A crucial interaction: nearcore block processing requires chunk data/parts before accepting a block (“all the chunk parts are received”), meaning DA is not merely post-finality—it is upstream of the local validation pipeline that produces approvals and canonical head updates. citeturn29view1turn29view0

## Operational roles, resource constraints and failure behaviour

### Roles and who stores what

Validator documentation (2026 site copy) describes a stratified validator set where the “top 100 validators” are responsible for producing/validating blocks and producing chunks, typically assigned to a shard; it separately describes “chunk validators” (non-top-100) that “do not track shards” and focus on chunk validation/endorsement. citeturn24search1 This role separation is directly relevant to DA because it determines *who is expected to hold full shard state vs who may only handle proofs/parts*.

Nearcore operational documentation describes most mainnet nodes as tracking all shards “today,” which (if accurate for the deployment you are analysing) dramatically simplifies DA in practice because more nodes can directly serve full chunk data without relying exclusively on erasure parts. citeturn29view0

### CPU and concurrency constraints

Nearcore’s architecture documentation emphasises that:

- `ClientActor` is single-threaded and contains consensus/block/chunk processing logic. citeturn29view0  
- `ViewClientActor` runs in four threads by default and services read-only requests (including RPC queries and some sync-related network requests). citeturn29view0  
- per-peer networking is handled via per-peer actors/threads. citeturn29view0  

This indicates hard latency sensitivities: single-threaded consensus/execution paths compete with chunk reconstruction and state-application work; under load, this ties directly to the “chunk production delayed → block production delayed” failure mode described in gas parameter docs. citeturn32view0turn29view0

### Storage and retention

Two retention windows are explicit in official docs:

- Nodes “garbage collect blocks after 5 epochs (~2.5 days) unless they are archival nodes.” citeturn6view1  
- For rollup blob DA, receipt pruning is “at least 3” epochs (12 hours each), “in practice … around five epochs,” and afterwards archival nodes and indexers are responsible for longer retention. citeturn35view1turn6view1  

This is central to rollup threat modelling: DA is *not* “forever by consensus” for raw blob payloads; it is “available long enough for consumers to fetch and replicate,” unless you explicitly rely on archival infrastructure. citeturn35view1

### Robustness: missing peers, partial outages, and fallbacks

Nearcore’s chunk retrieval path includes explicit retry logic (re-request after 400ms if a part is not responded to) and the OrphanPool mechanism for blocks arriving while waiting for missing data. citeturn29view0 On the production side, the system can omit very-late chunks (“insert an empty chunk”) to keep the chain producing blocks. citeturn32view0

Node-operations docs (Dec 2025 revision) provide practical failure guidance: a node should normally have “12 to 15 peers,” low peer count correlates with “missing blocks,” and restarting can be a remediation to refresh peers; it also notes missed blocks can occur during protocol upgrades when nodes upgrade late and are “kicked.” citeturn12search1 These operational realities feed into DA: fewer peers means fewer candidate part-holders, increasing retrieval latency and raising the probability of temporary unavailability during partitions.

A concrete example of “incidents adjacent to DA” is visible in nearcore release notes describing “critical flaws in network code” that could cause node crashes and urgent upgrade guidance—while not a DA incident per se, node crashes reduce replication and can worsen availability during high load or targeted attacks. citeturn15search6turn12search7

## Economics of data publication and “cost per GB-year”

### Storage staking (state) vs DA (receipt/input) economics

NEAR’s economic model separates the cost of **holding data in state** from the cost of **executing transactions**:

- Storage staking is set (per docs updated in 2026) to **1e19 yoctoNEAR per byte**, i.e., “100kb per NEAR token.” citeturn25search0  
- Gas fees cover uploading/writing bytes, but “does not cover the cost of holding them in storage (which is 1N ~ 100kb).” citeturn25search10  

From the storage-staking parameter alone, you can derive an approximate *capital lock* per GB of state:

- 1 NEAR per 100 KB ⇒ 1 GB ≈ 10,000 NEAR locked (since 1 GB ≈ 1,000,000 KB). citeturn25search0  

This “cost/GB-year” is therefore not purely a fee; it is a **stake-like opportunity cost** (tokens must remain locked as long as the state remains stored). citeturn25search0turn25search10

### Rollup DA fee surface

The Rollup DA design explicitly tries to avoid long-lived state costs for blobs:

- it states “we don’t store the blob data in the blockchain state,” and instead leverages consensus over receipts, with pruning after a small number of epochs. citeturn35view1  

Therefore, in the described model, rollup blob publishers primarily pay:

1) transaction execution fees (gas) to submit blob input, and  
2) external costs to post/check commitments on the target settlement layer (the document explicitly references submitting `[transaction_id ++ commitment]` to an L1 contract and describes retrieving tx IDs “from Ethereum”). citeturn35view1turn35view2

The document also lists proof-of-concept integrations with major rollup stacks—**entity["organization","Polygon","layer-2 ecosystem"] CDK**, **entity["organization","Optimism","layer-2 ecosystem"] OP stack**, and **entity["organization","Arbitrum","layer-2 ecosystem"] Nitro**—which implies real deployments may have additional “hidden” operational costs (sidecars, proposers, DAC plugins) beyond the base blob submission fee. citeturn35view2

### Fee market dynamics, who gets paid, what is burned

The nearcore gas specification is unusually explicit about fee flows:

- it states gas spent on execution is “burnt and removed from total supply forever,” and “none of it goes to validators.” citeturn39view0  
- it also states a portion of execution fees are paid to the contract owner as “contract reward,” with base fees (e.g., receipt creation fees) burned 100%, and the remainder multiplied by a runtime parameter `burnt_gas_reward` “currently … 30%.” citeturn39view0  

For congestion pricing, the same document states:

- block-level gas price (`gas_price` in the header) changes within a range “between 0.1 NEAR per Pgas and 2 NEAR per Pgas,” and the intuitive rule is: if average usage exceeds 50% capacity, gas price increases “exponentially,” otherwise decreases. citeturn39view0turn6view2  
- it notes all shards share the same gas price and the 50% threshold is computed as an average across shards. citeturn39view0  

This implies rollup blob publishers face a fee market that is **gas-priced and congestion-responsive**, but not necessarily “per-byte base fee” unless the contract’s execution cost scales with input size in a way that maps bytes to gas.

Finally, validator misbehaviour economics: the integrator documentation describes slashing events as burning stake (“The slashed stake is burnt”), while also stating validators are generally not slashed for being offline (they can lose rewards / be removed from the set). citeturn24search0turn24search1 This matters for DA in two ways: (a) it defines the economic deterrent for provable misbehaviour, and (b) it implies DA failures due purely to downtime may be punished more by exclusion than by direct stake burning.

### Summary of “hidden” DA costs

The combined 2019–2026 documentation implies three recurring hidden-cost categories:

- **Retention costs outside consensus**: rollup blobs are pruned from normal full nodes after a small number of epochs and require archival/indexer infrastructure for longer retention. citeturn35view1turn6view1  
- **External verification / settlement costs**: the commitment format includes an L1 posting step and verification that uses transaction IDs from **entity["organization","Ethereum","layer-1 blockchain"]** (as documented). citeturn35view2  
- **Monitoring costs until non-interactive proofs mature**: the Rollup DA documentation explicitly mentions a “Fisherman” pattern as an initial-stage mechanism until non-interactive approaches like KZG are implemented. citeturn35view0turn35view2