-- Espresso Tiramisu DA: Daily Analysis Dashboard
-- Columns for: throughput, utilization, payload, cost, block time
-- Rolling averages: 7-day
--
-- Tables: dune.prasad_chainscore.espresso_blocks
--         dune.prasad_chainscore.espresso_prices

WITH params AS (
  SELECT
    1 AS base_fee_wei,
    1000000 AS max_block_size,
    7.0 AS da_retention_days
),

daily_blocks AS (
  SELECT
    date_trunc('day', from_unixtime(CAST(timestamp_ms AS DOUBLE) / 1000.0)) AS day,
    count(*)                                                    AS block_count,
    sum(size_bytes)                                             AS total_bytes,
    sum(num_transactions)                                       AS total_txs,
    sum(CASE WHEN size_bytes > 0 THEN 1 ELSE 0 END)            AS non_empty_blocks,

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

    approx_percentile(CAST(size_bytes AS DOUBLE), 0.50)         AS p50_payload_bytes,
    approx_percentile(CAST(size_bytes AS DOUBLE), 0.90)         AS p90_payload_bytes,
    approx_percentile(CAST(size_bytes AS DOUBLE), 0.99)         AS p99_payload_bytes
  FROM dune.prasad_chainscore.espresso_blocks
  GROUP BY 1
),

daily_prices AS (
  SELECT
    date_trunc('day', from_iso8601_timestamp(date)) AS day,
    avg(eth_usd)                                    AS avg_eth_usd,
    approx_percentile(eth_usd, 0.10)                AS p10_eth_usd,
    approx_percentile(eth_usd, 0.50)                AS p50_eth_usd,
    approx_percentile(eth_usd, 0.90)                AS p90_eth_usd
  FROM dune.prasad_chainscore.espresso_prices
  GROUP BY 1
),

base AS (
  SELECT
    b.day,
    b.block_count,
    b.non_empty_blocks,
    b.total_txs,

    b.avg_block_time_ms,
    b.p10_block_time_ms,
    b.p50_block_time_ms,
    b.p90_block_time_ms,

    CAST(b.total_bytes AS DOUBLE) / 1048576.0 AS daily_mib,

    (CAST(b.total_bytes AS DOUBLE) / 1048576.0)
      / NULLIF(CAST(b.block_count AS DOUBLE) * b.p50_block_time_ms / 1000.0, 0)
      AS actual_mib_per_s,
    (CAST(p.max_block_size AS DOUBLE) / 1048576.0)
      / NULLIF(b.p50_block_time_ms / 1000.0, 0)
      AS max_mib_per_s,

    (CAST(b.total_bytes AS DOUBLE)
      / NULLIF(CAST(b.block_count AS DOUBLE) * p.max_block_size, 0)) * 100.0
      AS utilization_pct,

    b.p50_payload_bytes,
    b.p90_payload_bytes,
    b.p99_payload_bytes,

    pr.avg_eth_usd,
    (1048576.0 / 1e18) * pr.avg_eth_usd AS cost_per_mib_usd,
    (1048576.0 / 1e18) * pr.avg_eth_usd / p.da_retention_days AS cost_per_mib_day_usd,

    (1048576.0 / 1e18) * pr.p10_eth_usd  AS cost_per_mib_usd_p10,
    (1048576.0 / 1e18) * pr.p50_eth_usd  AS cost_per_mib_usd_p50,
    (1048576.0 / 1e18) * pr.p90_eth_usd  AS cost_per_mib_usd_p90,

    (CAST(b.total_bytes AS DOUBLE) / 1e18) * pr.avg_eth_usd AS daily_da_spend_usd

  FROM daily_blocks b
  LEFT JOIN daily_prices pr ON b.day = pr.day
  CROSS JOIN params p
)

SELECT
  base.*,

  -- 7-day rolling averages
  avg(actual_mib_per_s)  OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
    AS actual_mib_per_s_7d,
  avg(utilization_pct)   OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
    AS utilization_pct_7d,
  avg(daily_mib)         OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
    AS daily_mib_7d,
  avg(cost_per_mib_usd)  OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
    AS cost_per_mib_usd_7d,

  -- Cumulative
  sum(daily_mib)          OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_mib,
  sum(daily_da_spend_usd) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_da_spend_usd

FROM base
ORDER BY day
