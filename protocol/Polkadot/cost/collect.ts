#!/usr/bin/env npx tsx
/**
 * Polkadot DA Cost Analysis — comprehensive data collection
 *
 * Queries the Coretime chain (broker pallet) for historical pricing data
 * and scans the Relay chain for on-demand coretime orders.
 *
 * Broker events (via Subscan API — no block scanning needed):
 *   broker.SaleInitialized   → sale cycle boundaries + start/end prices
 *   broker.Purchased         → actual core purchase prices
 *   broker.Renewed           → core renewal prices
 *
 * Relay chain events (via RPC scan):
 *   onDemand.OnDemandOrderPlaced → per-block on-demand fees
 *
 * Broker config (via Coretime chain RPC):
 *   broker.configuration()   → sale parameters
 *   broker.saleInfo()        → current sale state
 *
 * Outputs:
 *   analysis/sales.csv           — per-sale-cycle data
 *   analysis/purchases.csv       — individual core purchases with price paid
 *   analysis/renewals.csv        — individual core renewals with price paid
 *   analysis/ondemand.csv        — on-demand orders (relay chain)
 *   analysis/dot_prices.csv      — historical DOT/USD daily prices
 *   analysis/broker_config.json  — broker pallet configuration snapshot
 *   analysis/cost_config.json    — derived cost metrics + DOT/USD
 *
 * Usage:
 *   npx tsx cost/collect.ts                           # default
 *   npx tsx cost/collect.ts --ondemand-blocks 5000    # relay scan window
 *   npx tsx cost/collect.ts --max-pages 50            # more Subscan pages (100 events/page)
 */

import { ApiPromise, WsProvider } from "@polkadot/api";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SaleEvent {
  ct_block: number;
  timestamp: number;
  sale_start: number;
  leadin_length: number;
  start_price: string;
  end_price: string;
  region_begin: number;
  region_end: number;
  ideal_cores_sold: number;
  cores_offered: number;
}

interface PurchaseEvent {
  ct_block: number;
  timestamp: number;
  who: string;
  region_begin: number;
  core: number;
  mask: string;
  price: string;
  duration: number;
}

interface RenewalEvent {
  ct_block: number;
  timestamp: number;
  who: string;
  old_core: number;
  core: number;
  begin: number;
  price: string;
  duration: number;
  workload: string;
}

interface OnDemandRow {
  block_number: number;
  timestamp: number;
  para_id: number;
  fee_paid: string;
}

interface BrokerConfig {
  advance_notice: number;
  interlude_length: number;
  leadin_length: number;
  region_length: number;
  ideal_bulk_proportion: number;
  limit_cores_offered: number | null;
  renewal_bump: number;
  contribution_timeout: number;
}

interface Opts {
  relayRpc: string;
  coretimeRpc: string;
  ondemandBlocks: number;
  maxPages: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MiB = 1_048_576;
const DOT = 10_000_000_000;
const BLOCK_TIME_MS = 6_000;
const TIMESLICE_PERIOD = 80;

const DEFAULT_RELAY_RPC = "wss://rpc.polkadot.io";
const DEFAULT_CORETIME_RPC = "wss://polkadot-coretime-rpc.polkadot.io";
const DEFAULT_ONDEMAND_BLOCKS = 2_000;
const DEFAULT_MAX_PAGES = 20;
const RELAY_BATCH = 50;
const MAX_RETRIES = 3;

const SUBSCAN_BASE = "https://coretime-polkadot.api.subscan.io";
const SUBSCAN_ROWS_PER_PAGE = 100;
const SUBSCAN_DELAY_MS = 600; // respect ~2 req/s rate limit

const OUTPUT_DIR = path.join(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "analysis"
);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const opts: Opts = {
    relayRpc: DEFAULT_RELAY_RPC,
    coretimeRpc: DEFAULT_CORETIME_RPC,
    ondemandBlocks: DEFAULT_ONDEMAND_BLOCKS,
    maxPages: DEFAULT_MAX_PAGES,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--relay-rpc" && args[i + 1]) opts.relayRpc = args[++i];
    else if (args[i] === "--coretime-rpc" && args[i + 1]) opts.coretimeRpc = args[++i];
    else if (args[i] === "--ondemand-blocks" && args[i + 1]) opts.ondemandBlocks = parseInt(args[++i], 10);
    else if (args[i] === "--max-pages" && args[i + 1]) opts.maxPages = parseInt(args[++i], 10);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();
  await mkdir(OUTPUT_DIR, { recursive: true });

  const dotUsd = await fetchDotUsd();
  console.log(`DOT/USD: $${dotUsd.price.toFixed(4)}  (${dotUsd.source})\n`);

  // ── Coretime chain RPC: config + current sale ───────────────────────────
  console.log(`Connecting to coretime chain: ${opts.coretimeRpc}`);
  const ctProvider = new WsProvider(opts.coretimeRpc);
  const ctApi = await ApiPromise.create({ provider: ctProvider, noInitWarn: true });

  let brokerConfig: BrokerConfig | null = null;
  let currentSaleInfo: Record<string, any> = {};

  try {
    brokerConfig = await queryBrokerConfig(ctApi);
    if (brokerConfig) {
      console.log(`Broker config: region_length=${brokerConfig.region_length} ts  leadin=${brokerConfig.leadin_length} blocks  renewal_bump=${(brokerConfig.renewal_bump / 1e7).toFixed(1)}%`);
    }
    currentSaleInfo = await querySaleInfo(ctApi);
    console.log(`Current sale: regionBegin=${currentSaleInfo.regionBegin}  coresOffered=${currentSaleInfo.coresOffered}  coresSold=${currentSaleInfo.coresSold}  endPrice=${currentSaleInfo.endPrice}`);
  } finally {
    await ctApi.disconnect();
  }

  // ── Subscan: broker events ──────────────────────────────────────────────
  console.log(`\nQuerying Subscan for broker events (max ${opts.maxPages} pages per event type)...`);

  const sales = await fetchSubscanEvents<SaleEvent>(
    "broker", "SaleInitialized", opts.maxPages, parseSaleFromSubscan
  );
  console.log(`  SaleInitialized: ${sales.length} events`);

  const purchases = await fetchSubscanEvents<PurchaseEvent>(
    "broker", "Purchased", opts.maxPages, parsePurchaseFromSubscan
  );
  console.log(`  Purchased:       ${purchases.length} events`);

  const renewals = await fetchSubscanEvents<RenewalEvent>(
    "broker", "Renewed", opts.maxPages, parseRenewalFromSubscan
  );
  console.log(`  Renewed:         ${renewals.length} events`);

  // ── Relay chain: config + on-demand ─────────────────────────────────────
  console.log(`\nConnecting to relay chain: ${opts.relayRpc}`);
  const relayProvider = new WsProvider(opts.relayRpc);
  const relayApi = await ApiPromise.create({ provider: relayProvider, noInitWarn: true });

  let relayConfig: { maxPovBytes: number; cadence: number; effectiveCores: number };
  let ondemandRows: OnDemandRow[];

  try {
    relayConfig = await readRelayConfig(relayApi);
    console.log(
      `Relay config: max_pov=${(relayConfig.maxPovBytes / MiB).toFixed(2)} MiB  cadence=${relayConfig.cadence}s  effective_cores=${relayConfig.effectiveCores}`
    );
    ondemandRows = await collectOnDemand(relayApi, opts.ondemandBlocks);
    console.log(`On-demand orders: ${ondemandRows.length} in last ${opts.ondemandBlocks} blocks\n`);
  } finally {
    await relayApi.disconnect();
  }

  // ── Fetch historical DOT prices ─────────────────────────────────────────
  const allTimestamps = [
    ...purchases.map((p) => p.timestamp),
    ...renewals.map((r) => r.timestamp),
  ].filter((t) => t > 0);

  let historicalPrices = new Map<string, number>();
  if (allTimestamps.length > 0) {
    const minTs = Math.min(...allTimestamps);
    const maxTs = Math.max(...allTimestamps);
    // Pad range by 1 day on each side
    historicalPrices = await fetchHistoricalDotPrices(minTs - 86400, maxTs + 86400);
  }

  // ── Compute cost metrics ────────────────────────────────────────────────
  const maxPovMib = relayConfig.maxPovBytes / MiB;
  const regionTimeslices = brokerConfig?.region_length ?? 5040;
  const blocksPerRegion = regionTimeslices * TIMESLICE_PERIOD;
  const maxMibPerRegion = blocksPerRegion * maxPovMib;

  // Bulk purchase: use actual purchase prices if available, else latest sale end_price
  const latestSale = sales.length > 0 ? sales[sales.length - 1] : null;
  const latestEndPriceDot = latestSale ? Number(latestSale.end_price) / DOT : 0;
  const purchasePricesDot = purchases.map((p) => Number(p.price) / DOT);
  const medPurchasePrice = purchasePricesDot.length > 0
    ? medianOf(purchasePricesDot)
    : latestEndPriceDot;
  const bulkCostPerMibDot = medPurchasePrice > 0 ? medPurchasePrice / maxMibPerRegion : 0;

  // Bulk renewal
  const renewalPricesDot = renewals.map((r) => Number(r.price) / DOT);
  const medRenewalPrice = renewalPricesDot.length > 0 ? medianOf(renewalPricesDot) : 0;
  const renewalCostPerMibDot = medRenewalPrice > 0 ? medRenewalPrice / maxMibPerRegion : 0;

  // On-demand
  const odFees = ondemandRows.map((r) => Number(r.fee_paid));
  odFees.sort((a, b) => a - b);
  const medOdFee = odFees.length > 0 ? odFees[Math.floor(odFees.length / 2)] : 0;
  const medOdFeeDot = medOdFee / DOT;
  const odCostPerMibDot = medOdFeeDot > 0 ? medOdFeeDot / maxPovMib : 0;
  const BLOCKS_PER_MONTH = (30 * 24 * 3600) / relayConfig.cadence;

  const costConfig = {
    dot_usd: dotUsd.price,
    dot_usd_source: dotUsd.source,
    dot_usd_timestamp: dotUsd.timestamp,
    relay: relayConfig,
    broker: {
      region_length_timeslices: regionTimeslices,
      timeslice_period_blocks: TIMESLICE_PERIOD,
      blocks_per_region: blocksPerRegion,
      max_mib_per_region: maxMibPerRegion,
      renewal_bump_perbill: brokerConfig?.renewal_bump ?? 0,
    },
    bulk_purchase: {
      sales_indexed: sales.length,
      purchases_indexed: purchases.length,
      latest_end_price_dot: latestEndPriceDot,
      median_purchase_price_dot: medPurchasePrice,
      cost_per_mib_dot: bulkCostPerMibDot,
      cost_per_mib_usd: bulkCostPerMibDot * dotUsd.price,
      cost_per_gib_month_usd: bulkCostPerMibDot * 1024 * dotUsd.price,
    },
    bulk_renewal: {
      renewals_indexed: renewals.length,
      median_renewal_price_dot: medRenewalPrice,
      cost_per_mib_dot: renewalCostPerMibDot,
      cost_per_mib_usd: renewalCostPerMibDot * dotUsd.price,
      cost_per_gib_month_usd: renewalCostPerMibDot * 1024 * dotUsd.price,
    },
    ondemand: {
      orders_indexed: ondemandRows.length,
      median_fee_dot: medOdFeeDot,
      cost_per_mib_dot: odCostPerMibDot,
      cost_per_mib_usd: odCostPerMibDot * dotUsd.price,
      cost_per_gib_month_usd: odCostPerMibDot * 1024 * BLOCKS_PER_MONTH * dotUsd.price,
      blocks_per_month: BLOCKS_PER_MONTH,
    },
  };

  // ── Write outputs ───────────────────────────────────────────────────────
  await writeSalesCsv(sales);
  await writePurchasesCsv(purchases);
  await writeRenewalsCsv(renewals);
  await writeOndemandCsv(ondemandRows);
  if (historicalPrices.size > 0) {
    await writeDotPricesCsv(historicalPrices);
  }

  if (brokerConfig) {
    const bcPath = path.join(OUTPUT_DIR, "broker_config.json");
    await writeFile(bcPath, JSON.stringify(brokerConfig, null, 2) + "\n");
    console.log(`Config -> ${bcPath}`);
  }

  const ccPath = path.join(OUTPUT_DIR, "cost_config.json");
  await writeFile(ccPath, JSON.stringify(costConfig, null, 2) + "\n");
  console.log(`Config -> ${ccPath}`);

  printSummary(costConfig, sales, purchases, renewals, ondemandRows);
}

// ---------------------------------------------------------------------------
// DOT/USD price
// ---------------------------------------------------------------------------

async function fetchDotUsd(): Promise<{ price: number; source: string; timestamp: number }> {
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=polkadot&vs_currencies=usd"
    );
    const data = (await resp.json()) as any;
    if (data?.polkadot?.usd) {
      return { price: data.polkadot.usd, source: "coingecko", timestamp: Date.now() };
    }
  } catch {
    /* fall through */
  }
  console.warn("  Warning: CoinGecko unavailable, using fallback DOT/USD");
  return { price: 5.0, source: "fallback", timestamp: Date.now() };
}

// ---------------------------------------------------------------------------
// Historical DOT/USD prices (CoinGecko market_chart/range)
// ---------------------------------------------------------------------------

async function fetchHistoricalDotPrices(
  fromUnix: number,
  toUnix: number
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  // CoinGecko free tier limits market_chart/range to the past 365 days.
  // Split into: (a) range query for last 365 days, (b) per-day history for older dates.
  const nowUnix = Math.floor(Date.now() / 1000);
  const maxRangeStart = nowUnix - 365 * 86400;

  // (a) Range query for the portion within the 365-day window
  const rangeFrom = Math.max(fromUnix, maxRangeStart);
  if (rangeFrom <= toUnix) {
    try {
      const url = `https://api.coingecko.com/api/v3/coins/polkadot/market_chart/range?vs_currency=usd&from=${rangeFrom}&to=${toUnix}`;
      const resp = await fetch(url);
      const data = (await resp.json()) as any;
      if (Array.isArray(data?.prices)) {
        for (const [tsMs, price] of data.prices) {
          const d = new Date(tsMs);
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
          prices.set(key, price);
        }
      }
      console.log(`Historical DOT/USD (range): ${prices.size} daily prices`);
    } catch (err: any) {
      console.warn(`  Warning: CoinGecko range query failed: ${err.message ?? err}`);
    }
  }

  // (b) For dates older than 365 days, use the /history endpoint per unique date
  if (fromUnix < maxRangeStart) {
    const olderDates = new Set<string>();
    // Collect unique dates we need from the from→maxRangeStart window
    for (let ts = fromUnix; ts < maxRangeStart; ts += 86400) {
      const d = new Date(ts * 1000);
      const key = `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
      const isoKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      if (!prices.has(isoKey)) olderDates.add(key);
    }

    if (olderDates.size > 0) {
      console.log(`Fetching ${olderDates.size} older daily DOT/USD prices via /history...`);
      let fetched = 0;
      for (const ddmmyyyy of olderDates) {
        try {
          await sleep(SUBSCAN_DELAY_MS); // respect rate limit
          const url = `https://api.coingecko.com/api/v3/coins/polkadot/history?date=${ddmmyyyy}&localization=false`;
          const resp = await fetch(url);
          const data = (await resp.json()) as any;
          const usd = data?.market_data?.current_price?.usd;
          if (typeof usd === "number") {
            // Convert dd-mm-yyyy to yyyy-mm-dd
            const [dd, mm, yyyy] = ddmmyyyy.split("-");
            prices.set(`${yyyy}-${mm}-${dd}`, usd);
          }
          fetched++;
          if (olderDates.size > 5) {
            process.stdout.write(`\r  history: ${fetched}/${olderDates.size} dates fetched`);
          }
        } catch {
          // skip this date
        }
      }
      if (olderDates.size > 5) {
        process.stdout.write(`\r  history: ${fetched}/${olderDates.size} done${" ".repeat(20)}\n`);
      }
    }
  }

  console.log(`Historical DOT/USD: ${prices.size} total daily prices`);
  return prices;
}

async function writeDotPricesCsv(prices: Map<string, number>): Promise<void> {
  const sorted = [...prices.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const header = "date,dot_usd\n";
  const body = sorted.map(([d, p]) => `${d},${p}`).join("\n");
  const p = path.join(OUTPUT_DIR, "dot_prices.csv");
  await writeFile(p, header + body + "\n");
  console.log(`CSV -> ${p}  (${sorted.length} rows)`);
}

// ---------------------------------------------------------------------------
// Broker pallet queries (via RPC — single queries, no scanning)
// ---------------------------------------------------------------------------

async function queryBrokerConfig(api: ApiPromise): Promise<BrokerConfig | null> {
  try {
    const raw = await (api.query as any).broker?.configuration?.();
    if (!raw) return null;
    const cfg = raw.toJSON() as Record<string, any>;
    return {
      advance_notice: cfg.advanceNotice ?? cfg.advance_notice ?? 0,
      interlude_length: cfg.interludeLength ?? cfg.interlude_length ?? 0,
      leadin_length: cfg.leadinLength ?? cfg.leadin_length ?? 0,
      region_length: cfg.regionLength ?? cfg.region_length ?? 5040,
      ideal_bulk_proportion: cfg.idealBulkProportion ?? cfg.ideal_bulk_proportion ?? 0,
      limit_cores_offered: cfg.limitCoresOffered ?? cfg.limit_cores_offered ?? null,
      renewal_bump: cfg.renewalBump ?? cfg.renewal_bump ?? 0,
      contribution_timeout: cfg.contributionTimeout ?? cfg.contribution_timeout ?? 0,
    };
  } catch (err: any) {
    console.warn(`  Warning: broker.configuration() failed: ${err.message ?? err}`);
    return null;
  }
}

async function querySaleInfo(api: ApiPromise): Promise<Record<string, any>> {
  try {
    const raw = await (api.query as any).broker?.saleInfo?.();
    if (!raw) return {};
    return raw.toJSON() as Record<string, any>;
  } catch (err: any) {
    console.warn(`  Warning: broker.saleInfo() failed: ${err.message ?? err}`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Subscan API: two-step event fetching
//   Step 1: /api/v2/scan/events (list) — returns event_index but no params
//   Step 2: /api/scan/event (detail)   — returns full params for each event
// ---------------------------------------------------------------------------

const SUBSCAN_DETAIL_CONCURRENCY = 2; // concurrent detail requests (stay under ~2 req/s free limit)

/** Fetch all events of a given type, including full params via detail endpoint */
async function fetchSubscanEvents<T>(
  module: string,
  eventId: string,
  maxPages: number,
  parser: (params: Map<string, any>, ctBlock: number, timestamp: number) => T | null
): Promise<T[]> {
  // Step 1: collect all event_indexes + block_timestamps from the list endpoint
  const eventMeta: { index: string; timestamp: number }[] = [];

  for (let page = 0; page < maxPages; page++) {
    try {
      const resp = await fetch(`${SUBSCAN_BASE}/api/v2/scan/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module,
          event_id: eventId,
          page,
          row: SUBSCAN_ROWS_PER_PAGE,
          order: "asc",
        }),
      });

      const data = (await resp.json()) as any;

      if (data.code !== 0) {
        console.warn(`  Subscan list error (${module}.${eventId} p${page}): ${data.message}`);
        break;
      }

      const events = data.data?.events ?? [];
      if (events.length === 0) break;

      for (const evt of events) {
        if (evt.event_index) {
          eventMeta.push({
            index: evt.event_index,
            timestamp: Number(evt.block_timestamp ?? 0),
          });
        }
      }

      if (events.length < SUBSCAN_ROWS_PER_PAGE) break;
      await sleep(SUBSCAN_DELAY_MS);
    } catch (err: any) {
      console.warn(`  Subscan list error (${module}.${eventId} p${page}): ${err.message}`);
      break;
    }
  }

  if (eventMeta.length === 0) return [];

  // Step 2: fetch detail for each event (with controlled concurrency + retries)
  const results: T[] = [];
  const failed: string[] = [];
  let fetched = 0;

  async function fetchDetail(meta: { index: string; timestamp: number }): Promise<T | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(`${SUBSCAN_BASE}/api/scan/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_index: meta.index }),
        });

        if (resp.status === 429) {
          // Rate limited — back off and retry
          await sleep(SUBSCAN_DELAY_MS * (attempt + 2));
          continue;
        }

        const data = (await resp.json()) as any;
        if (data.code !== 0) return null;

        const evtData = data.data;
        const ctBlock = Number(meta.index.split("-")[0]);
        const params = parseSubscanParams(evtData);
        if (!params) return null;

        return parser(params, ctBlock, meta.timestamp);
      } catch {
        if (attempt < 2) await sleep(SUBSCAN_DELAY_MS * (attempt + 1));
      }
    }
    return null;
  }

  for (let i = 0; i < eventMeta.length; i += SUBSCAN_DETAIL_CONCURRENCY) {
    const batch = eventMeta.slice(i, i + SUBSCAN_DETAIL_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (meta) => {
        const result = await fetchDetail(meta);
        if (!result) failed.push(meta.index);
        return result;
      })
    );

    for (const r of batchResults) {
      if (r) results.push(r);
    }

    fetched += batch.length;
    if (eventMeta.length > 10) {
      process.stdout.write(
        `\r    ${module}.${eventId}: ${fetched}/${eventMeta.length} details fetched`
      );
    }

    if (i + SUBSCAN_DETAIL_CONCURRENCY < eventMeta.length) {
      await sleep(SUBSCAN_DELAY_MS);
    }
  }

  if (eventMeta.length > 10) {
    process.stdout.write(`\r    ${module}.${eventId}: ${fetched}/${eventMeta.length} done${" ".repeat(20)}\n`);
  }

  if (failed.length > 0) {
    console.warn(`    (${failed.length} detail fetches failed — may be rate-limited)`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Subscan event parsers
// ---------------------------------------------------------------------------

function parseSaleFromSubscan(params: Map<string, any>, ctBlock: number, timestamp: number): SaleEvent | null {
  return {
    ct_block: ctBlock,
    timestamp,
    sale_start: numParam(params, "sale_start"),
    leadin_length: numParam(params, "leadin_length"),
    start_price: strParam(params, "start_price"),
    end_price: strParam(params, "end_price") || strParam(params, "regular_price"),
    region_begin: numParam(params, "region_begin"),
    region_end: numParam(params, "region_end"),
    ideal_cores_sold: numParam(params, "ideal_cores_sold"),
    cores_offered: numParam(params, "cores_offered"),
  };
}

function parsePurchaseFromSubscan(params: Map<string, any>, ctBlock: number, timestamp: number): PurchaseEvent | null {
  // region_id is a composite { begin, core, mask }
  const regionId = findParam(params, "region_id");
  let regionBegin = 0, core = 0, mask = "";
  if (regionId && typeof regionId === "object") {
    regionBegin = Number(regionId.begin ?? 0);
    core = Number(regionId.core ?? 0);
    mask = String(regionId.mask ?? "");
  }

  return {
    ct_block: ctBlock,
    timestamp,
    who: strParam(params, "who"),
    region_begin: regionBegin,
    core,
    mask,
    price: strParam(params, "price"),
    duration: numParam(params, "duration"),
  };
}

function parseRenewalFromSubscan(params: Map<string, any>, ctBlock: number, timestamp: number): RenewalEvent | null {
  return {
    ct_block: ctBlock,
    timestamp,
    who: strParam(params, "who"),
    old_core: numParam(params, "old_core"),
    core: numParam(params, "core"),
    begin: numParam(params, "begin"),
    price: strParam(params, "price"),
    duration: numParam(params, "duration"),
    workload: JSON.stringify(findParam(params, "workload") ?? []),
  };
}

/**
 * Parse Subscan event detail params.
 * Detail endpoint returns: { params: [{ name, type, type_name, value }, ...] }
 */
function parseSubscanParams(evtData: any): Map<string, any> | null {
  let rawParams = evtData?.params;
  if (typeof rawParams === "string") {
    try { rawParams = JSON.parse(rawParams); } catch { return null; }
  }
  if (!Array.isArray(rawParams)) return null;

  const map = new Map<string, any>();
  for (const p of rawParams) {
    const name = p.name ?? "";
    let value = p.value;
    // Subscan sometimes wraps values in JSON strings
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { /* keep as string */ }
    }
    map.set(name, value);
  }
  return map;
}

function findParam(params: Map<string, any>, name: string): any {
  return params.get(name) ?? undefined;
}

function numParam(params: Map<string, any>, name: string): number {
  const v = params.get(name);
  if (v == null) return 0;
  return typeof v === "number" ? v : parseInt(String(v), 10) || 0;
}

function strParam(params: Map<string, any>, name: string): string {
  const v = params.get(name);
  if (v == null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

// ---------------------------------------------------------------------------
// Relay chain config
// ---------------------------------------------------------------------------

async function readRelayConfig(api: ApiPromise): Promise<{
  maxPovBytes: number;
  cadence: number;
  effectiveCores: number;
}> {
  const rawConfig = await api.query.configuration.activeConfig();
  const cfg = rawConfig.toJSON() as Record<string, any>;

  const maxPovBytes: number = cfg.maxPovSize ?? cfg.max_pov_size ?? 10 * MiB;

  const sched = cfg.schedulerParams ?? cfg.scheduler_params ?? {};
  const numCores: number = sched.numCores ?? sched.num_cores ?? 50;

  const asyncParams = cfg.asyncBackingParams ?? cfg.async_backing_params ?? {};
  const maxCandidateDepth: number =
    asyncParams.maxCandidateDepth ?? asyncParams.max_candidate_depth ?? 0;
  const cadence = maxCandidateDepth > 0 ? 6 : 12;

  const validatorsRaw = await api.query.session.validators();
  const validatorCount = (validatorsRaw as unknown as unknown[]).length;
  const effectiveCores = Math.min(numCores, Math.floor(validatorCount / 5));

  return { maxPovBytes, cadence, effectiveCores };
}

// ---------------------------------------------------------------------------
// Relay chain: on-demand order collection
// ---------------------------------------------------------------------------

async function collectOnDemand(api: ApiPromise, blocks: number): Promise<OnDemandRow[]> {
  const head = await api.rpc.chain.getHeader();
  const endBlock = head.number.toNumber();
  const startBlock = endBlock - blocks + 1;
  const headHash = await api.rpc.chain.getBlockHash(endBlock);
  const headTs = ((await api.query.timestamp.now.at(headHash)) as any).toNumber() as number;
  const tsOf = (bn: number) => headTs + (bn - endBlock) * BLOCK_TIME_MS;

  const rows: OnDemandRow[] = [];
  let done = 0;
  const t0 = Date.now();

  for (let bn = startBlock; bn <= endBlock; bn += RELAY_BATCH) {
    const batchEnd = Math.min(bn + RELAY_BATCH - 1, endBlock);
    const promises: Promise<OnDemandRow[]>[] = [];

    for (let b = bn; b <= batchEnd; b++) {
      const blockNum = b;
      const timestamp = tsOf(b);
      promises.push(
        (async (): Promise<OnDemandRow[]> => {
          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
              const hash = await api.rpc.chain.getBlockHash(blockNum);
              const eventsRaw = await api.query.system.events.at(hash);
              const allEvents = eventsRaw as unknown as Array<{
                event: { section: string; method: string; data: any[] };
              }>;

              const odRows: OnDemandRow[] = [];
              for (const { event } of allEvents) {
                const isOd =
                  (event.section === "onDemandAssignmentProvider" ||
                    event.section === "onDemand") &&
                  (event.method === "OnDemandOrderPlaced" ||
                    event.method === "OrderPlaced" ||
                    event.method === "SpotOrderPlaced");
                if (!isOd) continue;

                try {
                  const paraId =
                    (event.data[0] as any)?.toNumber?.() ?? Number(event.data[0]);
                  const fee =
                    (event.data[1] as any)?.toString?.() ?? String(event.data[1]);
                  odRows.push({ block_number: blockNum, timestamp, para_id: paraId, fee_paid: fee });
                } catch {
                  /* skip */
                }
              }
              return odRows;
            } catch {
              if (attempt < MAX_RETRIES - 1) await sleep(300 * (attempt + 1));
            }
          }
          return [];
        })()
      );
    }

    const results = await Promise.all(promises);
    for (const batch of results) rows.push(...batch);
    done += batchEnd - bn + 1;

    const elapsed = (Date.now() - t0) / 1000;
    if (elapsed > 0 && done < blocks) {
      process.stdout.write(
        `\r  on-demand scan: ${done}/${blocks} blocks  (${(done / elapsed).toFixed(1)} blk/s)`
      );
    }
  }

  if (blocks > 100) {
    process.stdout.write(`\r  on-demand scan: ${done}/${blocks} done${" ".repeat(30)}\n`);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// CSV writers
// ---------------------------------------------------------------------------

async function writeSalesCsv(rows: SaleEvent[]): Promise<void> {
  const header = "ct_block,timestamp,sale_start,leadin_length,start_price,end_price,region_begin,region_end,ideal_cores_sold,cores_offered\n";
  const body = rows
    .sort((a, b) => a.ct_block - b.ct_block)
    .map(
      (r) =>
        `${r.ct_block},${r.timestamp},${r.sale_start},${r.leadin_length},${r.start_price},${r.end_price},${r.region_begin},${r.region_end},${r.ideal_cores_sold},${r.cores_offered}`
    )
    .join("\n");
  const p = path.join(OUTPUT_DIR, "sales.csv");
  await writeFile(p, header + body + "\n");
  console.log(`CSV -> ${p}  (${rows.length} rows)`);
}

async function writePurchasesCsv(rows: PurchaseEvent[]): Promise<void> {
  const header = "ct_block,timestamp,who,region_begin,core,mask,price,duration\n";
  const body = rows
    .sort((a, b) => a.ct_block - b.ct_block)
    .map(
      (r) =>
        `${r.ct_block},${r.timestamp},${r.who},${r.region_begin},${r.core},${r.mask},${r.price},${r.duration}`
    )
    .join("\n");
  const p = path.join(OUTPUT_DIR, "purchases.csv");
  await writeFile(p, header + body + "\n");
  console.log(`CSV -> ${p}  (${rows.length} rows)`);
}

async function writeRenewalsCsv(rows: RenewalEvent[]): Promise<void> {
  const header = "ct_block,timestamp,who,old_core,core,begin,price,duration,workload\n";
  const body = rows
    .sort((a, b) => a.ct_block - b.ct_block)
    .map(
      (r) =>
        `${r.ct_block},${r.timestamp},${r.who},${r.old_core},${r.core},${r.begin},${r.price},${r.duration},${r.workload}`
    )
    .join("\n");
  const p = path.join(OUTPUT_DIR, "renewals.csv");
  await writeFile(p, header + body + "\n");
  console.log(`CSV -> ${p}  (${rows.length} rows)`);
}

async function writeOndemandCsv(rows: OnDemandRow[]): Promise<void> {
  const header = "block_number,timestamp,para_id,fee_paid\n";
  const body = rows
    .map((r) => `${r.block_number},${r.timestamp},${r.para_id},${r.fee_paid}`)
    .join("\n");
  const p = path.join(OUTPUT_DIR, "ondemand.csv");
  await writeFile(p, header + body + "\n");
  console.log(`CSV -> ${p}  (${rows.length} rows)`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(
  cc: any,
  sales: SaleEvent[],
  purchases: PurchaseEvent[],
  renewals: RenewalEvent[],
  odRows: OnDemandRow[]
): void {
  const line = "─".repeat(64);
  console.log(`\n${line}`);
  console.log("Polkadot DA Cost Summary");
  console.log(line);

  console.log(`\n  DOT/USD: $${cc.dot_usd.toFixed(4)} (${cc.dot_usd_source})`);
  console.log(`  max_pov: ${(cc.relay.maxPovBytes / MiB).toFixed(0)} MiB  cadence: ${cc.relay.cadence}s  cores: ${cc.relay.effectiveCores}`);

  if (sales.length > 0) {
    console.log(`\n  ── Sale History (${sales.length} cycles) ──`);
    const endPrices = sales.map((s) => Number(s.end_price) / DOT);
    console.log(`  End price range: ${Math.min(...endPrices).toFixed(4)} – ${Math.max(...endPrices).toFixed(4)} DOT`);
    console.log(`  Cores offered:   ${sales.map((s) => s.cores_offered).join(", ")}`);
    console.log(`  Region range:    ${sales[0].region_begin}..${sales[sales.length - 1].region_end} (timeslices)`);
  }

  console.log(`\n  ── Bulk Purchases (${purchases.length} indexed) ──`);
  if (purchases.length > 0) {
    const pPrices = purchases.map((p) => Number(p.price) / DOT);
    pPrices.sort((a, b) => a - b);
    console.log(`  Price range: ${pPrices[0].toFixed(4)} – ${pPrices[pPrices.length - 1].toFixed(4)} DOT`);
    console.log(`  Median:      ${cc.bulk_purchase.median_purchase_price_dot.toFixed(4)} DOT`);
  }
  console.log(`  Cost/MiB:    ${cc.bulk_purchase.cost_per_mib_dot.toFixed(8)} DOT  ($${cc.bulk_purchase.cost_per_mib_usd.toFixed(8)})`);
  console.log(`  Cost/GiB/mo: $${cc.bulk_purchase.cost_per_gib_month_usd.toFixed(4)}`);

  console.log(`\n  ── Bulk Renewals (${renewals.length} indexed) ──`);
  if (renewals.length > 0) {
    const rPrices = renewals.map((r) => Number(r.price) / DOT);
    rPrices.sort((a, b) => a - b);
    console.log(`  Price range: ${rPrices[0].toFixed(4)} – ${rPrices[rPrices.length - 1].toFixed(4)} DOT`);
    console.log(`  Median:      ${cc.bulk_renewal.median_renewal_price_dot.toFixed(4)} DOT`);
    console.log(`  Cost/MiB:    ${cc.bulk_renewal.cost_per_mib_dot.toFixed(8)} DOT  ($${cc.bulk_renewal.cost_per_mib_usd.toFixed(8)})`);
    console.log(`  Cost/GiB/mo: $${cc.bulk_renewal.cost_per_gib_month_usd.toFixed(4)}`);
  }

  console.log(`\n  ── On-Demand (${odRows.length} orders in scan window) ──`);
  if (odRows.length > 0) {
    const fees = odRows.map((r) => Number(r.fee_paid) / DOT);
    fees.sort((a, b) => a - b);
    console.log(`  Fee range: ${fees[0].toFixed(6)} – ${fees[fees.length - 1].toFixed(6)} DOT`);
    console.log(`  Median:    ${cc.ondemand.median_fee_dot.toFixed(6)} DOT`);
    console.log(`  Cost/MiB:  ${cc.ondemand.cost_per_mib_dot.toFixed(6)} DOT  ($${cc.ondemand.cost_per_mib_usd.toFixed(6)})`);
    console.log(`  Cost/GiB/mo: $${cc.ondemand.cost_per_gib_month_usd.toFixed(4)} (if ordering every block)`);
  }

  if (cc.bulk_purchase.cost_per_mib_usd > 0 && cc.ondemand.cost_per_mib_usd > 0) {
    console.log(`\n  ── Comparison ──`);
    const ratio = cc.ondemand.cost_per_mib_usd / cc.bulk_purchase.cost_per_mib_usd;
    console.log(`  On-demand is ${ratio.toFixed(1)}x bulk purchase price per MiB`);
  }
  if (cc.bulk_renewal.cost_per_mib_usd > 0 && cc.bulk_purchase.cost_per_mib_usd > 0) {
    const ratio = cc.bulk_renewal.cost_per_mib_usd / cc.bulk_purchase.cost_per_mib_usd;
    console.log(`  Renewal is ${ratio.toFixed(2)}x purchase price per MiB`);
  }

  console.log(`\n  Note: bulk cost/MiB is best-case (full PoV every block for entire region).`);
  console.log(`  Actual cost is higher — real parachains use 1-3 MiB per candidate.\n`);
  console.log(line);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
