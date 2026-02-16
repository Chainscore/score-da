# Deep research on Avail data availability

This report analyses Avail’s data-availability (DA) layer as of **12 Feb 2026**, focusing on: (i) what DA security means under an explicit threat model, (ii) the cryptographic and protocol mechanism used to obtain DA guarantees, (iii) throughput/overhead and scalability levers (including historical upgrades), (iv) latency (availability, confidence, finality), (v) operational constraints by role, (vi) failure behaviour and robustness, and (vii) economics and hidden costs.

Primary sources were prioritised from Avail’s official documentation and blog, supplemented by Avail’s forum and upstream release notes in entity["organization","GitHub","code hosting platform"]. citeturn5search0turn5search1turn13view0turn26search0turn28search4turn0search16turn0search6

## Evolution of Avail DA architecture and upgrades

Avail’s DA design is grounded in the “data availability sampling + erasure coding + polynomial commitments” line of work articulated in early Avail material. In 2021, Avail’s “Data Availability Problem” write-up framed DA as the ability for clients to **detect** when block data is not sufficiently published for reconstruction, using **erasure coding** to amplify the probability that random sampling detects large hidden regions, and using succinct commitments to verify sampled pieces. citeturn0search1

By late 2023, Avail forum discussion about long-term storage (RFP-003) indicates a then-current operational capacity target of **~2 MB of data per 20 seconds** (per block), explicitly noting that block sizes were expected to rise and that stress tests had been performed at much larger sizes (e.g., 128 MB). This is important historically because it implies an intentional early choice of **moderate block sizes with a roadmap to increase**, rather than a fixed small-blob approach. citeturn0search2

In July 2024, Avail publicly announced mainnet readiness (“Mainnet is Live!”), positioning Avail DA as a production DA layer secured by a validator network and DA sampling. Independent media (e.g., entity["organization","The Block","crypto news outlet"]) also covered the launch, including the claim that Avail’s approach uses DA sampling and validity/commitment techniques rather than trusting a committee. citeturn0search16turn0search11

During 2024, Avail documentation and blog material started emphasising practical UX and integration trade-offs: a guide to selecting a DA layer explicitly references that Avail’s “confidence” can reach near 100% with **a small constant number of samples**, giving an indicative range of **8–30 samples** for “close to 100%” confidence. citeturn0search7turn5search1

From an “architecture over time” standpoint, three later elements materially change how DA is consumed:

- **Light-client high-availability P2P (DHT) layer**: By Jan 2026, Avail’s light client documentation is explicit that light clients do DAS, retrieve data first from a **Kademlia DHT** in an LC-only P2P network, and then fall back to RPC (and subsequently upload missing cells into the DHT). This is a significant architectural decision: DA assurance is not only a passive “sample-from-full-nodes” model; it is also an active “LCs replicate cells” model. citeturn5search0turn3view2
- **Governance-controlled “block length” and upgrade process**: Avail’s wiki documents a three-step runtime-upgrade process that temporarily increases block limits via `dataAvailability/submit_block_length_proposal`, performs a `system/set_code` runtime upgrade, and then reverts limits—highlighting that block format/limits are **explicitly governed and adjustable**, and that “matrix dimensions” (rows × columns) are part of operational reality. citeturn26search0
- **Large block-size and finality tuning (late 2025)**: Avail’s node release notes (v2.3.4.0, Dec 2025) claim: (i) finality time decreased to **~1 block (20s)**, (ii) block size increased to support up to **64 MiB**, and (iii) backoff strategy updated when finality is stuck (max delay 5 minutes). This is the clearest public signal of a step-change in DA capacity and a corresponding need to harden “stuck finality” handling. citeturn28search4turn27search2

Finally, Avail introduced two “DA consumption accelerators” that matter for end-to-end DA systems:

- **Turbo DA**: a managed service offering sub-second pre-confirmations (<250 ms) while ensuring eventual posting to Avail DA. This is a notable architectural/operational layer on top of base DA. citeturn10search0
- **VectorX / DA verification on Ethereum**: a DA attestation bridge that periodically posts commitments to entity["organization","Ethereum","layer-1 blockchain"], enabling off-chain or Ethereum-side verification that Avail DA finalised a data root / commitment. citeturn30search0turn30search2turn30search18

## What DA security means for Avail

### Threat model and “who can withhold data”
Under Avail’s documented model, DA security primarily targets **data withholding** and **data tampering**:

- **Withholding**: an adversary attempts to get a block header finalised while preventing enough of the underlying block data from being retrievable to reconstruct the original payload. This threat is the core reason Avail uses erasure coding plus DAS. citeturn5search1turn0search1
- **Tampering / invalid data serving**: peers (RPC servers or P2P peers) might respond with incorrect cells; Avail’s light client expects to cryptographically verify received cells (via commitments and openings). citeturn5search0turn7view0

In practical operational terms, *who* can cause withholding-like failure depends on which layer is attacked:

- A **block producer/validator** can attempt to publish a header/commitments while not sufficiently disseminating the data (or selectively disseminating). Avail’s glossary states that finality on headers is achieved by a supermajority of validators via GRANDPA. That suggests “header finality” and “data availability confidence” are separable concepts. citeturn7view0turn5search0
- A **network adversary** can attempt to eclipse a light client (or a region) such that it cannot fetch sampled cells (even if globally available). Avail explicitly deploys two retrieval mechanisms—DHT and RPC—and documents NAT traversal capabilities to improve connectivity and availability. citeturn5search0turn3view2
- **RPC/service operators** can degrade liveness for clients that rely on them, but Avail’s light client design explicitly tries DHT first and uses cryptographic verification, reducing the “trusted RPC” surface. citeturn5search0turn3view2

### Honest threshold for DA assurances
Avail’s documentation is clearer about *confidence via sampling* than about a stake-threshold DA committee model, because Avail is explicitly positioning itself as *not a DAC-based* model. The FAQ contrasts DAS+commitments with committee-like approaches and emphasises that DAS with erasure coding and KZG commitments can provide near-100% guarantees with a small number of queries. citeturn5search1turn7view0

A precise honest-stake threshold for DA (“≥1 honest validator”, “≥2/3 honest stake”, etc.) is not stated as the DA mechanism’s core security assumption. Instead, the mechanism’s security rests on:

- **Cryptographic binding** of commitments in the header (so an adversary cannot equivocate about the committed data without detection). citeturn5search1turn7view0
- **Sampling by light clients** that are not all simultaneously eclipsed, so that “unavailability” is detected with high probability. citeturn5search0turn5search1

However, Avail’s *header* finality is by a validator supermajority (GRANDPA), so if the validator set finalises a header that corresponds to data that is not sufficiently available, the system can reach a state best described as:
- **Chain-final but DA-failed** for applications that require data availability before proceeding. citeturn7view0turn10search0turn5search1

### Safety versus liveness under withholding
Under withholding, Avail’s light-client-facing security goal is “do not accept the block as available”. The light client computes a “confidence factor” and emits an event when “ConfidenceAchieved” is reached. If cells cannot be retrieved/verified, this confidence cannot be achieved (and the block would not be treated as available by that client). citeturn3view2turn5search0turn7view0

From a consensus viewpoint, the chain can still progress and finalise headers (since finality is a validator process); from a DA consumer viewpoint (rollups/validiums/sovereign chains), the safer mode is to treat “DA confidence not achieved” as a **halt condition for that application** (application-level liveness failure, while the base chain may remain live). This separation is hinted by Avail’s own positioning of Turbo DA: it exists specifically because some applications need “faster finality” than the base chain’s 20s block time / multi-block finality window. citeturn10search0turn5search0

### Slashing and accountability for withholding
Avail has slashing concepts at the consensus layer (the glossary defines slashing and equivocation), and staking has an explicit unbonding period intended to preserve accountability for validator behaviour over time. citeturn5search2turn29search0

What Avail’s public docs do **not** provide is a clear, protocol-level **proof of withholding** that can be used to slash a specific validator for DA withholding. This is consistent with a common DA limitation: *absence* (data not being served) is hard to attribute to a specific actor without additional mechanisms (e.g., signed availability attestations, challenge protocols, or committee signatures). Avail’s docs emphasise verification of received cells (detecting incorrect data), but they do not describe an on-chain slashing workflow for “data never appeared”. citeturn5search0turn7view0turn5search1

## DA mechanism and cryptographic structure

### Commitments in the header
Avail’s glossary explicitly states that an Avail block header includes **two attestations**:
- **KZG polynomial commitments** for the provided data.
- A **Merkle root** with data blobs as leaves. citeturn7view0

This combination matters architecturally:
- KZG commitments are used for **succinct openings** (small proofs) needed for data availability sampling verification by light clients. citeturn5search1turn5search2
- A Merkle root over blobs supports inclusion proofs for blob-level data structures and is directly referenced by VectorX/bridge constructions that talk about “data root” / “data blobs”. citeturn7view0turn30search0

### Erasure coding scheme and data layout
Avail’s current light client documentation describes block data as being chunked into equal-sized **cells** arranged in a **matrix**, with **each row erasure-coded using Reed–Solomon** and then committed with KZG commitments in the header. citeturn5search0

This is an important “current state” observation: Avail’s official doc text (Jan 2026) foregrounds **row-wise RS coding** rather than explicitly describing a full 2D RS extension in both row and column dimensions (as is common in some 2D DAS designs). The matrix still exists as the sampling domain (“cells in the matrix”), but the encoding description is presented row-wise. citeturn5search0turn5search1

A key parameter for overhead is the **coding rate** (redundancy factor). While the Jan 2026 light client overview does not state the numeric rate directly, multiple sources are consistent with a “doubling” intuition historically used in DAS designs:
- Avail forum discussion (Dec 2023) references a 2 MB per block regime and an expectation of increasing size; in typical Avail discussions this is linked with erasure expansion for sampling robustness. citeturn0search2
- The light client CLI sample output shows “Random cells generated: 10” and then a “Confidence factor: 99.90234375”. The numeric value 99.90234375 equals **1 − 1/1024**, which matches the probability-of-miss model **(1/2)¹⁰** if an adversary must withhold at least half the encoded cells to make reconstruction impossible. This is an inference from the output values (not a stated formula), but it strongly indicates that Avail’s default confidence calculation is aligned with a “withhold ≥50%” worst-case consistent with rate-1/2 erasure expansion. citeturn3view2

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["Avail data availability sampling matrix cells KZG commitments","Avail light client data availability sampling DHT RPC diagram","KZG polynomial commitment opening proof diagram","Reed-Solomon erasure coding matrix data availability sampling"],"num_per_query":1}

### Sampling model and confidence targets
Avail’s light client mode listens for **finalised blocks** and performs DAS on **a predetermined number of cells**; the number of cells depends on the assurance level the user wants. citeturn5search0

Avail’s blog guidance is unusually explicit (for an L1 DA project) about a practical sampling range: it states that Avail can reach confidence “close to 100% within 8–30 samples”, suggesting an operational knob to trade off bandwidth/latency against assurance. citeturn0search7

In the “run light client” documentation, the sample output shows:
- `cells_total=10`, `cells_fetched=10`, `cells_verified=10`
- “Confidence factor: 99.90234375”
- and the event `ConfidenceAchieved`. citeturn3view2turn2view1

Practically, this implies Avail’s “time to confidence” can be short (seconds) under good connectivity, because the client only needs to fetch and verify a small constant number of cells. citeturn3view2turn5search0

### Retrieval and serving of data
Avail’s light client design has a very explicit retrieval strategy with **failover**:

- **Primary**: retrieve cells via a **Kademlia DHT** in a light-client-only “high availability” P2P network.
- **Fallback**: if cells are missing in the DHT, retrieve them via **RPC** calls to Avail node(s).
- **Repair step**: cells not found in the DHT and retrieved via RPC are uploaded back into the DHT, increasing future availability in the LC P2P network. citeturn5search0turn3view2

Additionally, Avail states the light client uses **libp2p with Kademlia** and supports NAT traversal (symmetric and asymmetric), which is operationally relevant for achieving peer diversity and resilience. citeturn5search0turn5search2

## Capacity, overhead, and scalability limits

### Maximum data per block and effective payload
Two key “current-state” parameters appear consistently in Avail sources:

- **Block time**: Avail DA is documented as having a **20-second block time**. citeturn10search0turn5search0
- **Max block size (late 2025/early 2026)**: Avail node release notes (v2.3.4.0) claim block size increased to support up to **64 MiB**. citeturn28search4

Historically, a public Avail forum post described operational capacity as “up to 2 MB per 20 seconds” (with plans to increase), so the 64 MiB number should be interpreted as the outcome of an aggressive scaling trajectory (and potentially a “max supported” parameter, not a median utilisation). citeturn0search2turn28search4

If the coding rate is effectively ~1/2 (doubling), then “network bytes” per raw published byte are at least ~2× at the DA layer (encoded data), before adding P2P gossip overhead and KZG commitment/proof overhead. The Avail docs explicitly connect data size to the cost of generating commitments (and thus fees), which is consistent with the idea that large blocks impose real computational costs on block producers. citeturn13view0turn5search0

### Redundancy factor and bandwidth amplification
At a high level, the redundancy factor is driven by Reed–Solomon erasure coding “spreading out” the information such that losing some shards is tolerable, and such that hiding even one transaction requires hiding a large fraction of the encoded block (making sampling effective). citeturn5search1turn0search1

The clearest operational implication is:

- **For validators / full nodes**: bandwidth requirements scale roughly with the **encoded** block size (plus gossip duplication). If “64 MiB per 20 seconds” were sustained at max load, the encoded payload could be on the order of ~128 MiB per 20 seconds (in a 2× redundancy model), i.e., multiple MiB/sec sustained ingress/egress *per peer set*, which is a decentralisation pressure point. citeturn28search4turn5search0
- **For light clients**: bandwidth can remain almost constant per block because they only fetch a small number of cells, not the whole block. citeturn5search0turn0search7

### Scalability knobs and “what breaks first”
Avail exposes multiple levers intended to allow scaling without forcing all participants to bear linear costs:

- **Application indexing (App IDs)**: Avail headers contain an index allowing an application to download only the sections relevant to that application; thus, “block sizes can increase without requiring applications to fetch more data” (except that DAS still samples across the whole block). This is a core architectural decision to mitigate “multi-tenant DA” costs. citeturn9view1turn5search1
- **Governable matrix/block length**: Avail’s documented upgrade process uses `submit_block_length_proposal` to increase block limits (example: 512 rows × 256 columns) during runtime upgrades. This suggests that block structuring parameters (and therefore maximum block data) are explicitly controlled and can be changed by governance. citeturn26search0

Despite these knobs, the “first failure modes” under aggressive scaling are likely to be:
- **Validator/full-node networking** (propagating large encoded blocks in 20 seconds).
- **Block producer CPU** (erasure coding + KZG commitment generation), which Avail itself acknowledges by linking DA transaction fees to the computation required to generate commitments for the posted data. citeturn13view0turn5search0

## Latency and finality pipeline

This section separates three distinct latencies requested: time-to-availability (full nodes), time-to-confidence (light clients), and time-to-finality, plus the extra latency introduced when DA is verified/attested on Ethereum.

### Time-to-availability for full nodes
Avail’s docs do not provide a single canonical “time-to-availability” SLA; instead, they describe a retrieval topology in which data propagates via normal networking plus the LC DHT replication behaviour. citeturn5search0

Empirically (from Avail’s own sample output), fetching and verifying 10 sampled cells from RPC took on the order of **~2–3 seconds** in the example logs, with proof verification taking ~10–20 ms total for those samples. This is not a p95/p99 guarantee, but it provides a directional bound that “cell retrieval and proof verification can be seconds-level” under typical conditions. citeturn3view2turn2view1

### Time-to-confidence for light clients
The light client performs DAS on a predetermined number of cells per finalised block and computes a “confidence factor” after verification. citeturn5search0

In the sample run, the client reaches “ConfidenceAchieved” with 10 sampled cells and reports confidence 99.90234375. Under the standard DAS-with-erasure intuition, increasing the sample count increases confidence exponentially. Avail’s own blog guidance uses “8–30 samples” as a practical operational range. citeturn3view2turn0search7turn5search1

### Time-to-finality on Avail DA and whether DA is required pre-finality
Avail’s documentation (Turbo DA page) states: block time is 20 seconds and “finalization time” is **2–3 blocks** (~60 seconds in most cases). citeturn10search0

However, Avail’s later node release notes (v2.3.4.0) claim finality time decreased to **1 block (20 seconds)**. This appears to be a protocol/network tuning update; the discrepancy likely reflects different measurement windows, different network phases, or documentation lag. For research-paper accuracy, both statements should be recorded as “observed/claimed” values with their timestamps. citeturn10search0turn28search4

On “is DA required before finality?” Avail’s glossary describes finality as a validator supermajority signing a chain including the header via GRANDPA. The light client, separately, verifies availability confidence by sampling and can refuse to treat a block as available if it can’t fetch/verify samples. This supports the interpretation that Avail’s base-chain finality is **not gated** on light-client DA confidence, even though DA consumers should gate their own safety on that confidence. citeturn7view0turn5search0turn3view2

### Extra latency for DA verification on Ethereum
If a system requires verification on Ethereum (e.g., for a settlement/bridging workflow), Avail’s VectorX docs state:

- Data submitted to Avail DA is bridged to Ethereum **every 360 Avail blocks**, and the commitment is included in the VectorX contract. citeturn30search0turn30search6

At a 20-second block time, 360 blocks is ~2 hours, which is consistent with Avail’s user guide stating that bridging AVAIL from Avail DA to Ethereum typically takes **1–2 hours**. citeturn30search1turn10search0

For rollups using Avail with Ethereum settlement, Avail’s OP Stack integration overview explicitly states that the Avail data root is posted to Ethereum through the Vector data attestation bridge for verification of DA consensus. citeturn30search18turn30search0

## Operational roles, resource costs, and failure behaviour

### Roles and published hardware baselines
Avail provides explicit system requirement baselines:

- **Light client**: minimum 512 MB RAM / 2-core CPU; recommended 1 GB RAM / 4-core CPU. citeturn11search9turn5search0
- **Full node**: minimum 8 GB RAM / 4-core CPU / 20–40 GB SSD; recommended 16 GB RAM / 8-core CPU / 200–300 GB SSD (noting storage needs grow over time). citeturn11search1

Node “types” are described as: light clients (low storage), full nodes (maintain current state, not full history), validator nodes (staked block production), and RPC nodes (API gateways). citeturn11search6

### Storage and retention (pruning rules)
Avail’s “run a node” guide is specific about pruning configuration:

- State pruning defaults to keeping the last **256** finalised blocks, unless set to archive modes. citeturn11search0
- RPC providers are instructed to run with `--state-pruning archive` and `--blocks-pruning archive`, and to enable Kate RPC (`--enable-kate-rpc`) for DA-related RPC methods. citeturn11search0

This implies an important DA nuance: Avail’s base-node defaults are not necessarily “permanent storage”. Long-term data retention becomes an **archival/RPC operator** responsibility (and historically Avail even solicited an RFP about long-term storage). citeturn11search0turn0search2

### Bandwidth and CPU by role (what is knowable from public sources)
Precise p95/p99 bandwidth figures are not published in Avail’s docs; however, the architecture allows useful bounding:

- **Light client bandwidth** is dominated by (header sync) + (k sampled cells per block). The light client also participates in a DHT and may upload cells it fetched via RPC into the DHT (outbound bandwidth). citeturn5search0turn3view2
- **Light client CPU** is dominated by verifying sampled cells and their proofs; the sample logs show proof verification elapsed in the ~10–20 ms range for 10 cells in that environment. citeturn3view2turn2view1
- **Block producer CPU and cost scaling** is directly acknowledged in Avail’s fee documentation: DA transaction fees scale with the size of the submitted data, because larger data requires more computing resources to generate commitments, and consumes more storage. citeturn13view0
- **Validator/full-node bandwidth** scales with block size and redundancy. Avail’s “max 64 MiB block size” release note signals that validator networking and CPU requirements must have been re-evaluated to support those parameters. citeturn28search4turn13view0

### Failure behaviour and fallback modes
Avail’s light client defines a clear recovery path for missing peers/partial outages:

1. Try DHT first.
2. If DHT misses, fetch via RPC.
3. Upload newly fetched cells to DHT to strengthen future availability. citeturn5search0turn3view2

The same documentation specifies that on fresh startup, the light client performs a **block sync** using both DHT and RPC, and that sync depth should match the node’s caching depth (`sync_block_depth`). This is a very concrete operational constraint for anyone embedding LCs in production apps. citeturn5search0

At the chain layer, the v2.3.4.0 node release notes explicitly mention updating a backoff strategy with a maximum delay of 5 minutes “when finality is stuck”, which is evidence that “stuck finality” is a recognised failure mode, and that client software was changed to behave more robustly under it. citeturn28search4

### Publicly documented security reporting
Avail runs a bug bounty programme via entity["organization","Immunefi","bug bounty platform"] with rewards up to $500,000 (scope-dependent), which is relevant for evaluating “robustness maturity” as of early 2026. citeturn29search5

## Economics and fee market for data publishing

### Fee market structure for DA data
Avail’s transaction fee documentation provides a concrete fee decomposition:

- Base fee: stated as **0.124 AVAIL** (at last update).
- Length fee: proportional to encoded transaction length (space in block).
- Weight fee: proportional to computation, multiplied by a congestion multiplier based on recent block fullness.
- Optional tip: explicitly to incentivise validators.
- For DA transactions (`dataAvailability_submitData`), the weight fee is additionally multiplied by a governance-adjustable parameter `submitDataFeeModifier`. citeturn13view0

This is effectively an EIP-1559-like *dynamic pricing* component (via congestion multiplier) layered onto a Substrate-style “weight + length” fee model, with a DA-specific multiplier that can be changed through governance. citeturn13view0

### Practical cost estimation
Avail documents a direct method for estimating fees before submitting data: the SDK call `paymentInfo` on a constructed `submitData` extrinsic returns the estimated fee (`partialFee`). This is essential for any “cost/GB” evaluation, because it suggests the canonical cost discovery is “query the chain for paymentInfo”, not “multiply bytes by a fixed posted cost”. citeturn31view0

### Who gets paid and what is burned
Avail’s public “transaction fees” page explicitly states that an optional **tip** incentivises validators, but it does not specify (in that page) how the non-tip portion of transaction fees is split between burning, treasury, or validator rewards. citeturn13view0

What is clearly documented elsewhere is that validators earn rewards and set commission rates (general staking/validator economics), but this still does not fully specify “fee burning vs distribution” for DA publish fees without consulting runtime economic code or a dedicated economics specification. citeturn5search2turn29search0

### Hidden costs and cross-chain proof costs
Two “hidden cost” categories are explicitly visible in Avail’s materials:

- **Commitment-generation cost is internalised into fees**: Avail states larger DA submissions require more computing to generate commitments and thus increase fees (weight/length). This implies a non-linear “effective per-byte price” depending on underlying weight curves and congestion multiplier. citeturn13view0
- **Ethereum verification/settlement path adds additional costs and latency**: VectorX posts commitments to Ethereum every 360 Avail blocks; using that path requires interacting with Ethereum and therefore paying Ethereum transaction fees/gas, plus operating (or relying on) bridge API/software. Avail’s own materials position VectorX as a zero-knowledge proof circuit implementation for the Vector data attestation bridge. citeturn30search0turn30search2turn30search18

In addition, **Turbo DA** introduces a separate economic layer: it is in private beta and requires purchasing “credits” denominated in KB/MB, and supports paying with various ERC-20 tokens. This is effectively a managed service fee market distinct from Avail L1 fee mechanics, with the trade-off that it can return a pre-confirmation in <250 ms but only guarantees eventual posting to Avail DA. citeturn10search0

### Interpreting “cost/GB/year” for a DA layer
“Cost/GB/year” is subtle for DA systems because DA is not necessarily “permanent storage”; Avail node defaults include pruning (256 blocks) unless configured as archive, and the ecosystem has discussed the need for long-term storage infrastructure separately. As a result, “GB/year” costs split into:

- **On-chain publishing cost** (AVAIL fees per byte at time of publication; dynamic by congestion + modifiers).
- **Off-chain retention cost** (archival/RPC infrastructure configured to retain and serve data long term), which is not fully specified in Avail docs as a single required model. citeturn11search0turn13view0turn0search2

A rigorous paper should therefore report:
- The on-chain fee model (base/length/weight/congestion + DA modifier) and the recommended method to estimate per-byte cost via `paymentInfo`. citeturn13view0turn31view0
- The retention window implied by default pruning and the existence of archive/RPC operators as the practical long-term availability backbone. citeturn11search0turn11search6