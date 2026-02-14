-- Celestia DA: Hourly Analysis Dashboard
-- Single query producing all columns for dashboard charts:
--   1. Throughput (MiB/s)       → actual_mib_per_s, max_mib_per_s, actual_mib_per_s_24h
--   2. Utilization (%)          → utilization_pct, utilization_pct_24h
--   3. Hourly Payload (MiB)     → hourly_blob_mib, hourly_blob_mib_24h
--   4. Cost per MiB (USD)       → cost_per_mib_usd, cost_per_mib_usd_24h
--   5. Cost Quantile Bands      → cost_per_mib_usd_p10/p50/p90
--   6. Block Time Band (ms)     → p10/p50/p90_block_time_ms
--   7. Square Size (optional)   → p50/p90_square_size, max_square_size_seen
--
-- Tables: dune.prasad_chainscore.celestia_blocks
--         dune.prasad_chainscore.celestia_prices
--
-- Key differences from Espresso:
--   - Dynamic fee market (gas-based) → cost bands show real gas-price variance
--   - Upgrade eras (Lemongrass/Ginger/Current) detected via version_app
--   - Native token is TIA not ETH; GasPerBlobByte = 8
--   - blobs_size/blobs_count/square_size/fill_rate available per block
--   - DA retention ~30 days (vs Espresso 7d, Ethereum 18d)

WITH
hourly_blocks AS (
  SELECT
    date_trunc('hour', from_unixtime(CAST(timestamp_ms AS DOUBLE) / 1000.0)) AS hour,

    -- Era detection: majority app version for the hour
    max(version_app)                                                AS max_version_app,

    -- Block counts
    count(*)                                                        AS block_count,
    sum(CASE WHEN blobs_count > 0 THEN 1 ELSE 0 END)               AS blocks_with_blobs,

    -- Payload
    sum(blobs_size)                                                 AS total_blobs_bytes,
    sum(blobs_count)                                                AS total_blobs_count,
    sum(bytes_in_block)                                             AS total_bytes_in_block,
    sum(tx_count)                                                   AS total_txs,

    -- Fees and gas
    sum(fee_utia)                                                   AS total_fee_utia,
    sum(gas_used)                                                   AS total_gas_used,
    sum(gas_limit)                                                  AS total_gas_limit,

    -- Fill rate (pre-computed utilization per block)
    avg(fill_rate)                                                  AS avg_fill_rate,

    -- Block time percentiles (exclude zero deltas)
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

    -- Square size distribution
    approx_percentile(CAST(square_size AS DOUBLE), 0.50)            AS p50_square_size,
    approx_percentile(CAST(square_size AS DOUBLE), 0.90)            AS p90_square_size,
    max(square_size)                                                AS max_square_size_seen,

    -- Per-block blob size percentiles (blocks with blobs only)
    approx_percentile(
      CASE WHEN blobs_size > 0
           THEN CAST(blobs_size AS DOUBLE) END, 0.50)              AS p50_blobs_size,
    approx_percentile(
      CASE WHEN blobs_size > 0
           THEN CAST(blobs_size AS DOUBLE) END, 0.90)              AS p90_blobs_size,
    approx_percentile(
      CASE WHEN blobs_size > 0
           THEN CAST(blobs_size AS DOUBLE) END, 0.99)              AS p99_blobs_size,

    -- Gas price percentiles (utia/gas, for cost bands)
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

hourly_prices AS (
  SELECT
    date_trunc('hour', from_iso8601_timestamp(date)) AS hour,
    avg(tia_usd)                                     AS avg_tia_usd
  FROM dune.prasad_chainscore.celestia_prices
  GROUP BY 1
),

-- Join blocks + prices, detect era, compute all hourly metrics
base AS (
  SELECT
    b.hour,

    -- === Era ===
    CASE
      WHEN b.max_version_app >= 6 THEN 'Current (v6)'
      WHEN b.max_version_app >= 3 THEN 'Ginger (v3-5)'
      ELSE 'Lemongrass (v1-2)'
    END AS era,
    CASE
      WHEN b.max_version_app >= 6 THEN 8388608    -- 8 MiB
      WHEN b.max_version_app >= 3 THEN 2097152    -- 2 MiB
      ELSE 2097152
    END AS max_data_bytes,
    CASE
      WHEN b.max_version_app >= 3 THEN 6.0
      ELSE 12.0
    END AS era_block_time_s,

    -- === Block stats ===
    b.block_count,
    b.blocks_with_blobs,
    b.total_blobs_count,
    b.total_txs,

    -- === Block time band (Chart 6) ===
    b.avg_block_time_ms,
    b.p10_block_time_ms,
    b.p50_block_time_ms,
    b.p90_block_time_ms,

    -- === Payload (Chart 3) ===
    CAST(b.total_blobs_bytes AS DOUBLE) / 1048576.0    AS hourly_blob_mib,
    CAST(b.total_bytes_in_block AS DOUBLE) / 1048576.0 AS hourly_block_mib,

    -- === Throughput (Chart 1) ===
    (CAST(b.total_blobs_bytes AS DOUBLE) / 1048576.0)
      / NULLIF(CAST(b.block_count AS DOUBLE)
               * COALESCE(b.p50_block_time_ms, 6000) / 1000.0, 0)
      AS actual_mib_per_s,

    -- === Utilization (Chart 2) ===
    b.avg_fill_rate * 100.0 AS utilization_pct,

    -- === Square size (Chart 7) ===
    b.p50_square_size,
    b.p90_square_size,
    b.max_square_size_seen,

    -- === Blob size percentiles ===
    b.p50_blobs_size,
    b.p90_blobs_size,
    b.p99_blobs_size,

    -- === Fee / gas raw ===
    b.total_fee_utia,
    b.total_gas_used,
    CAST(b.total_fee_utia AS DOUBLE)
      / NULLIF(CAST(b.total_gas_used AS DOUBLE), 0)
      AS avg_gas_price_utia,
    b.p10_gas_price_utia,
    b.p50_gas_price_utia,
    b.p90_gas_price_utia,

    -- === Price ===
    pr.avg_tia_usd

  FROM hourly_blocks b
  LEFT JOIN hourly_prices pr ON b.hour = pr.hour
),

-- Add cost columns
with_costs AS (
  SELECT
    base.*,

    -- Protocol max throughput for this era (Chart 1 reference line)
    (CAST(max_data_bytes AS DOUBLE) / 1048576.0) / era_block_time_s
      AS max_mib_per_s,

    -- === Cost per MiB (Chart 4) ===
    -- avg_gas_price × GasPerBlobByte(8) × 2^20 / 1e6(utia→TIA)
    (avg_gas_price_utia * 8.0 * 1048576.0 / 1e6)
      AS cost_per_mib_tia,
    (avg_gas_price_utia * 8.0 * 1048576.0 / 1e6) * COALESCE(avg_tia_usd, 0)
      AS cost_per_mib_usd,
    -- Amortized over 30-day DA retention window
    (avg_gas_price_utia * 8.0 * 1048576.0 / 1e6) * COALESCE(avg_tia_usd, 0) / 30.0
      AS cost_per_mib_day_usd,

    -- === Cost quantile bands (Chart 5) ===
    -- Gas price variance × avg TIA/USD (isolates fee-market dynamics)
    (p10_gas_price_utia * 8.0 * 1048576.0 / 1e6) * COALESCE(avg_tia_usd, 0)
      AS cost_per_mib_usd_p10,
    (p50_gas_price_utia * 8.0 * 1048576.0 / 1e6) * COALESCE(avg_tia_usd, 0)
      AS cost_per_mib_usd_p50,
    (p90_gas_price_utia * 8.0 * 1048576.0 / 1e6) * COALESCE(avg_tia_usd, 0)
      AS cost_per_mib_usd_p90,

    -- === Hourly DA spend (all fees in USD) ===
    (CAST(total_fee_utia AS DOUBLE) / 1e6) * COALESCE(avg_tia_usd, 0)
      AS hourly_da_spend_usd

  FROM base
)

SELECT
  with_costs.*,

  -- === 24-hour (1-day) rolling averages ===
  avg(actual_mib_per_s) OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS actual_mib_per_s_24h,
  avg(utilization_pct)  OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS utilization_pct_24h,
  avg(hourly_blob_mib)  OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS hourly_blob_mib_24h,
  avg(cost_per_mib_usd) OVER (ORDER BY hour ROWS BETWEEN 23 PRECEDING AND CURRENT ROW)
    AS cost_per_mib_usd_24h,

  -- === Cumulative totals ===
  sum(hourly_blob_mib)    OVER (ORDER BY hour ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_blob_mib,
  sum(hourly_da_spend_usd) OVER (ORDER BY hour ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    AS cumulative_da_spend_usd

FROM with_costs
ORDER BY hour
