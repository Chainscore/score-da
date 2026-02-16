#!/usr/bin/env npx tsx
/**
 * Polkadot DA Throughput — data collection
 *
 * Queries relay-chain blocks for parachain availability, backing, and
 * inclusion events. Writes raw per-block observations to CSV; derived
 * metrics (throughput, utilization) are computed via Dune dashboards.
 *
 * Outputs (relative to this script):
 *   1. throughput.csv       — per-block event data
 *   2. chain_config.json    — active config + governance milestones
 *   3. blocks/<date>.csv    — per-day raw block data (--days mode)
 *   4. stdout               — summary table
 *
 * Usage:
 *   npx tsx data/throughput/collect.ts --blocks 5000
 *   npx tsx data/throughput/collect.ts --days 90
 */

import { ApiPromise, WsProvider } from "@polkadot/api";
import { writeFile, mkdir, readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw per-block observations — only data that requires RPC. */
interface Row {
  block_number: number;
  timestamp: number;
  backed: number;          // paraInclusion.CandidateBacked
  included: number;        // paraInclusion.CandidateIncluded
  timed_out: number;       // paraInclusion.CandidateTimedOut
  disputes: number;        // parasDisputes.DisputeInitiated
  cores_active: number;    // unique CoreIndex from CandidateIncluded
  distinct_paras: number;  // unique ParaId from CandidateIncluded
  bitfields: number;       // signed availability bitfields submitted (from paraInherent.enter)
  avg_avail: number;       // mean availability fraction across occupied cores (0..1)
}

interface ChainConfig {
  maxPovBytes: number;
  numCores: number;
  validatorCount: number;
  backingGroupSize: number;
  effectiveCores: number;
  cadence: number;
  protocolMaxMibps: number;
  // Approval voting parameters (from configuration.activeConfig)
  neededApprovals: number;
  nDelayTranches: number;
  noShowSlots: number;
  zerothDelayTrancheWidth: number;
}

interface Milestone {
  ref: number;
  label: string;
  block: number | null;
  timestamp: number | null;
}

interface Opts {
  rpcs: string[];
  blocks: number;
  days: number;
  step: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MiB = 1_048_576;
const BLOCK_TIME_MS = 6_000;
const BACKING_GROUP_SIZE = 5;
const BLOCKS_PER_DAY = 14_400;
const DEFAULT_RPCS = [
  "wss://rpc.polkadot.io",
  "wss://polkadot-rpc.dwellir.com",
  "wss://rpc.ibp.network/polkadot",
];
const DEFAULT_BLOCKS = 1000;
const DEFAULT_STEP = 100;          // 1 block per 10 minutes in --days mode
const BATCH_SIZE_BLOCKS = 100;     // batch size for --blocks mode
const BATCH_SIZE_DAYS = 50;        // batch size for --days mode (150 concurrent RPC calls)
const BATCH_SLEEP_MS = 200;        // sleep between batches in --days mode
const MAX_RETRIES = 3;
const ROTATE_AFTER_FAILURES = 5;   // consecutive block failures before RPC rotation
const OUTPUT_DIR =
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);

/**
 * Governance milestones that changed DA-relevant parameters.
 * Execution blocks/timestamps sourced from Polkassembly statusHistory.
 */
const MILESTONES: Milestone[] = [
  { ref: 1200, label: "Validators 400→500 (usable cores 80→100)",  block: 23120301, timestamp: 1729856238000 }, // 2024-10-25
  { ref: 1480, label: "PoV limit 5→10 MiB",                       block: 25342222, timestamp: 1743233346000 }, // 2025-03-29
  { ref: 1484, label: "Validators 500→600 (usable cores 100→120)", block: 25164320, timestamp: 1742159838000 }, // 2025-03-16
  { ref: 1536, label: "Cores 62→66",                               block: 25786439, timestamp: 1745920674001 }, // 2025-04-29
  { ref: 1629, label: "Cores 66→100",                              block: 26803000, timestamp: 1752061098000 }, // 2025-07-09
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const rpcs: string[] = [];
  const opts: Opts = { rpcs: [], blocks: DEFAULT_BLOCKS, days: 0, step: 0 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--blocks" && args[i + 1]) {
      opts.blocks = parseInt(args[++i], 10);
    } else if (args[i] === "--days" && args[i + 1]) {
      opts.days = parseInt(args[++i], 10);
    } else if (args[i] === "--step" && args[i + 1]) {
      opts.step = parseInt(args[++i], 10);
    } else if (args[i] === "--rpc" && args[i + 1]) {
      rpcs.push(args[++i]);
    }
  }
  opts.rpcs = rpcs.length > 0 ? rpcs : DEFAULT_RPCS;
  if (opts.days > 0 && opts.step === 0) opts.step = DEFAULT_STEP;
  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const opts = parseArgs();

  if (opts.days > 0) {
    await collectDays(opts.rpcs, opts.days, opts.step);
    return;
  }

  // ---- Original --blocks mode (unchanged behavior) ----
  const rpc = opts.rpcs[0];
  const provider = new WsProvider(rpc);
  const api = await ApiPromise.create({ provider, noInitWarn: true });

  try {
    const head = await api.rpc.chain.getHeader();
    const endBlock = head.number.toNumber();
    const startBlock = endBlock - opts.blocks + 1;

    // ---- Active chain config + head timestamp (fetched once) ----
    const headHash = await api.rpc.chain.getBlockHash(endBlock);
    const cc = await readChainConfig(api, headHash);
    const headTs = ((await api.query.timestamp.now.at(headHash)) as any).toNumber() as number;
    const tsOf = (bn: number) => headTs + (bn - endBlock) * BLOCK_TIME_MS;

    console.log(
      `Polkadot DA Throughput — ${opts.blocks} blocks (${startBlock}..${endBlock})`
    );
    console.log(`RPC: ${rpc}`);
    console.log(
      `Config: max_pov=${(cc.maxPovBytes / MiB).toFixed(2)} MiB  cores=${cc.numCores}  validators=${cc.validatorCount}  effective_cores=${cc.effectiveCores}  cadence=${cc.cadence}s`
    );
    console.log(`Protocol max: ${cc.protocolMaxMibps.toFixed(2)} MiB/s\n`);

    // ---- Governance milestones (constants — no RPC) ----
    for (const m of MILESTONES) {
      const date = new Date(m.timestamp!).toISOString().slice(0, 10);
      console.log(`  #${m.ref}  block ${m.block}  (${date})  ${m.label}`);
    }
    console.log();

    // ---- Per-block data ----
    const rows: Row[] = [];
    const t0 = Date.now();
    let done = 0;

    for (let bn = startBlock; bn <= endBlock; bn += BATCH_SIZE_BLOCKS) {
      const batchEnd = Math.min(bn + BATCH_SIZE_BLOCKS - 1, endBlock);
      const promises: Promise<Row | null>[] = [];
      for (let b = bn; b <= batchEnd; b++) {
        promises.push(fetchBlock(api, b, tsOf(b)));
      }

      const settled = await Promise.allSettled(promises);
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) rows.push(r.value);
      }
      done += settled.length;

      const elapsed = (Date.now() - t0) / 1000;
      if (elapsed > 0 && done < opts.blocks) {
        const bps = (done / elapsed).toFixed(1);
        process.stdout.write(
          `\r  ${done}/${opts.blocks} blocks  (${bps} blocks/s)`
        );
      }
    }

    process.stdout.write(
      `\r  ${done}/${opts.blocks} blocks  done${" ".repeat(20)}\n\n`
    );

    rows.sort((a, b) => a.block_number - b.block_number);

    // ---- Write outputs ----
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeCsv(rows);
    await writeConfig(cc, MILESTONES, startBlock, endBlock);
    printSummary(rows, startBlock, endBlock, cc);
  } finally {
    await api.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Read active chain config from a single block hash
// ---------------------------------------------------------------------------
async function readChainConfig(
  api: ApiPromise,
  atHash: any
): Promise<ChainConfig> {
  const rawConfig = await api.query.configuration.activeConfig.at(atHash);
  const cfg = rawConfig.toJSON() as Record<string, any>;

  const maxPovBytes: number =
    cfg.maxPovSize ?? cfg.max_pov_size ?? 10 * MiB;

  const sched = cfg.schedulerParams ?? cfg.scheduler_params ?? {};
  const numCores: number = sched.numCores ?? sched.num_cores ?? 50;

  const asyncParams =
    cfg.asyncBackingParams ?? cfg.async_backing_params ?? {};
  const maxCandidateDepth: number =
    asyncParams.maxCandidateDepth ?? asyncParams.max_candidate_depth ?? 0;
  const cadence = maxCandidateDepth > 0 ? 6 : 12;

  const validatorsRaw = await api.query.session.validators.at(atHash);
  const validatorCount = (validatorsRaw as unknown as unknown[]).length;

  const effectiveCores = Math.min(
    numCores,
    Math.floor(validatorCount / BACKING_GROUP_SIZE)
  );
  const protocolMaxMibps = (effectiveCores * maxPovBytes) / cadence / MiB;

  // Approval voting parameters (from the same activeConfig)
  const approvalVoting = cfg.approvalVotingParams ?? cfg.approval_voting_params ?? {};
  const neededApprovals: number =
    approvalVoting.neededApprovals ?? approvalVoting.needed_approvals ?? cfg.neededApprovals ?? cfg.needed_approvals ?? 30;
  const nDelayTranches: number =
    cfg.nDelayTranches ?? cfg.n_delay_tranches ?? approvalVoting.nDelayTranches ?? approvalVoting.n_delay_tranches ?? 40;
  const noShowSlots: number =
    cfg.noShowSlots ?? cfg.no_show_slots ?? approvalVoting.noShowSlots ?? approvalVoting.no_show_slots ?? 2;
  const zerothDelayTrancheWidth: number =
    cfg.zerothDelayTrancheWidth ?? cfg.zeroth_delay_tranche_width ?? approvalVoting.zerothDelayTrancheWidth ?? approvalVoting.zeroth_delay_tranche_width ?? 0;

  return {
    maxPovBytes,
    numCores,
    validatorCount,
    backingGroupSize: BACKING_GROUP_SIZE,
    effectiveCores,
    cadence,
    protocolMaxMibps,
    neededApprovals,
    nDelayTranches,
    noShowSlots,
    zerothDelayTrancheWidth,
  };
}

// ---------------------------------------------------------------------------
// Utilities: sleep
// ---------------------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// RPC connection manager with rotation
// ---------------------------------------------------------------------------
class RpcManager {
  private rpcs: string[];
  private currentIdx = 0;
  private api: ApiPromise | null = null;
  private consecutiveFailures = 0;

  constructor(rpcs: string[]) {
    this.rpcs = rpcs;
  }

  async getApi(): Promise<ApiPromise> {
    if (this.api) return this.api;
    const url = this.rpcs[this.currentIdx];
    console.log(`Connecting to RPC: ${url}`);
    const provider = new WsProvider(url);
    this.api = await ApiPromise.create({ provider, noInitWarn: true });
    this.consecutiveFailures = 0;
    return this.api;
  }

  async rotate(): Promise<ApiPromise> {
    if (this.api) {
      try { await this.api.disconnect(); } catch { /* ignore */ }
      this.api = null;
    }
    this.currentIdx = (this.currentIdx + 1) % this.rpcs.length;
    console.log(`Rotating to RPC: ${this.rpcs[this.currentIdx]}`);
    return this.getApi();
  }

  async onBlockFailure(): Promise<void> {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= ROTATE_AFTER_FAILURES) {
      console.warn(`\n  ${this.consecutiveFailures} consecutive failures — rotating RPC`);
      await this.rotate();
    }
  }

  onBlockSuccess(): void {
    this.consecutiveFailures = 0;
  }

  async disconnect(): Promise<void> {
    if (this.api) {
      try { await this.api.disconnect(); } catch { /* ignore */ }
      this.api = null;
    }
  }

  currentRpc(): string {
    return this.rpcs[this.currentIdx];
  }
}

// ---------------------------------------------------------------------------
// Fetch block with retry + exponential backoff
// ---------------------------------------------------------------------------
async function fetchBlockWithRetry(
  mgr: RpcManager,
  blockNumber: number,
  timestamp: number,
): Promise<Row | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const api = await mgr.getApi();
      const result = await fetchBlock(api, blockNumber, timestamp);
      if (result) mgr.onBlockSuccess();
      return result;
    } catch {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
  }
  await mgr.onBlockFailure();
  return null;
}

// ---------------------------------------------------------------------------
// Day-by-day collection (--days mode)
// ---------------------------------------------------------------------------
async function collectDays(
  rpcs: string[],
  days: number,
  step: number,
): Promise<void> {
  const mgr = new RpcManager(rpcs);
  const api = await mgr.getApi();

  // 1. Get head block + timestamp
  const head = await api.rpc.chain.getHeader();
  const endBlock = head.number.toNumber();
  const headHash = await api.rpc.chain.getBlockHash(endBlock);
  const headTs = ((await api.query.timestamp.now.at(headHash)) as any).toNumber() as number;

  // 2. Calculate block range
  const startBlock = endBlock - days * BLOCKS_PER_DAY;
  const totalSampled = Math.ceil((days * BLOCKS_PER_DAY) / step);

  console.log(`Polkadot DA Throughput — ${days}-day collection`);
  console.log(`  Block range: ${startBlock}..${endBlock} (${days * BLOCKS_PER_DAY} blocks)`);
  console.log(`  Sampling: every ${step} blocks (${totalSampled} samples, ${Math.ceil(BLOCKS_PER_DAY / step)}/day)`);
  console.log(`  RPCs: ${rpcs.join(", ")}\n`);

  // 3. Ensure data directory exists
  const dataDir = path.join(OUTPUT_DIR, "blocks");
  await mkdir(dataDir, { recursive: true });

  // 4. Day-by-day collection (oldest → newest)
  const t0 = Date.now();
  let totalCollected = 0;
  let daysSkipped = 0;

  for (let d = days - 1; d >= 0; d--) {
    const dayStartBlock = endBlock - (d + 1) * BLOCKS_PER_DAY;
    const dayEndBlock = endBlock - d * BLOCKS_PER_DAY - 1;

    // Estimate date from block offset
    const dayTs = headTs + (dayStartBlock - endBlock) * BLOCK_TIME_MS;
    const dateStr = new Date(dayTs).toISOString().slice(0, 10);
    const dayFile = path.join(dataDir, `${dateStr}.csv`);

    // Skip if already collected
    if (existsSync(dayFile)) {
      daysSkipped++;
      continue;
    }

    // Calibrate: fetch actual on-chain timestamp at first block of this day
    let calibTs = dayTs;
    try {
      const currentApi = await mgr.getApi();
      const calibHash = await currentApi.rpc.chain.getBlockHash(dayStartBlock);
      calibTs = ((await currentApi.query.timestamp.now.at(calibHash)) as any).toNumber() as number;
    } catch {
      // Fall back to estimated timestamp
    }
    const tsOf = (bn: number) => calibTs + (bn - dayStartBlock) * BLOCK_TIME_MS;

    // Build list of sampled block numbers for this day
    const blocks: number[] = [];
    for (let bn = dayStartBlock; bn <= dayEndBlock; bn += step) {
      blocks.push(bn);
    }

    // Fetch in batches
    const sampled: Row[] = [];
    const dayT0 = Date.now();
    for (let i = 0; i < blocks.length; i += BATCH_SIZE_DAYS) {
      const batch = blocks.slice(i, i + BATCH_SIZE_DAYS);
      const results = await Promise.allSettled(
        batch.map((bn) => fetchBlockWithRetry(mgr, bn, tsOf(bn)))
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) sampled.push(r.value);
      }
      // Progress every 1000 blocks
      if (sampled.length > 0 && sampled.length % 1000 < BATCH_SIZE_DAYS) {
        const dayElapsed = ((Date.now() - dayT0) / 1000).toFixed(0);
        const bps = (sampled.length / ((Date.now() - dayT0) / 1000)).toFixed(1);
        console.log(`    ${dateStr}  ${sampled.length}/${blocks.length} blocks  (${bps} blk/s, ${dayElapsed}s)`);
      }
      if (i + BATCH_SIZE_DAYS < blocks.length) {
        await sleep(BATCH_SLEEP_MS);
      }
    }

    // Write day CSV
    sampled.sort((a, b) => a.block_number - b.block_number);
    await writeDayCsv(dayFile, sampled);
    totalCollected += sampled.length;

    const dayNum = days - d;
    const elapsed = (Date.now() - t0) / 1000;
    const daysRemaining = d;
    const eta = daysRemaining > 0 && dayNum > daysSkipped
      ? ((elapsed / (dayNum - daysSkipped)) * daysRemaining).toFixed(0)
      : "?";
    console.log(
      `  ${dateStr}  ${String(sampled.length).padStart(4)} blocks  ` +
      `(day ${dayNum}/${days}, ${totalCollected} total, ETA ${eta}s)`
    );
  }

  if (daysSkipped > 0) {
    console.log(`\n  Skipped ${daysSkipped} days (already collected)`);
  }

  // 5. Merge all day files → throughput.csv
  console.log("\nMerging day files...");
  await mergeDayFiles();

  // 6. Write chain_config.json
  const currentApi = await mgr.getApi();
  const cc = await readChainConfig(currentApi, headHash);
  await writeConfig(cc, MILESTONES, startBlock, endBlock);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone — ${totalCollected} blocks collected in ${elapsed}s`);

  await mgr.disconnect();
}

// ---------------------------------------------------------------------------
// Write a single day's CSV
// ---------------------------------------------------------------------------
async function writeDayCsv(filePath: string, rows: Row[]): Promise<void> {
  const header =
    "block_number,timestamp,backed,included,timed_out,disputes,cores_active,distinct_paras,bitfields,avg_avail\n";
  const body = rows
    .map(
      (r) =>
        `${r.block_number},${r.timestamp},${r.backed},${r.included},${r.timed_out},${r.disputes},${r.cores_active},${r.distinct_paras},${r.bitfields},${r.avg_avail}`
    )
    .join("\n");
  await writeFile(filePath, header + body + "\n");
}

// ---------------------------------------------------------------------------
// Merge all day CSVs into analysis/throughput.csv
// ---------------------------------------------------------------------------
async function mergeDayFiles(): Promise<void> {
  const dataDir = path.join(OUTPUT_DIR, "blocks");
  const files = (await readdir(dataDir))
    .filter((f) => f.endsWith(".csv"))
    .sort();

  const header =
    "block_number,timestamp,backed,included,timed_out,disputes,cores_active,distinct_paras,bitfields,avg_avail\n";
  const allLines: string[] = [];

  for (const file of files) {
    const content = await readFile(path.join(dataDir, file), "utf-8");
    const lines = content.trim().split("\n").slice(1); // skip header
    allLines.push(...lines);
  }

  // Sort by block_number (first CSV column)
  allLines.sort((a, b) => {
    const aN = parseInt(a.split(",")[0], 10);
    const bN = parseInt(b.split(",")[0], 10);
    return aN - bN;
  });

  const outPath = path.join(OUTPUT_DIR, "throughput.csv");
  await writeFile(outPath, header + allLines.join("\n") + "\n");
  console.log(`CSV    → ${outPath}  (${allLines.length} rows from ${files.length} day files)`);
}

// ---------------------------------------------------------------------------
// Fetch a single block (3 RPC calls: getBlockHash + system.events + getBlock)
// ---------------------------------------------------------------------------
async function fetchBlock(
  api: ApiPromise,
  blockNumber: number,
  timestamp: number
): Promise<Row | null> {
  try {
    const hash = await api.rpc.chain.getBlockHash(blockNumber);
    const [eventsRaw, signedBlock] = await Promise.all([
      api.query.system.events.at(hash),
      api.rpc.chain.getBlock(hash),
    ]);
    const allEvents = eventsRaw as unknown as Array<{
      event: { section: string; method: string; data: any[] };
    }>;

    // paraInclusion events
    const backedEvents = allEvents.filter(
      ({ event }) =>
        event.section === "paraInclusion" &&
        event.method === "CandidateBacked"
    );
    const includedEvents = allEvents.filter(
      ({ event }) =>
        event.section === "paraInclusion" &&
        event.method === "CandidateIncluded"
    );
    const timedOutEvents = allEvents.filter(
      ({ event }) =>
        event.section === "paraInclusion" &&
        event.method === "CandidateTimedOut"
    );

    // parasDisputes events
    const disputeEvents = allEvents.filter(
      ({ event }) =>
        event.section === "parasDisputes" &&
        event.method === "DisputeInitiated"
    );

    // Unique cores and parachain IDs from included candidates
    // CandidateIncluded(CandidateReceipt, HeadData, CoreIndex, GroupIndex)
    const coreSet = new Set<number>();
    const paraSet = new Set<number>();
    for (const { event } of includedEvents) {
      try {
        const coreIndex = (event.data[2] as any).toNumber?.()
          ?? Number(event.data[2]);
        coreSet.add(coreIndex);
      } catch { /* skip if can't parse */ }
      try {
        const receipt = event.data[0] as any;
        const paraId = receipt.descriptor?.paraId?.toNumber?.()
          ?? receipt.descriptor?.para_id?.toNumber?.()
          ?? Number(receipt.descriptor?.paraId ?? receipt.descriptor?.para_id);
        if (!isNaN(paraId)) paraSet.add(paraId);
      } catch { /* skip if can't parse */ }
    }

    // Parse paraInherent.enter for availability bitfields
    let bitfieldsCount = 0;
    let avgAvail = 0;
    const inherent = signedBlock.block.extrinsics.find(
      (ex: any) =>
        ex.method.section === "paraInherent" && ex.method.method === "enter"
    ) as any;
    if (inherent) {
      const data = inherent.method.args[0]; // ParachainsInherentData
      const bitfields = data.bitfields ?? data.signed_bitfields ?? [];
      bitfieldsCount = bitfields.length;

      // Per-core availability: count how many bitfields have each bit set.
      // Each bitfield.payload is a bitvec, one bit per core.
      if (bitfieldsCount > 0 && coreSet.size > 0) {
        const coreBits = new Map<number, number>(); // coreIndex → attestation count
        for (const core of coreSet) coreBits.set(core, 0);

        for (const bf of bitfields) {
          try {
            const payload = bf.payload ?? bf;
            // payload is a bitvec — access as Uint8Array of bytes
            const bytes: Uint8Array =
              payload.toU8a ? payload.toU8a(true) : new Uint8Array();
            for (const core of coreSet) {
              const byteIdx = core >> 3;
              const bitIdx = core & 7;
              if (byteIdx < bytes.length && (bytes[byteIdx] & (1 << bitIdx))) {
                coreBits.set(core, (coreBits.get(core) ?? 0) + 1);
              }
            }
          } catch { /* skip malformed bitfield */ }
        }

        // Average availability fraction across occupied cores
        let totalFrac = 0;
        for (const count of coreBits.values()) {
          totalFrac += count / bitfieldsCount;
        }
        avgAvail = totalFrac / coreBits.size;
      }
    }

    return {
      block_number: blockNumber,
      timestamp,
      backed: backedEvents.length,
      included: includedEvents.length,
      timed_out: timedOutEvents.length,
      disputes: disputeEvents.length,
      cores_active: coreSet.size,
      distinct_paras: paraSet.size,
      bitfields: bitfieldsCount,
      avg_avail: Math.round(avgAvail * 10000) / 10000, // 4 decimal places
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Output 1: CSV
// ---------------------------------------------------------------------------
async function writeCsv(rows: Row[]): Promise<void> {
  const header =
    "block_number,timestamp,backed,included,timed_out,disputes,cores_active,distinct_paras,bitfields,avg_avail\n";
  const body = rows
    .map(
      (r) =>
        `${r.block_number},${r.timestamp},${r.backed},${r.included},${r.timed_out},${r.disputes},${r.cores_active},${r.distinct_paras},${r.bitfields},${r.avg_avail}`
    )
    .join("\n");
  const p = path.join(OUTPUT_DIR, "throughput.csv");
  await writeFile(p, header + body + "\n");
  console.log(`CSV    → ${p}`);
}

// ---------------------------------------------------------------------------
// Output 2: chain_config.json
// ---------------------------------------------------------------------------
async function writeConfig(
  cc: ChainConfig,
  milestones: Milestone[],
  startBlock: number,
  endBlock: number
): Promise<void> {
  const obj = {
    blockRange: { start: startBlock, end: endBlock },
    config: cc,
    milestones,
  };
  const p = path.join(OUTPUT_DIR, "chain_config.json");
  await writeFile(p, JSON.stringify(obj, null, 2) + "\n");
  console.log(`Config → ${p}`);
}

// ---------------------------------------------------------------------------
// Output 3: stdout summary
// ---------------------------------------------------------------------------
function printSummary(
  rows: Row[],
  startBlock: number,
  endBlock: number,
  cc: ChainConfig
): void {
  const pctl = (arr: number[], p: number): number => {
    const s = [...arr].sort((a, b) => a - b);
    const i = Math.ceil((p / 100) * s.length) - 1;
    return s[Math.max(0, i)];
  };
  const mean = (arr: number[]): number =>
    arr.reduce((a, b) => a + b, 0) / arr.length;
  const sum = (arr: number[]): number =>
    arr.reduce((a, b) => a + b, 0);

  const included = rows.map((r) => r.included);
  const backed = rows.map((r) => r.backed);
  const cores = rows.map((r) => r.cores_active);
  const paras = rows.map((r) => r.distinct_paras);
  const bfs = rows.map((r) => r.bitfields);
  const avails = rows.filter((r) => r.avg_avail > 0).map((r) => r.avg_avail);
  const totalTimedOut = sum(rows.map((r) => r.timed_out));
  const totalDisputes = sum(rows.map((r) => r.disputes));
  const totalIncluded = sum(included);

  const title = `Polkadot DA Throughput — ${rows.length} blocks (${startBlock}..${endBlock})`;
  const line = "─".repeat(title.length);
  console.log(`\n${title}`);
  console.log(line);

  // Derived throughput from included counts
  const throughputs = included.map(
    (n) => (n * cc.maxPovBytes) / cc.cadence / MiB
  );
  const utilizations = included.map((n) => n / cc.effectiveCores);

  const labels = ["min", "p10", "p50", "p90", "p99", "max", "mean"] as const;
  const statFn = (arr: number[], label: string): number => {
    if (label === "min") return Math.min(...arr);
    if (label === "max") return Math.max(...arr);
    if (label === "mean") return mean(arr);
    return pctl(arr, parseInt(label.slice(1)));
  };

  console.log(
    `${"".padStart(10)}  backed  included  cores  paras  bitfields  throughput  utilization`
  );
  for (const label of labels) {
    const b = statFn(backed, label);
    const inc = statFn(included, label);
    const c = statFn(cores, label);
    const p = statFn(paras, label);
    const bf = statFn(bfs, label);
    const tp = statFn(throughputs, label);
    const ut = statFn(utilizations, label);

    const lbl = label.padStart(10);
    const bs = (Number.isInteger(b) ? String(b) : b.toFixed(1)).padStart(8);
    const is_ = (Number.isInteger(inc) ? String(inc) : inc.toFixed(1)).padStart(10);
    const cs = (Number.isInteger(c) ? String(c) : c.toFixed(1)).padStart(7);
    const ps = (Number.isInteger(p) ? String(p) : p.toFixed(1)).padStart(7);
    const bfs_ = (Number.isInteger(bf) ? String(bf) : bf.toFixed(1)).padStart(11);
    const ts = tp.toFixed(2).padStart(12);
    const us = ((ut * 100).toFixed(1) + "%").padStart(13);
    console.log(`${lbl}${bs}${is_}${cs}${ps}${bfs_}${ts}${us}`);
  }
  if (avails.length > 0) {
    const avgA = avails.reduce((a, b) => a + b, 0) / avails.length;
    console.log(
      `\nBitfield availability (occupied cores): mean ${(avgA * 100).toFixed(1)}%  min ${(Math.min(...avails) * 100).toFixed(1)}%  max ${(Math.max(...avails) * 100).toFixed(1)}%`
    );
  }

  console.log(line);
  console.log(
    `Totals: ${totalIncluded} included, ${totalTimedOut} timed out, ${totalDisputes} disputes`
  );
  if (totalIncluded + totalTimedOut > 0) {
    const availRate = totalIncluded / (totalIncluded + totalTimedOut);
    console.log(`Availability rate: ${(availRate * 100).toFixed(2)}%`);
  }
  console.log(
    `Config: max_pov=${(cc.maxPovBytes / MiB).toFixed(2)} MiB  cores=${cc.numCores}  effective_cores=${cc.effectiveCores}  cadence=${cc.cadence}s`
  );
  console.log(
    `Protocol max: ${cc.protocolMaxMibps.toFixed(2)} MiB/s  (${cc.effectiveCores} × ${(cc.maxPovBytes / MiB).toFixed(2)} MiB / ${cc.cadence}s)`
  );
  console.log(
    `Approval voting: needed_approvals=${cc.neededApprovals}  n_delay_tranches=${cc.nDelayTranches}  no_show_slots=${cc.noShowSlots}`
  );
  console.log(
    "Note: throughput is upper-bound (assumes max PoV per candidate)\n"
  );
}

// ---------------------------------------------------------------------------
main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
