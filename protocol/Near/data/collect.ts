#!/usr/bin/env npx tsx
/**
 * NEAR DA — unified block & price collector
 *
 * Collects per-block DA data and NEAR/USD prices into shared CSV files
 * for Dune upload and analysis.
 *
 * Outputs (all relative to this script's directory, i.e. data/):
 *   blocks/<date>.csv      — per-day block CSVs
 *   prices.csv             — NEAR/USD hourly prices (90d from CoinGecko)
 *   chain_config.json      — protocol config + gas cost breakdown
 *
 * Usage:
 *   npx tsx data/collect.ts                            # last 1 day (RPC)
 *   npx tsx data/collect.ts --days 90                  # 90 days (auto: NEAR Lake S3)
 *   npx tsx data/collect.ts --source lake --days 7     # force lake source
 *   npx tsx data/collect.ts --source rpc --blocks 5000 # force RPC source
 *   npx tsx data/collect.ts --rpc url1,url2,url3       # custom RPCs
 */

import { writeFile, readFile, mkdir, readdir } from "fs/promises";
import path from "path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Row {
  block_height: number;
  timestamp_ms: number;
  num_shards: number;
  total_encoded_bytes: number;
  total_gas_used: number;
  total_gas_limit: number;
  chunks_produced: number;
  gas_price: string;
  block_time_ms: number;
}

interface ChainConfig {
  numShards: number;
  protocolVersion: number;
  epochLength: number;
  minGasPrice: string;
  maxGasPrice: string;
  genesisHeight: number;
  blockProducerSeats: number;
  gasLimitPerChunk: number;
  avgBlockTimeMs: number;
  empiricalMaxEncodedBytes: number;
  maxBytesPerBlockMib: number;
  protocolMaxMibps: number;
}

interface GasConfig {
  gas_price: string;
  receipt_creation_gas: number;
  fn_call_base_gas: number;
  fn_call_per_byte_gas: number;
  per_mib_gas: number;
  per_mib_near: number;
}

interface Milestone {
  label: string;
  block: number | null;
  timestamp_ms: number | null;
}

interface PricePoint {
  timestamp_ms: number;
  near_usd: number;
}

interface Opts {
  rpcs: string[];
  source: "rpc" | "lake";
  blocks: number | null;
  days: number;
  startBlock: number | null;
  endBlock: number | null;
  batchSize: number;
  batchDelay: number;
  concurrency: number;
  saveInterval: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MiB = 1_048_576;
const YOCTO = 1e24;
const DEFAULT_RPCS = [
  "https://rpc.fastnear.com",
  "https://rpc.mainnet.near.org",
];
const DEFAULT_DAYS = 1;
const BLOCKS_PER_DAY = 66_500; // ~1.3s block time
const MAX_RETRIES = 5;
const OUTPUT_DIR =
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);

const CSV_HEADER =
  "block_height,timestamp_ms,num_shards,total_encoded_bytes,total_gas_used,total_gas_limit,chunks_produced,gas_price,block_time_ms";

const MILESTONES: Milestone[] = [
  { label: "Simple Nightshade (4 shards)", block: 47704100, timestamp_ms: 1636761600000 },
  { label: "Simple Nightshade v2 (5 shards)", block: 103747170, timestamp_ms: 1696982400000 },
  { label: "Stateless validation", block: 130154688, timestamp_ms: 1722470400000 },
];

// NEAR Lake S3 config (requester-pays bucket)
const LAKE_BUCKET = "near-lake-data-mainnet";
const LAKE_REGION = "eu-central-1";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const opts: Opts = {
    rpcs: [...DEFAULT_RPCS],
    source: "rpc", // auto-detected below if not explicit
    blocks: null,
    days: DEFAULT_DAYS,
    startBlock: null,
    endBlock: null,
    batchSize: 20,
    batchDelay: 200,
    concurrency: 100,
    saveInterval: 300, // 5 min default
  };
  let sourceExplicit = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && args[i + 1]) {
      const s = args[++i].toLowerCase();
      if (s === "lake" || s === "rpc") {
        opts.source = s;
        sourceExplicit = true;
      }
    } else if (args[i] === "--start-block" && args[i + 1]) {
      opts.startBlock = parseInt(args[++i], 10);
    } else if (args[i] === "--end-block" && args[i + 1]) {
      opts.endBlock = parseInt(args[++i], 10);
    } else if (args[i] === "--blocks" && args[i + 1]) {
      opts.blocks = parseInt(args[++i], 10);
    } else if (args[i] === "--days" && args[i + 1]) {
      opts.days = parseFloat(args[++i]);
    } else if (args[i] === "--rpc" && args[i + 1]) {
      opts.rpcs = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === "--batch" && args[i + 1]) {
      opts.batchSize = parseInt(args[++i], 10);
    } else if (args[i] === "--delay" && args[i + 1]) {
      opts.batchDelay = parseInt(args[++i], 10);
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      opts.concurrency = parseInt(args[++i], 10);
    } else if (args[i] === "--save-interval" && args[i + 1]) {
      opts.saveInterval = parseInt(args[++i], 10);
    }
  }

  // Auto-detect source: use lake for large collections (>50K blocks ≈ >0.75 days)
  if (!sourceExplicit) {
    const target = opts.startBlock && opts.endBlock
      ? opts.endBlock - opts.startBlock
      : opts.blocks ?? Math.ceil(opts.days * BLOCKS_PER_DAY);
    opts.source = target > 50_000 ? "lake" : "rpc";
  }

  return opts;
}

// ---------------------------------------------------------------------------
// RPC helpers
// ---------------------------------------------------------------------------

let shutdownRequested = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function rpcFetch(
  rpcUrl: string,
  method: string,
  params: Record<string, any>
): Promise<any> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "da-rsrch", method, params }),
      });

      if (resp.status === 429) {
        await sleep(Math.min(1000 * Math.pow(2, attempt), 15000));
        continue;
      }

      const data = (await resp.json()) as any;
      if (data.error) {
        if (data.error.cause?.name === "UNKNOWN_BLOCK") return null;
        throw new Error(data.error.message || JSON.stringify(data.error));
      }
      return data.result;
    } catch (err: any) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(500 * (attempt + 1));
      } else {
        throw err;
      }
    }
  }
  return null;
}

async function rpcCall(
  rpcs: string[],
  method: string,
  params: Record<string, any>
): Promise<any> {
  let lastErr: Error | null = null;
  for (const rpcUrl of rpcs) {
    try {
      return await rpcFetch(rpcUrl, method, params);
    } catch (err: any) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

// ---------------------------------------------------------------------------
// NEAR Lake S3 helpers
// ---------------------------------------------------------------------------

let s3Client: S3Client | null = null;

function getS3(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: LAKE_REGION });
  }
  return s3Client;
}

async function fetchBlockFromLake(height: number): Promise<any | null> {
  const key = `${String(height).padStart(12, "0")}/block.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await getS3().send(
        new GetObjectCommand({
          Bucket: LAKE_BUCKET,
          Key: key,
          RequestPayer: "requester",
        })
      );
      const body = await resp.Body?.transformToString();
      if (!body) return null;
      return JSON.parse(body);
    } catch (err: any) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      if (err.$metadata?.httpStatusCode === 503 || err.name === "SlowDown") {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      if (attempt < 2) {
        await sleep(500 * (attempt + 1));
      } else {
        throw err;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Block parser (works with both RPC and Lake block.json — same BlockView struct)
// ---------------------------------------------------------------------------

function parseBlock(block: any): Row {
  const header = block.header;
  const chunks: any[] = block.chunks || [];

  const tsNs = BigInt(header.timestamp_nanosec ?? header.timestamp);
  const tsMs = Number(tsNs / 1_000_000n);

  let totalEncoded = 0;
  let totalGasUsed = 0;
  let totalGasLimit = 0;
  let produced = 0;

  for (const c of chunks) {
    totalEncoded += c.encoded_length ?? 0;
    totalGasUsed += c.gas_used ?? 0;
    totalGasLimit += c.gas_limit ?? 0;
    if ((c.height_created ?? 0) === header.height) {
      produced++;
    }
  }

  return {
    block_height: header.height,
    timestamp_ms: tsMs,
    num_shards: chunks.length,
    total_encoded_bytes: totalEncoded,
    total_gas_used: totalGasUsed,
    total_gas_limit: totalGasLimit,
    chunks_produced: produced,
    gas_price: header.gas_price,
    block_time_ms: 0,
  };
}

// ---------------------------------------------------------------------------
// Collection: NEAR Lake S3 (worker pool)
// ---------------------------------------------------------------------------

async function collectFromLake(
  neededHeights: number[],
  allRows: Row[],
  opts: Opts
): Promise<void> {
  const concurrency = opts.concurrency;
  const total = neededHeights.length;
  let nextIdx = 0;
  let fetched = 0;
  const failedHeights: number[] = [];
  const t0 = Date.now();
  let lastSave = Date.now();
  let saving = false;

  console.log(`  Source: NEAR Lake S3 (${LAKE_BUCKET}), concurrency: ${concurrency}`);

  async function worker(): Promise<void> {
    while (!shutdownRequested) {
      const idx = nextIdx++;
      if (idx >= total) break;
      const height = neededHeights[idx];
      try {
        const block = await fetchBlockFromLake(height);
        if (block) {
          allRows.push(parseBlock(block));
          fetched++;
        }
      } catch {
        failedHeights.push(height);
      }
    }
  }

  // Progress + checkpoint on interval
  const progressTimer = setInterval(async () => {
    const elapsed = (Date.now() - t0) / 1000;
    const rate = elapsed > 0 ? fetched / elapsed : 0;
    const remaining = total - fetched - failedHeights.length;
    const eta = rate > 0 ? remaining / rate : 0;
    process.stdout.write(
      `\r  ${fetched}/${total} blocks  (${rate.toFixed(0)} b/s, ETA ${formatDuration(eta)})  `
    );

    // Checkpoint
    const now = Date.now();
    if ((now - lastSave) / 1000 >= opts.saveInterval && allRows.length > 0 && !saving) {
      saving = true;
      try {
        const snapshot = [...allRows];
        computeBlockTimes(snapshot);
        await saveBlocks(snapshot);
        lastSave = now;
        process.stdout.write(`[checkpoint ${snapshot.length} rows]`);
      } finally {
        saving = false;
      }
    }
  }, 2000);

  // Launch worker pool
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker())
  );
  clearInterval(progressTimer);

  const elapsed = (Date.now() - t0) / 1000;
  process.stdout.write(
    `\r  ${fetched}/${total} blocks in ${formatDuration(elapsed)}  (${(fetched / elapsed).toFixed(0)} b/s avg)${" ".repeat(20)}\n`
  );

  // Retry failed blocks
  if (failedHeights.length > 0 && !shutdownRequested) {
    console.log(`  Retrying ${failedHeights.length} failed blocks...`);
    const retryTargets = [...failedHeights];
    let retryIdx = 0;
    let retryFetched = 0;

    async function retryWorker(): Promise<void> {
      while (!shutdownRequested) {
        const idx = retryIdx++;
        if (idx >= retryTargets.length) break;
        try {
          const block = await fetchBlockFromLake(retryTargets[idx]);
          if (block) {
            allRows.push(parseBlock(block));
            retryFetched++;
          }
        } catch { /* give up */ }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(20, retryTargets.length) }, () => retryWorker())
    );
    console.log(`  Recovered ${retryFetched}/${retryTargets.length} blocks`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Collection: RPC (batch model)
// ---------------------------------------------------------------------------

async function collectFromRpc(
  neededHeights: number[],
  allRows: Row[],
  opts: Opts
): Promise<void> {
  const bulkRpc = opts.rpcs[0];
  const total = neededHeights.length;
  const t0 = Date.now();
  let lastSave = Date.now();
  let fetched = 0;
  const failedHeights: number[] = [];

  console.log(`  Source: RPC (${bulkRpc}), batch: ${opts.batchSize}, delay: ${opts.batchDelay}ms`);

  for (let i = 0; i < neededHeights.length; i += opts.batchSize) {
    if (shutdownRequested) break;

    const batchHeights = neededHeights.slice(i, i + opts.batchSize);
    const settled = await Promise.allSettled(
      batchHeights.map(async (h) => {
        const block = await rpcFetch(bulkRpc, "block", { block_id: h });
        return { height: h, block };
      })
    );

    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status === "fulfilled" && r.value.block) {
        allRows.push(parseBlock(r.value.block));
        fetched++;
      } else if (r.status === "rejected") {
        failedHeights.push(batchHeights[j]);
      }
    }

    const elapsed = (Date.now() - t0) / 1000;
    if (elapsed > 0) {
      const rate = fetched / elapsed;
      const eta = rate > 0 ? (total - fetched) / rate : 0;
      process.stdout.write(
        `\r  ${fetched}/${total} blocks  (${rate.toFixed(1)} b/s, ETA ${formatDuration(eta)})`
      );
    }

    // Periodic checkpoint
    const now = Date.now();
    if ((now - lastSave) / 1000 >= opts.saveInterval && allRows.length > 0) {
      computeBlockTimes([...allRows]);
      await saveBlocks([...allRows]);
      lastSave = now;
      process.stdout.write(` [checkpoint ${allRows.length} rows]`);
    }

    if (i + opts.batchSize < neededHeights.length && !shutdownRequested) {
      await sleep(opts.batchDelay);
    }
  }

  // Retry failed blocks with smaller batches
  if (failedHeights.length > 0 && !shutdownRequested) {
    console.log(`\n  Retrying ${failedHeights.length} failed blocks...`);
    const retryBatch = Math.max(5, Math.floor(opts.batchSize / 2));
    for (let i = 0; i < failedHeights.length; i += retryBatch) {
      if (shutdownRequested) break;
      const batch = failedHeights.slice(i, i + retryBatch);
      const settled = await Promise.allSettled(
        batch.map(async (h) => {
          const block = await rpcFetch(bulkRpc, "block", { block_id: h });
          return { height: h, block };
        })
      );
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value.block) {
          allRows.push(parseBlock(r.value.block));
          fetched++;
        }
      }
      await sleep(opts.batchDelay * 2);
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  process.stdout.write(
    `\r  ${fetched}/${total} blocks in ${formatDuration(elapsed)}  (${(fetched / elapsed).toFixed(1)} b/s avg)${" ".repeat(20)}\n\n`
  );
}

// ---------------------------------------------------------------------------
// Fetch protocol config
// ---------------------------------------------------------------------------

async function fetchProtocolConfig(
  rpcs: string[]
): Promise<{ chain: Partial<ChainConfig>; gas: GasConfig }> {
  const cfg = await rpcCall(rpcs, "EXPERIMENTAL_protocol_config", {
    finality: "final",
  });
  if (!cfg) throw new Error("Protocol config unavailable");

  // --- Shard count ---
  const shardSeats: any[] =
    cfg.num_block_producer_seats_per_shard ??
    cfg.avg_hidden_validator_seats_per_shard ??
    [];
  let numShards = shardSeats.length;
  if (numShards === 0) {
    const layout = cfg.shard_layout;
    if (layout?.V1) {
      numShards = (layout.V1.boundary_accounts?.length ?? 0) + 1;
    } else if (layout?.V2) {
      numShards = (layout.V2.boundary_accounts?.length ?? 0) + 1;
    } else {
      numShards = 1;
    }
  }

  // --- Gas config ---
  const rc = cfg.runtime_config ?? {};
  const tc = rc.transaction_costs ?? {};
  const ac = tc.action_creation_config ?? {};

  const receiptCfg = tc.action_receipt_creation_config ?? {};
  const receiptGas =
    (receiptCfg.send_sir ?? 0) +
    (receiptCfg.send_not_sir ?? 0) +
    (receiptCfg.execution ?? 0);

  const fcBase = ac.function_call_cost ?? {};
  const fcBaseGas =
    (fcBase.send_sir ?? 0) +
    (fcBase.send_not_sir ?? 0) +
    (fcBase.execution ?? 0);

  const fcPerByte = ac.function_call_cost_per_byte ?? {};
  const fcPerByteGas =
    (fcPerByte.send_sir ?? 0) +
    (fcPerByte.send_not_sir ?? 0) +
    (fcPerByte.execution ?? 0);

  // Gas price from latest block
  const latest = await rpcCall(rpcs, "block", { finality: "final" });
  const gasPrice = latest.header.gas_price;

  const perMibGas = receiptGas + fcBaseGas + fcPerByteGas * MiB;
  const perMibNear = (Number(BigInt(gasPrice)) * perMibGas) / YOCTO;

  return {
    chain: {
      numShards,
      protocolVersion: cfg.protocol_version ?? 0,
      epochLength: cfg.epoch_length ?? 43200,
      minGasPrice: cfg.min_gas_price ?? "100000000",
      maxGasPrice: cfg.max_gas_price ?? "10000000000000000000000",
      genesisHeight: cfg.genesis_height ?? 9820210,
      blockProducerSeats: cfg.num_block_producer_seats ?? 100,
    },
    gas: {
      gas_price: gasPrice,
      receipt_creation_gas: receiptGas,
      fn_call_base_gas: fcBaseGas,
      fn_call_per_byte_gas: fcPerByteGas,
      per_mib_gas: perMibGas,
      per_mib_near: perMibNear,
    },
  };
}

// ---------------------------------------------------------------------------
// Price fetcher
// ---------------------------------------------------------------------------

async function fetchNearPrices90d(): Promise<PricePoint[]> {
  const url =
    "https://api.coingecko.com/api/v3/coins/near/market_chart?vs_currency=usd&days=90";
  console.log("Fetching 90 days of NEAR/USD from CoinGecko...");

  const resp = await fetch(url);
  if (!resp.ok)
    throw new Error(`CoinGecko HTTP ${resp.status}: ${await resp.text()}`);

  const data = (await resp.json()) as any;
  if (!Array.isArray(data?.prices))
    throw new Error("Unexpected CoinGecko response format");

  const points: PricePoint[] = data.prices.map(
    ([ts, price]: [number, number]) => ({
      timestamp_ms: ts,
      near_usd: price,
    })
  );

  console.log(`  ${points.length} hourly price points fetched`);
  return points;
}

// ---------------------------------------------------------------------------
// CSV I/O
// ---------------------------------------------------------------------------

async function loadExistingBlocks(): Promise<Row[]> {
  const dataDir = path.join(OUTPUT_DIR, "blocks");
  try {
    const files = (await readdir(dataDir)).filter((f) => f.endsWith(".csv")).sort();
    const allRows: Row[] = [];
    for (const file of files) {
      const text = await readFile(path.join(dataDir, file), "utf-8");
      const lines = text.trim().split("\n").slice(1);
      for (const line of lines) {
        if (!line.trim()) continue;
        const [bh, ts, ns, teb, tgu, tgl, cp, gp, btm] = line.split(",");
        allRows.push({
          block_height: parseInt(bh),
          timestamp_ms: parseInt(ts),
          num_shards: parseInt(ns),
          total_encoded_bytes: parseInt(teb),
          total_gas_used: parseInt(tgu),
          total_gas_limit: parseInt(tgl),
          chunks_produced: parseInt(cp),
          gas_price: gp,
          block_time_ms: parseInt(btm),
        });
      }
    }
    return allRows;
  } catch {
    return [];
  }
}

function computeBlockTimes(rows: Row[]): void {
  rows.sort((a, b) => a.block_height - b.block_height);
  if (rows.length > 0) rows[0].block_time_ms = 0;
  for (let i = 1; i < rows.length; i++) {
    rows[i].block_time_ms = rows[i].timestamp_ms - rows[i - 1].timestamp_ms;
  }
}

async function saveBlocks(rows: Row[]): Promise<void> {
  const dataDir = path.join(OUTPUT_DIR, "blocks");
  await mkdir(dataDir, { recursive: true });

  // Group rows by UTC date
  const byDate = new Map<string, Row[]>();
  for (const r of rows) {
    const date = new Date(r.timestamp_ms).toISOString().slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(r);
  }

  for (const [date, dateRows] of byDate) {
    dateRows.sort((a, b) => a.block_height - b.block_height);
    const body = dateRows
      .map(
        (r) =>
          `${r.block_height},${r.timestamp_ms},${r.num_shards},${r.total_encoded_bytes},${r.total_gas_used},${r.total_gas_limit},${r.chunks_produced},${r.gas_price},${r.block_time_ms}`
      )
      .join("\n");
    await writeFile(path.join(dataDir, `${date}.csv`), CSV_HEADER + "\n" + body + "\n");
  }
}

async function savePrices(prices: PricePoint[]): Promise<void> {
  const header = "timestamp_ms,date,near_usd";
  const body = prices
    .map(
      (p) =>
        `${p.timestamp_ms},${new Date(p.timestamp_ms).toISOString()},${p.near_usd.toFixed(6)}`
    )
    .join("\n");
  await writeFile(path.join(OUTPUT_DIR, "prices.csv"), header + "\n" + body + "\n");
}

async function saveConfig(
  cc: ChainConfig,
  gas: GasConfig,
  milestones: Milestone[],
  startBlock: number,
  endBlock: number,
  prices: PricePoint[]
): Promise<void> {
  const latestPrice = prices.length > 0 ? prices[prices.length - 1].near_usd : 0;
  const obj = {
    blockRange: { start: startBlock, end: endBlock },
    config: cc,
    gas: {
      ...gas,
      current_near_usd: latestPrice,
      current_cost_per_mib_usd: gas.per_mib_near * latestPrice,
      current_cost_per_gib_month_usd: gas.per_mib_near * latestPrice * 1024,
    },
    milestones,
    priceRange:
      prices.length > 0
        ? {
            min_usd: Math.min(...prices.map((p) => p.near_usd)),
            max_usd: Math.max(...prices.map((p) => p.near_usd)),
            from: new Date(prices[0].timestamp_ms).toISOString(),
            to: new Date(prices[prices.length - 1].timestamp_ms).toISOString(),
            points: prices.length,
          }
        : null,
  };
  await writeFile(
    path.join(OUTPUT_DIR, "chain_config.json"),
    JSON.stringify(obj, null, 2) + "\n"
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();

  // Determine block range
  let startHeight: number;
  let endHeight: number;

  if (opts.startBlock != null && opts.endBlock != null) {
    startHeight = opts.startBlock;
    endHeight = opts.endBlock;
  } else {
    // Latest finalized block via RPC, then work backwards
    const latest = await rpcCall(opts.rpcs, "block", { finality: "final" });
    endHeight = latest.header.height;
    const targetBlocks = opts.blocks ?? Math.ceil(opts.days * BLOCKS_PER_DAY);
    startHeight = endHeight - targetBlocks + 1;
  }

  const totalBlocks = endHeight - startHeight + 1;

  console.log(`NEAR DA — unified collector`);
  console.log(`Source: ${opts.source}${opts.source === "lake" ? ` (${LAKE_BUCKET})` : ` (${opts.rpcs[0]})`}`);
  console.log(`Target: ${totalBlocks.toLocaleString()} blocks (~${(totalBlocks / BLOCKS_PER_DAY).toFixed(1)} days)`);
  console.log(`Block range: ${startHeight}..${endHeight}`);
  if (opts.source === "lake") {
    console.log(`Concurrency: ${opts.concurrency}, checkpoint: ${opts.saveInterval}s`);
  } else {
    console.log(`Batch: ${opts.batchSize} blocks, ${opts.batchDelay}ms delay`);
  }
  console.log();

  await mkdir(OUTPUT_DIR, { recursive: true });

  // ---- Protocol config (always via RPC) ----
  const { chain: cfgPartial, gas: gasConfig } = await fetchProtocolConfig(opts.rpcs);
  console.log(
    `Protocol v${cfgPartial.protocolVersion}  shards=${cfgPartial.numShards}  epoch=${cfgPartial.epochLength}`
  );
  console.log(
    `Gas: ${gasConfig.per_mib_near.toFixed(6)} NEAR/MiB  (${gasConfig.per_mib_gas.toLocaleString("en-US")} gas/MiB)\n`
  );

  // ---- Load existing data for incremental collection ----
  const existingRows = await loadExistingBlocks();
  const existingHeights = new Set(existingRows.map((r) => r.block_height));
  if (existingRows.length > 0) {
    const maxH = Math.max(...existingRows.map((r) => r.block_height));
    console.log(`Existing data: ${existingRows.length} rows (up to block ${maxH})`);
  }

  // ---- Determine which blocks we still need ----
  const neededHeights: number[] = [];
  for (let h = startHeight; h <= endHeight; h++) {
    if (!existingHeights.has(h)) {
      neededHeights.push(h);
    }
  }

  // Filter existing rows to only those within our target range
  const allRows: Row[] = existingRows.filter(
    (r) => r.block_height >= startHeight && r.block_height <= endHeight
  );

  if (neededHeights.length === 0) {
    console.log(`All ${totalBlocks.toLocaleString()} blocks already collected!\n`);
  } else {
    console.log(`Need to fetch ${neededHeights.length} new blocks (${allRows.length} already cached)\n`);

    // ---- Print milestones in range ----
    for (const m of MILESTONES) {
      if (m.block != null && m.block >= startHeight && m.block <= endHeight) {
        const date = new Date(m.timestamp_ms!).toISOString().slice(0, 10);
        console.log(`  ${date}  block ${m.block}  ${m.label}`);
      }
    }

    // ---- Graceful shutdown handler ----
    process.on("SIGINT", () => {
      if (shutdownRequested) {
        console.log("\nForce exit.");
        process.exit(1);
      }
      shutdownRequested = true;
      console.log("\nGraceful shutdown requested — saving progress...");
    });

    // ---- Collect blocks ----
    if (opts.source === "lake") {
      await collectFromLake(neededHeights, allRows, opts);
    } else {
      await collectFromRpc(neededHeights, allRows, opts);
    }
  }

  // ---- Compute block_time_ms ----
  computeBlockTimes(allRows);

  // ---- Build final chain config ----
  const blockTimes = allRows
    .slice(1)
    .map((r) => r.block_time_ms)
    .filter((t) => t > 0);
  const avgBt =
    blockTimes.length > 0
      ? blockTimes.reduce((a, b) => a + b, 0) / blockTimes.length
      : 1300;
  const maxEnc =
    allRows.length > 0 ? Math.max(...allRows.map((r) => r.total_encoded_bytes)) : 0;
  const gasLimChunk =
    allRows.length > 0 && allRows[0].num_shards > 0
      ? allRows[0].total_gas_limit / allRows[0].num_shards
      : 1_000_000_000_000_000;
  const numShards = cfgPartial.numShards ?? 6;
  const maxBytesPerBlockMib = numShards * 4;
  const protocolMaxMibps = (maxBytesPerBlockMib * MiB) / (avgBt / 1000) / MiB;

  const cc: ChainConfig = {
    numShards,
    protocolVersion: cfgPartial.protocolVersion ?? 0,
    epochLength: cfgPartial.epochLength ?? 43200,
    minGasPrice: cfgPartial.minGasPrice ?? "100000000",
    maxGasPrice: cfgPartial.maxGasPrice ?? "10000000000000000000000",
    genesisHeight: cfgPartial.genesisHeight ?? 9820210,
    blockProducerSeats: cfgPartial.blockProducerSeats ?? 100,
    gasLimitPerChunk: gasLimChunk,
    avgBlockTimeMs: avgBt,
    empiricalMaxEncodedBytes: maxEnc,
    maxBytesPerBlockMib,
    protocolMaxMibps,
  };

  // ---- Fetch prices ----
  let prices: PricePoint[] = [];
  try {
    prices = await fetchNearPrices90d();
  } catch (err: any) {
    console.warn(`Price fetch failed: ${err.message}`);
    try {
      const text = await readFile(path.join(OUTPUT_DIR, "prices.csv"), "utf-8");
      const lines = text.trim().split("\n").slice(1);
      prices = lines
        .filter((l) => l.trim())
        .map((line) => {
          const [ts, , usd] = line.split(",");
          return { timestamp_ms: parseInt(ts), near_usd: parseFloat(usd) };
        });
      console.log(`  Using cached prices.csv (${prices.length} points)`);
    } catch {
      console.warn("  No cached prices available.");
    }
  }

  // ---- Write all outputs ----
  await saveBlocks(allRows);
  console.log(`CSV    -> data/blocks/  (${allRows.length} rows)`);

  if (prices.length > 0) {
    await savePrices(prices);
    console.log(`CSV    -> data/prices.csv  (${prices.length} rows)`);
  }

  await saveConfig(cc, gasConfig, MILESTONES, startHeight, endHeight, prices);
  console.log(`Config -> data/chain_config.json`);

  // ---- Summary ----
  printSummary(allRows, startHeight, endHeight, cc, gasConfig, prices);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function printSummary(
  rows: Row[],
  startBlock: number,
  endBlock: number,
  cc: ChainConfig,
  gas: GasConfig,
  prices: PricePoint[]
): void {
  if (rows.length === 0) {
    console.log("\nNo blocks collected.");
    return;
  }

  const pctl = (arr: number[], p: number): number => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
  };
  const mean = (arr: number[]): number =>
    arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

  const encoded = rows.map((r) => r.total_encoded_bytes);
  const blockTimes = rows
    .slice(1)
    .map((r) => r.block_time_ms)
    .filter((t) => t > 0);
  const throughputs = rows
    .slice(1)
    .map((r) => {
      const dt = r.block_time_ms;
      return dt > 0 ? ((r.total_encoded_bytes / dt) * 1000) / MiB : 0;
    })
    .filter((t) => t > 0);

  const title = `\nNEAR DA — ${rows.length} blocks (${startBlock}..${endBlock})`;
  const line = "─".repeat(Math.min(title.length - 1, 80));
  console.log(title);
  console.log(line);

  const labels = ["min", "p10", "p50", "p90", "p99", "max", "mean"] as const;
  const statFn = (arr: number[], label: string): number => {
    if (label === "min") return Math.min(...arr);
    if (label === "max") return Math.max(...arr);
    if (label === "mean") return mean(arr);
    return pctl(arr, parseInt(label.slice(1)));
  };

  console.log(
    `${"".padStart(8)}  encoded_B  MiB/s     block_ms`
  );
  for (const label of labels) {
    const enc = statFn(encoded, label);
    const tp = throughputs.length > 0 ? statFn(throughputs, label) : 0;
    const bt = blockTimes.length > 0 ? statFn(blockTimes, label) : 0;
    console.log(
      `${label.padStart(8)}  ${enc.toFixed(0).padStart(9)}  ${tp.toFixed(4).padStart(8)}  ${bt.toFixed(0).padStart(8)}`
    );
  }

  console.log(`\n${line}`);
  console.log(
    `Config: ${cc.numShards} shards  proto_v${cc.protocolVersion}  epoch=${cc.epochLength}`
  );
  console.log(`Avg block time: ${cc.avgBlockTimeMs.toFixed(0)} ms`);
  console.log(
    `Protocol max: ${cc.protocolMaxMibps.toFixed(2)} MiB/s (${cc.numShards} shards x 4 MiB / ${(cc.avgBlockTimeMs / 1000).toFixed(2)}s)`
  );

  if (prices.length > 0) {
    const latestPrice = prices[prices.length - 1].near_usd;
    const costPerMib = gas.per_mib_near * latestPrice;
    console.log(`\nDA cost: $${costPerMib.toFixed(6)} / MiB`);
    console.log(
      `  ${gas.per_mib_near.toFixed(6)} NEAR/MiB x $${latestPrice.toFixed(2)} NEAR/USD`
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
