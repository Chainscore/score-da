# Deep Technical Review of Espresso’s Tiramisu Data Availability Layer up to February 2026

## Evolution of the DA architecture and today’s operating mode

The DA component originally referred to as **Tiramisu** in early papers is the same system now branded in production documentation as **EspressoDA**. The core high-level design goal has remained stable: separate *consensus on a compact commitment* from *data dissemination/retrievability of the full payload*, so the consensus layer does not require every validator to download and store full blocks. citeturn7view0turn19view0

From 2024 to early 2026, the major DA-relevant architectural milestones and decisions visible in public technical sources are:

- **Three-layer DA composition formalised and kept**: base **VID** layer (Savoiardi) for strong, bribery-resistant recoverability; **small “full-data” committee** layer (Mascarpone) for fast/common-case retrieval; and an **optional CDN** layer (Cocoa) for Web2-like dissemination performance, explicitly treated as a performance optimisation rather than a security dependency. citeturn7view0turn19view0turn17view4  
- **No Data Availability Sampling (DAS) in the core design**: EspressoDA explicitly chooses **Verifiable Information Dispersal (VID)** over DAS for its default DA security path, positioning VID as more efficient by avoiding “unnecessary redundancies” and by making finalisation conditional on DA verification. citeturn18search0turn18search2turn18search3  
- **Benchmarked integration of the VID layer into the consensus pipeline**: the Cappuccino testnet benchmarks explicitly attribute performance changes to adding the Savoiardi layer to HotShot, and they discuss compute intensity and tuning parameters (e.g., “multiplicity”) as first-order implementation bottlenecks/knobs. citeturn20view0  
- **Production launch with permissioned operators first, then staged PoS**: Mainnet 0 (production) launched with a permissioned operator set (20 operators / 100 nodes in the release description), with proof-of-stake positioned as an upcoming milestone to increase economic security. citeturn8search0turn8search5  
- **DA economics initially reputation-based rather than on-chain slashing**: the project’s own DA-focused write-up states that before PoS, validators do not suffer financial loss for misbehaviour; instead the system relies on detectability and reputational incentives, and it highlights a concrete “worst case” where a supermajority refusing to serve data prevents retrieval. citeturn18search2  
- **Ecosystem risk reviews agree Mainnet 0 lacked slashing**: entity["organization","L2BEAT","layer2 risk analytics"] classifies Espresso DA as having **no slashing** and **no fraud detection** in their DA risk breakdown, and also notes Mainnet 0’s permissioned committee assumptions. citeturn4search4turn30search12  
- **Operational role specialisation became explicit**: by early 2026, node-operator docs clearly distinguish **lightweight** nodes (consensus only; negligible storage, ineligible for DA committee), **DA nodes** (bounded retention via pruning; eligible for DA committee), and **archival nodes** (store history in perpetuity; eligible for DA committee). This is a material architectural decision because it ties DA committee eligibility to nodes that can actually serve/recover data. citeturn27view0  
- **As of February 2026, the public docs still describe PoS on testnet (Decaf) with Mainnet 1 forthcoming**: Mainnet 1 is documented as delegated PoS, with testnet activation in April 2025 and mainnet upgrade “to follow” (date not announced in that page). Recent foundation comms (early Feb 2026) frame PoS transition as upcoming (“will soon be transitioning”), consistent with Mainnet 1 not yet clearly documented as completed on mainnet. citeturn8search2turn9search21turn9search14  

Overall, the “current state” for DA, as reflected in sources updated through early 2026, is a production DA service built around VID + a DA committee + an optional CDN, with node roles (lightweight/DA/archival) and pruning/retention rules now explicitly specified, and with PoS economics being rolled out (at least on testnet) but still publicly signposted as an upgrade path for mainnet. citeturn19view0turn27view0turn8search2turn9search21

## DA security meaning and the threat model

“DA security” in this context means: **once a block is finalised (or otherwise committed by consensus), any honest user who needs the full payload can obtain it**, even if some network participants try to prevent access. Espresso’s own design framing emphasises that the consensus layer agrees on **certificates of data availability** rather than persisting full blocks on every validator, while still needing to “stream block data with very high efficiency” to rollups/executors/provers. citeturn7view0

### Who can withhold data
In the Tiramisu/EspressoDA architecture, potential withholding power is distributed across multiple actors and layers:

- **The dispersal sender (builder/leader/block proposer’s DA role)** can attempt withholding by not dispersing shares/full data. However, the protocol’s structure makes *finalisation contingent on DA evidence*, so an honest quorum should refuse to certify non-dispersed or invalidly dispersed data. citeturn18search0turn16view0  
- **Storage nodes (the broad validator set in the VID layer)** can withhold by refusing to respond during retrieval or by going offline; the VID design explicitly models recovery from a sufficiently large subset and uses a quorum certificate to bound adversarial impact. citeturn7view0turn16view1  
- **The DA committee (Mascarpone)** can withhold by refusing to deliver the full payload after having participated in certification. The ePrint explicitly analyses the attack where an adversary corrupts the small DA committee so it can produce a certificate yet will not deliver the payload, thereby forcing expensive recovery via the base VID layer. citeturn17view4  
- **The CDN (Cocoa)** can fail or be attacked, but it is explicitly described as *untrusted* and *optional*, not a security root. If it is offline, the system is intended to continue via the other layers. citeturn19view0turn17view4  

A practical “who can withhold” answer therefore depends on which layer(s) remain functional and honest: the strongest guarantees come from the VID layer under its fault threshold assumptions; the committee and CDN are accelerators that can degrade to fallback paths. citeturn7view0turn17view4turn19view0

### Honest threshold for DA guarantees
Tiramisu’s *strongest* DA guarantee is anchored in the **Savoiardi VID layer**, which the ePrint describes as resisting corruption of **less than one third** of the nodes/stake for destroying availability, by dispersing erasure-coded chunks and certifying availability via signed acknowledgements. citeturn17view1  

More formally, the VID appendix gives parameter constraints that relate:

- **n**: number of storage nodes  
- **f**: number of malicious storage nodes tolerated  
- **m**: number of successful retrievals/shares needed to reconstruct  
- **q**: number of storage-node signatures included in the retrievability certificate

It requires **m + f ≤ q ≤ n − f** to ensure both dispersal certification and later retrieval succeed under up to f malicious nodes, and it defines the erasure code rate **r = m/n** as the main redundancy knob. citeturn16view1turn16view2  

This shows the design supports a spectrum of operating points (e.g., higher redundancy → smaller r → potentially larger tolerated f or smaller q), but the “headline” threshold repeatedly emphasised in the system narrative is the **< 1/3 adversary** regime typical of BFT-with-stake assumptions. citeturn17view1turn4search4

For the **Mascarpone committee** (fast-path retrieval), the ePrint describes requiring a threshold signature—for example “80%”—and motivates this via probabilistic inclusion of at least one honest node in any 2/3 quorum, noting the committee’s increased vulnerability to bribery relative to Savoiardi. citeturn7view0

### Safety vs liveness under withholding
A core architectural choice is: **do not finalise a block unless DA evidence is assembled** (VID verification / availability certification). citeturn18search0turn17view1  

Operationally, the ePrint is explicit that the proposer waits for both:

- a **quorum of “Savoiardi piece available” votes**, and  
- **committee attestations** (Mascarpone certificate)  

to compose the certificate of availability included on-chain. citeturn17view1  

If the **Mascarpone committee fails** (e.g., adversary corrupts it enough to prevent a committee certificate), the protocol states: **no block can be finalised for that HotShot view**, i.e., a **temporary liveness failure** rather than finalising anyway with missing DA. citeturn17view4  

If the **CDN is down**, the analysis treats it as a performance issue; retrieval remains possible via committee or (expensively) via Savoiardi. citeturn17view4turn19view0  

### Slashing and accountability for withholding or misbehaviour
Two different “eras” matter:

- **Design intent (cryptoeconomic accountability)**: the project’s technical blog framing of HotShot discusses slashing as enabling accountability for safety violations (e.g., double-signing), potentially by aligning with Ethereum-style validator economics (e.g., via restaking and additional slashing rules). citeturn30search1  
- **Mainnet 0 reality (as documented)**: the EspressoDA write-up explicitly states that, without PoS live, misbehaving validators “will not suffer any financial loss,” implying withholding deterrence is mainly reputational, and it describes a worst case where a supermajority refusing to serve data blocks retrieval. citeturn18search2  
  External risk analysis likewise characterises Espresso DA as having **no slashing** at the DA layer and **no fraud detection**, reinforcing that early production security relied more on committee/operator assumptions and detectability than on on-chain penalties. citeturn30search12turn4search4  

By early 2026, the operator docs show PoS mechanics (registration, delegation, commission) on Decaf, but those docs do not, in the cited excerpts, fully specify slashing conditions for DA withholding; instead, they define operational roles and retention. citeturn22view0turn27view0

## DA mechanism and cryptographic structure

### Commitment type carried by consensus and used for verification
The ePrint’s Savoiardi construction commits to the block payload using:

- **KZG polynomial commitments** to polynomials derived from the payload, and  
- a **constant-size vector commitment** to per-node evaluation tuples,  
combined into a commitment **Commit(B) = (h, v)** where **h = hash(KZG commitments)** and **v = vc(e₁,…,eₙ)**. citeturn15view0turn15view2  

This is not a Merkle or namespaced Merkle commitment; it is explicitly polynomial-commitment-based (KZG) plus a vector commitment component, designed so that nodes can verify their received chunk/share with succinct witnesses and later prove consistency during retrieval. citeturn15view2turn16view1  

### Erasure coding scheme and tunable parameters
The VID layer “interprets” the payload as **polynomials**, distributes **evaluations** to storage nodes, and reconstructs via **interpolation** once a retriever collects **m** valid evaluations. This is the standard Reed–Solomon-style erasure coding model (polynomial evaluation as encoding; interpolation as decoding), implemented with a KZG-backed integrity layer. citeturn15view2turn16view1  

Key tunables that affect overhead and fault-tolerance include:

- **m (reconstruction threshold)** and **n (total nodes)**, giving code rate **r = m/n** and redundancy factor roughly **1/r** in total encoded bytes. citeturn16view1turn16view2  
- **q (number of signatures in the retrievability certificate)** must satisfy **m + f ≤ q ≤ n − f** given a malicious-node bound f. citeturn16view1turn16view2  
- Implementation-level tuning such as **“multiplicity”** (how many evaluations per polynomial sent per node) is documented as a performance knob in benchmarks. citeturn20view0  

### Sampling model (DAS) and confidence formation
EspressoDA’s public documentation and DA explainer explicitly state it **does not require DAS** and instead relies on **VID** to “directly split the data amongst HotShot nodes” with recoverability ensured, framed as an efficiency advantage over DAS. citeturn18search0turn18search3turn18search2  

As a result, “time-to-confidence” for light clients is primarily about:

- verifying **consensus finality**, and  
- verifying the **availability certificate** / commitment relationships,

rather than accumulating probability mass from independent random samples. This is a qualitatively different security UX than DAS-centric DA layers. citeturn7view0turn18search0turn17view1  

### Retrieval protocol and serving roles
The VID retrieval protocol in the ePrint is a one-round interaction where a client requests the commitment and proof material (evaluation tuple + witnesses) from storage nodes identified/covered by the certificate, verifies, and reconstructs after receiving m valid responses. citeturn16view0turn16view1  

Operationally, Espresso’s operator documentation (late 2025–early 2026) makes retrieval-serving roles explicit:

- **DA nodes** exist to provide “data availability for recently finalised data” long enough for archivals to persist it. citeturn27view0  
- **Archival nodes** are intended to store “all historical data in perpetuity” and serve historical queries. citeturn27view0  
- **Lightweight nodes** do not keep historical data and are not eligible for the DA committee. citeturn27view0  
- A **CDN endpoint** is used in testnet operator configs as part of the dissemination/retrieval acceleration path, but the EspressoDA docs emphasise that the CDN is not trusted and can be replaced/removed without breaking DA security (only performance). citeturn19view0turn22view0  

## Capacity and overhead characteristics

### Maximum data per block and effective payload
Two different “block size” concepts appear in sources:

- **Benchmark block sizes**: Cappuccino benchmarks explicitly test block sizes from **50 KB up to 20 MB**, and then tabulate results around a **5 MB** “turning point” (where latency begins to increase at saturation). citeturn20view0  
- **Configured maximum block size**: node operator documentation exposes a **`max_block_size`** chain configuration parameter, and provides an example genesis snippet (e.g., `max_block_size = '1mb'`). citeturn27view0  

The effective payload available to applications is less than raw “bytes moved” because VID adds redundancy (governed by r) and adds cryptographic overhead per node (commitments, openings, witnesses). The ePrint states that total payload communication over all nodes is O(|B|) with per-node overhead O(k + |open|), and that if the opening size is constant, Savoiardi achieves asymptotically optimal O(|B|) total communication. citeturn16view2turn16view3  

### Redundancy factor and “network bytes per payload byte”
The most direct redundancy lever in the ePrint is the erasure code rate **r = m/n**, where lower r means more redundancy and a larger fraction of nodes can be offline/malicious while still allowing reconstruction, at the cost of higher total encoded bytes. citeturn16view1turn16view2  

Separately, Espresso’s DA explainer contrasts its VID approach with 2D-erasure-code/DAS approaches by highlighting that its design can be parameterised so recovery requires only a smaller fraction of nodes (the explainer uses illustrative fractions), and that additional layers (committee/CDN) provide fine-grained access without depending on the worst-case recovery path. citeturn18search3  

A practical way to represent overhead for specification purposes is:

- **VID encoded traffic factor (idealised)** ≈ **1/r** for the erasure-coded payload, plus cryptographic material overhead per node (vector openings + KZG witness). citeturn16view1turn16view3  
- **Mascarpone committee replication** adds full-payload uploads to each committee member (fast path), and **Cocoa/CDN replication** adds at least one full-payload upload to the CDN plus distribution costs, but the CDN is treated as optional and not part of the security root. citeturn7view0turn19view0turn17view4  

### Scalability knobs and bottlenecks
Documented scalability bottlenecks and knobs include:

- **Compute intensity of Savoiardi**: Cappuccino notes Savoiardi share generation as compute-intensive and suggests improvements: parallelisation, tuning multiplicity, experimenting with GPUs, and having the Cocoa layer “optimistically calculate” shares. citeturn20view0  
- **Committee bottleneck**: the recent Espresso benchmarks page explicitly lists “removing the DA committee bottleneck” as a future improvement and estimates it could reduce time by ~800 ms. citeturn21view0  
- **Networking architecture**: the latest benchmarks page states that messages route through a central CDN today (extra hop) and suggests sending smaller messages over a dedicated P2P network to further improve latency. citeturn21view0  
- **Role separation**: the explicit lightweight/DA/archival split is itself a scalability knob: it allows consensus participation with negligible storage, while bounding the set of nodes required to store/re-serve data long enough for archival persistence. citeturn27view0  

## Latency analysis across availability, confidence, and finality

Because EspressoDA does not use DAS in the default design, the “three latencies” are best understood as (a) distribution/retrievability latency, (b) certificate/finality latency for confidence, and (c) chain finality measured in view/commit timings.

### Time-to-availability for full retrieval
Two common-case paths exist in the architecture:

- **CDN path**: EspressoDA documentation cites Cappuccino testnet measurements of **~5.7 MB/s** data dissemination with **100 nodes**, presented as a CDN-boosted dissemination metric. citeturn19view0turn20view0  
- **Committee path**: the Mascarpone committee stores full data to allow “very fast data retrievability,” with VID as fallback if the committee fails. citeturn19view0turn7view0  

Worst-case/attack-path availability falls back to VID reconstruction (collect shares; verify; interpolate), which is intentionally more expensive in bandwidth/compute but designed to be robust under the <1/3 adversary regime. citeturn7view0turn17view4turn16view1  

### Time-to-confidence for light clients
In a VID-and-certificate model, light-client confidence is primarily achieved when the client can verify:

- the consensus decision on the block commitment, and  
- the associated availability certificate / retrievability certificate logic that the protocol requires before finalising.

The ePrint describes that the proposer composes the certificate of availability (Savoiardi votes + committee attestations) and includes the commitment and certification on-chain. citeturn17view1  
EspressoDA docs likewise state the system “guarantees a block will only be finalised if data is verified to be available.” citeturn19view0turn18search0  

So, in the intended design, “confidence” and “finality” are tightly coupled rather than being separated by a later DAS confidence accumulation window. citeturn17view1turn18search0  

### Time-to-finality in practice
Two benchmark sources provide concrete latency datapoints:

- Cappuccino benchmarks (HotShot + Savoiardi integrated) show, for **5 MB blocks**, throughput and “average latency” depending on network size; for example at **100 nodes** and **5 MB blocks**, the table shows **average latency ~2 seconds** and throughput **~5.76 MB/s** in that setting. citeturn20view0  
- The “Espresso Network Benchmarks” page (updated ~Jan 2026) summarises internal benchmarking results claiming **~2 seconds finality latency** for **5 MB blocks**, and throughput improvements “from 1 MB/s → 5 MB/s,” with a “100 globally distributed nodes + 21 DA nodes” setup. citeturn21view0  

Both sources also describe remaining pipeline overheads (builder exchange ~500 ms; committee bottleneck ~800 ms; CDN hop), indicating that end-to-end finality is not just cryptographic consensus time but includes DA and data plumbing. citeturn21view0turn20view0  

## Resource cost by operational role

The publicly documented operational model directly affects resource requirements and therefore the realistic DA security envelope (because resource pressure can create correlated downtime).

### Lightweight / validator-only nodes
A lightweight node is defined as storing only what is needed for consensus and keeping no historical data, with “negligible storage requirements on the order of kilobytes,” and it is **not eligible** for the DA committee. citeturn27view0  

Current recommended hardware requirements (explicitly noted as “still in flux”) include **1 core CPU and 8 GB memory** for non-DA nodes. citeturn27view0  

### DA nodes
A DA node is defined as serving recently finalised data long enough for archivals to persist it, with bounded storage via pruning, and it is eligible for the DA committee. citeturn27view0  

Key documented operational constraints:

- **Pruning requires SQL (Postgres) storage**; filesystem pruning is “not yet supported.” citeturn27view0  
- Typical retention targets are **~1 week under average load** and **≥1 day under worst-case load**, explicitly to give archival nodes time to persist data long-term before pruning. citeturn27view0  
- Example pruning parameters are given: `ESPRESSO_SEQUENCER_POSTGRES_PRUNE=true`, minimum retention `1d`, target retention `7d`, pruning threshold tied to hardware. citeturn27view0  
- Recommended compute/memory: DA node sequencer **4 cores / 8 GB**, plus database **2 cores / 4 GB**. citeturn27view0  
- Storage: **100 GB SSD** when pruning enabled (bounded DA mode), versus **1.2 TB SSD minimum** for DA/archival without pruning. citeturn27view0  

### Archival nodes
Archival nodes store “all historical data in perpetuity,” serve arbitrary historical queries, and are eligible for the DA committee. In testnets this has been “tens of GB per month,” with mainnet expected to be higher. citeturn27view0  

### Bandwidth and CPU hotspots specific to DA
While public docs do not provide p95/p99 bandwidth or CPU profiling per role, they do identify where resource pressure concentrates:

- Savoiardi share generation is “compute-intensive,” affecting builders, leaders, and DA committee members. citeturn20view0  
- Network throughput can be limited by TCP defaults; Espresso reports tuning to better utilise available bandwidth (they cite ~1 Gbps utilisation on AWS instances after tuning, vs a much lower default). citeturn21view0  
- Catch-up and missing-data fetch behaviour is rate-limited via explicit configuration parameters such as `--fetch-rate-limit` and delays between fetches, implying bandwidth bursts and peer-load management are active concerns in practice. citeturn27view0  

## Robustness and failure behaviour

### Partial outages and missing peers
The system’s robustness story is explicitly layered:

- If the **CDN layer is not functioning**, the ePrint treats retrieval as still possible via Mascarpone or Savoiardi, and it frames Savoiardi as the only layer secure against adaptive/bribing adversaries. citeturn17view4  
- If the **DA committee is corrupted** such that it can sign but refuses or cannot deliver payload later, the protocol can fall back to **expensive Savoiardi recovery**, and the ePrint treats such attacks as budget-exhausting rather than permanently destabilising (because committee selection is refreshed). citeturn17view4  
- If the **committee fails to produce a certificate** in a view, the protocol’s choice is to **not finalise blocks in that view**, i.e., liveness pause rather than finalising without DA. citeturn17view4turn17view1  

Operational docs also reveal “recovery paths” in node software:

- DA/archival nodes have explicit parameters for limiting concurrent fetches and pacing requests to comply with upstream node rate limits, suggesting a designed mechanism for catching up under partial outage conditions. citeturn27view0  

### Fallback modes (committee → VID; CDN → non-CDN)
EspressoDA’s docs make the fallback relationship explicit: the DA committee provides fast retrieval, while VID is the *guarantee* layer if the committee is unavailable or uncooperative; the CDN is an additional accelerator that can be removed without breaking the system’s security. citeturn19view0turn27view0turn17view4  

### Historical incidents and observed abnormal behaviour
Publicly visible sources do not enumerate specific production “incidents” (e.g., multi-hour unavailability events) in the way some L1s do; instead:

- The Mainnet 0 launch post warns of possible “early hiccups” and says the team will update the community if disruptions occur. citeturn8search5  
- The entity["organization","L2BEAT","layer2 risk analytics"] EspressoDA milestone list (as visible in the cited excerpt) records the **mainnet launch** milestone but does not present a catalogue of major DA outages there. citeturn4search4  

Given the lack of a detailed incident log in cited materials, a specification paper should treat “real-world incident history” as **underdocumented in public sources** and avoid assuming a clean record without additional primary telemetry. citeturn8search5turn4search4  

## Economics and cost model

### Per-byte pricing and fee market structure
Espresso’s node-operator documentation defines a chain-config parameter **`base_fee`** as:

- “the amount of Ether required to sequence a **byte** of data,” paid by builders submitting blocks to be finalised, intended to offset network operating costs. citeturn28search0turn27view0  

A second chain-config parameter **`max_block_size`** is explicitly defined and parsed, indicating that congestion / usage can be managed by bounding block bytes (and, by extension, the number of bytes billed per block). citeturn27view0  

The documentation also notes a **fee contract** on L1 that allows users/builders to deposit ETH into Espresso state to pay sequencing fees, implying an L1-dependent payment rail and associated L1 gas costs. citeturn27view0  

What is *not* fully specified in the cited sources is an EIP-1559-style dynamic adjustment rule for base fee in response to congestion; instead, the docs present base fee as a chain config field and show that “Fee” upgrades exist as an upgrade type. citeturn27view0turn28search0  

### Who gets paid vs what’s burned
The node-operator documentation explicitly says that fees are **not currently distributed to node operators** and are instead “collected in a burner address.” citeturn28search0turn27view0  

This is consistent with external risk framing that, at least historically, EspressoDA did not rely on large staked/slashable assets on the DA layer in Mainnet 0. citeturn4search4turn30search12  

In PoS mode (documented on Decaf), validators register with a commission rate and an Ethereum address that receives commission, while “remaining rewards” go proportionally to delegators—indicating that reward distribution mechanics exist (at least on testnet), but the exact source of those rewards (fees vs inflation vs emissions) is not fully described in the cited excerpt. citeturn22view0  

### Cost per GB and cost per GB-year
Because the base fee is defined **per byte**, the user-side cost to publish data can be expressed precisely as:

- **Cost per GB (in wei)** = `base_fee_wei_per_byte × 1,000,000,000`  
- **Cost per GB (in ETH)** = above ÷ `1e18`

The docs even include an example chain config with `base_fee = '1 wei'` (as a sample configuration), which would imply an extremely low illustrative per-GB fee in that toy configuration. citeturn27view0turn28search0  

However, because this example is an illustration (not necessarily mainnet parameters), a rigorous spec paper should present the above as a **formula**, and treat actual mainnet $/GB as a **configuration-dependent** parameter that must be read from the live network’s chain config / headers. citeturn27view0turn28search0  

For **GB-year**, EspressoDA’s economics are less like “rent” and more like “publish once, store according to operator policy,” so GB-year depends on the role:

- **DA nodes**: targeted retention (e.g., 7 days average / 1 day minimum worst case) makes their storage cost bounded and more like a rolling buffer. citeturn27view0  
- **Archival nodes**: store indefinitely; therefore storage cost grows with throughput (“tens of GB per month” on testnets, potentially more on mainnet). citeturn27view0  

### Hidden or second-order costs
Important non-obvious costs implied by the architecture include:

- **Cryptographic compute**: Savoiardi requires polynomial commitments, vector commitment operations, and witness verification; the ePrint and benchmarks highlight that this is compute-heavy in implementation today. citeturn15view2turn20view0turn16view3  
- **Fallback recovery bandwidth/compute**: if reliance shifts from CDN/committee to VID reconstruction, clients/rollups must download many shares and interpolate, which is explicitly described as the disadvantage of Savoiardi and the reason Mascarpone exists. citeturn7view0turn17view4  
- **L1 interaction costs**: staking and/or fee deposit flows involve Ethereum transactions (e.g., stake table registration and fee contract deposits), which implies gas costs that are external to Espresso’s own per-byte DA pricing. citeturn22view0turn27view0  
- **Operational requirements for DA eligibility**: DA/archival nodes require database infrastructure (Postgres) for some modes (especially pruning), and storage requirements can be high (hundreds of GB to TB scale). citeturn27view0turn22view0