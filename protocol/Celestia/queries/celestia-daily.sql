-- Celestia DA: Daily Analysis Dashboard
-- Columns for: throughput, utilization, payload, cost, block time, square size
-- Rolling averages: 7-day
-- Era detection via version_app (Lemongrass/Ginger/Current)
--
-- Tables: dune.prasad_chainscore.celestia_blocks
--         dune.prasad_chainscore.celestia_prices

WITH
daily_blocks AS (
  SELECT
    date_trunc('day', from_unixtime(CAST(timestamp_ms AS DOUBLE) / 1000.0)) AS day,

    max(version_app)                                                AS max_version_app,

    count(*)                                                        AS block_count,
    sum(CASE WHEN blobs_count > 0 THEN 1 ELSE 0 END)               AS blocks_with_blobs,

    sum(blobs_size)                                                 AS total_blobs_bytes,
    sum(blobs_count)                                                AS total_blobs_count,
    sum(bytes_in_block)                                             AS total_bytes_in_block,
    sum(tx_count)                                                   AS total_txs,

    sum(fee_utia)                                                   AS total_fee_utia,
    sum(gas_used)                                                   AS total_gas_used,
    sum(gas_limit)                                                  AS total_gas_limit,

    avg(fill_rate)                                                  AS avg_fill_rate,

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

    approx_percentile(CAST(square_size AS DOUBLE), 0.50)            AS p50_square_size,
    approx_percentile(CAST(square_size AS DOUBLE), 0.90)            AS p90_square_size,
    max(square_size)                                                AS max_square_size_seen,

    approx_percentile(
      CASE WHEN blobs_size > 0
           THEN CAST(blobs_size AS DOUBLE) END, 0.50)              AS p50_blobs_size,
    approx_percentile(
      CASE WHEN blobs_size > 0
           THEN CAST(blobs_size AS DOUBLE) END, 0.90)              AS p90_blobs_size,
    approx_percentile(
      CASE WHEN blobs_size > 0
           THEN CAST(blobs_size AS DOUBLE) END, 0.99)              AS p99_blobs_size,

    approx_percentile(
      CASE WHEN gas_used > 0
           THEN CAST(fee_utia AS DOUBLE) / CAST(gas_used AS DOUBLE) END,
      0.10)                                                         AS p10_gas_price_utia,
    approx_percentile(
      CASE WHEN gas_used > 0
           THEN CAST(fee_utia AS DOUBLE) / CAST(gas_used AS DOUBLE) END,
      0.50)                                                         AS p50_gas_price_utia,
    approx_percentile(
      CASE WHEN gas_used > 0
           THEN CAST(fee_utia AS DOUBLE) / CAST(gas_used AS DOUBLE) END,
      0.90)                                                         AS p90_gas_price_utia

  FROM dune.prasad_chainscore.celestia_blocks
  GROUP BY 1
),

daily_prices AS (
  SELECT
    date_trunc('day', from_iso8601_timestamp(date)) AS day,
    avg(tia_usd)                                    AS avg_tia_usd
  FROM dune.prasad_chainscore.celestia_prices
  GROUP BY 1
),

base AS (
  SELECT
    b.day,

    CASE
      WHEN b.max_version_app >= 6 THEN 'Current (v6)'
      WHEN b.max_version_app >= 3 THEN 'Ginger (v3-5)'
      ELSE 'Lemongrass (v1-2)'
    END AS era,
    CASE
      WHEN b.max_version_app >= 6 THEN 8388608
      WHEN b.max_version_app >= 3 THEN 2097152
      ELSE 2097152
    END AS max_data_bytes,
    CASE
      WHEN b.max_version_app >= 3 THEN 6.0
      ELSE 12.0
    END AS era_block_time_s,

    b.block_count,
    b.blocks_with_blobs,
    b.total_blobs_count,
    b.total_txs,

    b.avg_block_time_ms,
    b.p10_block_time_ms,
    b.p50_block_time_ms,
    b.p90_block_time_ms,

    CAST(b.total_blobs_bytes AS DOUBLE) / 1048576.0    AS daily_blob_mib,
    CAST(b.total_bytes_in_block AS DOUBLE) / 1048576.0 AS daily_block_mib,

    (CAST(b.total_blobs_bytes AS DOUBLE) / 1048576.0)
      / NULLIF(CAST(b.block_count AS DOUBLE)
               * COALESCE(b.p50_block_time_ms, 6000) / 1000.0, 0)
      AS actual_mib_per_s,

    b.avg_fill_rate * 100.0 AS utilization_pct,

    b.p50_square_size,
    b.p90_square_size,
    b.max_square_size_seen,

    b.p50_blobs_size,
    b.p90_blobs_size,
    b.p99_blobs_size,

    b.total_fee_utia,
    b.total_gas_used,
    CAST(b.total_fee_utia AS DOUBLE)
      / NULLIF(CAST(b.total_gas_used AS DOUBLE), 0)
      AS avg_gas_price_utia,
    b.p10_gas_price_utia,
    b.p50_gas_price_utia,
    b.p90_gas_price_utia,

    pr.avg_tia_usd

  FROM daily_blocks b
  LEFT JOIN daily_prices pr ON b.day = pr.day
),

with_costs AS (
  SELECT
    base.*,

    (CAST(max_data_bytes AS DOUBLE) / 1048576.0) / era_block_time_s
      AS max_mib_per_s,

    (avg_gas_price_utia * 8.0 * 1048576.0 / 1e6)
      AS cost_per_mib_tia,
    (avg_gas_price_utia * 8.0 * 1048576.0 / 1e6) * COALESCE(avg_tia_usd, 0)
      AS cost_per_mib_usd,
    (avg_gas_price_utia * 8.0 * 1048576.0 / 1e6) * COALESCE(avg_tia_usd, 0) / 30.0
      AS cost_per_mib_day_usd,

    (p10_gas_price_utia * 8.0 * 1048576.0 / 1e6) * COALESCE(avg_tia_usd, 0)
      AS cost_per_mib_usd_p10,
    (p50_gas_price_utia * 8.0 * 1048576.0 / 1e6) * COALESCE(avg_tia_usd, 0)
      AS cost_per_mib_usd_p50,
    (p90_gas_price_utia * 8.0 * 1048576.0 / 1e6) * COALESCE(avg_tia_usd, 0)
      AS cost_per_mib_usd_p90,

    (CAST(total_fee_utia AS DOUBLE) / 1e6) * COALESCE(avg_tia_usd, 0)
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
  avg(daily_blob_mib)   OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
    AS daily_blob_mib_7d,
  avg(cost_per_mib_usd) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
    AS cost_per_mib_usd_7d,

  -- Cumulative
  sum(daily_blob_mib)    OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_blob_mib,
  sum(daily_da_spend_usd) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_da_spend_usd

FROM with_costs
ORDER BY day
