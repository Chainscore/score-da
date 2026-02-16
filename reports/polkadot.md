# Polkadot data availability and security up to early 2026

## Architectural evolution relevant to data availability

Polkadot’s *parachain data availability (DA)* is not a “blob posted on-chain” design. Instead, parachain block data (the *AvailableData*, primarily PoV + persisted validation data) is kept *off-chain* but made *reconstructible* through (i) erasure coding across the validator set, (ii) validator attestations (“availability bitfields”), and (iii) retrieval/recovery protocols that can reconstruct the full data when needed for approvals and disputes. citeturn24search12turn24search3turn7view4

A useful way to track DA-related architectural decisions is to map them to the “ELVES/AnV” pipeline:

- **Backing** (candidate validity attested by a quorum of assigned validators) citeturn7view4turn23view0  
- **Availability distribution + availability votes** (erasure-coded distribution + 2/3+ availability quorum) citeturn24search12turn8view4turn23view0  
- **Approvals (with tranche-based escalation)** and **finality gating** on approvals completion citeturn23view0turn27view0  
- **Disputes** with on-chain consequences (slashing), with the practical constraint that disputes are only meaningful once availability succeeded citeturn24search7turn24search11turn24search13  

Key DA-relevant upgrades/changes and their implications through Feb 2026:

- **ELVES formalisation of the deployed auditing layer**: the ELVES paper explicitly describes the phases (backing → availability via Reed–Solomon distribution → approvals with escalation → finalise only when approvals conclude → disputes), and notes that ELVES has been used in production on Polkadot/Kusama since 2021. This is important because it clarifies *finality dependence* on the audit/approval pipeline, not merely block production. citeturn23view0  
- **Scaling-era (“Polkadot 2.0”) upgrades that increase DA throughput pressure**: by late 2025 the Polkadot runtime release messaging frames “Asynchronous backing, Agile Coretime, and Elastic scaling” as a completed optimisation series (“Polkadot 2.0”). Even when these are primarily throughput upgrades, they are DA-relevant because higher candidate throughput implies more availability chunks in-flight, more bitfields, and more recovery traffic. citeturn25search3  
- **Increased core count (more parallel candidates)**: the Coretime system chain upgrade v1.6.0 is documented as increasing Polkadot cores from 66 → 100 (and Kusama cores from 100 → 140). More cores means more concurrent candidates per relay-chain block and therefore more DA work (distribution, storage, recovery, approvals) per unit time. citeturn25search0  
- **Max PoV size headroom increased at the SDK-primitive level**: the relay-chain primitive constant `MAX_POV_SIZE` is documented (in the SDK rustdocs) with a value comment of **10,485,760 bytes** (~10 MiB). This is a *hard cap input* into HostConfiguration limits and thus a direct DA capacity knob. citeturn33view0turn27view0  
- **Implementation hardening around retention/pruning**: the implementation guide documents conservative pruning windows (notably “finalised for 1 day + 1 hour” for PoV data/chunks) to account for disputes and the possibility that finality can be reverted. This directly impacts validator storage cost. citeturn24search0  

## What DA security means in Polkadot

### The security objective

In Polkadot, DA security is best expressed as:

> If a parachain candidate becomes *included/available* and the relay-chain later *finalises* (i.e., treats that history as final), then the system should (with high probability under stated adversary assumptions) ensure that the candidate’s *AvailableData* can be retrieved/reconstructed by validators who need it for **approval checking** and **dispute resolution**, within the challenge window.

This aligns with both the protocol specification’s role for availability votes (2/3+ quorum) and the ELVES framing where availability distribution ensures that “any auditor could check the block if they so choose,” and finality is delayed until approvals conclude. citeturn8view4turn23view0

### Threat model: who can withhold, and how

Polkadot’s DA threat model is multi-actor:

- **Untrusted collators can withhold the full PoV from the outset**, since collators are explicitly treated as untrusted sources of parachain candidates. citeturn7view4  
- **Backing validators can impede distribution**, because availability distribution begins from the set of validators who obtained/validated the candidate data during backing and then must spread erasure-coded pieces. (Implementation guide: availability distribution requests chunks “from backing validators” so local nodes can store their own chunk and later vote.) citeturn24search4turn24search5  
- **Any validator who is a designated chunk holder can refuse to serve their chunk** later, impacting recovery. (The protocol therefore makes recovery require only a bounded number of chunks, discussed below.) citeturn7view3turn24search2  
- **Network adversaries can mount DoS/partition-style attacks**, and the ELVES security model explicitly includes *fully adaptive crashes* (instantaneous crashing of parties), which is relevant because DA depends on being able to fetch enough pieces from online validators. citeturn23view0  

### Honest threshold: what must be honest for DA guarantees

Polkadot’s DA-related thresholds appear in two places: *attestation/quorum* and *reconstruction threshold*.

- **Availability quorum used by the chain**: the protocol specification describes a *2/3+ availability quorum* via availability votes/bitfields. Validators issue signed bitfields that indicate which candidates they have availability data stored for; these bitfields are used to determine which candidates meet the 2/3+ availability quorum. citeturn8view4turn24search5  
- **Reconstruction threshold**: both the Polkadot protocol specification and the implementation guide state that to recover `AvailableData`, a recovering party generally must obtain at least **f + 1** erasure pieces, where the session validator set size satisfies \(n = 3f + k\) with \(k \in \{1,2,3\}\). citeturn7view3turn24search2  
- **Underlying Byzantine assumption**: ELVES’ security statement (and Polkadot-style BFT assumptions) use a corruption bound **\(\gamma < 1/3\)** under synchrony. This is the standard fault threshold that makes the combination of (i) quorum-based statements and (ii) dispute resolution viable. citeturn23view0  

Interpreting these together for DA:

- The chain uses **2/3+** availability attestations as the condition for treating a candidate as “available enough” for inclusion/finality gating. citeturn8view4turn7view4turn24search12  
- Recovery is designed so that **only f+1** pieces are needed, meaning DA does **not** require “all or most validators serve data,” only that enough of the validator set remains reachable to supply f+1 distinct chunks. citeturn7view3turn24search2  

### Safety vs liveness under withholding

Polkadot’s design aims to make DA failures primarily a *liveness* problem for the affected parachain candidate, not a *safety* violation for finalised relay-chain history.

- **If data cannot be made available quickly enough**, the Polkadot wiki explains that the candidate’s data is expected to be made available within a timeout, and if not, the candidate is discarded (so it cannot be finalised as part of the canonical history). citeturn1search4  
- **Finality is coupled to approvals** in the ELVES model: blocks are finalised only if/when the approvals phase concludes (and missing auditors are replaced by more). This implies that if lack of availability prevents approvals, finality should be delayed rather than “finalise anyway.” citeturn23view0  
- The protocol spec similarly ties candidate acceptance for *finalised blocks* to satisfying availability requirements: the “candidate approval process ensures that only relay chain blocks are finalised where each candidate … meets the requirement of 2/3+ availability votes.” citeturn7view4turn8view4  

So, under withholding, the typical outcomes are:

- **Candidate fails to become available → candidate not finalised / eventually discarded**, relay chain continues. citeturn1search4turn8view4  
- **If withholding stalls approvals**, finality is delayed until approvals complete (or disputes resolve), rather than accepting unapproved data. citeturn23view0turn24search13  

### Slashing/accountability for DA misbehaviour

Polkadot draws a sharp line between *provable* misbehaviour (slashable) and *unprovable network-dependent* failures.

- **Provably wrong validity statements are slashable**: the spec states that broadcasting failed verification as “Valid” statements is slashable. citeturn7view4  
- **Disputes lead to slashing for incorrect votes**, and the disputes pallet documentation distinguishes punishment categories (“against valid” vs “for invalid”), with voting thresholds and confirmed disputes. citeturn24search11turn23view0  
- **Disputes are only meaningful for candidates that achieved inclusion/availability**, because only then does the system have guarantees that the candidate data is available enough to reliably check and slash malicious actors. This is explicitly called out in the dispute coordinator documentation. citeturn24search7  

For *pure data withholding* (e.g., not responding to chunk requests), cryptographic “proof of withholding” is generally hard in asynchronous networks. The docs reflect this indirectly by focusing on (i) quorum attestations, (ii) recovery by requesting more peers, and (iii) incentives/slashing primarily around *validity* and *dispute outcomes*, not around “a node didn’t answer my request.” citeturn24search2turn24search9turn24search11  

There is also *operational unavailability slashing* discussed in Polkadot support material (focused on validators going offline in large correlated events), with slashed funds going to the Treasury. This is relevant to DA insofar as correlated validator downtime reduces the pool of available chunk holders, but it is not a direct “proved chunk withholding” slash mechanism. citeturn24search1  

## DA mechanism and cryptographic structure

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["Polkadot availability distribution erasure coding diagram","Polkadot parachain candidate backing approval voting diagram","Polkadot availability bitfields diagram"],"num_per_query":1}

### What is committed on-chain

The relay-chain does not store full parachain blocks. Instead, it stores commitments sufficient to (a) identify the candidate, (b) bind to the PoV, and (c) bind to the erasure-coded distribution.

The protocol specification defines the **candidate descriptor** fields, including:

- the PoV block hash, and  
- **the root of the block’s erasure encoding Merkle tree** (`r`) citeturn7view1  

This means Polkadot’s DA commitment is **Merkle-based** (not namespaced Merkle trees, and not polynomial commitments like KZG) at the “share/chunk commitment in the header-level candidate data” layer. citeturn7view1turn24search3  

### Erasure coding scheme and parameters

Polkadot uses **systematic Reed–Solomon erasure coding** for availability distribution (as described at a high level in ELVES) and implemented in code via an erasure coding library based on “novel polynomial basis” techniques enabling efficient RS encoding/decoding. citeturn23view0turn6view0  

Key protocol-level parameterisation:

- Validator set size \(n\) is treated as \(n = 3f + k\), \(k \in \{1,2,3\}\), matching the familiar BFT-style split into “up to f faulty.” citeturn7view3turn24search2  
- **Recovery threshold is f + 1 chunks**: a validator (or other participant performing recovery) should query randomly selected validators until it has received at least f+1 pieces. citeturn7view3turn24search2  

Interpretation for “1D vs 2D RS” and “coding rate”:

- This is **1D RS across the validator set** (encode a blob into \(n\) chunks; any sufficiently large subset reconstructs), not the 2D Reed–Solomon matrix used by DAS-focused designs like Celestia-style schemes. citeturn23view0turn24search2  
- With recovery threshold \(k = f + 1 \approx n/3\), the **nominal coding rate is \(\approx 1/3\)** and the **redundancy factor is \(\approx 3\times\)** at the level of “total encoded bytes / original bytes” (before considering network replication and gossip). citeturn7view3turn24search2  

### Chunk structure and proofs

The implementation guide defines the **erasure chunk** as:

- the chunk bytes,  
- the chunk index, and  
- a Merkle proof (`proof`) against the candidate’s `erasure_root`. citeturn24search3turn7view1  

This is important because it means retrieval of a single chunk is *individually verifiable* against the on-chain commitment (`erasure_root`), which prevents “garbage chunk” equivocation from being undetectable (though it does not itself prove withholding). citeturn24search3turn8view0turn7view1  

### Sampling model: DAS vs “randomised recovery”

Polkadot’s current DA is **not** a light-client DAS model where light clients randomly sample shares to obtain probabilistic availability guarantees.

Instead:

- **Validators (and sometimes collators) do recovery** by querying randomly chosen validators until obtaining f+1 chunks. citeturn7view3turn24search2  
- “Randomness” here is used operationally (choose random peers to ask) to minimise adversarial targeting and improve robustness, not to provide a light-client probabilistic proof of availability. citeturn7view3turn24search2  

### Retrieval protocols and who serves data

The protocol specification defines request/response messages (SCALE-encoded) for:

- PoV fetching (by PoV hash),  
- chunk fetching (candidate hash + chunk index, returning chunk + Merkle proof), and  
- “available data” fetching (candidate hash → PoV + persisted validation data). citeturn8view0turn8view4  

The implementers’ guide further clarifies:

- **Availability Distribution** serves requests by querying the local Availability Store, and ensures availability by fetching/storing the local chunk for occupied cores after a candidate is backed, to reach “at least 2/3+ of all validators” holding chunks. citeturn24search4turn24search5turn8view4  
- **Availability Recovery** reconstructs data (when needed for approvals/disputes, and also in adversarial censoring scenarios for collators) by querying random validators until f+1 pieces are obtained, with optimisations to reduce reconstruction work. citeturn24search2  

## Capacity, overhead, and scalability knobs

### Maximum data per candidate and per relay-chain block

The most direct “raw DA payload cap” is the PoV size limit.

The Polkadot SDK documentation for relay-chain primitives provides:

- `MAX_POV_SIZE ≈ 10,485,760 bytes` (~10 MiB). citeturn33view0  

Host configuration uses that max PoV size constant as part of the default parachains host configuration. citeturn27view0  

What is actually made available per candidate is `AvailableData`, defined as **PoV + PersistedValidationData** (with a note that future cross-chain messaging considerations may add more). citeturn24search3turn8view0  

The maximum *per relay-chain block* depends on how many availability cores schedule candidates in that block (i.e., how many candidates are included per block), which has increased over time with coretime/core count changes. A documented example is the increase in core count (66 → 100) on Polkadot Coretime. citeturn25search0  

### Redundancy and network-byte overhead per payload byte

At the level of *erasure-coded storage*:

- Encode \(L\) bytes into \(n\) chunks, reconstructable from \(k = f+1 \approx n/3\).  
- Total encoded bytes is approximately \(L \cdot \frac{n}{k} \approx 3L\). citeturn7view3turn24search2  

At the level of *per-validator load*:

- Each validator keeps **one chunk per available candidate**. By construction, chunk size is roughly \(L/k\), which is approximately \( \approx 3L/n\). So, as the number of validators grows, per-validator bandwidth/storage per candidate decreases roughly inversely with \(n\). citeturn24search3turn24search12  

At the level of *real network traffic*, you must add:

- request/response overhead,  
- local gossip replication for bitfields, statements, and other protocol messages, and  
- retries when peers fail to respond. citeturn24search9turn24search2turn8view0  

### Scalability knobs and what breaks first

Scalability “knobs” documented in the implementation are largely about *how many candidates are processed per unit time* and *how large PoVs can be*:

- Increase **MAX_POV_SIZE** (up to the SDK constant) → increases per-candidate DA payload linearly. citeturn33view0turn27view0  
- Increase **core count / scheduling parallelism** → increases number of candidates requiring chunk distribution, bitfields, recovery, and retention. citeturn25search0turn24search12  
- Increase validator set size (increases \(n\)) → reduces per-validator chunk size for fixed payload, but increases system-wide overhead of signatures/bitfields and peer management. citeturn24search12turn23view0  

What tends to “break first” (dominant constraints), based on the documented subsystems:

- **Bandwidth and peer responsiveness**: availability recovery explicitly assumes it may need to connect to and query randomly chosen validators until f+1 pieces are obtained. If large fractions are unreachable, recovery latency increases. citeturn24search2turn23view0  
- **Validator storage + I/O**: validators maintain an availability store with pruning rules and periodic pruning routines; the pruning routine is described as potentially expensive (`O(n*m)` in number of candidates and data sizes). citeturn24search0  
- **CPU for validation and encoding checks**: the availability store includes steps like recomputing the erasure root and comparing to expected, and recovery may involve reconstruction work (though optimised). citeturn24search0turn24search2turn24search3  

## Latency: availability, confidence, and finality

### Time to availability for full nodes and validators

The “time-to-availability” is the time from candidate being backed/included to the point where *enough validators have their chunks stored* and have published the signed bitfields, such that the candidate meets the **2/3+ availability quorum**. citeturn8view4turn24search5turn24search12  

Implementation detail that directly affects latency:

- Bitfield signing jobs intentionally **wait a fixed period** (to allow availability distribution to fetch/store chunks) before forming and signing bitfields by querying the local availability store for “do we have our chunk”. citeturn24search5turn24search4  

So availability is not instantaneous: it is a multi-step pipeline (chunk distribution → local store update → bitfield signing/broadcast → inclusion of bitfields in blocks). citeturn24search4turn24search9turn8view4  

### Time to confidence for light clients

Polkadot’s DA design (as documented in protocol spec + implementers guide) is validator-set-centric and does not describe a light-client DAS procedure where light clients obtain probabilistic DA guarantees by sampling shares. Instead, light-client “confidence” is primarily anchored in:

- relay-chain consensus/finality proofs, and  
- the assumption that the finality rules are enforcing the approvals + availability pipeline. citeturn23view0turn7view4turn8view4  

So there is no “sample-count schedule, confidence target, failure escalation” for light clients analogous to DAS-based DA layers as of these docs; escalation is instead in the *approval system* (more auditors in later tranches) and in *recovery* (query more validators until f+1 pieces). citeturn23view0turn24search2turn27view0  

### Time to finality and whether DA is required before finality

Two independent doc threads point to “DA is required before finality” in the practical sense:

- ELVES explicitly: “finalize blocks only if and when the approvals phase concludes.” citeturn23view0  
- Protocol spec: only finalise relay-chain blocks where candidates meet the “2/3+ availability votes” requirement. citeturn7view4turn8view4  

Finality timing is therefore a function of:

- whether availability quorum is reached quickly, and  
- whether approval checking completes without “no-shows,” which triggers tranche escalation.

The chain-spec/host-configuration code exposes parameters like `no_show_slots`, `n_delay_tranches`, and `needed_approvals`, which govern this approval/latency behaviour at the protocol configuration level (though exact wall-clock timings depend on slot duration and deployment). citeturn27view0turn23view0  

## Resource costs by role

This section focuses on *operational constraints implied by the documented mechanisms*, not on a specific cloud bill, because the docs are primarily protocol/implementation descriptions.

### Validators

Validators bear the dominant DA workload.

**Bandwidth**

- Receive full PoV/AvailableData for candidates they validate (backing/approval/dispute roles) and distribute/serve chunks. The ELVES phase description makes the availability phase explicitly a distribution to enable any auditor to check. citeturn23view0  
- Availability recovery may require requesting chunks from multiple validators until f+1 is reached, implying bursty outbound requests and inbound chunk responses during approvals/disputes. citeturn24search2turn7view3  
- Bitfield distribution is a gossip system; peers are scored/reported based on behaviour, implying continuous network traffic beyond the strict “chunks only” path. citeturn24search9  

**CPU**

- Validate candidates (PoV execution for assigned roles) and sign statements/bitfields. Slashability for invalid validity statements indicates the protocol takes these checks seriously. citeturn7view4turn23view0  
- Availability store can recompute erasure roots when storing available data (integrity check vs expected erasure root). citeturn24search0turn24search3  
- Recovery may involve reconstruction (though the implementation uses strategies to sometimes avoid full reconstruction). citeturn24search2  

**Storage and retention**

The availability store documentation is unusually explicit:

- It stores (a) full PoV blocks for candidates validated and (b) availability chunks for candidates backed and noted available on-chain. citeturn24search0  
- Conservative pruning:
  - PoV kept until the block that finalised its availability has itself been finalised for **1 day + 1 hour**. citeturn24search0  
  - Chunks kept until the dispute period for the candidate has ended, implemented via the same “final for 1 day + 1 hour” criterion. citeturn24search0  

This means validator storage scales with: (candidates per day) × (local chunk size) × (retention window), plus some full PoVs for locally validated candidates. citeturn24search0turn24search3  

### Non-validator full nodes

The protocol spec’s request/response layer includes non-validator nodes as participants in network messaging (they can send/receive certain request types). citeturn8view0  

However, the *availability store / bitfield signing / availability recovery* subsystems are validator-centric, and the implementers guide notes that bitfield signing “if not running as a validator, do nothing.” citeturn24search5turn24search0  

So the typical “full node” cost profile is dominated by:

- relay-chain block sync/verification,  
- gossip overhead,  
- optional serving of requested data if configured (implementation-dependent), rather than mandatory chunk custody. citeturn8view0turn24search4  

### Light clients

The documentation set here describes light clients at the relay-chain level, but the DA path described for parachain candidates is not a light-client DAS model; instead, “confidence” comes from finality rules that effectively refuse to finalise unapproved/unavailable candidates. citeturn23view0turn7view4turn8view4  

Thus, light client resource usage is primarily:

- header/finality proof verification,  
- not chunk sampling. citeturn23view0  

### Archival nodes

An “archival node” in Polkadot terms (full history) is not automatically a “store all PoVs forever” node; PoVs and chunks are explicitly pruned by validators after the retention window. Long-term archival of full PoVs would require additional infrastructure beyond the mandatory protocol roles described here. citeturn24search0turn1search4  

## Robustness, failure behaviour, and economics

### Missing peers and partial outages

Robustness mechanisms are explicitly documented:

- Recovery queries **randomly chosen validators** until f+1 pieces are obtained, which is a direct mitigation against partial outages and adversarial peer selection. citeturn24search2turn7view3  
- Availability distribution notes real-world failure modes: needing to request chunks from backing validators, potential throughput issues if backers don’t deliver quickly, and the fact that only active leaves are considered (which can cause some validators to miss fetching their chunk if availability is reached very quickly). citeturn24search4  
- Bitfield distribution maintains peer reputation scoring and only gossips bitfields relevant to current view, which is a robustness measure against spam and stale data. citeturn24search9  

Worst-case latency under significant outages follows the logic: you may need to try many peers to reach f+1 pieces, and approvals/finality may be delayed correspondingly (consistent with ELVES’ “replace no-shows by more auditors” model). citeturn24search2turn23view0  

### Fallback modes and escalation

Polkadot’s “fallback” is not described as “committee → P2P” (because it is already P2P request/response + gossip), but rather as:

- **escalate recovery attempts** (different strategies, query more validators) citeturn24search2  
- **escalate approvals** (additional tranches when assigned auditors do not respond soon enough) citeturn23view0turn27view0  
- **enter disputes**, which begin with ensuring availability if needed, and then proceed on-chain for slashing/penalties. citeturn24search13turn24search11  

### Observed operational issues relevant to DA health

Public release communications show that validator performance issues are taken seriously at network-upgrade time. For example, the Polkadot v2.0.0 runtime release notification warns that relay validators “might experience occasional slowdowns” without a specific db-cache setting during testing of the Asset Hub migration, and requests a mitigation. While not a DA incident per se, validator slowdowns are DA-relevant because DA depends on validators serving chunks reliably and on time. citeturn25search3  

### Economics of data publishing and “who pays for DA”

Polkadot’s economics are not a per-byte DA fee market like “blob gas.” Instead, DA is bundled into *blockspace*:

- Through the “Agile Coretime” framing, coretime is treated as the mechanism for purchasing access to cores (parallel execution capacity), and a runtime upgrade explicitly changes core supply (cores count) and introduces minimum price controller settings for coretime sales. This is the closest analogue to a “DA fee market,” but it prices *coretime/blockspace*, not bytes of DA payload. citeturn25search0turn25search3  

Slashing economics (relevant to validity/approval/dispute accountability):

- Slashed tokens are added to the Treasury (per support documentation). This is part of the incentive structure deterring provably malicious behaviour, though—crucially—pure data withholding remains difficult to slash unless it materialises as a provable protocol offence (e.g., wrong-side dispute votes, invalid backing). citeturn24search1turn24search11turn7view4  

Hidden/non-obvious costs that function as DA “tax” even without per-byte pricing:

- Validator bandwidth, storage, and operational overhead for maintaining chunks and serving recovery for the retention window. citeturn24search0turn24search2turn24search4  
- Collator infrastructure overhead in adversarial conditions (availability recovery is also used by collators when other collators censor blocks). citeturn24search2  

