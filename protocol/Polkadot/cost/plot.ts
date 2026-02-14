#!/usr/bin/env npx tsx
/**
 * Polkadot DA Cost — SVG plotter
 *
 * Reads analysis/cost_config.json + CSVs and generates:
 *   1. sale_prices.svg       — end price trend across sale cycles + purchase scatter
 *   2. ondemand_fees.svg     — on-demand fee per order over time (if data exists)
 *   3. cost_timeseries.svg   — historical cost/MiB/day using actual DOT/USD at time
 *
 * All charts show only the last 90 days of data.
 *
 * Usage:
 *   npx tsx cost/plot.ts
 */

import { readFile, writeFile } from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CostConfig {
  dot_usd: number;
  dot_usd_source: string;
  relay: {
    maxPovBytes: number;
    cadence: number;
    effectiveCores: number;
  };
  broker: {
    region_length_timeslices: number;
    timeslice_period_blocks: number;
    blocks_per_region: number;
    max_mib_per_region: number;
    renewal_bump_perbill: number;
  };
  bulk_purchase: {
    sales_indexed: number;
    purchases_indexed: number;
    latest_end_price_dot: number;
    median_purchase_price_dot: number;
    cost_per_mib_dot: number;
    cost_per_mib_usd: number;
    cost_per_gib_month_usd: number;
  };
  bulk_renewal: {
    renewals_indexed: number;
    median_renewal_price_dot: number;
    cost_per_mib_dot: number;
    cost_per_mib_usd: number;
    cost_per_gib_month_usd: number;
  };
  ondemand: {
    orders_indexed: number;
    median_fee_dot: number;
    cost_per_mib_dot: number;
    cost_per_mib_usd: number;
    cost_per_gib_month_usd: number;
    blocks_per_month: number;
  };
}

interface SaleRow {
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

interface PurchaseRow {
  ct_block: number;
  timestamp: number;
  who: string;
  region_begin: number;
  core: number;
  mask: string;
  price: string;
  duration: number;
}

interface RenewalRow {
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

interface CostTimeseriesRow {
  date: string;
  type: "purchase" | "renewal";
  price_dot: number;
  dot_usd: number;
  core_cost_usd: number;
  max_pov_mib: number;
  cost_per_mib_per_day_usd: number;
}

// ---------------------------------------------------------------------------
const DOT = 10_000_000_000;
const MiB = 1_048_576;
const DIR = path.join(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "analysis"
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const LAST_N_DAYS = 90;

async function main(): Promise<void> {
  const cfgText = await readFile(path.join(DIR, "cost_config.json"), "utf-8");
  const cc: CostConfig = JSON.parse(cfgText);

  const allSales = await loadSales();
  const allPurchases = await loadPurchases();
  const allRenewals = await loadRenewals();
  const allOndemand = await loadOndemand();

  // Filter to last 90 days
  const cutoff = Math.floor(Date.now() / 1000) - LAST_N_DAYS * 86400;
  const sales = allSales.filter(s => s.timestamp >= cutoff);
  const purchases = allPurchases.filter(p => p.timestamp >= cutoff);
  const renewals = allRenewals.filter(r => r.timestamp >= cutoff);
  const ondemand = allOndemand.filter(o => o.timestamp >= cutoff);

  console.log(`Filtering to last ${LAST_N_DAYS} days (cutoff ${new Date(cutoff * 1000).toISOString().slice(0, 10)})`);
  console.log(`  sales: ${allSales.length} → ${sales.length}  |  purchases: ${allPurchases.length} → ${purchases.length}  |  renewals: ${allRenewals.length} → ${renewals.length}`);

  // Plot 1: Sale price history + purchase/renewal scatter
  if (sales.length > 0 || purchases.length > 0 || renewals.length > 0) {
    const svg1 = buildSalePriceChart(sales, purchases, renewals, cc);
    const out1 = path.join(DIR, "sale_prices.svg");
    await writeFile(out1, svg1);
    console.log(`SVG -> ${out1}`);
  } else {
    console.log("No sale/purchase/renewal data — skipping price history");
  }

  // Plot 2: On-demand fee timeline
  if (ondemand.length > 0) {
    const svg2 = buildOndemandChart(ondemand, cc);
    const out2 = path.join(DIR, "ondemand_fees.svg");
    await writeFile(out2, svg2);
    console.log(`SVG -> ${out2}`);
  } else {
    console.log("No on-demand orders — skipping fee timeline");
  }

  // Plot 3: Cost timeseries (derived from purchases + renewals + dot_prices)
  const dotPrices = await loadDotPrices();
  if ((purchases.length > 0 || renewals.length > 0) && dotPrices.size > 0) {
    const costTs = deriveCostTimeseries(purchases, renewals, dotPrices, cc.dot_usd);
    const svg3 = buildCostTimeseriesChart(costTs);
    const out3 = path.join(DIR, "cost_timeseries.svg");
    await writeFile(out3, svg3);
    console.log(`SVG -> ${out3}  (${costTs.length} points)`);
  } else {
    console.log("No purchase/renewal data or dot_prices.csv — skipping historical cost chart");
  }
}

// ---------------------------------------------------------------------------
// CSV loaders
// ---------------------------------------------------------------------------

async function loadSales(): Promise<SaleRow[]> {
  try {
    const text = await readFile(path.join(DIR, "sales.csv"), "utf-8");
    return text.trim().split("\n").slice(1).filter(l => l.trim()).map(line => {
      const c = line.split(",");
      return {
        ct_block: parseInt(c[0]), timestamp: parseInt(c[1]), sale_start: parseInt(c[2]),
        leadin_length: parseInt(c[3]), start_price: c[4], end_price: c[5],
        region_begin: parseInt(c[6]), region_end: parseInt(c[7]),
        ideal_cores_sold: parseInt(c[8]), cores_offered: parseInt(c[9]),
      };
    });
  } catch { return []; }
}

async function loadPurchases(): Promise<PurchaseRow[]> {
  try {
    const text = await readFile(path.join(DIR, "purchases.csv"), "utf-8");
    return text.trim().split("\n").slice(1).filter(l => l.trim()).map(line => {
      const c = line.split(",");
      return {
        ct_block: parseInt(c[0]), timestamp: parseInt(c[1]), who: c[2],
        region_begin: parseInt(c[3]), core: parseInt(c[4]), mask: c[5],
        price: c[6], duration: parseInt(c[7]),
      };
    });
  } catch { return []; }
}

async function loadRenewals(): Promise<RenewalRow[]> {
  try {
    const text = await readFile(path.join(DIR, "renewals.csv"), "utf-8");
    return text.trim().split("\n").slice(1).filter(l => l.trim()).map(line => {
      const match = line.match(/^(\d+),(\d+),([^,]+),(\d+),(\d+),(\d+),(\d+),(\d+),(.*)$/);
      if (!match) return null;
      return {
        ct_block: parseInt(match[1]), timestamp: parseInt(match[2]), who: match[3],
        old_core: parseInt(match[4]), core: parseInt(match[5]), begin: parseInt(match[6]),
        price: match[7], duration: parseInt(match[8]), workload: match[9],
      };
    }).filter(Boolean) as RenewalRow[];
  } catch { return []; }
}

async function loadOndemand(): Promise<OnDemandRow[]> {
  try {
    const text = await readFile(path.join(DIR, "ondemand.csv"), "utf-8");
    return text.trim().split("\n").slice(1).filter(l => l.trim()).map(line => {
      const [bn, ts, pid, fee] = line.split(",");
      return { block_number: parseInt(bn), timestamp: parseInt(ts), para_id: parseInt(pid), fee_paid: fee };
    });
  } catch { return []; }
}

// ---------------------------------------------------------------------------
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Format a date tick label appropriate for the given time range in ms */
function fmtDateTick(ms: number, rangeMs: number): string {
  const d = new Date(ms);
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const yr = d.getUTCFullYear();
  const rangeDays = rangeMs / 86_400_000;
  if (rangeDays <= 180) return `${mon} ${day}`;
  return `${mon} ${yr}`;
}

// ---------------------------------------------------------------------------
// Plot 1: Sale price history + purchase/renewal prices per sale
// ---------------------------------------------------------------------------

function buildSalePriceChart(
  sales: SaleRow[],
  purchases: PurchaseRow[],
  renewals: RenewalRow[],
  cc: CostConfig
): string {
  const W = 750, H = 460;
  const ml = 56, mr = 20, mt = 44, mb = 56;
  const pw = W - ml - mr;
  const gap = 14; // gap between panels

  // Top panel (overview): 25% of available height — shows full range + outliers
  // Bottom panel (detail): 75% — zoomed to base price region showing bump structure
  const totalH = H - mt - mb - gap;
  const topH = Math.round(totalH * 0.25);
  const botH = totalH - topH;
  const topY0 = mt;                   // top of top panel
  const botY0 = mt + topH + gap;      // top of bottom panel

  // Compute prices in DOT
  const purchasePrices = purchases.map(p => Number(p.price) / DOT);
  const renewalPrices = renewals.map(r => Number(r.price) / DOT);
  const salePrices = sales.map(s => Number(s.end_price) / DOT);

  const allPrices = [...salePrices, ...purchasePrices, ...renewalPrices].filter(p => p > 0 && isFinite(p));
  if (allPrices.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="12" fill="#888">No price data</text></svg>`;
  }

  // Top panel Y range: full range
  const topYMin = 0;
  const topYMax = Math.ceil(Math.max(...allPrices) / 20) * 20 * 1.05;

  // Bottom panel Y range: zoomed around base price
  const basePrice = salePrices.length > 0 ? salePrices[0] : Math.min(...allPrices);
  const BUMP = 0.03;
  const botYMin = Math.max(0, basePrice * 0.92);
  const botYMax = basePrice * Math.pow(1 + BUMP, 9); // show up to ~9 bump generations

  // X-axis: timestamps (shared between panels)
  const allTimestamps: number[] = [];
  for (const sl of sales) if (sl.timestamp > 0) allTimestamps.push(sl.timestamp * 1000);
  for (const p of purchases) if (p.timestamp > 0) allTimestamps.push(p.timestamp * 1000);
  for (const r of renewals) if (r.timestamp > 0) allTimestamps.push(r.timestamp * 1000);

  const xMinMs = allTimestamps.length > 0 ? Math.min(...allTimestamps) : 0;
  const xMaxMs = allTimestamps.length > 0 ? Math.max(...allTimestamps) : 1;

  const xOf = (ms: number) => ml + ((ms - xMinMs) / (xMaxMs - xMinMs || 1)) * pw;
  const topYOf = (v: number) => topY0 + topH - ((v - topYMin) / (topYMax - topYMin || 1)) * topH;
  const botYOf = (v: number) => botY0 + botH - ((v - botYMin) / (botYMax - botYMin || 1)) * botH;

  // ---- Per-cycle stats ----
  interface CycleStats { offered: number; purchased: number; renewed: number; }
  const cycleStats = new Map<number, CycleStats>();
  for (const sl of sales) {
    cycleStats.set(sl.region_begin, { offered: sl.cores_offered, purchased: 0, renewed: 0 });
  }
  for (const p of purchases) {
    const cs = cycleStats.get(p.region_begin);
    if (cs) cs.purchased++;
  }
  for (const r of renewals) {
    const cs = cycleStats.get(r.begin);
    if (cs) cs.renewed++;
  }

  // Seeded jitter for overlapping scatter points
  const jitter = (xMaxMs - xMinMs) * 0.004;
  const seededRand = (seed: number) => {
    let x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">\n`;
  s += `<rect width="${W}" height="${H}" fill="#fff"/>\n`;
  s += `<text x="${ml}" y="${mt - 26}" font-size="11" font-weight="600" fill="#222">Coretime Market: Prices &amp; Utilization per Sale Cycle</text>\n`;
  s += `<text x="${ml}" y="${mt - 14}" font-size="7" fill="#888">${sales.length} sales  \u00b7  ${purchases.length} purchases  \u00b7  ${renewals.length} renewals  \u00b7  DOT/USD $${cc.dot_usd.toFixed(2)}</text>\n`;

  // Clip paths for each panel
  s += `<defs>\n`;
  s += `  <clipPath id="cpTop"><rect x="${ml}" y="${topY0}" width="${pw}" height="${topH}"/></clipPath>\n`;
  s += `  <clipPath id="cpBot"><rect x="${ml}" y="${botY0}" width="${pw}" height="${botH}"/></clipPath>\n`;
  s += `</defs>\n`;

  // ===========================================================================
  // TOP PANEL — full range overview
  // ===========================================================================

  // Sale cycle bands
  const bandColors = ["#f0f4ff", "#fff6f0"];
  for (let i = 0; i < sales.length; i++) {
    const x1 = xOf(sales[i].timestamp * 1000);
    const x2 = i + 1 < sales.length ? xOf(sales[i + 1].timestamp * 1000) : ml + pw;
    s += `<rect clip-path="url(#cpTop)" x="${x1.toFixed(1)}" y="${topY0}" width="${(x2 - x1).toFixed(1)}" height="${topH}" fill="${bandColors[i % 2]}"/>\n`;
  }

  // Grid (just a few ticks)
  const topTicks = niceTicks(topYMin, topYMax, 3);
  for (const v of topTicks) {
    const y = topYOf(v);
    s += `<line x1="${ml}" y1="${y.toFixed(1)}" x2="${ml + pw}" y2="${y.toFixed(1)}" stroke="#e0e0e0" stroke-width="0.5"/>\n`;
    s += `<text x="${ml - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="6" fill="#999">${v.toFixed(0)}</text>\n`;
  }

  // Top panel axes
  s += `<line x1="${ml}" y1="${topY0}" x2="${ml}" y2="${topY0 + topH}" stroke="#333" stroke-width="0.7"/>\n`;
  s += `<line x1="${ml}" y1="${topY0 + topH}" x2="${ml + pw}" y2="${topY0 + topH}" stroke="#333" stroke-width="0.7"/>\n`;

  // Top panel label
  s += `<text x="${ml + pw - 2}" y="${topY0 + 10}" text-anchor="end" font-size="6.5" font-style="italic" fill="#999">full range</text>\n`;

  // Scatter: purchases in top panel
  for (let i = 0; i < purchases.length; i++) {
    const p = purchases[i];
    const jx = xOf(p.timestamp * 1000 + (seededRand(i * 7 + 1) - 0.5) * jitter);
    const y = topYOf(purchasePrices[i]);
    s += `<circle clip-path="url(#cpTop)" cx="${jx.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#2a9d8f" opacity="0.5"/>\n`;
  }

  // Scatter: renewals in top panel
  for (let i = 0; i < renewals.length; i++) {
    const r = renewals[i];
    const jx = xOf(r.timestamp * 1000 + (seededRand(i * 13 + 3) - 0.5) * jitter);
    const y = topYOf(renewalPrices[i]);
    s += `<circle clip-path="url(#cpTop)" cx="${jx.toFixed(1)}" cy="${y.toFixed(1)}" r="1.5" fill="#e76f51" opacity="0.45"/>\n`;
  }

  // Highlight the zoom region in top panel
  const zoomTopY = topYOf(botYMax);
  const zoomBotY = topYOf(botYMin);
  s += `<rect clip-path="url(#cpTop)" x="${ml}" y="${zoomTopY.toFixed(1)}" width="${pw}" height="${(zoomBotY - zoomTopY).toFixed(1)}" fill="#4361ee" opacity="0.06" stroke="#4361ee" stroke-width="0.5" stroke-dasharray="3,2"/>\n`;

  // ===========================================================================
  // BOTTOM PANEL — zoomed detail around base price
  // ===========================================================================

  // Sale cycle bands + annotations
  for (let i = 0; i < sales.length; i++) {
    const x1 = xOf(sales[i].timestamp * 1000);
    const x2 = i + 1 < sales.length ? xOf(sales[i + 1].timestamp * 1000) : ml + pw;
    s += `<rect clip-path="url(#cpBot)" x="${x1.toFixed(1)}" y="${botY0}" width="${(x2 - x1).toFixed(1)}" height="${botH}" fill="${bandColors[i % 2]}"/>\n`;

    // Cycle annotation at top of bottom panel
    const cs = cycleStats.get(sales[i].region_begin);
    if (cs) {
      const total = cs.purchased + cs.renewed;
      const pct = cs.offered > 0 ? Math.round((total / cs.offered) * 100) : 0;
      const midX = (x1 + x2) / 2;
      s += `<text x="${midX.toFixed(1)}" y="${botY0 + 11}" text-anchor="middle" font-size="7" font-weight="600" fill="#555">${total}/${cs.offered} cores (${pct}%)</text>\n`;
      s += `<text x="${midX.toFixed(1)}" y="${botY0 + 21}" text-anchor="middle" font-size="6" fill="#888">${cs.purchased} new \u00b7 ${cs.renewed} renew</text>\n`;
    }
  }

  // Bottom panel grid
  const botTicks = niceTicks(botYMin, botYMax, 6);
  for (const v of botTicks) {
    const y = botYOf(v);
    s += `<line x1="${ml}" y1="${y.toFixed(1)}" x2="${ml + pw}" y2="${y.toFixed(1)}" stroke="#e0e0e0" stroke-width="0.5"/>\n`;
    s += `<text x="${ml - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="6.5" fill="#666">${v.toFixed(1)}</text>\n`;
  }

  // Bottom panel axes
  s += `<line x1="${ml}" y1="${botY0}" x2="${ml}" y2="${botY0 + botH}" stroke="#333" stroke-width="0.7"/>\n`;
  s += `<line x1="${ml}" y1="${botY0 + botH}" x2="${ml + pw}" y2="${botY0 + botH}" stroke="#333" stroke-width="0.7"/>\n`;

  // Y label (shared)
  s += `<text x="14" y="${(topY0 + topH + botY0 + botH) / 2}" text-anchor="middle" font-size="8" fill="#444" transform="rotate(-90,14,${(topY0 + topH + botY0 + botH) / 2})">Price (DOT)</text>\n`;

  // Bottom panel label
  s += `<text x="${ml + pw - 2}" y="${botY0 + 11}" text-anchor="end" font-size="6.5" font-style="italic" fill="#999">zoomed</text>\n`;

  // ---- Base price line ----
  if (basePrice > 0) {
    const yBase = botYOf(basePrice);
    s += `<line clip-path="url(#cpBot)" x1="${ml}" y1="${yBase.toFixed(1)}" x2="${ml + pw}" y2="${yBase.toFixed(1)}" stroke="#4361ee" stroke-width="1.2" stroke-dasharray="6,3" opacity="0.5"/>\n`;
    s += `<text x="${ml + pw + 2}" y="${(yBase + 3).toFixed(1)}" font-size="6" fill="#4361ee">${basePrice.toFixed(0)} DOT</text>\n`;
  }

  // ---- Renewal bump reference lines ----
  if (basePrice > 0) {
    for (let gen = 1; gen <= 8; gen++) {
      const bumpPrice = basePrice * Math.pow(1 + BUMP, gen);
      if (bumpPrice > botYMax) break;
      const yBump = botYOf(bumpPrice);
      s += `<line clip-path="url(#cpBot)" x1="${ml}" y1="${yBump.toFixed(1)}" x2="${ml + pw}" y2="${yBump.toFixed(1)}" stroke="#e76f51" stroke-width="0.4" stroke-dasharray="2,4" opacity="0.35"/>\n`;
      // Label the first few bump levels
      if (gen <= 6) {
        const superscripts = ["\u2070", "\u00b9", "\u00b2", "\u00b3", "\u2074", "\u2075", "\u2076"];
        s += `<text clip-path="url(#cpBot)" x="${ml + 3}" y="${(yBump - 2).toFixed(1)}" font-size="5" fill="#c06040" opacity="0.6">\u00d71.03${superscripts[gen]}</text>\n`;
      }
    }
  }

  // ---- Purchase scatter (bottom panel, clipped) ----
  for (let i = 0; i < purchases.length; i++) {
    const p = purchases[i];
    const price = purchasePrices[i];
    if (price < botYMin || price > botYMax) continue; // outliers shown only in top panel
    const jx = xOf(p.timestamp * 1000 + (seededRand(i * 7 + 1) - 0.5) * jitter);
    const y = botYOf(price);
    s += `<circle clip-path="url(#cpBot)" cx="${jx.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#2a9d8f" opacity="0.6"/>\n`;
  }

  // ---- Renewal scatter (bottom panel, clipped) ----
  for (let i = 0; i < renewals.length; i++) {
    const r = renewals[i];
    const price = renewalPrices[i];
    if (price < botYMin || price > botYMax) continue;
    const jx = xOf(r.timestamp * 1000 + (seededRand(i * 13 + 3) - 0.5) * jitter);
    const y = botYOf(price);
    s += `<circle clip-path="url(#cpBot)" cx="${jx.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#e76f51" opacity="0.55"/>\n`;
  }

  // Count outliers above zoomed range
  const purchaseOutliers = purchasePrices.filter(p => p > botYMax).length;
  const renewalOutliers = renewalPrices.filter(p => p > botYMax).length;
  if (purchaseOutliers + renewalOutliers > 0) {
    const parts: string[] = [];
    if (purchaseOutliers > 0) parts.push(`${purchaseOutliers} purchase${purchaseOutliers > 1 ? "s" : ""}`);
    if (renewalOutliers > 0) parts.push(`${renewalOutliers} renewal${renewalOutliers > 1 ? "s" : ""}`);
    s += `<text x="${ml + pw / 2}" y="${botY0 - 3}" text-anchor="middle" font-size="6" fill="#888">\u2191 ${parts.join(" + ")} above ${botYMax.toFixed(0)} DOT (see top panel)</text>\n`;
  }

  // ---- Shared X axis labels ----
  const xRangeSP = xMaxMs - xMinMs;
  const approxTicksSP = 7;
  const xStepSP = xRangeSP / approxTicksSP;
  for (let i = 0; i <= approxTicksSP; i++) {
    const ms = xMinMs + i * xStepSP;
    if (ms > xMaxMs) break;
    const x = xOf(ms);
    s += `<line x1="${x.toFixed(1)}" y1="${botY0 + botH}" x2="${x.toFixed(1)}" y2="${botY0 + botH + 3}" stroke="#333" stroke-width="0.5"/>\n`;
    s += `<text x="${x.toFixed(1)}" y="${botY0 + botH + 14}" text-anchor="middle" font-size="6.5" fill="#666">${esc(fmtDateTick(ms, xRangeSP))}</text>\n`;
  }
  s += `<text x="${ml + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="8" fill="#444">Date</text>\n`;

  // ---- Legend (bottom-right of bottom panel) ----
  const lx = ml + pw - 210, ly = botY0 + botH - 58;
  s += `<rect x="${lx - 4}" y="${ly - 6}" width="214" height="56" rx="2" fill="white" fill-opacity="0.92" stroke="#ddd" stroke-width="0.5"/>\n`;

  s += `<line x1="${lx}" y1="${ly}" x2="${lx + 14}" y2="${ly}" stroke="#4361ee" stroke-width="1.2" stroke-dasharray="6,3" opacity="0.5"/>\n`;
  s += `<text x="${lx + 18}" y="${ly + 3}" font-size="6.5" fill="#444">Sale end price / base (${basePrice.toFixed(0)} DOT)</text>\n`;

  s += `<circle cx="${lx + 7}" cy="${ly + 14}" r="3.5" fill="#2a9d8f" opacity="0.6"/>\n`;
  s += `<text x="${lx + 18}" y="${ly + 17}" font-size="6.5" fill="#444">Purchase price</text>\n`;

  s += `<circle cx="${lx + 7}" cy="${ly + 28}" r="3" fill="#e76f51" opacity="0.55"/>\n`;
  s += `<text x="${lx + 18}" y="${ly + 31}" font-size="6.5" fill="#444">Renewal price (3% bump per cycle)</text>\n`;

  s += `<line x1="${lx}" y1="${ly + 42}" x2="${lx + 14}" y2="${ly + 42}" stroke="#e76f51" stroke-width="0.4" stroke-dasharray="2,4" opacity="0.4"/>\n`;
  s += `<text x="${lx + 18}" y="${ly + 45}" font-size="6.5" fill="#444">Renewal bump levels (1.03\u207f \u00d7 base)</text>\n`;

  s += `</svg>\n`;
  return s;
}

// ---------------------------------------------------------------------------
// Plot 3: On-demand fee timeline
// ---------------------------------------------------------------------------

function buildOndemandChart(rows: OnDemandRow[], cc: CostConfig): string {
  const W = 700, H = 280;
  const ml = 64, mr = 20, mt = 28, mb = 52;
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  const fees = rows.map((r) => Number(r.fee_paid) / DOT);
  const ts = rows.map((r) => r.timestamp);
  const tsMin = Math.min(...ts), tsMax = Math.max(...ts);
  const feeMax = Math.max(...fees) * 1.1;

  const xOf = (v: number) => ml + ((v - tsMin) / (tsMax - tsMin || 1)) * pw;
  const yOf = (v: number) => mt + ph - (v / (feeMax || 1)) * ph;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">\n`;
  s += `<rect width="${W}" height="${H}" fill="#fff"/>\n`;
  s += `<text x="${ml}" y="${mt - 14}" font-size="10" font-weight="600" fill="#222">On-Demand Coretime Fees</text>\n`;
  s += `<text x="${ml}" y="${mt - 4}" font-size="7" fill="#888">${rows.length} orders  \u00b7  DOT/USD $${cc.dot_usd.toFixed(2)}</text>\n`;

  // Clip
  s += `<defs><clipPath id="clip"><rect x="${ml}" y="${mt}" width="${pw}" height="${ph}"/></clipPath></defs>\n`;

  // Grid
  const yTicks = niceTicks(0, feeMax, 5);
  for (const v of yTicks) {
    const y = yOf(v);
    s += `<line x1="${ml}" y1="${y.toFixed(1)}" x2="${ml + pw}" y2="${y.toFixed(1)}" stroke="#eee" stroke-width="0.5"/>\n`;
  }

  // Data points
  for (let i = 0; i < rows.length; i++) {
    const x = xOf(ts[i]);
    const y = yOf(fees[i]);
    s += `<circle clip-path="url(#clip)" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#e63946" opacity="0.6"/>\n`;
  }

  // Median line
  const sortedFees = [...fees].sort((a, b) => a - b);
  const median = sortedFees[Math.floor(sortedFees.length / 2)];
  const medY = yOf(median);
  s += `<line clip-path="url(#clip)" x1="${ml}" y1="${medY.toFixed(1)}" x2="${ml + pw}" y2="${medY.toFixed(1)}" stroke="#4361ee" stroke-width="1" stroke-dasharray="6,3"/>\n`;

  // Axes
  s += `<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="#333" stroke-width="0.7"/>\n`;
  s += `<line x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}" stroke="#333" stroke-width="0.7"/>\n`;

  // Y ticks
  for (const v of yTicks) {
    const y = yOf(v);
    s += `<line x1="${ml - 3}" y1="${y.toFixed(1)}" x2="${ml}" y2="${y.toFixed(1)}" stroke="#333" stroke-width="0.5"/>\n`;
    s += `<text x="${ml - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="6.5" fill="#666">${v.toFixed(4)}</text>\n`;
  }
  s += `<text x="12" y="${mt + ph / 2}" text-anchor="middle" font-size="8" fill="#444" transform="rotate(-90,12,${mt + ph / 2})">Fee (DOT)</text>\n`;

  // X ticks
  const xCount = Math.min(8, rows.length);
  const xStep = Math.max(1, Math.floor(rows.length / xCount));
  for (let i = 0; i < rows.length; i += xStep) {
    const x = xOf(ts[i]);
    s += `<line x1="${x.toFixed(1)}" y1="${mt + ph}" x2="${x.toFixed(1)}" y2="${mt + ph + 3}" stroke="#333" stroke-width="0.5"/>\n`;
    const d = new Date(ts[i]);
    const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const day = d.getUTCDate().toString().padStart(2, "0");
    const hh = d.getUTCHours().toString().padStart(2, "0");
    const mm = d.getUTCMinutes().toString().padStart(2, "0");
    s += `<text x="${x.toFixed(1)}" y="${mt + ph + 13}" text-anchor="middle" font-size="6.5" fill="#666">${esc(`${mon} ${day}`)}</text>\n`;
    s += `<text x="${x.toFixed(1)}" y="${mt + ph + 21}" text-anchor="middle" font-size="6.5" fill="#666">${esc(`${hh}:${mm}`)}</text>\n`;
  }
  s += `<text x="${ml + pw / 2}" y="${H - 4}" text-anchor="middle" font-size="8" fill="#444">Time (UTC)</text>\n`;

  // Legend
  const lx = ml + pw - 160, ly = mt + 8;
  s += `<rect x="${lx - 4}" y="${ly - 5}" width="164" height="26" rx="2" fill="white" fill-opacity="0.85"/>\n`;
  s += `<circle cx="${lx + 4}" cy="${ly}" r="2" fill="#e63946" opacity="0.6"/>\n`;
  s += `<text x="${lx + 10}" y="${ly + 3}" font-size="6.5" fill="#444">Order fee (DOT)</text>\n`;
  s += `<line x1="${lx}" y1="${ly + 12}" x2="${lx + 14}" y2="${ly + 12}" stroke="#4361ee" stroke-width="1" stroke-dasharray="6,3"/>\n`;
  s += `<text x="${lx + 18}" y="${ly + 15}" font-size="6.5" fill="#444">Median (${median.toFixed(4)} DOT)</text>\n`;

  s += `</svg>\n`;
  return s;
}

// ---------------------------------------------------------------------------
// DOT prices loader + cost timeseries derivation
// ---------------------------------------------------------------------------

const MAX_POV_CHANGE_TIMESLICE = 316778; // relay timeslice where max_pov changed 5→10 MiB
const BLOCKS_PER_DAY = 86400 / 6; // 14400 blocks/day at 6s cadence
const REGION_DURATION_DAYS = 30; // ~30 days per region

async function loadDotPrices(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  try {
    const text = await readFile(path.join(DIR, "dot_prices.csv"), "utf-8");
    for (const line of text.trim().split("\n").slice(1)) {
      const [date, priceStr] = line.split(",");
      if (date && priceStr) prices.set(date, parseFloat(priceStr));
    }
  } catch { /* no prices file */ }
  return prices;
}

function lookupDotPrice(prices: Map<string, number>, unixSeconds: number, fallback: number): number {
  const d = new Date(unixSeconds * 1000);
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const exact = prices.get(key);
  if (exact !== undefined) return exact;

  let closestDist = Infinity;
  let closestPrice = fallback;
  for (const [k, v] of prices) {
    const kDate = new Date(k + "T00:00:00Z").getTime() / 1000;
    const dist = Math.abs(kDate - unixSeconds);
    if (dist < closestDist) {
      closestDist = dist;
      closestPrice = v;
    }
  }
  return closestPrice;
}

function deriveCostTimeseries(
  purchases: PurchaseRow[],
  renewals: RenewalRow[],
  dotPrices: Map<string, number>,
  fallbackDotUsd: number
): CostTimeseriesRow[] {
  const rows: CostTimeseriesRow[] = [];

  for (const p of purchases) {
    const dotUsd = lookupDotPrice(dotPrices, p.timestamp, fallbackDotUsd);
    const priceDot = Number(p.price) / DOT;
    const maxPovMib = p.region_begin < MAX_POV_CHANGE_TIMESLICE ? 5 : 10;
    const coreCostUsd = priceDot * dotUsd;
    const costPerMibPerDay = coreCostUsd / REGION_DURATION_DAYS / (maxPovMib * BLOCKS_PER_DAY);
    const d = new Date(p.timestamp * 1000);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    rows.push({ date, type: "purchase", price_dot: priceDot, dot_usd: dotUsd, core_cost_usd: coreCostUsd, max_pov_mib: maxPovMib, cost_per_mib_per_day_usd: costPerMibPerDay });
  }

  for (const r of renewals) {
    const dotUsd = lookupDotPrice(dotPrices, r.timestamp, fallbackDotUsd);
    const priceDot = Number(r.price) / DOT;
    const maxPovMib = r.begin < MAX_POV_CHANGE_TIMESLICE ? 5 : 10;
    const coreCostUsd = priceDot * dotUsd;
    const costPerMibPerDay = coreCostUsd / REGION_DURATION_DAYS / (maxPovMib * BLOCKS_PER_DAY);
    const d = new Date(r.timestamp * 1000);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    rows.push({ date, type: "renewal", price_dot: priceDot, dot_usd: dotUsd, core_cost_usd: coreCostUsd, max_pov_mib: maxPovMib, cost_per_mib_per_day_usd: costPerMibPerDay });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

// ---------------------------------------------------------------------------
// Plot 4: Cost timeseries — logarithmic Y-axis
// ---------------------------------------------------------------------------

function buildCostTimeseriesChart(rows: CostTimeseriesRow[]): string {
  const W = 750, H = 380;
  const ml = 80, mr = 20, mt = 44, mb = 60;
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  const purchaseRows = rows.filter(r => r.type === "purchase");
  const renewalRows = rows.filter(r => r.type === "renewal");

  // Parse dates to ms for X axis
  const dateToMs = (d: string) => new Date(d + "T00:00:00Z").getTime();
  const allDates = rows.map(r => dateToMs(r.date));
  const xMin = Math.min(...allDates);
  const xMax = Math.max(...allDates);

  // Y axis: log scale for cost_per_mib_per_day_usd
  const allCosts = rows.map(r => r.cost_per_mib_per_day_usd).filter(v => v > 0 && isFinite(v));
  const logMin = Math.floor(Math.log10(Math.min(...allCosts)));
  const logMax = Math.ceil(Math.log10(Math.max(...allCosts)));

  const xOf = (ms: number) => ml + ((ms - xMin) / (xMax - xMin || 1)) * pw;
  const yOf = (v: number) => {
    if (v <= 0) return mt + ph;
    const logV = Math.log10(v);
    return mt + ph - ((logV - logMin) / (logMax - logMin || 1)) * ph;
  };

  // Find max_pov change date
  const fiveMibRows = rows.filter(r => r.max_pov_mib === 5);
  const tenMibRows = rows.filter(r => r.max_pov_mib === 10);
  let changeLineMs: number | null = null;
  if (fiveMibRows.length > 0 && tenMibRows.length > 0) {
    const lastFive = dateToMs(fiveMibRows[fiveMibRows.length - 1].date);
    const firstTen = dateToMs(tenMibRows[0].date);
    changeLineMs = (lastFive + firstTen) / 2;
  }

  // Medians
  const medianOf = (vals: number[]): number => {
    if (vals.length === 0) return 0;
    const sorted = [...vals].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const purchaseMedian = medianOf(purchaseRows.map(r => r.cost_per_mib_per_day_usd));
  const renewalMedian = medianOf(renewalRows.map(r => r.cost_per_mib_per_day_usd));

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">\n`;
  s += `<rect width="${W}" height="${H}" fill="#fff"/>\n`;
  s += `<text x="${ml}" y="${mt - 26}" font-size="11" font-weight="600" fill="#222">Polkadot DA: Historical Cost per MiB per Day (USD, log scale)</text>\n`;
  s += `<text x="${ml}" y="${mt - 14}" font-size="7" fill="#888">${purchaseRows.length} purchases  \u00b7  ${renewalRows.length} renewals  \u00b7  using DOT/USD at time of each event</text>\n`;

  // Clip path
  s += `<defs><clipPath id="ctcp"><rect x="${ml}" y="${mt}" width="${pw}" height="${ph}"/></clipPath></defs>\n`;

  // Log-scale grid lines: major (10^n) + minor (2×10^n, 5×10^n)
  for (let exp = logMin; exp <= logMax; exp++) {
    const major = Math.pow(10, exp);
    const yMajor = yOf(major);
    s += `<line x1="${ml}" y1="${yMajor.toFixed(1)}" x2="${ml + pw}" y2="${yMajor.toFixed(1)}" stroke="#ddd" stroke-width="0.7"/>\n`;
    s += `<text x="${ml - 5}" y="${(yMajor + 3).toFixed(1)}" text-anchor="end" font-size="6.5" fill="#444">$${major.toExponential(0)}</text>\n`;

    // Minor ticks at 2× and 5×
    for (const m of [2, 5]) {
      const minor = m * major;
      if (Math.log10(minor) > logMax) break;
      const yMinor = yOf(minor);
      s += `<line x1="${ml}" y1="${yMinor.toFixed(1)}" x2="${ml + pw}" y2="${yMinor.toFixed(1)}" stroke="#f0f0f0" stroke-width="0.4"/>\n`;
    }
  }

  // Axes
  s += `<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="#333" stroke-width="0.7"/>\n`;
  s += `<line x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}" stroke="#333" stroke-width="0.7"/>\n`;
  s += `<text x="16" y="${mt + ph / 2}" text-anchor="middle" font-size="8" fill="#444" transform="rotate(-90,16,${mt + ph / 2})">USD / MiB / day (log)</text>\n`;

  // Vertical line at max_pov change
  if (changeLineMs !== null && changeLineMs >= xMin && changeLineMs <= xMax) {
    const cx = xOf(changeLineMs);
    s += `<line clip-path="url(#ctcp)" x1="${cx.toFixed(1)}" y1="${mt}" x2="${cx.toFixed(1)}" y2="${mt + ph}" stroke="#999" stroke-width="1" stroke-dasharray="4,3"/>\n`;
    s += `<text x="${(cx + 4).toFixed(1)}" y="${mt + 10}" font-size="6.5" fill="#666">max_pov 5\u219210 MiB</text>\n`;
  }

  // Purchase dots (teal)
  for (const r of purchaseRows) {
    if (r.cost_per_mib_per_day_usd <= 0) continue;
    const x = xOf(dateToMs(r.date));
    const y = yOf(r.cost_per_mib_per_day_usd);
    s += `<circle clip-path="url(#ctcp)" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#2a9d8f" opacity="0.7"/>\n`;
  }

  // Renewal dots (orange)
  for (const r of renewalRows) {
    if (r.cost_per_mib_per_day_usd <= 0) continue;
    const x = xOf(dateToMs(r.date));
    const y = yOf(r.cost_per_mib_per_day_usd);
    s += `<circle clip-path="url(#ctcp)" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#e76f51" opacity="0.7"/>\n`;
  }

  // Median lines
  if (purchaseMedian > 0) {
    const my = yOf(purchaseMedian);
    s += `<line clip-path="url(#ctcp)" x1="${ml}" y1="${my.toFixed(1)}" x2="${ml + pw}" y2="${my.toFixed(1)}" stroke="#2a9d8f" stroke-width="1" stroke-dasharray="6,3" opacity="0.6"/>\n`;
  }
  if (renewalMedian > 0) {
    const my = yOf(renewalMedian);
    s += `<line clip-path="url(#ctcp)" x1="${ml}" y1="${my.toFixed(1)}" x2="${ml + pw}" y2="${my.toFixed(1)}" stroke="#e76f51" stroke-width="1" stroke-dasharray="6,3" opacity="0.6"/>\n`;
  }

  // X axis labels (dates)
  const xRangeCT = xMax - xMin;
  const approxTicksCT = 8;
  const xStepCT = xRangeCT / approxTicksCT;
  for (let i = 0; i <= approxTicksCT; i++) {
    const ms = xMin + i * xStepCT;
    if (ms > xMax) break;
    const x = xOf(ms);
    s += `<line x1="${x.toFixed(1)}" y1="${mt + ph}" x2="${x.toFixed(1)}" y2="${mt + ph + 3}" stroke="#333" stroke-width="0.5"/>\n`;
    s += `<text x="${x.toFixed(1)}" y="${mt + ph + 14}" text-anchor="middle" font-size="6.5" fill="#666">${esc(fmtDateTick(ms, xRangeCT))}</text>\n`;
  }
  s += `<text x="${ml + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="8" fill="#444">Date</text>\n`;

  // Legend
  const fmtMedian = (v: number) => v < 0.0001 ? v.toExponential(2) : v.toFixed(6);
  const hasMaxPovLine = changeLineMs !== null && changeLineMs >= xMin && changeLineMs <= xMax;
  const legendItems: string[][] = [];
  legendItems.push([
    `<circle cx="LX5" cy="LYR" r="3" fill="#2a9d8f" opacity="0.7"/>`,
    `<text x="LX12" y="LYR3" font-size="6.5" fill="#444">Purchase (median $${fmtMedian(purchaseMedian)}/MiB/day)</text>`,
  ]);
  legendItems.push([
    `<circle cx="LX5" cy="LYR" r="3" fill="#e76f51" opacity="0.7"/>`,
    `<text x="LX12" y="LYR3" font-size="6.5" fill="#444">Renewal (median $${fmtMedian(renewalMedian)}/MiB/day)</text>`,
  ]);
  if (hasMaxPovLine) {
    legendItems.push([
      `<line x1="LX" y1="LYR" x2="LX14" y2="LYR" stroke="#999" stroke-width="1" stroke-dasharray="4,3"/>`,
      `<text x="LX18" y="LYR3" font-size="6.5" fill="#444">max_pov upgrade (5\u219210 MiB)</text>`,
    ]);
  }
  legendItems.push([
    `<line x1="LX" y1="LYR" x2="LX14" y2="LYR" stroke="#2a9d8f" stroke-width="1" stroke-dasharray="6,3" opacity="0.6"/>`,
    `<text x="LX18" y="LYR3" font-size="6.5" fill="#444">Median lines</text>`,
  ]);

  const legendH = legendItems.length * 13 + 6;
  const lx = ml + pw - 210, ly = mt + 6;
  s += `<rect x="${lx - 4}" y="${ly - 5}" width="214" height="${legendH}" rx="2" fill="white" fill-opacity="0.9" stroke="#eee" stroke-width="0.5"/>\n`;

  for (let li = 0; li < legendItems.length; li++) {
    const rowY = ly + 2 + li * 13;
    for (const part of legendItems[li]) {
      s += part
        .replace(/LX18/g, String(lx + 18))
        .replace(/LX14/g, String(lx + 14))
        .replace(/LX12/g, String(lx + 12))
        .replace(/LX5/g, String(lx + 5))
        .replace(/LX/g, String(lx))
        .replace(/LYR3/g, String(rowY + 3))
        .replace(/LYR/g, String(rowY))
      + "\n";
    }
  }

  s += `</svg>\n`;
  return s;
}

// ---------------------------------------------------------------------------
function niceTicks(min: number, max: number, count: number): number[] {
  const range = max - min || 1;
  const rough = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const nice = [1, 2, 5, 10].map((m) => m * mag);
  const step = nice.find((n) => n >= rough) ?? rough;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.01; v += step) ticks.push(v);
  return ticks;
}

// ---------------------------------------------------------------------------
main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
