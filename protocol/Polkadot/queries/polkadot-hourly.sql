-- Polkadot DA: Hourly Analysis Dashboard
-- Single query producing all columns for dashboard charts:
--   1. Throughput (MiB/s)         → actual_mib_per_s, max_mib_per_s, actual_mib_per_s_24h
--   2. Utilization (%)            → utilization_pct, utilization_pct_24h
--   3. Hourly Data Volume (MiB)   → hourly_data_mib, hourly_data_mib_24h
--   4. Pipeline Health            → pipeline_efficiency_pct
--   5. Included Distribution      → p10/p50/p90_included
--   6. Availability               → mean_availability
--
-- Tables: dune.prasad_chainscorelabs.polkadot_blocks      (sampled relay blocks)
--         dune.prasad_chainscorelabs.polkadot_prices       (DOT/USD daily)
--
-- Polkadot DA model:
--   Throughput upper bound = included × max_pov / cadence
-- Chain params: 6s cadence, ~6 sampled blocks per hour (step=100 in --days mode)
-- 600 blocks/hour.
-- Note: bulk purchases/renewals are too sparse for hourly; use daily query for cost.

WITH params AS (
  SELECT
    6.0      AS cadence_s,
    5        AS backing_group_size,
    600.0    AS blocks_per_hour       -- 3600 / 6
),

-- ── Governance regimes ──────────────────────────────────────────────────

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

-- ── Throughput: hourly aggregation from sampled blocks ──────────────────

hourly_blocks AS (
  SELECT
    date_trunc('hour', from_unixtime(CAST(timestamp AS DOUBLE) / 1000.0)) AS hour,

    count(*)                              AS sample_count,

    avg(CAST(included AS DOUBLE))         AS avg_included,
    avg(CAST(backed AS DOUBLE))           AS avg_backed,
    avg(CAST(cores_active AS DOUBLE))     AS avg_cores_active,
    avg(CAST(distinct_paras AS DOUBLE))   AS avg_distinct_paras,
    avg(CAST(bitfields AS DOUBLE))        AS avg_bitfields,
    avg(CASE WHEN avg_avail > 0
             THEN avg_avail END)          AS mean_availability,

    -- Included candidate percentiles
    approx_percentile(CAST(included AS DOUBLE), 0.10) AS p10_included,
    approx_percentile(CAST(included AS DOUBLE), 0.50) AS p50_included,
    approx_percentile(CAST(included AS DOUBLE), 0.90) AS p90_included,

    sum(CAST(timed_out AS DOUBLE))        AS total_timed_out,

    approx_percentile(CAST(block_number AS DOUBLE), 0.5) AS median_block

  FROM dune.prasad_chainscorelabs.polkadot_blocks
  GROUP BY 1
),

-- ── DOT/USD prices (daily granularity, joined to each hour) ─────────────

daily_prices AS (
  SELECT
    date_trunc('day', from_iso8601_timestamp(date)) AS day,
    avg(dot_usd)                                    AS avg_dot_usd
  FROM dune.prasad_chainscorelabs.polkadot_prices
  GROUP BY 1
),

-- ── Base: join throughput with regime + price ────────────────────────────

base AS (
  SELECT
    h.hour,
    r.era,
    r.effective_cores,
    CAST(r.max_pov_bytes AS DOUBLE) / 1048576.0 AS max_pov_mib,
    h.sample_count,

    -- ── 1. Throughput ────────────────────────────────────────────────
    h.avg_included * CAST(r.max_pov_bytes AS DOUBLE)
      / p.cadence_s / 1048576.0                        AS actual_mib_per_s,
    CAST(r.effective_cores AS DOUBLE) * CAST(r.max_pov_bytes AS DOUBLE)
      / p.cadence_s / 1048576.0                        AS max_mib_per_s,

    -- ── 2. Utilization ──────────────────────────────────────────────
    h.avg_included
      / NULLIF(CAST(r.effective_cores AS DOUBLE), 0)
      * 100.0                                          AS utilization_pct,

    -- ── 3. Hourly data volume (upper bound MiB) ────────────────────
    h.avg_included * CAST(r.max_pov_bytes AS DOUBLE)
      / 1048576.0 * p.blocks_per_hour                  AS hourly_data_mib,

    -- ── 4. Included distribution ────────────────────────────────────
    h.avg_included,
    h.p10_included,
    h.p50_included,
    h.p90_included,

    -- ── 5. Pipeline health ──────────────────────────────────────────
    h.avg_backed,
    h.avg_included / NULLIF(h.avg_backed, 0) * 100.0   AS pipeline_efficiency_pct,
    h.total_timed_out
      / NULLIF(CAST(h.sample_count AS DOUBLE) * h.avg_backed, 0)
      * 100.0                                          AS timed_out_rate_pct,

    -- ── 6. Parachain diversity ──────────────────────────────────────
    h.avg_distinct_paras,
    h.avg_cores_active,
    h.avg_cores_active
      / NULLIF(CAST(r.effective_cores AS DOUBLE), 0)
      * 100.0                                          AS core_engagement_pct,

    -- ── 7. Availability ─────────────────────────────────────────────
    h.mean_availability,
    h.avg_bitfields,

    pr.avg_dot_usd

  FROM hourly_blocks h
  CROSS JOIN params p
  JOIN regimes_with_end r
    ON CAST(h.median_block AS BIGINT) >= r.start_block
    AND CAST(h.median_block AS BIGINT) < r.end_block
  LEFT JOIN daily_prices pr ON date_trunc('day', h.hour) = pr.day
)

SELECT
  base.*,

  -- ── 24-hour rolling averages ──────────────────────────────────────────
  avg(actual_mib_per_s)        OVER w24 AS actual_mib_per_s_24h,
  avg(utilization_pct)         OVER w24 AS utilization_pct_24h,
  avg(hourly_data_mib)         OVER w24 AS hourly_data_mib_24h,
  avg(pipeline_efficiency_pct) OVER w24 AS pipeline_efficiency_pct_24h,
  avg(core_engagement_pct)     OVER w24 AS core_engagement_pct_24h,

  -- ── Cumulative ────────────────────────────────────────────────────────
  sum(hourly_data_mib) OVER (
    ORDER BY hour ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS cumulative_data_mib

FROM base
WINDOW w24 AS (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
ORDER BY hour
