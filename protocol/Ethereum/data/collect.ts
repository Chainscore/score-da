#!/usr/bin/env npx tsx
/**
 * Ethereum DA (EIP-4844 Blobs) — block & price collector
 *
 * Collects per-block blob data from Google BigQuery and ETH/USD prices
 * from CoinGecko into CSV files for Dune upload and analysis.
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS env var pointing to a
 * service account JSON key with BigQuery Job User role.
 *
 * Outputs (relative to this script's directory, i.e. data/):
 *   blocks/<date>.csv      — per-day block CSVs
 *   eth_prices.csv         — ETH/USD daily prices (from CoinGecko)
 *   chain_config.json      — fork params + collection metadata
 *
 * Usage:
 *   npx tsx data/collect.ts                     # last 90 days (default)
 *   npx tsx data/collect.ts --days 365          # last 365 days
 *   npx tsx data/collect.ts --start-date 2024-03-13  # from Dencun activation
 *   npx tsx data/collect.ts --start-date 2024-03-13 --end-date 2024-06-13
 */

import { writeFile, readFile, mkdir, readdir } from "fs/promises";
import path from "path";
import { BigQuery } from "@google-cloud/bigquery";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlockRow {
  block_number: number;
  timestamp_ms: number;
  blob_count: number;
  blob_gas_used: number;
  excess_blob_gas: number;
}

interface PricePoint {
  date: string; // YYYY-MM-DD
  eth_usd: number;
}

interface ForkConfig {
  name: string;
  activation_block: number | null;
  activation_epoch: number | null;
  target_blobs: number;
  max_blobs: number;
  blob_gas_per_blob: number;
  update_fraction: number;
}

interface Opts {
  days: number;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  priceDays: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OUTPUT_DIR =
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);

const BYTES_PER_BLOB = 131_072; // 128 KiB
const BLOB_GAS_PER_BLOB = 131_072; // 1:1 with bytes
const MiB = 1_048_576;
const AVG_BLOCK_TIME_S = 12.0;
const BLOCKS_PER_DAY = 7200; // 86400 / 12

// Dencun activation (first block with blob support)
const DENCUN_BLOCK = 19_426_587;
const DENCUN_DATE = "2024-03-13";

const CSV_HEADER =
  "block_number,timestamp_ms,blob_count,blob_gas_used,excess_blob_gas";

// Fork configurations
const FORKS: ForkConfig[] = [
  {
    name: "Dencun (EIP-4844)",
    activation_block: 19_426_587,
    activation_epoch: 269_568,
    target_blobs: 3,
    max_blobs: 6,
    blob_gas_per_blob: BLOB_GAS_PER_BLOB,
    update_fraction: 3_338_477,
  },
  {
    name: "Pectra (EIP-7691)",
    activation_block: null, // filled from data
    activation_epoch: 364_032,
    target_blobs: 6,
    max_blobs: 9,
    blob_gas_per_blob: BLOB_GAS_PER_BLOB,
    update_fraction: 5_007_716,
  },
  {
    name: "BPO1 (EIP-7892)",
    activation_block: 23_975_796,
    activation_epoch: null,
    target_blobs: 10,
    max_blobs: 15,
    blob_gas_per_blob: BLOB_GAS_PER_BLOB,
    update_fraction: 8_346_193,
  },
  {
    name: "BPO2 (EIP-7892)",
    activation_block: null,
    activation_epoch: 419_072,
    target_blobs: 14,
    max_blobs: 21,
    blob_gas_per_blob: BLOB_GAS_PER_BLOB,
    update_fraction: 11_684_671,
  },
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const opts: Opts = {
    days: 90,
    startDate: null,
    endDate: null,
    priceDays: 365,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      opts.days = parseInt(args[++i], 10);
    } else if (args[i] === "--start-date" && args[i + 1]) {
      opts.startDate = args[++i];
    } else if (args[i] === "--end-date" && args[i + 1]) {
      opts.endDate = args[++i];
    } else if (args[i] === "--price-days" && args[i + 1]) {
      opts.priceDays = parseInt(args[++i], 10);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// BigQuery
// ---------------------------------------------------------------------------

function createBigQueryClient(): BigQuery {
  const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!creds) {
    throw new Error(
      "Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json"
    );
  }
  return new BigQuery();
}

async function fetchBlocks(
  bq: BigQuery,
  startDate: string,
  endDate: string
): Promise<BlockRow[]> {
  const query = `
    SELECT
      number AS block_number,
      UNIX_MILLIS(timestamp) AS timestamp_ms,
      CAST(COALESCE(blob_gas_used, 0) / ${BLOB_GAS_PER_BLOB} AS INT64) AS blob_count,
      COALESCE(blob_gas_used, 0) AS blob_gas_used,
      COALESCE(excess_blob_gas, 0) AS excess_blob_gas
    FROM \`bigquery-public-data.crypto_ethereum.blocks\`
    WHERE timestamp >= TIMESTAMP('${startDate}')
      AND timestamp < TIMESTAMP('${endDate}')
      AND number >= ${DENCUN_BLOCK}
    ORDER BY number
  `;

  console.log(`  BigQuery: fetching blocks from ${startDate} to ${endDate}...`);

  const [rows] = await bq.query({ query, location: "US" });

  console.log(`  ${rows.length.toLocaleString()} blocks returned`);

  return rows.map((r: any) => ({
    block_number: Number(r.block_number),
    timestamp_ms: Number(r.timestamp_ms),
    blob_count: Number(r.blob_count),
    blob_gas_used: Number(r.blob_gas_used),
    excess_blob_gas: Number(r.excess_blob_gas),
  }));
}

// ---------------------------------------------------------------------------
// Price fetcher (CoinGecko)
// ---------------------------------------------------------------------------

async function fetchEthPrices(days: number): Promise<PricePoint[]> {
  const url = `https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  console.log(`Fetching ${days} days of ETH/USD from CoinGecko...`);

  const resp = await fetch(url);
  if (!resp.ok)
    throw new Error(`CoinGecko HTTP ${resp.status}: ${await resp.text()}`);

  const data = (await resp.json()) as any;
  if (!Array.isArray(data?.prices))
    throw new Error("Unexpected CoinGecko response format");

  // Deduplicate by date (CoinGecko sometimes returns overlapping points)
  const seen = new Set<string>();
  const points: PricePoint[] = [];
  for (const [ts, price] of data.prices as [number, number][]) {
    const date = new Date(ts).toISOString().slice(0, 10);
    if (!seen.has(date)) {
      seen.add(date);
      points.push({ date, eth_usd: price });
    }
  }

  console.log(`  ${points.length} daily price points fetched`);
  return points;
}

// ---------------------------------------------------------------------------
// CSV I/O
// ---------------------------------------------------------------------------

async function loadExistingBlocks(): Promise<Map<string, Set<number>>> {
  const dataDir = path.join(OUTPUT_DIR, "blocks");
  const dateBlocks = new Map<string, Set<number>>();
  try {
    const files = (await readdir(dataDir))
      .filter((f) => f.endsWith(".csv"))
      .sort();
    for (const file of files) {
      const date = file.replace(".csv", "");
      const text = await readFile(path.join(dataDir, file), "utf-8");
      const lines = text.trim().split("\n").slice(1);
      const blocks = new Set<number>();
      for (const line of lines) {
        if (!line.trim()) continue;
        blocks.add(parseInt(line.split(",")[0]));
      }
      dateBlocks.set(date, blocks);
    }
  } catch {
    // No existing data
  }
  return dateBlocks;
}

async function saveBlocks(rows: BlockRow[]): Promise<number> {
  const dataDir = path.join(OUTPUT_DIR, "blocks");
  await mkdir(dataDir, { recursive: true });

  // Group by UTC date
  const byDate = new Map<string, BlockRow[]>();
  for (const r of rows) {
    const date = new Date(r.timestamp_ms).toISOString().slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(r);
  }

  let fileCount = 0;
  for (const [date, dateRows] of byDate) {
    dateRows.sort((a, b) => a.block_number - b.block_number);
    const body = dateRows
      .map(
        (r) =>
          `${r.block_number},${r.timestamp_ms},${r.blob_count},${r.blob_gas_used},${r.excess_blob_gas}`
      )
      .join("\n");
    await writeFile(
      path.join(dataDir, `${date}.csv`),
      CSV_HEADER + "\n" + body + "\n"
    );
    fileCount++;
  }
  return fileCount;
}

async function savePrices(prices: PricePoint[]): Promise<void> {
  const header = "date,eth_usd";
  const body = prices
    .map((p) => `${p.date},${p.eth_usd.toFixed(2)}`)
    .join("\n");
  await writeFile(
    path.join(OUTPUT_DIR, "eth_prices.csv"),
    header + "\n" + body + "\n"
  );
}

interface CollectionStats {
  totalFetched: number;
  totalBlobs: number;
  blocksWithBlobs: number;
  minBlock: number;
  maxBlock: number;
  minTs: number;
  maxTs: number;
  totalOnDisk: number;
}

async function saveConfigFromStats(
  stats: CollectionStats,
  prices: PricePoint[]
): Promise<void> {
  const totalBlobDataMib = (stats.totalBlobs * BYTES_PER_BLOB) / MiB;
  const obj = {
    blockRange: {
      start: stats.minBlock === Infinity ? 0 : stats.minBlock,
      end: stats.maxBlock,
    },
    dateRange: {
      start: stats.minTs === Infinity ? "" : new Date(stats.minTs).toISOString().slice(0, 10),
      end: stats.maxTs === 0 ? "" : new Date(stats.maxTs).toISOString().slice(0, 10),
    },
    totalBlocks: stats.totalOnDisk,
    blocksWithBlobs: stats.blocksWithBlobs,
    totalBlobs: stats.totalBlobs,
    totalBlobDataMib: Math.round(totalBlobDataMib * 100) / 100,
    params: {
      bytesPerBlob: BYTES_PER_BLOB,
      blobGasPerBlob: BLOB_GAS_PER_BLOB,
      avgBlockTimeSec: AVG_BLOCK_TIME_S,
    },
    forks: FORKS,
    priceRange:
      prices.length > 0
        ? {
            min_usd: prices.reduce((m, p) => Math.min(m, p.eth_usd), Infinity),
            max_usd: prices.reduce((m, p) => Math.max(m, p.eth_usd), -Infinity),
            from: prices[0].date,
            to: prices[prices.length - 1].date,
            points: prices.length,
          }
        : null,
    collectedAt: new Date().toISOString(),
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

  // Determine date range
  let startDate: string;
  let endDate: string;

  if (opts.startDate) {
    startDate = opts.startDate;
  } else {
    const d = new Date();
    d.setDate(d.getDate() - opts.days);
    startDate = d.toISOString().slice(0, 10);
  }

  // Clamp to Dencun activation
  if (startDate < DENCUN_DATE) {
    startDate = DENCUN_DATE;
  }

  if (opts.endDate) {
    endDate = opts.endDate;
  } else {
    // Tomorrow to include today's blocks
    const d = new Date();
    d.setDate(d.getDate() + 1);
    endDate = d.toISOString().slice(0, 10);
  }

  console.log(`Ethereum DA (EIP-4844) — collector`);
  console.log(`Date range: ${startDate} → ${endDate}`);
  console.log();

  // ---- Check existing data ----
  const existingDates = await loadExistingBlocks();
  if (existingDates.size > 0) {
    const dates = [...existingDates.keys()].sort();
    const totalRows = [...existingDates.values()].reduce(
      (s, set) => s + set.size,
      0
    );
    console.log(
      `Existing data: ${totalRows.toLocaleString()} blocks across ${dates.length} days (${dates[0]} → ${dates[dates.length - 1]})`
    );
  }

  // ---- Determine which dates need fetching ----
  const datesToFetch: string[] = [];
  const cursor = new Date(startDate);
  const endD = new Date(endDate);
  const today = new Date().toISOString().slice(0, 10);

  while (cursor < endD) {
    const dateStr = cursor.toISOString().slice(0, 10);
    // Always re-fetch today (partial day), skip dates we already have
    if (dateStr === today || !existingDates.has(dateStr)) {
      datesToFetch.push(dateStr);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // Track stats incrementally to avoid holding millions of rows in memory
  let totalFetched = 0;
  let totalBlobs = 0;
  let blocksWithBlobs = 0;
  let minBlock = Infinity;
  let maxBlock = 0;
  let minTs = Infinity;
  let maxTs = 0;

  if (datesToFetch.length === 0) {
    console.log(`All dates already collected!\n`);
  } else {
    console.log(
      `Need to fetch ${datesToFetch.length} days (${datesToFetch[0]} → ${datesToFetch[datesToFetch.length - 1]})\n`
    );

    // ---- Query BigQuery ----
    const bq = createBigQueryClient();

    // Fetch in chunks of 30 days to manage memory
    const CHUNK_DAYS = 30;
    for (let i = 0; i < datesToFetch.length; i += CHUNK_DAYS) {
      const chunk = datesToFetch.slice(i, i + CHUNK_DAYS);
      const chunkStart = chunk[0];
      const lastDate = new Date(chunk[chunk.length - 1]);
      lastDate.setDate(lastDate.getDate() + 1);
      const chunkEnd = lastDate.toISOString().slice(0, 10);

      const rows = await fetchBlocks(bq, chunkStart, chunkEnd);

      // Update stats
      for (const r of rows) {
        totalFetched++;
        totalBlobs += r.blob_count;
        if (r.blob_count > 0) blocksWithBlobs++;
        if (r.block_number < minBlock) minBlock = r.block_number;
        if (r.block_number > maxBlock) maxBlock = r.block_number;
        if (r.timestamp_ms < minTs) minTs = r.timestamp_ms;
        if (r.timestamp_ms > maxTs) maxTs = r.timestamp_ms;
      }

      // Save to disk and release memory
      const fileCount = await saveBlocks(rows);
      console.log(`  Saved ${fileCount} day files (${totalFetched.toLocaleString()} total blocks)\n`);
    }
  }

  // ---- Count existing data from disk ----
  const dataDir = path.join(OUTPUT_DIR, "blocks");
  let totalOnDisk = 0;
  let dayFiles = 0;
  try {
    const files = (await readdir(dataDir))
      .filter((f) => f.endsWith(".csv"))
      .sort();
    dayFiles = files.length;
    for (const file of files) {
      const text = await readFile(path.join(dataDir, file), "utf-8");
      const lines = text.trim().split("\n");
      totalOnDisk += lines.length - 1; // subtract header
    }
  } catch {
    // No data
  }

  // ---- Fetch prices ----
  let prices: PricePoint[] = [];
  try {
    prices = await fetchEthPrices(opts.priceDays);
  } catch (err: any) {
    console.warn(`Price fetch failed: ${err.message}`);
    try {
      const text = await readFile(
        path.join(OUTPUT_DIR, "eth_prices.csv"),
        "utf-8"
      );
      const lines = text.trim().split("\n").slice(1);
      prices = lines
        .filter((l) => l.trim())
        .map((line) => {
          const [date, usd] = line.split(",");
          return { date, eth_usd: parseFloat(usd) };
        });
      console.log(`  Using cached eth_prices.csv (${prices.length} points)`);
    } catch {
      console.warn("  No cached prices available.");
    }
  }

  // ---- Write prices ----
  if (prices.length > 0) {
    await savePrices(prices);
    console.log(`CSV    → data/eth_prices.csv  (${prices.length} rows)`);
  }

  // ---- Write config from stats ----
  if (totalOnDisk > 0) {
    await saveConfigFromStats(
      { totalFetched, totalBlobs, blocksWithBlobs, minBlock, maxBlock, minTs, maxTs, totalOnDisk },
      prices
    );
    console.log(`Config → data/chain_config.json`);
  }

  // ---- Summary ----
  console.log(`\nCSV    → data/blocks/  (${totalOnDisk.toLocaleString()} rows across ${dayFiles} days)`);
  if (totalFetched > 0) {
    const days = (maxTs - minTs) / (1000 * 86400);
    const totalDataMib = (totalBlobs * BYTES_PER_BLOB) / MiB;
    console.log(`\nEthereum DA — ${totalFetched.toLocaleString()} new blocks (${days.toFixed(1)} days)`);
    console.log("─".repeat(60));
    console.log(`Blocks with blobs:  ${blocksWithBlobs.toLocaleString()} / ${totalFetched.toLocaleString()} (${((blocksWithBlobs / totalFetched) * 100).toFixed(1)}%)`);
    console.log(`Total blobs:        ${totalBlobs.toLocaleString()}`);
    console.log(`Total data:         ${totalDataMib.toFixed(1)} MiB`);
    console.log(`Avg blobs/block:    ${(totalBlobs / totalFetched).toFixed(2)}`);
  }
  if (prices.length > 0) {
    const latest = prices[prices.length - 1];
    console.log(`\nETH price: $${latest.eth_usd.toFixed(2)} (${latest.date})`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
