#!/usr/bin/env npx tsx
/**
 * Polkadot DA Throughput — SVG plotter
 *
 * Reads analysis/throughput.csv + analysis/chain_config.json
 * (produced by polkadot_throughput.ts) and writes multiple SVG plots:
 *
 *   1. throughput.svg     — used throughput (MiB/s) vs protocol max
 *   2. availability.svg   — core utilization %, timeouts, disputes
 *   3. participation.svg  — validator bitfield submission & DA progress
 *
 * Usage:
 *   npx tsx plot_throughput.ts
 */

import { readFile, writeFile } from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CsvRow {
  block_number: number;
  timestamp: number;
  backed: number;
  included: number;
  timed_out: number;
  disputes: number;
  cores_active: number;
  distinct_paras: number;
  bitfields: number;
  avg_avail: number;
}

interface ChainConfig {
  maxPovBytes: number;
  numCores: number;
  validatorCount: number;
  backingGroupSize: number;
  effectiveCores: number;
  cadence: number;
  protocolMaxMibps: number;
  neededApprovals?: number;
  nDelayTranches?: number;
  noShowSlots?: number;
  zerothDelayTrancheWidth?: number;
}

interface Milestone {
  ref: number;
  label: string;
  block: number | null;
  timestamp: number | null;
}

interface ConfigFile {
  blockRange: { start: number; end: number };
  config: ChainConfig;
  milestones: Milestone[];
}

/** A single data series to plot. */
interface Series {
  values: number[];
  color: string;
  label: string;
  width?: number;
  opacity?: number;
  dash?: string;        // stroke-dasharray
  areaFill?: boolean;   // fill area under line
}

/** Horizontal reference line. */
interface HLine {
  value: number;
  color: string;
  label: string;
  dash?: string;
}

interface ChartOpts {
  rows: CsvRow[];
  cfgFile: ConfigFile;
  title: string;
  yLabel: string;
  yMin?: number;
  yMax?: number;
  yFormat?: (v: number) => string;
  series: Series[];
  hLines?: HLine[];
  rightYLabel?: string;
  rightSeries?: Series[];  // plotted against right Y-axis
  rightYMin?: number;
  rightYMax?: number;
  rightYFormat?: (v: number) => string;
}

// ---------------------------------------------------------------------------
const MiB = 1_048_576;
const DIR = path.join(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "analysis"
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const csvText = await readFile(path.join(DIR, "throughput.csv"), "utf-8");
  const rows = parseCsv(csvText);

  const cfgText = await readFile(path.join(DIR, "chain_config.json"), "utf-8");
  const cfgFile: ConfigFile = JSON.parse(cfgText);
  const cc = cfgFile.config;

  const scale = cc.maxPovBytes / cc.cadence / MiB;
  const throughputs = rows.map((r) => r.included * scale);
  const utilizations = rows.map((r) => (r.included / cc.effectiveCores) * 100);

  // --- Plot 1: Combined Throughput & Utilization ---
  const svg1 = buildChart({
    rows,
    cfgFile,
    title: "DA Throughput & Core Utilization",
    yLabel: "Throughput (MiB/s)",
    yMin: 0,
    series: [
      {
        values: throughputs,
        color: "#4361ee",
        label: "Used throughput (MiB/s)",
        width: 1.2,
        areaFill: true,
      },
    ],
    hLines: [
      {
        value: cc.protocolMaxMibps,
        color: "#2d6a4f",
        label: `Protocol max (${cc.protocolMaxMibps.toFixed(1)} MiB/s)`,
        dash: "6,3",
      },
    ],
    rightYLabel: "Core utilization (%)",
    rightSeries: [
      {
        values: utilizations,
        color: "#e63946",
        label: "Core utilization (%)",
        width: 1,
        opacity: 0.7,
      },
    ],
    rightYMin: 0,
    rightYMax: 105,
    rightYFormat: (v) => `${v}%`,
  });
  const out1 = path.join(DIR, "throughput.svg");
  await writeFile(out1, svg1);
  console.log(`SVG → ${out1}`);

  // --- Plot 3: Validator participation (zoomed to data range) ---
  const bitfieldVals = rows.map((r) => r.bitfields);
  const bfMin = Math.min(...bitfieldVals);
  const bfFloor = Math.max(0, Math.floor(bfMin * 0.98 / 10) * 10); // round down to nearest 10, with 2% padding
  const svg3 = buildChart({
    rows,
    cfgFile,
    title: "Validator DA Participation",
    yLabel: "Bitfields submitted",
    yMin: bfFloor,
    yMax: cc.validatorCount * 1.02,
    series: [
      {
        values: bitfieldVals,
        color: "#4361ee",
        label: `Bitfields (of ${cc.validatorCount})`,
        width: 1,
        areaFill: true,
      },
    ],
    hLines: [
      {
        value: cc.validatorCount,
        color: "#888",
        label: `Validator count (${cc.validatorCount})`,
        dash: "4,4",
      },
    ],
    rightYLabel: "Avg availability (%)",
    rightSeries: [
      {
        values: rows.map((r) => r.avg_avail * 100),
        color: "#2d6a4f",
        label: "Avg core availability",
        width: 1,
      },
    ],
    rightYMin: 95,
    rightYMax: 100.5,
    rightYFormat: (v) => `${v.toFixed(1)}%`,
  });
  const out3 = path.join(DIR, "participation.svg");
  await writeFile(out3, svg3);
  console.log(`SVG → ${out3}`);

  console.log(`\n${rows.length} rows plotted across 2 charts.`);
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------
function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split("\n").slice(1);
  return lines.map((line) => {
    const [bn, ts, bk, inc, to, disp, ca, dp, bf, aa] = line.split(",");
    return {
      block_number: parseInt(bn),
      timestamp: parseInt(ts),
      backed: parseInt(bk),
      included: parseInt(inc),
      timed_out: parseInt(to),
      disputes: parseInt(disp),
      cores_active: parseInt(ca),
      distinct_paras: parseInt(dp) || 0,
      bitfields: parseInt(bf) || 0,
      avg_avail: parseFloat(aa) || 0,
    };
  });
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

function fmtTime(ms: number): [string, string] {
  const d = new Date(ms);
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return [`${mon} ${day}`, `${hh}:${mm}`];
}

// ---------------------------------------------------------------------------
// Generic chart builder
// ---------------------------------------------------------------------------
function buildChart(opts: ChartOpts): string {
  const { rows, cfgFile, series, hLines = [], rightSeries = [] } = opts;
  const cc = cfgFile.config;
  const { start: startBlock, end: endBlock } = cfgFile.blockRange;
  const hasRight = rightSeries.length > 0 && opts.rightYLabel;

  // Layout
  const W = 700, H = 280;
  const ml = 58, mr = hasRight ? 58 : 20, mt = 28, mb = 52;
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  // X range
  const ts = rows.map((r) => r.timestamp);
  const tsMin = Math.min(...ts), tsMax = Math.max(...ts);
  const xOf = (v: number) => ml + ((v - tsMin) / (tsMax - tsMin || 1)) * pw;

  // Left Y range
  const allLeftVals = series.flatMap((s) => s.values);
  const hLineVals = hLines.map((h) => h.value);
  const rawLeftMin = opts.yMin ?? Math.min(...allLeftVals);
  const rawLeftMax = opts.yMax ?? Math.max(...allLeftVals, ...hLineVals) * 1.08;
  const yMin = rawLeftMin;
  const yMax = rawLeftMax;
  const yOf = (v: number) => mt + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;
  const yFmt = opts.yFormat ?? ((v: number) => v % 1 === 0 ? String(v) : v.toFixed(1));

  // Right Y range
  let rYMin = 0, rYMax = 1, rYOf = (_v: number) => mt + ph;
  let rYFmt = (v: number) => v % 1 === 0 ? String(v) : v.toFixed(1);
  if (hasRight) {
    const allRightVals = rightSeries.flatMap((s) => s.values);
    rYMin = opts.rightYMin ?? Math.min(...allRightVals);
    rYMax = opts.rightYMax ?? Math.max(...allRightVals) * 1.08;
    rYOf = (v: number) => mt + ph - ((v - rYMin) / (rYMax - rYMin || 1)) * ph;
    if (opts.rightYFormat) rYFmt = opts.rightYFormat;
  }

  // Subtitle
  const subtitle = `${rows.length} blocks (${startBlock}\u2026${endBlock})  \u00b7  cadence ${cc.cadence}s  \u00b7  effective_cores ${cc.effectiveCores}`;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">\n`;
  s += `<rect width="${W}" height="${H}" fill="#fff"/>\n`;

  // Title + subtitle
  s += `<text x="${ml}" y="${mt - 14}" font-size="10" font-weight="600" fill="#222">${esc(opts.title)}</text>\n`;
  s += `<text x="${ml}" y="${mt - 4}" font-size="7" fill="#888">${esc(subtitle)}</text>\n`;

  // Clip path
  s += `<defs><clipPath id="clip"><rect x="${ml}" y="${mt}" width="${pw}" height="${ph}"/></clipPath></defs>\n`;

  // Grid
  const yTicks = niceTicks(yMin, yMax, 5);
  for (const v of yTicks) {
    const y = yOf(v);
    s += `<line x1="${ml}" y1="${y.toFixed(1)}" x2="${ml + pw}" y2="${y.toFixed(1)}" stroke="#eee" stroke-width="0.5"/>\n`;
  }

  // Milestone vertical markers
  const COL_MS = "#9d4edd";
  for (const m of cfgFile.milestones) {
    if (m.timestamp == null || m.timestamp < tsMin || m.timestamp > tsMax) continue;
    const x = xOf(m.timestamp);
    s += `<line clip-path="url(#clip)" x1="${x.toFixed(1)}" y1="${mt}" x2="${x.toFixed(1)}" y2="${mt + ph}" stroke="${COL_MS}" stroke-width="0.7" stroke-dasharray="3,3" opacity="0.6"/>\n`;
    s += `<text x="${(x + 2).toFixed(1)}" y="${mt + 9}" font-size="5.5" fill="${COL_MS}" opacity="0.7">#${m.ref}</text>\n`;
  }

  // Horizontal reference lines
  for (const hl of hLines) {
    const y = yOf(hl.value);
    s += `<line clip-path="url(#clip)" x1="${ml}" y1="${y.toFixed(1)}" x2="${ml + pw}" y2="${y.toFixed(1)}" stroke="${hl.color}" stroke-width="1" stroke-dasharray="${hl.dash ?? "6,3"}"/>\n`;
  }

  // Left series
  for (const sr of series) {
    const pts = rows.map((r, i) =>
      `${xOf(r.timestamp).toFixed(1)},${yOf(sr.values[i]).toFixed(1)}`
    ).join(" ");

    if (sr.areaFill) {
      const baseY = yOf(yMin).toFixed(1);
      const areaP = `${xOf(rows[0].timestamp).toFixed(1)},${baseY} ${pts} ${xOf(rows[rows.length - 1].timestamp).toFixed(1)},${baseY}`;
      s += `<polygon clip-path="url(#clip)" fill="${sr.color}" opacity="0.1" points="${areaP}"/>\n`;
    }
    s += `<polyline clip-path="url(#clip)" fill="none" stroke="${sr.color}" stroke-width="${sr.width ?? 1}" opacity="${sr.opacity ?? 1}" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ""} points="${pts}"/>\n`;
  }

  // Right series
  for (const sr of rightSeries) {
    const pts = rows.map((r, i) =>
      `${xOf(r.timestamp).toFixed(1)},${rYOf(sr.values[i]).toFixed(1)}`
    ).join(" ");
    s += `<polyline clip-path="url(#clip)" fill="none" stroke="${sr.color}" stroke-width="${sr.width ?? 1}" opacity="${sr.opacity ?? 0.6}" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ""} points="${pts}"/>\n`;
  }

  // Axes frame
  s += `<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="#333" stroke-width="0.7"/>\n`;
  s += `<line x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}" stroke="#333" stroke-width="0.7"/>\n`;
  if (hasRight) {
    s += `<line x1="${ml + pw}" y1="${mt}" x2="${ml + pw}" y2="${mt + ph}" stroke="#333" stroke-width="0.7"/>\n`;
  }

  // X ticks
  const xCount = Math.min(8, rows.length);
  const xStep = Math.max(1, Math.floor(rows.length / xCount));
  const xTicks: number[] = [];
  for (let i = 0; i < rows.length; i += xStep) xTicks.push(rows[i].timestamp);
  // Don't push last tick if it would be too close to the previous one
  const lastTs = ts[ts.length - 1];
  if (xTicks.length > 0 && (lastTs - xTicks[xTicks.length - 1]) / (tsMax - tsMin || 1) > 0.06) {
    xTicks.push(lastTs);
  }

  for (const t of xTicks) {
    const x = xOf(t);
    s += `<line x1="${x.toFixed(1)}" y1="${mt + ph}" x2="${x.toFixed(1)}" y2="${mt + ph + 3}" stroke="#333" stroke-width="0.5"/>\n`;
    const [date, time] = fmtTime(t);
    s += `<text x="${x.toFixed(1)}" y="${mt + ph + 13}" text-anchor="middle" font-size="6.5" fill="#666">${esc(date)}</text>\n`;
    s += `<text x="${x.toFixed(1)}" y="${mt + ph + 21}" text-anchor="middle" font-size="6.5" fill="#666">${esc(time)}</text>\n`;
  }
  s += `<text x="${ml + pw / 2}" y="${H - 4}" text-anchor="middle" font-size="8" fill="#444">Time (UTC)</text>\n`;

  // Left Y ticks + label
  const leftColor = series[0]?.color ?? "#333";
  for (const v of yTicks) {
    const y = yOf(v);
    s += `<line x1="${ml - 3}" y1="${y.toFixed(1)}" x2="${ml}" y2="${y.toFixed(1)}" stroke="#333" stroke-width="0.5"/>\n`;
    s += `<text x="${ml - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="6.5" fill="${leftColor}">${esc(yFmt(v))}</text>\n`;
  }
  s += `<text x="12" y="${mt + ph / 2}" text-anchor="middle" font-size="8" fill="${leftColor}" transform="rotate(-90,12,${mt + ph / 2})">${esc(opts.yLabel)}</text>\n`;

  // Right Y ticks + label
  if (hasRight) {
    const rightColor = rightSeries[0]?.color ?? "#333";
    const rYTicks = niceTicks(rYMin, rYMax, 5);
    for (const v of rYTicks) {
      const y = rYOf(v);
      s += `<line x1="${ml + pw}" y1="${y.toFixed(1)}" x2="${ml + pw + 3}" y2="${y.toFixed(1)}" stroke="#333" stroke-width="0.5"/>\n`;
      s += `<text x="${ml + pw + 5}" y="${(y + 3).toFixed(1)}" text-anchor="start" font-size="6.5" fill="${rightColor}">${esc(rYFmt(v))}</text>\n`;
    }
    s += `<text x="${W - 12}" y="${mt + ph / 2}" text-anchor="middle" font-size="8" fill="${rightColor}" transform="rotate(90,${W - 12},${mt + ph / 2})">${esc(opts.rightYLabel!)}</text>\n`;
  }

  // Legend
  const allSeries = [
    ...series.map((sr) => ({ ...sr, side: "left" as const })),
    ...hLines.map((hl) => ({ values: [], color: hl.color, label: hl.label, dash: hl.dash ?? "6,3", width: 1, side: "left" as const })),
    ...rightSeries.map((sr) => ({ ...sr, side: "right" as const })),
  ];
  const lx = ml + pw - allSeries.length * 2, ly = mt + 6;
  // Background box for legend
  const legendW = Math.max(...allSeries.map((sr) => sr.label.length)) * 4.5 + 24;
  const legendH = allSeries.length * 11 + 4;
  s += `<rect x="${ml + pw - legendW - 4}" y="${ly - 5}" width="${legendW + 8}" height="${legendH}" rx="2" fill="white" fill-opacity="0.85"/>\n`;

  let legendIdx = 0;
  for (const sr of allSeries) {
    const lxr = ml + pw - legendW;
    const lyy = ly + legendIdx * 11;
    s += `<line x1="${lxr}" y1="${lyy}" x2="${lxr + 14}" y2="${lyy}" stroke="${sr.color}" stroke-width="${Math.min(sr.width ?? 1, 1.5)}" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ""} opacity="${sr.opacity ?? 1}"/>\n`;
    s += `<text x="${lxr + 18}" y="${lyy + 3}" font-size="6.5" fill="#444">${esc(sr.label)}</text>\n`;
    legendIdx++;
  }

  s += `</svg>\n`;
  return s;
}

// ---------------------------------------------------------------------------
main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
