-- NEAR DA: Daily Analysis Dashboard
-- Columns for: throughput, utilization, payload, cost, block time
-- Rolling averages: 7-day
--
-- Tables: dune.prasadkumkar.near_blocks
--         dune.prasadkumkar.near_prices
--
-- NEAR cost model:
--   cost_near = total_gas_used × gas_price / 1e24 (yoctoNEAR → NEAR)
--   cost_per_mib = cost_near / (total_encoded_bytes / MiB)
-- Chain params: ~0.6s block time, 9 shards, 36 MiB max per block (9 × 4 MiB)
-- Gas price is stored per-block (yoctoNEAR/gas), currently 1e8

WITH params AS (
  SELECT
    36            AS max_block_mib,       -- 9 shards × 4 MiB
    9             AS num_shards,
    0.61          AS target_block_time_s,
    24            AS near_decimals        -- 1 NEAR = 10^24 yoctoNEAR
),

daily_blocks AS (
  SELECT
    date_trunc('day', from_unixtime(CAST(timestamp_ms AS DOUBLE) / 1000.0)) AS day,

    count(*)                                                        AS block_count,
    sum(CASE WHEN total_encoded_bytes > 0 THEN 1 ELSE 0 END)       AS blocks_with_data,

    sum(CAST(total_encoded_bytes AS DOUBLE))                        AS total_encoded_bytes,
    sum(CAST(total_gas_used AS DOUBLE))                             AS total_gas_used,
    sum(CAST(total_gas_limit AS DOUBLE))                            AS total_gas_limit,
    sum(chunks_produced)                                            AS total_chunks_produced,

    -- Per-block DA cost in NEAR: gas_used × gas_price / 1e24
    sum(CAST(total_gas_used AS DOUBLE) * CAST(gas_price AS DOUBLE) / 1e24)
      AS total_da_cost_near,

    avg(CASE WHEN block_time_ms > 0
             THEN CAST(block_time_ms AS DOUBLE) END)                AS avg_block_time_ms,
    approx_percentile(
      CASE WHEN block_time_ms > 0
           THEN CAST(block_time_ms AS DOUBLE) END, 0.10)           AS p10_block_time_ms,
    approx_percentile(
      CASE WHEN block_time_ms > 0
           THEN CAST(block_time_ms AS DOUBLE) END, 0.50)           AS p50_block_time_ms,
    approx_percentile(
      CASE WHEN block_time_ms > 0
           THEN CAST(block_time_ms AS DOUBLE) END, 0.90)           AS p90_block_time_ms,

    approx_percentile(
      CASE WHEN total_encoded_bytes > 0
           THEN CAST(total_encoded_bytes AS DOUBLE) END, 0.50)     AS p50_encoded_bytes,
    approx_percentile(
      CASE WHEN total_encoded_bytes > 0
           THEN CAST(total_encoded_bytes AS DOUBLE) END, 0.90)     AS p90_encoded_bytes,
    approx_percentile(
      CASE WHEN total_encoded_bytes > 0
           THEN CAST(total_encoded_bytes AS DOUBLE) END, 0.99)     AS p99_encoded_bytes,

    -- Cost per byte percentiles (only blocks with data)
    approx_percentile(
      CASE WHEN total_encoded_bytes > 0
           THEN CAST(total_gas_used AS DOUBLE) * CAST(gas_price AS DOUBLE) / 1e24
                / CAST(total_encoded_bytes AS DOUBLE) END,
      0.10)                                                         AS p10_cost_per_byte_near,
    approx_percentile(
      CASE WHEN total_encoded_bytes > 0
           THEN CAST(total_gas_used AS DOUBLE) * CAST(gas_price AS DOUBLE) / 1e24
                / CAST(total_encoded_bytes AS DOUBLE) END,
      0.50)                                                         AS p50_cost_per_byte_near,
    approx_percentile(
      CASE WHEN total_encoded_bytes > 0
           THEN CAST(total_gas_used AS DOUBLE) * CAST(gas_price AS DOUBLE) / 1e24
                / CAST(total_encoded_bytes AS DOUBLE) END,
      0.90)                                                         AS p90_cost_per_byte_near

  FROM dune.prasadkumkar.near_blocks
  GROUP BY 1
),

daily_prices AS (
  SELECT
    date_trunc('day', from_iso8601_timestamp(date)) AS day,
    avg(near_usd)                                   AS avg_near_usd
  FROM dune.prasadkumkar.near_prices
  GROUP BY 1
),

base AS (
  SELECT
    b.day,
    p.max_block_mib,
    p.target_block_time_s,

    b.block_count,
    b.blocks_with_data,
    b.total_chunks_produced,

    b.avg_block_time_ms,
    b.p10_block_time_ms,
    b.p50_block_time_ms,
    b.p90_block_time_ms,

    -- Payload volume
    b.total_encoded_bytes / 1048576.0                AS daily_data_mib,

    -- Actual throughput: total MiB / elapsed seconds
    (b.total_encoded_bytes / 1048576.0)
      / NULLIF(CAST(b.block_count AS DOUBLE)
               * COALESCE(b.p50_block_time_ms, 1300) / 1000.0, 0)
      AS actual_mib_per_s,

    -- Max throughput
    CAST(p.max_block_mib AS DOUBLE) / p.target_block_time_s
      AS max_mib_per_s,

    -- Utilization: total bytes / (blocks × max bytes per block)
    (b.total_encoded_bytes
      / NULLIF(CAST(b.block_count AS DOUBLE) * p.max_block_mib * 1048576.0, 0)) * 100.0
      AS utilization_pct,

    b.p50_encoded_bytes,
    b.p90_encoded_bytes,
    b.p99_encoded_bytes,

    -- DA cost
    b.total_da_cost_near,
    CASE WHEN b.total_encoded_bytes > 0
         THEN b.total_da_cost_near
              / (b.total_encoded_bytes / 1048576.0)
         ELSE NULL
    END AS avg_cost_per_mib_near,

    -- Cost quantile bands (cost_per_byte → per MiB in NEAR)
    b.p10_cost_per_byte_near * 1048576.0 AS cost_per_mib_near_p10,
    b.p50_cost_per_byte_near * 1048576.0 AS cost_per_mib_near_p50,
    b.p90_cost_per_byte_near * 1048576.0 AS cost_per_mib_near_p90,

    pr.avg_near_usd

  FROM daily_blocks b
  CROSS JOIN params p
  LEFT JOIN daily_prices pr ON b.day = pr.day
),

with_costs AS (
  SELECT
    base.*,

    avg_cost_per_mib_near * COALESCE(avg_near_usd, 0)
      AS cost_per_mib_usd,

    cost_per_mib_near_p10 * COALESCE(avg_near_usd, 0)
      AS cost_per_mib_usd_p10,
    cost_per_mib_near_p50 * COALESCE(avg_near_usd, 0)
      AS cost_per_mib_usd_p50,
    cost_per_mib_near_p90 * COALESCE(avg_near_usd, 0)
      AS cost_per_mib_usd_p90,

    -- Daily DA spend in USD
    total_da_cost_near * COALESCE(avg_near_usd, 0)
      AS daily_da_spend_usd

  FROM base
)

SELECT
  with_costs.*,

  -- 7-day rolling averages
  avg(actual_mib_per_s) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
    AS actual_mib_per_s_7d,
  avg(utilization_pct)  OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
    AS utilization_pct_7d,
  avg(daily_data_mib)   OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
    AS daily_data_mib_7d,
  avg(cost_per_mib_usd) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
    AS cost_per_mib_usd_7d,

  -- Cumulative
  sum(daily_data_mib)    OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_data_mib,
  sum(daily_da_spend_usd) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_da_spend_usd

FROM with_costs
ORDER BY day
