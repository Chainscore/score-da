-- Avail DA: Hourly Analysis Dashboard
-- Columns for: throughput, utilization, payload, cost, block time
-- Rolling averages: 24-hour
--
-- Tables: dune.prasadkumkar.avail_blocks
--         dune.prasadkumkar.avail_prices
--
-- Fee model: base_fee + length_fee + weight_fee × congestion_multiplier × submitDataFeeModifier
-- Fees are actual on-chain fees from TransactionFeePaid events (in plancks, 1 AVAIL = 1e18 plancks)
-- Chain params: 20s block time, max 4,456,448 bytes per block

WITH params AS (
  SELECT
    4456448   AS max_block_bytes,
    20.0      AS target_block_time_s,
    18        AS avail_decimals      -- 1 AVAIL = 10^18 plancks
),

hourly_blocks AS (
  SELECT
    date_trunc('hour', from_unixtime(CAST(timestamp_ms AS DOUBLE) / 1000.0)) AS hour,

    count(*)                                                    AS block_count,
    sum(CASE WHEN submit_data_bytes > 0 THEN 1 ELSE 0 END)     AS blocks_with_data,
    sum(CAST(submit_data_bytes AS DOUBLE))                       AS total_data_bytes,
    sum(submit_data_count)                                      AS total_submit_count,

    sum(CAST(block_fee_plancks AS DOUBLE))                       AS total_fee_plancks,

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

    approx_percentile(
      CASE WHEN submit_data_bytes > 0
           THEN CAST(submit_data_bytes AS DOUBLE) END, 0.50)   AS p50_payload_bytes,
    approx_percentile(
      CASE WHEN submit_data_bytes > 0
           THEN CAST(submit_data_bytes AS DOUBLE) END, 0.90)   AS p90_payload_bytes,
    approx_percentile(
      CASE WHEN submit_data_bytes > 0
           THEN CAST(submit_data_bytes AS DOUBLE) END, 0.99)   AS p99_payload_bytes,

    -- Per-block fee distribution (only blocks with data)
    approx_percentile(
      CASE WHEN submit_data_bytes > 0
           THEN CAST(block_fee_plancks AS DOUBLE)
                / NULLIF(CAST(submit_data_bytes AS DOUBLE), 0) END,
      0.10)                                                     AS p10_fee_per_byte_plancks,
    approx_percentile(
      CASE WHEN submit_data_bytes > 0
           THEN CAST(block_fee_plancks AS DOUBLE)
                / NULLIF(CAST(submit_data_bytes AS DOUBLE), 0) END,
      0.50)                                                     AS p50_fee_per_byte_plancks,
    approx_percentile(
      CASE WHEN submit_data_bytes > 0
           THEN CAST(block_fee_plancks AS DOUBLE)
                / NULLIF(CAST(submit_data_bytes AS DOUBLE), 0) END,
      0.90)                                                     AS p90_fee_per_byte_plancks

  FROM dune.prasadkumkar.avail_blocks
  GROUP BY 1
),

hourly_prices AS (
  SELECT
    date_trunc('hour', from_iso8601_timestamp(date)) AS hour,
    avg(avail_usd)                                   AS avg_avail_usd
  FROM dune.prasadkumkar.avail_prices
  GROUP BY 1
),

base AS (
  SELECT
    b.hour,
    b.block_count,
    b.blocks_with_data,
    b.total_submit_count,

    b.avg_block_time_ms,
    b.p10_block_time_ms,
    b.p50_block_time_ms,
    b.p90_block_time_ms,

    CAST(b.total_data_bytes AS DOUBLE) / 1048576.0 AS hourly_data_mib,

    -- Actual throughput: total MiB / elapsed seconds
    (CAST(b.total_data_bytes AS DOUBLE) / 1048576.0)
      / NULLIF(CAST(b.block_count AS DOUBLE)
               * COALESCE(b.p50_block_time_ms, 20000) / 1000.0, 0)
      AS actual_mib_per_s,

    -- Max throughput
    (CAST(p.max_block_bytes AS DOUBLE) / 1048576.0)
      / p.target_block_time_s
      AS max_mib_per_s,

    -- Utilization
    (CAST(b.total_data_bytes AS DOUBLE)
      / NULLIF(CAST(b.block_count AS DOUBLE) * p.max_block_bytes, 0)) * 100.0
      AS utilization_pct,

    b.p50_payload_bytes,
    b.p90_payload_bytes,
    b.p99_payload_bytes,

    -- Fee-based cost per MiB
    b.total_fee_plancks,
    CASE WHEN b.total_data_bytes > 0
         THEN (CAST(b.total_fee_plancks AS DOUBLE)
               / NULLIF(CAST(b.total_data_bytes AS DOUBLE), 0))
              * 1048576.0 / 1e18
         ELSE NULL
    END AS avg_cost_per_mib_avail,

    -- Cost quantile bands (fee_per_byte → per MiB in AVAIL)
    b.p10_fee_per_byte_plancks * 1048576.0 / 1e18 AS cost_per_mib_avail_p10,
    b.p50_fee_per_byte_plancks * 1048576.0 / 1e18 AS cost_per_mib_avail_p50,
    b.p90_fee_per_byte_plancks * 1048576.0 / 1e18 AS cost_per_mib_avail_p90,

    pr.avg_avail_usd

  FROM hourly_blocks b
  CROSS JOIN params p
  LEFT JOIN hourly_prices pr ON b.hour = pr.hour
),

with_costs AS (
  SELECT
    base.*,

    avg_cost_per_mib_avail * COALESCE(avg_avail_usd, 0)
      AS cost_per_mib_usd,

    cost_per_mib_avail_p10 * COALESCE(avg_avail_usd, 0)
      AS cost_per_mib_usd_p10,
    cost_per_mib_avail_p50 * COALESCE(avg_avail_usd, 0)
      AS cost_per_mib_usd_p50,
    cost_per_mib_avail_p90 * COALESCE(avg_avail_usd, 0)
      AS cost_per_mib_usd_p90,

    -- Hourly DA spend in USD
    (CAST(total_fee_plancks AS DOUBLE) / 1e18) * COALESCE(avg_avail_usd, 0)
      AS hourly_da_spend_usd

  FROM base
)

SELECT
  with_costs.*,

  -- 24-hour rolling averages
  avg(actual_mib_per_s)  OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS actual_mib_per_s_24h,
  avg(utilization_pct)   OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS utilization_pct_24h,
  avg(hourly_data_mib)   OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS hourly_data_mib_24h,
  avg(cost_per_mib_usd)  OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS cost_per_mib_usd_24h,

  -- Cumulative
  sum(hourly_data_mib)     OVER (ORDER BY hour ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_data_mib,
  sum(hourly_da_spend_usd) OVER (ORDER BY hour ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_da_spend_usd

FROM with_costs
ORDER BY hour
