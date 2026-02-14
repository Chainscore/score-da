#!/usr/bin/env npx tsx
/**
 * Avail DA — unified block collection + price table
 *
 * Single script that replaces throughput/collect.ts + cost/collect.ts.
 * Fetches per-block DA data (bytes, fees) in one pass and writes:
 *   - blocks.csv            — per-block data (unified)
 *   - prices.csv            — AVAIL/USD hourly prices (90d)
 *   - chain_config.json     — protocol config + milestones
 *   - blocks/YYYY-MM-DD.csv — per-day files (--days mode)
 *
 * Usage:
 *   npx tsx data/collect.ts                         # last 1000 blocks
 *   npx tsx data/collect.ts --blocks 5000           # last 5000 blocks
 *   npx tsx data/collect.ts --days 30               # 30-day collection with day files
 *   npx tsx data/collect.ts --days 90 --step 50     # sample every 50th block
 *   npx tsx data/collect.ts --rpc wss://... --rpc wss://...
 *   npx tsx data/collect.ts --prices-only           # fetch only CoinGecko prices
 */

import { ApiPromise, WsProvider } from "avail-js-sdk";
import { types, rpc, signedExtensions } from "avail-js-sdk/spec";
import { writeFile, mkdir, readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Row {
  block_number: number;
  timestamp_ms: number;
  spec_version: number;
  submit_data_bytes: number;
  submit_data_count: number;
  block_fee_plancks: bigint;
  block_time_ms: number;
}

interface ChainConfig {
  expectedBlockTimeMs: number;
  maxBlockBytes: number;
  specVersion: number;
  maxMibPerS: number;
  avgBlockTimeMs: number;
  empiricalMaxSubmitBytes: number;
  availDecimals: number;
  currentAvailUsd: number;
  availUsdSource: string;
  avgFeePerMibAvail: number;
}

interface Milestone {
  label: string;
  block: number | null;
  timestamp_ms: number | null;
}

interface PricePoint {
  timestamp_ms: number;
  avail_usd: number;
}

interface Opts {
  rpcs: string[];
  blocks: number;
  days: number;
  step: number;
  pricesOnly: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MiB = 1_048_576;
const AVAIL_DECIMALS = 18;
const AVAIL_UNIT = 10 ** AVAIL_DECIMALS;
const EXPECTED_BLOCK_TIME_MS = 20_000;
const BLOCKS_PER_DAY = 4320; // 86400 / 20

const DEFAULT_RPCS = [
  "wss://mainnet-rpc.avail.so/ws",
  "wss://avail.api.onfinality.io/public-ws",
  "wss://avail-rpc.publicnode.com/",
  "wss://avail.rpc.vitwit.com/",
  "wss://rpc-avail.globalstake.io",
  "wss://avail.public.curie.radiumblock.co/ws",
  "wss://mainnet.avail-rpc.com/",
];
const DEFAULT_BLOCKS = 1000;
const DEFAULT_STEP_DAYS = 1;

const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 100;
const MAX_RETRIES = 3;
const ROTATE_AFTER_FAILURES = 5;
const BATCH_SIZE_DAYS = 50;
const BATCH_SLEEP_MS = 200;

const COINGECKO_IDS = ["avail", "avail-project"];

const OUTPUT_DIR =
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);

const MILESTONES: Milestone[] = [
  { label: "Mainnet launch", block: 1, timestamp_ms: 1721088000000 },
  { label: "v2.3.4.0 — 64 MiB blocks, ~1 block finality", block: null, timestamp_ms: 1733961600000 },
];

const CSV_HEADER =
  "block_number,timestamp_ms,spec_version,submit_data_bytes,submit_data_count,block_fee_plancks,block_time_ms\n";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const rpcs: string[] = [];
  const opts: Opts = { rpcs: [], blocks: DEFAULT_BLOCKS, days: 0, step: 0, pricesOnly: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--blocks" && args[i + 1]) {
      opts.blocks = parseInt(args[++i], 10);
    } else if (args[i] === "--days" && args[i + 1]) {
      opts.days = parseInt(args[++i], 10);
    } else if (args[i] === "--step" && args[i + 1]) {
      opts.step = parseInt(args[++i], 10);
    } else if (args[i] === "--rpc" && args[i + 1]) {
      rpcs.push(args[++i]);
    } else if (args[i] === "--prices-only") {
      opts.pricesOnly = true;
    }
  }

  opts.rpcs = rpcs.length > 0 ? rpcs : DEFAULT_RPCS;
  if (opts.days > 0 && opts.step === 0) opts.step = DEFAULT_STEP_DAYS;
  return opts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function plancksToAvail(plancks: bigint): number {
  return Number(plancks) / AVAIL_UNIT;
}

function rowToCsvLine(r: Row): string {
  return `${r.block_number},${r.timestamp_ms},${r.spec_version},${r.submit_data_bytes},${r.submit_data_count},${r.block_fee_plancks.toString()},${r.block_time_ms}`;
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
    this.api = await ApiPromise.create({
      provider,
      noInitWarn: true,
      types: types as any,
      rpc: rpc as any,
      signedExtensions: signedExtensions as any,
    });
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
// Unified block fetch — data bytes + fees in one pass
// ---------------------------------------------------------------------------

async function fetchBlock(
  api: ApiPromise,
  height: number,
): Promise<Row | null> {
  try {
    const hash = await api.rpc.chain.getBlockHash(height);
    const [signedBlock, eventsRaw, timestampRaw] = await Promise.all([
      api.rpc.chain.getBlock(hash),
      api.query.system.events.at(hash),
      api.query.timestamp.now.at(hash),
    ]);

    const timestampMs = (timestampRaw as any).toNumber
      ? (timestampRaw as any).toNumber()
      : Number(timestampRaw);

    // Spec version
    let specVersion = 0;
    try {
      const rv = await api.rpc.state.getRuntimeVersion(hash);
      specVersion = rv.specVersion.toNumber();
    } catch { /* keep 0 */ }

    const events = eventsRaw as unknown as Array<{
      event: { section: string; method: string; data: any[] };
      phase: any;
    }>;

    let submitDataBytes = 0;
    let submitDataCount = 0;
    let totalFeePlancks = 0n;

    const extrinsics = signedBlock.block.extrinsics;
    for (let extIdx = 0; extIdx < extrinsics.length; extIdx++) {
      const ext = extrinsics[extIdx];
      if (
        ext.method.section === "dataAvailability" &&
        ext.method.method === "submitData"
      ) {
        submitDataCount++;

        // Extract data payload size
        try {
          const dataArg = ext.method.args[0];
          const bytes = dataArg.toU8a
            ? dataArg.toU8a(true)
            : dataArg;
          submitDataBytes += bytes.length ?? bytes.byteLength ?? 0;
        } catch { /* skip if can't decode */ }

        // Find the TransactionFeePaid event for this extrinsic
        const feeEvent = events.find(
          ({ event, phase }) =>
            phase.isApplyExtrinsic &&
            phase.asApplyExtrinsic.eq(extIdx) &&
            event.section === "transactionPayment" &&
            event.method === "TransactionFeePaid"
        );

        if (feeEvent) {
          try {
            const actualFee = feeEvent.event.data[1];
            totalFeePlancks += BigInt(actualFee.toString());
          } catch { /* skip fee extraction on error */ }
        }
      }
    }

    return {
      block_number: height,
      timestamp_ms: timestampMs,
      spec_version: specVersion,
      submit_data_bytes: submitDataBytes,
      submit_data_count: submitDataCount,
      block_fee_plancks: totalFeePlancks,
      block_time_ms: 0, // computed after sorting
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch block with retry + exponential backoff
// ---------------------------------------------------------------------------

async function fetchBlockWithRetry(
  mgr: RpcManager,
  height: number,
): Promise<Row | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const api = await mgr.getApi();
      const result = await fetchBlock(api, height);
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
// CoinGecko price fetching
// ---------------------------------------------------------------------------

async function fetchAvailPrices90d(): Promise<PricePoint[]> {
  console.log("Fetching 90 days of AVAIL/USD from CoinGecko...");

  for (const coinId of COINGECKO_IDS) {
    try {
      const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=90`;
      const resp = await fetch(url);
      if (!resp.ok) {
        console.log(`  ${coinId}: HTTP ${resp.status}, trying next...`);
        continue;
      }

      const data = (await resp.json()) as any;
      if (!Array.isArray(data?.prices) || data.prices.length === 0) {
        console.log(`  ${coinId}: no price data, trying next...`);
        continue;
      }

      const points: PricePoint[] = data.prices.map(
        ([ts, price]: [number, number]) => ({
          timestamp_ms: ts,
          avail_usd: price,
        })
      );

      console.log(`  ${points.length} hourly price points fetched (coin: ${coinId})`);
      return points;
    } catch (err: any) {
      console.log(`  ${coinId}: ${err.message ?? err}, trying next...`);
    }
  }

  console.warn("  Warning: Could not fetch AVAIL/USD from CoinGecko");
  return [];
}

async function fetchAvailUsdSpot(): Promise<{ price: number; source: string }> {
  for (const coinId of COINGECKO_IDS) {
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
      const resp = await fetch(url);
      const data = (await resp.json()) as any;
      if (data?.[coinId]?.usd) {
        return { price: data[coinId].usd, source: `coingecko:${coinId}` };
      }
    } catch {
      continue;
    }
  }
  console.warn("  Warning: CoinGecko unavailable for spot price, using fallback");
  return { price: 0.05, source: "fallback" };
}

async function writePricesCsv(prices: PricePoint[]): Promise<void> {
  if (prices.length === 0) {
    console.log("  Skipping prices.csv (no price data available)");
    return;
  }
  const header = "timestamp_ms,date,avail_usd\n";
  const body = prices
    .map(
      (p) =>
        `${p.timestamp_ms},${new Date(p.timestamp_ms).toISOString()},${p.avail_usd.toFixed(6)}`
    )
    .join("\n");
  const p = path.join(OUTPUT_DIR, "prices.csv");
  await writeFile(p, header + body + "\n");
  console.log(`CSV    -> ${p}  (${prices.length} rows)`);
}

// ---------------------------------------------------------------------------
// --blocks mode (default)
// ---------------------------------------------------------------------------

async function collectBlocks(opts: Opts): Promise<void> {
  const mgr = new RpcManager(opts.rpcs);
  const api = await mgr.getApi();

  console.log(`Avail DA — collecting ${opts.blocks} blocks\n`);

  // Fetch chain constants
  let expectedBlockTimeMs = EXPECTED_BLOCK_TIME_MS;
  try {
    const bt = (api.consts.babe as any).expectedBlockTime;
    expectedBlockTimeMs = bt.toNumber ? bt.toNumber() : Number(bt);
  } catch {
    console.log("  (could not read babe.expectedBlockTime, using 20000 ms)");
  }

  let maxBlockBytes = 2 * MiB;
  try {
    const bl = (api.consts.system as any).blockLength;
    const blJson = bl.toJSON ? bl.toJSON() : bl;
    if (blJson?.max) {
      maxBlockBytes = blJson.max.normal ?? blJson.max.operational ?? maxBlockBytes;
    }
  } catch {
    console.log("  (could not read system.blockLength, using 2 MiB default)");
  }

  const runtimeVersion = await api.rpc.state.getRuntimeVersion();
  const currentSpec = runtimeVersion.specVersion.toNumber();

  console.log(`Expected block time: ${expectedBlockTimeMs} ms`);
  console.log(`Max block bytes (normal): ${(maxBlockBytes / MiB).toFixed(2)} MiB`);
  console.log(`Spec version: ${currentSpec}\n`);

  // Get finalized head
  const finalizedHash = await api.rpc.chain.getFinalizedHead();
  const finalizedHeader = await api.rpc.chain.getHeader(finalizedHash);
  const endBlock = finalizedHeader.number.toNumber();
  const startBlock = Math.max(1, endBlock - opts.blocks + 1);

  console.log(`Block range: ${startBlock}..${endBlock} (${endBlock - startBlock + 1} blocks)`);

  // Print milestones in range
  for (const m of MILESTONES) {
    if (m.block != null && m.block >= startBlock && m.block <= endBlock) {
      const date = new Date(m.timestamp_ms!).toISOString().slice(0, 10);
      console.log(`  ${date}  block ${m.block}  ${m.label}`);
    }
  }
  console.log();

  // Fetch blocks in batches
  const rows: Row[] = [];
  const upgrades: { block: number; fromSpec: number; toSpec: number }[] = [];
  let done = 0;
  let prevSpec = 0;
  const total = endBlock - startBlock + 1;
  const t0 = Date.now();

  for (let h = startBlock; h <= endBlock; h += BATCH_SIZE) {
    const batchEnd = Math.min(h + BATCH_SIZE - 1, endBlock);
    const promises: Promise<Row | null>[] = [];
    for (let b = h; b <= batchEnd; b++) {
      promises.push(fetchBlockWithRetry(mgr, b));
    }

    const settled = await Promise.allSettled(promises);
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value) {
        rows.push(r.value);
        if (prevSpec !== 0 && r.value.spec_version !== prevSpec) {
          upgrades.push({
            block: r.value.block_number,
            fromSpec: prevSpec,
            toSpec: r.value.spec_version,
          });
        }
        if (r.value.spec_version > 0) prevSpec = r.value.spec_version;
      }
    }

    done += batchEnd - h + 1;
    const elapsed = (Date.now() - t0) / 1000;
    if (elapsed > 0 && done < total) {
      process.stdout.write(
        `\r  ${done}/${total} blocks  (${(done / elapsed).toFixed(1)} blocks/s)`
      );
    }

    if (h + BATCH_SIZE <= endBlock) {
      await sleep(BATCH_DELAY_MS);
    }
  }
  process.stdout.write(
    `\r  ${done}/${total} blocks  done${" ".repeat(20)}\n\n`
  );

  rows.sort((a, b) => a.block_number - b.block_number);

  // Compute block_time_ms deltas
  for (let i = 1; i < rows.length; i++) {
    rows[i].block_time_ms = rows[i].timestamp_ms - rows[i - 1].timestamp_ms;
  }
  if (rows.length > 0) rows[0].block_time_ms = 0;

  // Log upgrades
  if (upgrades.length > 0) {
    console.log("Spec version changes detected:");
    for (const u of upgrades) {
      console.log(`  block ${u.block}: spec ${u.fromSpec} -> ${u.toSpec}`);
    }
    console.log();
  }

  // Fetch prices
  const spot = await fetchAvailUsdSpot();
  console.log(`AVAIL/USD: $${spot.price.toFixed(6)} (${spot.source})\n`);
  const prices = await fetchAvailPrices90d();

  // Build chain config
  const blockTimes = rows.slice(1).map((r) => r.block_time_ms).filter((t) => t > 0);
  const avgBt = blockTimes.length > 0
    ? blockTimes.reduce((a, b) => a + b, 0) / blockTimes.length
    : expectedBlockTimeMs;
  const maxSubmit = rows.length > 0 ? Math.max(...rows.map((r) => r.submit_data_bytes)) : 0;
  const maxMibPerS = (maxBlockBytes / MiB) / (expectedBlockTimeMs / 1000);

  // Compute avg fee per MiB
  const blocksWithData = rows.filter((r) => r.submit_data_count > 0 && r.submit_data_bytes > 0);
  let avgFeePerMibAvail = 0;
  if (blocksWithData.length > 0) {
    const feesPerMib = blocksWithData.map((b) => {
      const feeAvail = plancksToAvail(b.block_fee_plancks);
      return feeAvail / (b.submit_data_bytes / MiB);
    });
    avgFeePerMibAvail = feesPerMib.reduce((a, b) => a + b, 0) / feesPerMib.length;
  }

  const cc: ChainConfig = {
    expectedBlockTimeMs,
    maxBlockBytes,
    specVersion: currentSpec,
    maxMibPerS,
    avgBlockTimeMs: avgBt,
    empiricalMaxSubmitBytes: maxSubmit,
    availDecimals: AVAIL_DECIMALS,
    currentAvailUsd: spot.price,
    availUsdSource: spot.source,
    avgFeePerMibAvail,
  };

  // Write outputs
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeBlocksCsv(rows);
  await writePricesCsv(prices);

  // Build milestones including detected upgrades
  const allMilestones: Milestone[] = [...MILESTONES];
  for (const u of upgrades) {
    const r = rows.find((row) => row.block_number === u.block);
    allMilestones.push({
      label: `Spec upgrade ${u.fromSpec} -> ${u.toSpec}`,
      block: u.block,
      timestamp_ms: r?.timestamp_ms ?? null,
    });
  }

  await writeConfig(cc, allMilestones, startBlock, endBlock, prices);
  printSummary(rows, startBlock, endBlock, cc);

  await mgr.disconnect();
}

// ---------------------------------------------------------------------------
// --days mode
// ---------------------------------------------------------------------------

async function collectDays(opts: Opts): Promise<void> {
  const mgr = new RpcManager(opts.rpcs);
  const api = await mgr.getApi();

  // Get head block + timestamp
  const finalizedHash = await api.rpc.chain.getFinalizedHead();
  const finalizedHeader = await api.rpc.chain.getHeader(finalizedHash);
  const endBlock = finalizedHeader.number.toNumber();
  const headHash = await api.rpc.chain.getBlockHash(endBlock);
  const headTs = ((await api.query.timestamp.now.at(headHash)) as any).toNumber() as number;

  const startBlock = endBlock - opts.days * BLOCKS_PER_DAY;
  const totalSampled = Math.ceil((opts.days * BLOCKS_PER_DAY) / opts.step);

  console.log(`Avail DA — ${opts.days}-day collection`);
  console.log(`  Block range: ${startBlock}..${endBlock} (${opts.days * BLOCKS_PER_DAY} blocks)`);
  console.log(`  Sampling: every ${opts.step} blocks (${totalSampled} samples, ${Math.ceil(BLOCKS_PER_DAY / opts.step)}/day)`);
  console.log(`  RPCs: ${opts.rpcs.join(", ")}\n`);

  // Ensure data directory
  const dataDir = path.join(OUTPUT_DIR, "blocks");
  await mkdir(dataDir, { recursive: true });

  // Day-by-day collection (oldest -> newest)
  const t0 = Date.now();
  let totalCollected = 0;
  let daysSkipped = 0;

  for (let d = opts.days - 1; d >= 0; d--) {
    const dayStartBlock = endBlock - (d + 1) * BLOCKS_PER_DAY;
    const dayEndBlock = endBlock - d * BLOCKS_PER_DAY - 1;

    // Estimate date from block offset
    const dayTs = headTs + (dayStartBlock - endBlock) * EXPECTED_BLOCK_TIME_MS;
    const dateStr = new Date(dayTs).toISOString().slice(0, 10);
    const dayFile = path.join(dataDir, `${dateStr}.csv`);

    // Skip if already collected (resume support)
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

    // Build list of sampled block numbers for this day
    const blocks: number[] = [];
    for (let bn = dayStartBlock; bn <= dayEndBlock; bn += opts.step) {
      blocks.push(bn);
    }

    // Fetch in batches
    const sampled: Row[] = [];
    for (let i = 0; i < blocks.length; i += BATCH_SIZE_DAYS) {
      const batch = blocks.slice(i, i + BATCH_SIZE_DAYS);
      const results = await Promise.allSettled(
        batch.map((bn) => fetchBlockWithRetry(mgr, bn))
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) sampled.push(r.value);
      }
      if (i + BATCH_SIZE_DAYS < blocks.length) {
        await sleep(BATCH_SLEEP_MS);
      }
    }

    // Compute block_time_ms deltas within the day
    sampled.sort((a, b) => a.block_number - b.block_number);
    for (let i = 1; i < sampled.length; i++) {
      sampled[i].block_time_ms = sampled[i].timestamp_ms - sampled[i - 1].timestamp_ms;
    }
    if (sampled.length > 0) sampled[0].block_time_ms = 0;

    // Write day CSV
    await writeDayCsv(dayFile, sampled);
    totalCollected += sampled.length;

    const dayNum = opts.days - d;
    const elapsed = (Date.now() - t0) / 1000;
    const daysRemaining = d;
    const eta =
      daysRemaining > 0 && dayNum > daysSkipped
        ? ((elapsed / (dayNum - daysSkipped)) * daysRemaining).toFixed(0)
        : "?";
    console.log(
      `  ${dateStr}  ${String(sampled.length).padStart(4)} blocks  ` +
        `(day ${dayNum}/${opts.days}, ${totalCollected} total, ETA ${eta}s)`
    );
  }

  if (daysSkipped > 0) {
    console.log(`\n  Skipped ${daysSkipped} days (already collected)`);
  }

  // Merge all day files -> blocks.csv
  console.log("\nMerging day files...");
  await mergeDayFiles();

  // Fetch prices
  const spot = await fetchAvailUsdSpot();
  console.log(`\nAVAIL/USD: $${spot.price.toFixed(6)} (${spot.source})`);
  const prices = await fetchAvailPrices90d();
  await writePricesCsv(prices);

  // Fetch chain constants for config
  let expectedBlockTimeMs = EXPECTED_BLOCK_TIME_MS;
  try {
    const bt = (api.consts.babe as any).expectedBlockTime;
    expectedBlockTimeMs = bt.toNumber ? bt.toNumber() : Number(bt);
  } catch { /* use default */ }

  let maxBlockBytes = 2 * MiB;
  try {
    const bl = (api.consts.system as any).blockLength;
    const blJson = bl.toJSON ? bl.toJSON() : bl;
    if (blJson?.max) {
      maxBlockBytes = blJson.max.normal ?? blJson.max.operational ?? maxBlockBytes;
    }
  } catch { /* use default */ }

  const rv = await api.rpc.state.getRuntimeVersion();
  const currentSpec = rv.specVersion.toNumber();
  const maxMibPerS = (maxBlockBytes / MiB) / (expectedBlockTimeMs / 1000);

  const cc: ChainConfig = {
    expectedBlockTimeMs,
    maxBlockBytes,
    specVersion: currentSpec,
    maxMibPerS,
    avgBlockTimeMs: expectedBlockTimeMs,
    empiricalMaxSubmitBytes: 0,
    availDecimals: AVAIL_DECIMALS,
    currentAvailUsd: spot.price,
    availUsdSource: spot.source,
    avgFeePerMibAvail: 0,
  };

  await writeConfig(cc, MILESTONES, startBlock, endBlock, prices);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone — ${totalCollected} blocks collected in ${elapsed}s`);

  await mgr.disconnect();
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

async function writeBlocksCsv(rows: Row[]): Promise<void> {
  const body = rows.map(rowToCsvLine).join("\n");
  const p = path.join(OUTPUT_DIR, "blocks.csv");
  await writeFile(p, CSV_HEADER + body + "\n");
  console.log(`CSV    -> ${p}  (${rows.length} rows)`);
}

async function writeDayCsv(filePath: string, rows: Row[]): Promise<void> {
  const body = rows.map(rowToCsvLine).join("\n");
  await writeFile(filePath, CSV_HEADER + body + "\n");
}

async function mergeDayFiles(): Promise<void> {
  const dataDir = path.join(OUTPUT_DIR, "blocks");
  const files = (await readdir(dataDir))
    .filter((f) => f.endsWith(".csv"))
    .sort();

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

  const outPath = path.join(OUTPUT_DIR, "blocks.csv");
  await writeFile(outPath, CSV_HEADER + allLines.join("\n") + "\n");
  console.log(`CSV    -> ${outPath}  (${allLines.length} rows from ${files.length} day files)`);
}

async function writeConfig(
  cc: ChainConfig,
  milestones: Milestone[],
  startBlock: number,
  endBlock: number,
  prices: PricePoint[],
): Promise<void> {
  const obj = {
    blockRange: { start: startBlock, end: endBlock },
    config: cc,
    milestones,
    priceData: {
      points: prices.length,
      range:
        prices.length > 0
          ? {
              minUsd: Math.min(...prices.map((p) => p.avail_usd)),
              maxUsd: Math.max(...prices.map((p) => p.avail_usd)),
              from: new Date(prices[0].timestamp_ms).toISOString(),
              to: new Date(prices[prices.length - 1].timestamp_ms).toISOString(),
            }
          : null,
    },
    notes: [
      "Avail fees = base_fee + length_fee + weight_fee * congestion_multiplier * submitDataFeeModifier",
      "Fees extracted from TransactionFeePaid events (actual fees paid on-chain)",
      "Default node pruning retains 256 finalized blocks; archive nodes serve full history",
      "1 AVAIL = 10^18 plancks",
    ],
  };
  const p = path.join(OUTPUT_DIR, "chain_config.json");
  await writeFile(p, JSON.stringify(obj, null, 2) + "\n");
  console.log(`Config -> ${p}`);
}

// ---------------------------------------------------------------------------
// Summary output (combined throughput + cost)
// ---------------------------------------------------------------------------

function printSummary(
  rows: Row[],
  startBlock: number,
  endBlock: number,
  cc: ChainConfig,
): void {
  if (rows.length === 0) {
    console.log("No blocks collected.");
    return;
  }

  const pctl = (arr: number[], p: number): number => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
  };
  const mean = (arr: number[]): number =>
    arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

  const submitBytes = rows.map((r) => r.submit_data_bytes);
  const submitCounts = rows.map((r) => r.submit_data_count);
  const blockTimes = rows.slice(1).map((r) => r.block_time_ms).filter((t) => t > 0);

  const throughputs = rows
    .slice(1)
    .map((r) => {
      const dt = r.block_time_ms;
      return dt > 0 ? ((r.submit_data_bytes / dt) * 1000) / MiB : 0;
    })
    .filter((t) => t >= 0);

  const title = `Avail DA — ${rows.length} blocks (${startBlock}..${endBlock})`;
  const line = "─".repeat(Math.min(title.length, 80));
  console.log(`\n${title}`);
  console.log(line);

  const blocksWithData = rows.filter((r) => r.submit_data_count > 0).length;
  console.log(
    `Blocks with submitData: ${blocksWithData}/${rows.length} (${((blocksWithData / rows.length) * 100).toFixed(1)}%)\n`
  );

  // Throughput stats
  const labels = ["min", "p10", "p50", "p90", "p99", "max", "mean"] as const;
  const statFn = (arr: number[], label: string): number => {
    if (arr.length === 0) return 0;
    if (label === "min") return Math.min(...arr);
    if (label === "max") return Math.max(...arr);
    if (label === "mean") return mean(arr);
    return pctl(arr, parseInt(label.slice(1)));
  };

  console.log(
    `${"".padStart(8)}  submit_B  submit_n  MiB/s     block_ms`
  );
  for (const label of labels) {
    const sb = statFn(submitBytes, label);
    const sc = statFn(submitCounts, label);
    const tp = throughputs.length > 0 ? statFn(throughputs, label) : 0;
    const bt = blockTimes.length > 0 ? statFn(blockTimes, label) : 0;
    console.log(
      `${label.padStart(8)}  ${sb.toFixed(0).padStart(8)}  ${sc.toFixed(1).padStart(8)}  ${tp.toFixed(6).padStart(8)}  ${bt.toFixed(0).padStart(8)}`
    );
  }

  // Cost stats
  const dataRows = rows.filter((r) => r.submit_data_count > 0 && r.submit_data_bytes > 0);
  if (dataRows.length > 0 && cc.currentAvailUsd > 0) {
    const feesPerMib = dataRows.map(
      (b) => plancksToAvail(b.block_fee_plancks) / (b.submit_data_bytes / MiB)
    );
    feesPerMib.sort((a, b) => a - b);
    const medFeePerMib = feesPerMib[Math.floor(feesPerMib.length / 2)];
    const meanFeePerMib = mean(feesPerMib);

    console.log(`\nFee per MiB (from ${feesPerMib.length} blocks with data):`);
    console.log(`    min:    ${feesPerMib[0].toFixed(6)} AVAIL  ($${(feesPerMib[0] * cc.currentAvailUsd).toFixed(6)})`);
    console.log(`    median: ${medFeePerMib.toFixed(6)} AVAIL  ($${(medFeePerMib * cc.currentAvailUsd).toFixed(6)})`);
    console.log(`    mean:   ${meanFeePerMib.toFixed(6)} AVAIL  ($${(meanFeePerMib * cc.currentAvailUsd).toFixed(6)})`);
    console.log(`    max:    ${feesPerMib[feesPerMib.length - 1].toFixed(6)} AVAIL  ($${(feesPerMib[feesPerMib.length - 1] * cc.currentAvailUsd).toFixed(6)})`);

    const totalBytes = dataRows.reduce((a, b) => a + b.submit_data_bytes, 0);
    const totalFee = dataRows.reduce((a, b) => a + plancksToAvail(b.block_fee_plancks), 0);
    console.log(`\n  Total submitData volume: ${(totalBytes / MiB).toFixed(4)} MiB across ${dataRows.length} blocks`);
    console.log(`  Total fees: ${totalFee.toFixed(6)} AVAIL ($${(totalFee * cc.currentAvailUsd).toFixed(6)})`);
  }

  console.log(`\n${line}`);
  console.log(`Expected block time: ${cc.expectedBlockTimeMs} ms`);
  console.log(`Avg block time: ${cc.avgBlockTimeMs.toFixed(0)} ms`);
  console.log(`Max block bytes (normal): ${(cc.maxBlockBytes / MiB).toFixed(2)} MiB`);
  console.log(
    `Protocol max throughput: ${cc.maxMibPerS.toFixed(2)} MiB/s (${(cc.maxBlockBytes / MiB).toFixed(2)} MiB / ${(cc.expectedBlockTimeMs / 1000).toFixed(0)}s)`
  );
  console.log(
    `Empirical max submitData: ${(cc.empiricalMaxSubmitBytes / MiB).toFixed(4)} MiB`
  );
  console.log(`AVAIL/USD: $${cc.currentAvailUsd.toFixed(6)} (${cc.availUsdSource})`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();
  await mkdir(OUTPUT_DIR, { recursive: true });

  if (opts.pricesOnly) {
    console.log("Avail DA — prices-only mode\n");
    const spot = await fetchAvailUsdSpot();
    console.log(`AVAIL/USD: $${spot.price.toFixed(6)} (${spot.source})\n`);
    const prices = await fetchAvailPrices90d();
    await writePricesCsv(prices);
    return;
  }

  if (opts.days > 0) {
    await collectDays(opts);
    return;
  }

  await collectBlocks(opts);
}

// ---------------------------------------------------------------------------
main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
