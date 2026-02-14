-- Espresso Tiramisu DA: Hourly Analysis Dashboard
-- Single query producing all columns for dashboard charts:
--   1. Throughput (MiB/s)       → actual_mib_per_s, max_mib_per_s, actual_mib_per_s_24h
--   2. Utilization (%)          → utilization_pct, utilization_pct_24h
--   3. Hourly Payload (MiB)     → hourly_mib, hourly_mib_24h
--   4. Cost per MiB (USD)       → cost_per_mib_usd, cost_per_mib_usd_24h
--   5. Cost Quantile Bands      → cost_per_mib_usd_p10/p50/p90
--   6. Block Time Band (ms)     → p10/p50/p90_block_time_ms
--
-- Tables: dune.prasad_chainscore.espresso_blocks
--         dune.prasad_chainscore.espresso_prices

WITH params AS (
  SELECT
    1 AS base_fee_wei,              -- constant since genesis (verified heights 1K–10.3M)
    1000000 AS max_block_size,      -- 1 MB chain config
    7.0 AS da_retention_days        -- DA node target retention (min 1d)
),

hourly_blocks AS (
  SELECT
    date_trunc('hour', from_unixtime(CAST(timestamp_ms AS DOUBLE) / 1000.0)) AS hour,
    count(*)                                                    AS block_count,
    sum(size_bytes)                                             AS total_bytes,
    sum(num_transactions)                                       AS total_txs,
    sum(CASE WHEN size_bytes > 0 THEN 1 ELSE 0 END)            AS non_empty_blocks,

    -- Block time percentiles (exclude first-block zero delta)
    avg(CASE WHEN block_time_ms > 0
             THEN CAST(block_time_ms AS DOUBLE) END)            AS avg_block_time_ms,
    approx_percentile(
      CASE WHEN block_time_ms > 0
           THEN CAST(block_time_ms AS DOUBLE) END, 0.10)       AS p10_block_time_ms,
    approx_percentile(
      CASE WHEN block_time_ms > 0
           THEN CAST(block_time_ms AS DOUBLE) END, 0.50)       AS p50_block_time_ms,
    approx_percentile(
      CASE WHEN block_time_ms > 0
           THEN CAST(block_time_ms AS DOUBLE) END, 0.90)       AS p90_block_time_ms,

    -- Payload percentiles
    approx_percentile(CAST(size_bytes AS DOUBLE), 0.50)         AS p50_payload_bytes,
    approx_percentile(CAST(size_bytes AS DOUBLE), 0.90)         AS p90_payload_bytes,
    approx_percentile(CAST(size_bytes AS DOUBLE), 0.99)         AS p99_payload_bytes
  FROM dune.prasad_chainscore.espresso_blocks
  GROUP BY 1
),

hourly_prices AS (
  SELECT
    date_trunc('hour', from_iso8601_timestamp(date)) AS hour,
    avg(eth_usd)                                     AS avg_eth_usd,
    approx_percentile(eth_usd, 0.10)                 AS p10_eth_usd,
    approx_percentile(eth_usd, 0.50)                 AS p50_eth_usd,
    approx_percentile(eth_usd, 0.90)                 AS p90_eth_usd
  FROM dune.prasad_chainscore.espresso_prices
  GROUP BY 1
),

base AS (
  SELECT
    b.hour,

    -- Block stats
    b.block_count,
    b.non_empty_blocks,
    b.total_txs,

    -- Block time band  (Chart 6)
    b.avg_block_time_ms,
    b.p10_block_time_ms,
    b.p50_block_time_ms,
    b.p90_block_time_ms,

    -- Hourly payload MiB  (Chart 3)
    CAST(b.total_bytes AS DOUBLE) / 1048576.0 AS hourly_mib,

    -- Throughput MiB/s  (Chart 1)
    (CAST(b.total_bytes AS DOUBLE) / 1048576.0)
      / NULLIF(CAST(b.block_count AS DOUBLE) * b.p50_block_time_ms / 1000.0, 0)
      AS actual_mib_per_s,
    (CAST(p.max_block_size AS DOUBLE) / 1048576.0)
      / NULLIF(b.p50_block_time_ms / 1000.0, 0)
      AS max_mib_per_s,

    -- Utilization %  (Chart 2)
    (CAST(b.total_bytes AS DOUBLE)
      / NULLIF(CAST(b.block_count AS DOUBLE) * p.max_block_size, 0)) * 100.0
      AS utilization_pct,

    -- Payload percentiles
    b.p50_payload_bytes,
    b.p90_payload_bytes,
    b.p99_payload_bytes,

    -- Cost per MiB  (Chart 4)
    --   base_fee=1 wei/byte → cost_per_mib_eth = 2^20 / 1e18
    pr.avg_eth_usd,
    (1048576.0 / 1e18) * pr.avg_eth_usd AS cost_per_mib_usd,
    (1048576.0 / 1e18) * pr.avg_eth_usd
      / p.da_retention_days              AS cost_per_mib_day_usd,

    -- Cost quantile bands  (Chart 5)
    (1048576.0 / 1e18) * pr.p10_eth_usd  AS cost_per_mib_usd_p10,
    (1048576.0 / 1e18) * pr.p50_eth_usd  AS cost_per_mib_usd_p50,
    (1048576.0 / 1e18) * pr.p90_eth_usd  AS cost_per_mib_usd_p90,

    -- Hourly total DA spend
    (CAST(b.total_bytes AS DOUBLE) / 1e18) * pr.avg_eth_usd
      AS hourly_da_spend_usd

  FROM hourly_blocks b
  LEFT JOIN hourly_prices pr ON b.hour = pr.hour
  CROSS JOIN params p
)

SELECT
  base.*,

  -- 24-hour (1-day) rolling averages
  avg(actual_mib_per_s)  OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS actual_mib_per_s_24h,
  avg(utilization_pct)   OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS utilization_pct_24h,
  avg(hourly_mib)        OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS hourly_mib_24h,
  avg(cost_per_mib_usd)  OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS cost_per_mib_usd_24h,

  -- Cumulative totals
  sum(hourly_mib)          OVER (ORDER BY hour ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_mib,
  sum(hourly_da_spend_usd) OVER (ORDER BY hour ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_da_spend_usd

FROM base
ORDER BY hour
