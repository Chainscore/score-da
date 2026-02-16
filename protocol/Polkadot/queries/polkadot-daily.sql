-- Polkadot DA: Daily Analysis Dashboard
-- Single query producing all columns for dashboard charts:
--   1. Throughput (MiB/s)          → actual_mib_per_s, max_mib_per_s, rolling avgs
--   2. DA Utilization (%)          → utilization_pct, rolling avgs
--   3. Daily Data Volume (MiB)     → daily_data_mib, rolling avg
--   4. Cost per MiB (USD)          → bulk p10/p50/p90, renewal p50, rolling avg
--   5. Cost per Core (DOT + USD)   → bulk_p50_price_per_core_dot/usd
--   6. Coretime Market             → purchase_count, renewal_count, daily spend
--   7. Pipeline Health             → pipeline_efficiency_pct, timed_out_rate_pct
--   8. Parachain Diversity         → distinct_paras, core_engagement_pct
--   9. Availability                → mean_availability, avg_bitfields
--  10. Cumulative                  → cumulative_data_mib, cumulative_spend_usd
--
-- Tables: dune.prasad_chainscorelabs.polkadot_blocks      (sampled relay blocks)
--         dune.prasad_chainscorelabs.polkadot_purchases    (bulk coretime buys)
--         dune.prasad_chainscorelabs.polkadot_renewals     (bulk coretime renewals)
--         dune.prasad_chainscorelabs.polkadot_sales        (sale cycle boundaries)
--         dune.prasad_chainscorelabs.polkadot_prices       (DOT/USD daily)
--
-- Polkadot DA model:
--   Throughput upper bound = included × max_pov / cadence  (no actual PoV sizes)
--   Utilization = included / effective_cores
--   Bulk cost/MiB = region_price / max_mib_per_region
--   Cost/core = region_price (1 core buys a 28-day region)
--
-- Chain params: 6s cadence (async backing), backing_group_size = 5
-- 1 DOT = 10^10 planck.  Region = 5040 timeslices × 80 blocks = 403,200 blocks.
-- 14,400 blocks/day.  Data is sampled (step=100 in --days mode → ~144 samples/day).

WITH params AS (
  SELECT
    6.0        AS cadence_s,
    5          AS backing_group_size,
    1e10       AS dot_planck,
    10.0       AS max_pov_mib,          -- post-#1480 (10 MiB)
    5040       AS region_length_ts,     -- timeslices per region
    80         AS timeslice_period,     -- blocks per timeslice
    14400.0    AS blocks_per_day,       -- 86400 / 6
    86400.0    AS seconds_per_day
),

-- ── Governance regimes ──────────────────────────────────────────────────
-- effective_cores = min(num_cores, floor(validators / backing_group_size))

regimes AS (
  SELECT * FROM (VALUES
    (CAST(0        AS BIGINT), 62,  5242880,  'pre-#1200'),
    (CAST(23120301 AS BIGINT), 62,  5242880,  '#1200 (val 400→500)'),
    (CAST(25164320 AS BIGINT), 62,  5242880,  '#1484 (val 500→600)'),
    (CAST(25342222 AS BIGINT), 62,  10485760, '#1480 (PoV 10 MiB)'),
    (CAST(25786439 AS BIGINT), 66,  10485760, '#1536 (66 cores)'),
    (CAST(26803000 AS BIGINT), 100, 10485760, '#1629 (100 cores)')
  ) AS t(start_block, effective_cores, max_pov_bytes, era)
),

regimes_with_end AS (
  SELECT
    start_block,
    COALESCE(
      LEAD(start_block) OVER (ORDER BY start_block),
      CAST(999999999 AS BIGINT)
    ) AS end_block,
    effective_cores,
    max_pov_bytes,
    era
  FROM regimes
),

-- ── Throughput: daily aggregation from sampled blocks ───────────────────

daily_blocks AS (
  SELECT
    date_trunc('day', from_unixtime(CAST(timestamp AS DOUBLE) / 1000.0)) AS day,

    count(*)                              AS sample_count,

    -- Averages (unbiased estimates of population means)
    avg(CAST(included AS DOUBLE))         AS avg_included,
    avg(CAST(backed AS DOUBLE))           AS avg_backed,
    avg(CAST(cores_active AS DOUBLE))     AS avg_cores_active,
    avg(CAST(distinct_paras AS DOUBLE))   AS avg_distinct_paras,
    avg(CAST(bitfields AS DOUBLE))        AS avg_bitfields,
    avg(CASE WHEN avg_avail > 0
             THEN avg_avail END)          AS mean_availability,

    -- Per-block included candidate percentiles
    approx_percentile(CAST(included AS DOUBLE), 0.10) AS p10_included,
    approx_percentile(CAST(included AS DOUBLE), 0.50) AS p50_included,
    approx_percentile(CAST(included AS DOUBLE), 0.90) AS p90_included,

    -- Fault counts (sum across sampled blocks)
    sum(CAST(timed_out AS DOUBLE))        AS total_timed_out,
    sum(CAST(disputes AS DOUBLE))         AS total_disputes,

    -- Median block → regime lookup
    approx_percentile(CAST(block_number AS DOUBLE), 0.5) AS median_block

  FROM dune.prasad_chainscorelabs.polkadot_blocks
  GROUP BY 1
),

-- ── Bulk purchases: daily aggregation ───────────────────────────────────

daily_purchases AS (
  SELECT
    date_trunc('day', from_unixtime(CAST(timestamp AS DOUBLE))) AS day,

    count(*)                                                       AS purchase_count,

    -- Price per core (per region) in DOT
    approx_percentile(CAST(price AS DOUBLE) / p.dot_planck, 0.10) AS bulk_p10_price_dot,
    approx_percentile(CAST(price AS DOUBLE) / p.dot_planck, 0.50) AS bulk_p50_price_dot,
    approx_percentile(CAST(price AS DOUBLE) / p.dot_planck, 0.90) AS bulk_p90_price_dot,

    -- Total spend
    sum(CAST(price AS DOUBLE) / p.dot_planck)                      AS daily_bulk_spend_dot

  FROM dune.prasad_chainscorelabs.polkadot_purchases
  CROSS JOIN params p
  GROUP BY 1
),

-- ── Bulk renewals: daily aggregation ────────────────────────────────────

daily_renewals AS (
  SELECT
    date_trunc('day', from_unixtime(CAST(timestamp AS DOUBLE))) AS day,

    count(*)                                                       AS renewal_count,
    approx_percentile(CAST(price AS DOUBLE) / p.dot_planck, 0.50) AS renewal_p50_price_dot,

    sum(CAST(price AS DOUBLE) / p.dot_planck)                      AS daily_renewal_spend_dot

  FROM dune.prasad_chainscorelabs.polkadot_renewals
  CROSS JOIN params p
  GROUP BY 1
),

-- ── Sale cycle context (non-NULL only on days a sale started) ───────────

daily_sales AS (
  SELECT
    date_trunc('day', from_unixtime(CAST(timestamp AS DOUBLE))) AS day,

    count(*)            AS sales_started,
    avg(cores_offered)  AS avg_cores_offered,
    avg(CAST(start_price AS DOUBLE) / p.dot_planck) AS avg_start_price_dot,
    avg(CAST(end_price   AS DOUBLE) / p.dot_planck) AS avg_end_price_dot

  FROM dune.prasad_chainscorelabs.polkadot_sales
  CROSS JOIN params p
  GROUP BY 1
),

-- ── DOT/USD prices ──────────────────────────────────────────────────────

daily_prices AS (
  SELECT
    date_trunc('day', from_iso8601_timestamp(date)) AS day,
    avg(dot_usd)                                    AS avg_dot_usd
  FROM dune.prasad_chainscorelabs.polkadot_prices
  GROUP BY 1
),

-- ── Base: join all sources, compute derived metrics ─────────────────────

base AS (
  SELECT
    d.day,
    r.era,
    r.effective_cores,
    CAST(r.max_pov_bytes AS DOUBLE) / 1048576.0 AS max_pov_mib,
    d.sample_count,

    -- ── 1. Throughput ────────────────────────────────────────────────
    -- Upper bound: avg_included × max_pov / cadence
    d.avg_included * CAST(r.max_pov_bytes AS DOUBLE)
      / p.cadence_s / 1048576.0                        AS actual_mib_per_s,
    -- Max theoretical
    CAST(r.effective_cores AS DOUBLE) * CAST(r.max_pov_bytes AS DOUBLE)
      / p.cadence_s / 1048576.0                        AS max_mib_per_s,

    -- ── 2. Utilization ──────────────────────────────────────────────
    d.avg_included
      / NULLIF(CAST(r.effective_cores AS DOUBLE), 0)
      * 100.0                                          AS utilization_pct,

    -- ── 3. Daily data volume (upper bound MiB) ─────────────────────
    d.avg_included * CAST(r.max_pov_bytes AS DOUBLE)
      / 1048576.0 * p.blocks_per_day                   AS daily_data_mib,

    -- ── 4. Included candidate distribution ──────────────────────────
    d.avg_included,
    d.p10_included,
    d.p50_included,
    d.p90_included,

    -- ── 5. Cost per MiB (DOT) ───────────────────────────────────────
    bp.purchase_count,
    bp.bulk_p10_price_dot
      / (CAST(p.region_length_ts AS DOUBLE) * p.timeslice_period * p.max_pov_mib)
      AS bulk_p10_cost_per_mib_dot,
    bp.bulk_p50_price_dot
      / (CAST(p.region_length_ts AS DOUBLE) * p.timeslice_period * p.max_pov_mib)
      AS bulk_p50_cost_per_mib_dot,
    bp.bulk_p90_price_dot
      / (CAST(p.region_length_ts AS DOUBLE) * p.timeslice_period * p.max_pov_mib)
      AS bulk_p90_cost_per_mib_dot,

    rn.renewal_count,
    rn.renewal_p50_price_dot
      / (CAST(p.region_length_ts AS DOUBLE) * p.timeslice_period * p.max_pov_mib)
      AS renewal_p50_cost_per_mib_dot,

    -- ── 6. Cost per core (DOT) — raw region price ───────────────────
    bp.bulk_p50_price_dot                              AS bulk_p50_price_per_core_dot,
    rn.renewal_p50_price_dot                           AS renewal_p50_price_per_core_dot,

    -- ── 7. Daily spend (DOT) ────────────────────────────────────────
    bp.daily_bulk_spend_dot,
    rn.daily_renewal_spend_dot,

    -- ── 8. Pipeline health ──────────────────────────────────────────
    d.avg_backed,
    -- Pipeline efficiency: what fraction of backed candidates get included
    d.avg_included / NULLIF(d.avg_backed, 0) * 100.0   AS pipeline_efficiency_pct,
    -- Timed-out rate: timed_out / (total samples × avg_backed)
    d.total_timed_out
      / NULLIF(CAST(d.sample_count AS DOUBLE) * d.avg_backed, 0)
      * 100.0                                          AS timed_out_rate_pct,
    d.total_disputes,

    -- ── 9. Parachain diversity ──────────────────────────────────────
    d.avg_distinct_paras,
    -- Core engagement: what fraction of effective cores had activity
    d.avg_cores_active
      / NULLIF(CAST(r.effective_cores AS DOUBLE), 0)
      * 100.0                                          AS core_engagement_pct,
    -- Diversity ratio: unique paras / active cores (>1 means paras share cores)
    d.avg_distinct_paras
      / NULLIF(d.avg_cores_active, 0)                  AS para_diversity_ratio,

    -- ── 10. Availability ─────────────────────────────────────────────
    d.mean_availability,
    d.avg_bitfields,

    -- ── 11. Sale cycle context ───────────────────────────────────────
    sc.sales_started,
    sc.avg_cores_offered                               AS sale_cores_offered,
    sc.avg_start_price_dot                             AS sale_start_price_dot,
    sc.avg_end_price_dot                               AS sale_end_price_dot,

    -- ── Price context ────────────────────────────────────────────────
    pr.avg_dot_usd

  FROM daily_blocks d
  CROSS JOIN params p
  JOIN regimes_with_end r
    ON CAST(d.median_block AS BIGINT) >= r.start_block
    AND CAST(d.median_block AS BIGINT) < r.end_block
  LEFT JOIN daily_purchases bp ON d.day = bp.day
  LEFT JOIN daily_renewals rn  ON d.day = rn.day
  LEFT JOIN daily_sales sc     ON d.day = sc.day
  LEFT JOIN daily_prices pr    ON d.day = pr.day
),

-- ── Convert DOT → USD ───────────────────────────────────────────────────

with_costs AS (
  SELECT
    base.*,

    -- Cost per MiB (USD)
    bulk_p10_cost_per_mib_dot * COALESCE(avg_dot_usd, 0) AS bulk_p10_cost_per_mib_usd,
    bulk_p50_cost_per_mib_dot * COALESCE(avg_dot_usd, 0) AS bulk_p50_cost_per_mib_usd,
    bulk_p90_cost_per_mib_dot * COALESCE(avg_dot_usd, 0) AS bulk_p90_cost_per_mib_usd,
    renewal_p50_cost_per_mib_dot * COALESCE(avg_dot_usd, 0) AS renewal_p50_cost_per_mib_usd,

    -- Cost per core (USD)
    bulk_p50_price_per_core_dot * COALESCE(avg_dot_usd, 0) AS bulk_p50_price_per_core_usd,
    renewal_p50_price_per_core_dot * COALESCE(avg_dot_usd, 0) AS renewal_p50_price_per_core_usd,

    -- Daily spend (USD)
    COALESCE(daily_bulk_spend_dot, 0) * COALESCE(avg_dot_usd, 0) AS daily_bulk_spend_usd,
    COALESCE(daily_renewal_spend_dot, 0) * COALESCE(avg_dot_usd, 0) AS daily_renewal_spend_usd,
    (COALESCE(daily_bulk_spend_dot, 0) + COALESCE(daily_renewal_spend_dot, 0))
      * COALESCE(avg_dot_usd, 0) AS daily_total_spend_usd

  FROM base
)

SELECT
  with_costs.*,

  -- ── Rolling averages ──────────────────────────────────────────────────

  -- 7-day
  avg(actual_mib_per_s)            OVER w7  AS actual_mib_per_s_7d,
  avg(utilization_pct)             OVER w7  AS utilization_pct_7d,
  avg(daily_data_mib)              OVER w7  AS daily_data_mib_7d,
  avg(bulk_p50_cost_per_mib_usd)  OVER w7  AS bulk_cost_per_mib_usd_7d,
  avg(pipeline_efficiency_pct)     OVER w7  AS pipeline_efficiency_pct_7d,
  avg(core_engagement_pct)         OVER w7  AS core_engagement_pct_7d,

  -- 30-day
  avg(actual_mib_per_s)            OVER w30 AS actual_mib_per_s_30d,
  avg(utilization_pct)             OVER w30 AS utilization_pct_30d,

  -- ── Cumulative ────────────────────────────────────────────────────────

  sum(daily_data_mib)       OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_data_mib,
  sum(daily_total_spend_usd) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_spend_usd

FROM with_costs
WINDOW
  w7  AS (ORDER BY day ROWS BETWEEN  6 PRECEDING AND CURRENT ROW),
  w30 AS (ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW)
ORDER BY day
