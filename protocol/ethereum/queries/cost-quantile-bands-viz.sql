-- Ethereum Blob Cost - Rolling Quantile Bands Time Series
-- Fork-aware with correct denominator handling

WITH
params AS (
  SELECT
    now() - interval '90' day AS start_time,
    now() AS end_time,
    18.0 AS availability_days,  -- 18 days = 432 hours
    131072.0 AS bytes_per_blob,

    -- Fork activation timestamps (Unix seconds)
    CAST(1765290071 AS BIGINT) AS bpo1_time,  -- Dec 9, 2025 14:21:11 UTC
    CAST(1767747671 AS BIGINT) AS bpo2_time,  -- Jan 7, 2026 01:01:11 UTC

    -- Fork-specific denominators
    5007716 AS denom_prague,
    8346193 AS denom_bpo1,
    11684671 AS denom_bpo2
),

-- Blob count per slot
blob_counts AS (
  SELECT
    b.block_slot AS slot,
    count(*) AS blob_count
  FROM beacon.blobs b
  CROSS JOIN params p
  WHERE b.block_time >= p.start_time
    AND b.block_time < p.end_time
  GROUP BY 1
),

-- ETH price (hourly)
eth_price AS (
  SELECT
    date_trunc('hour', minute) AS hour,
    avg(price) AS eth_usd_price
  FROM prices.usd
  CROSS JOIN params p
  WHERE blockchain = 'ethereum'
    AND contract_address = 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
    AND minute >= p.start_time
  GROUP BY 1
),

-- Upgrade eras
upgrade_points AS (
  SELECT
    TIMESTAMP '1970-01-01 00:00:00' AS activation_time,
    'pre-Dencun' AS era,
    0 AS target_blobs,
    0 AS max_blobs
  UNION ALL
  SELECT min(time), 'Dencun', 3, 6
  FROM beacon.blocks WHERE epoch = 269568
  UNION ALL
  SELECT min(time), 'Pectra', 6, 9
  FROM beacon.blocks WHERE epoch = 364032
  UNION ALL
  SELECT time, 'BPO1', 10, 15
  FROM beacon.blocks WHERE execution_payload_block_number = 23975796
  UNION ALL
  SELECT min(time), 'BPO2', 14, 21
  FROM beacon.blocks WHERE epoch = 419072
),

regimes AS (
  SELECT
    activation_time,
    lead(activation_time, 1, TIMESTAMP '2999-01-01 00:00:00')
      OVER (ORDER BY activation_time) AS next_activation_time,
    era,
    target_blobs,
    max_blobs
  FROM upgrade_points
),

-- Base per-slot data
slots AS (
  SELECT
    blk.slot,
    blk.time AS block_time,
    blk.execution_payload_block_number AS execution_block_number,
    to_unixtime(blk.time) AS ts_unix
  FROM beacon.blocks blk
  CROSS JOIN params p
  WHERE blk.time >= p.start_time
    AND blk.time < p.end_time
),

per_block AS (
  SELECT
    s.block_time,
    date_trunc('day', s.block_time) AS day,
    s.execution_block_number,
    s.slot,
    s.ts_unix,

    coalesce(bc.blob_count, 0) AS blob_count,

    r.era AS blob_capacity_era,
    r.target_blobs,
    r.max_blobs,

    eb.blob_gas_used,
    eb.excess_blob_gas,

    -- Fork-aware denominator selection
    CASE
      WHEN s.ts_unix >= p.bpo2_time THEN p.denom_bpo2
      WHEN s.ts_unix >= p.bpo1_time THEN p.denom_bpo1
      ELSE p.denom_prague
    END AS denominator,

    -- Calculate blob base fee
    CASE
      WHEN coalesce(eb.excess_blob_gas, 0) = 0 THEN CAST(1 AS DOUBLE)
      ELSE exp(
        CAST(eb.excess_blob_gas AS DOUBLE) /
        CASE
          WHEN s.ts_unix >= p.bpo2_time THEN CAST(p.denom_bpo2 AS DOUBLE)
          WHEN s.ts_unix >= p.bpo1_time THEN CAST(p.denom_bpo1 AS DOUBLE)
          ELSE CAST(p.denom_prague AS DOUBLE)
        END
      )
    END AS blob_base_fee_wei,

    ep.eth_usd_price,
    p.availability_days,
    p.bytes_per_blob

  FROM slots s
  LEFT JOIN blob_counts bc ON s.slot = bc.slot
  JOIN regimes r
    ON s.block_time >= r.activation_time
    AND s.block_time < r.next_activation_time
  JOIN ethereum.blocks eb ON eb.number = s.execution_block_number
  LEFT JOIN eth_price ep ON ep.hour = date_trunc('hour', s.block_time)
  CROSS JOIN params p
),

per_block_with_costs AS (
  SELECT
    block_time,
    day,
    execution_block_number,
    slot,
    blob_count,
    blob_capacity_era,
    target_blobs,
    max_blobs,
    blob_base_fee_wei,
    eth_usd_price,

    -- Cost metrics
    blob_base_fee_wei / 1e9 AS blob_base_fee_gwei,
    (((blob_base_fee_wei * bytes_per_blob / 1e18) * coalesce(eth_usd_price, 0)) / 0.125) / availability_days AS cost_per_mb_day_usd,

    -- Time at floor
    CASE WHEN blob_base_fee_wei <= 1.0 THEN 1 ELSE 0 END AS is_at_floor

  FROM per_block
),

-- Daily statistics
daily_stats AS (
  SELECT
    day AS time,
    blob_capacity_era AS era,
    max_blobs,

    count(*) AS blocks_in_day,
    sum(blob_count) AS total_blobs,

    -- Quantile bands for blob base fee (gwei)
    approx_percentile(blob_base_fee_gwei, 0.10) AS p10_blob_base_fee_gwei,
    approx_percentile(blob_base_fee_gwei, 0.50) AS p50_blob_base_fee_gwei,
    approx_percentile(blob_base_fee_gwei, 0.90) AS p90_blob_base_fee_gwei,

    -- Quantile bands for cost per MB/hour (USD)
    approx_percentile(cost_per_mb_day_usd, 0.10) AS p10_cost_per_mb_day_usd,
    approx_percentile(cost_per_mb_day_usd, 0.50) AS p50_cost_per_mb_day_usd,
    approx_percentile(cost_per_mb_day_usd, 0.90) AS p90_cost_per_mb_day_usd,

    -- VWAP (volume-weighted by blob count)
    sum(blob_base_fee_gwei * blob_count) / NULLIF(sum(blob_count), 0) AS vwap_blob_base_fee_gwei,
    sum(cost_per_mb_day_usd * blob_count) / NULLIF(sum(blob_count), 0) AS vwap_cost_per_mb_day_usd,

    -- Time at floor
    100.0 * sum(is_at_floor) / NULLIF(count(*), 0) AS pct_time_at_floor,

    avg(eth_usd_price) AS avg_eth_usd_price

  FROM per_block_with_costs
  GROUP BY 1, 2, 3
)

-- Output: Time series with quantile bands
SELECT
  time,
  era,
  max_blobs,
  blocks_in_day,
  total_blobs,

  -- Blob base fee quantile bands (gwei) - for visualization
  p10_blob_base_fee_gwei,
  p50_blob_base_fee_gwei,
  p90_blob_base_fee_gwei,
  vwap_blob_base_fee_gwei,

  -- Cost per MB/hour quantile bands (USD) - for visualization
  p10_cost_per_mb_day_usd,
  p50_cost_per_mb_day_usd,
  p90_cost_per_mb_day_usd,
  vwap_cost_per_mb_day_usd,

  -- Time at floor metric
  pct_time_at_floor,

  -- Context
  avg_eth_usd_price

FROM daily_stats
ORDER BY time;
