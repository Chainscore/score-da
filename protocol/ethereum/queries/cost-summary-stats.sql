-- Ethereum Blob Cost Analysis - Summary Statistics Only
-- Includes p50/p90/p95/p99/ES99, VWAP, time-at-floor by era
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
    11684671 AS denom_bpo2,

    -- Minimum blob base fee
    1 AS min_base_fee_wei
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
    date_trunc('hour', s.block_time) AS hour,
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

    -- Calculate blob base fee using exponential approximation
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
    p.bytes_per_blob,
    p.min_base_fee_wei

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
    hour,
    day,
    execution_block_number,
    slot,
    blob_count,
    blob_capacity_era,
    target_blobs,
    max_blobs,
    blob_gas_used,
    excess_blob_gas,
    denominator,
    blob_base_fee_wei,
    eth_usd_price,
    min_base_fee_wei,

    -- Cost calculations
    blob_base_fee_wei / 1e9 AS blob_base_fee_gwei,
    (blob_base_fee_wei * bytes_per_blob / 1e18) * coalesce(eth_usd_price, 0) AS cost_per_blob_usd,
    ((blob_base_fee_wei * bytes_per_blob / 1e18) * coalesce(eth_usd_price, 0)) / 0.125 AS cost_per_mb_usd,
    (((blob_base_fee_wei * bytes_per_blob / 1e18) * coalesce(eth_usd_price, 0)) / 0.125) / availability_days AS cost_per_mb_day_usd,
    blob_count * (blob_base_fee_wei * bytes_per_blob / 1e18) * coalesce(eth_usd_price, 0) AS total_blob_cost_usd,
    (blob_count * bytes_per_blob) / 1048576.0 AS data_mb,

    -- Time at floor indicator
    CASE WHEN blob_base_fee_wei <= 1.0 THEN 1 ELSE 0 END AS is_at_floor

  FROM per_block
),

-- Overall statistics
summary_stats_base AS (
  SELECT
    'Overall (90d)' AS period,
    count(*) AS total_blocks,
    sum(CASE WHEN blob_count > 0 THEN 1 ELSE 0 END) AS blocks_with_blobs,
    sum(blob_count) AS total_blobs,
    sum(data_mb) AS total_data_mb,

    -- Blob base fee percentiles (gwei)
    approx_percentile(blob_base_fee_gwei, 0.50) AS p50_blob_base_fee_gwei,
    approx_percentile(blob_base_fee_gwei, 0.90) AS p90_blob_base_fee_gwei,
    approx_percentile(blob_base_fee_gwei, 0.95) AS p95_blob_base_fee_gwei,
    approx_percentile(blob_base_fee_gwei, 0.99) AS p99_blob_base_fee_gwei,
    max(blob_base_fee_gwei) AS max_blob_base_fee_gwei,

    -- Cost per MB/day percentiles
    approx_percentile(cost_per_mb_day_usd, 0.50) AS p50_cost_per_mb_day_usd,
    approx_percentile(cost_per_mb_day_usd, 0.90) AS p90_cost_per_mb_day_usd,
    approx_percentile(cost_per_mb_day_usd, 0.95) AS p95_cost_per_mb_day_usd,
    approx_percentile(cost_per_mb_day_usd, 0.99) AS p99_cost_per_mb_day_usd,

    -- VWAP
    sum(blob_base_fee_gwei * blob_count) / NULLIF(sum(blob_count), 0) AS vwap_blob_base_fee_gwei,
    sum(cost_per_mb_day_usd * data_mb) / NULLIF(sum(data_mb), 0) AS vwap_cost_per_mb_day_usd,

    -- Time at floor
    100.0 * sum(is_at_floor) / NULLIF(count(*), 0) AS pct_time_at_floor,

    avg(eth_usd_price) AS avg_eth_usd_price

  FROM per_block_with_costs
),

summary_stats AS (
  SELECT
    s.*,
    -- ES99
    (SELECT avg(cost_per_mb_day_usd)
     FROM per_block_with_costs
     WHERE cost_per_mb_day_usd >= s.p99_cost_per_mb_day_usd) AS es99_cost_per_mb_day_usd
  FROM summary_stats_base s
),

-- Per-era statistics
era_stats_base AS (
  SELECT
    blob_capacity_era AS period,
    count(*) AS total_blocks,
    sum(CASE WHEN blob_count > 0 THEN 1 ELSE 0 END) AS blocks_with_blobs,
    sum(blob_count) AS total_blobs,
    sum(data_mb) AS total_data_mb,

    -- Blob base fee percentiles (gwei)
    approx_percentile(blob_base_fee_gwei, 0.50) AS p50_blob_base_fee_gwei,
    approx_percentile(blob_base_fee_gwei, 0.90) AS p90_blob_base_fee_gwei,
    approx_percentile(blob_base_fee_gwei, 0.95) AS p95_blob_base_fee_gwei,
    approx_percentile(blob_base_fee_gwei, 0.99) AS p99_blob_base_fee_gwei,
    max(blob_base_fee_gwei) AS max_blob_base_fee_gwei,

    -- Cost per MB/day percentiles
    approx_percentile(cost_per_mb_day_usd, 0.50) AS p50_cost_per_mb_day_usd,
    approx_percentile(cost_per_mb_day_usd, 0.90) AS p90_cost_per_mb_day_usd,
    approx_percentile(cost_per_mb_day_usd, 0.95) AS p95_cost_per_mb_day_usd,
    approx_percentile(cost_per_mb_day_usd, 0.99) AS p99_cost_per_mb_day_usd,

    -- VWAP
    sum(blob_base_fee_gwei * blob_count) / NULLIF(sum(blob_count), 0) AS vwap_blob_base_fee_gwei,
    sum(cost_per_mb_day_usd * data_mb) / NULLIF(sum(data_mb), 0) AS vwap_cost_per_mb_day_usd,

    -- Time at floor
    100.0 * sum(is_at_floor) / NULLIF(count(*), 0) AS pct_time_at_floor,

    avg(eth_usd_price) AS avg_eth_usd_price

  FROM per_block_with_costs
  GROUP BY 1
),

era_stats AS (
  SELECT
    e.*,
    -- ES99
    (SELECT avg(cost_per_mb_day_usd)
     FROM per_block_with_costs
     WHERE cost_per_mb_day_usd >= e.p99_cost_per_mb_day_usd
       AND blob_capacity_era = e.period) AS es99_cost_per_mb_day_usd
  FROM era_stats_base e
)

-- Output: Summary stats only (no sparse columns)
SELECT * FROM summary_stats
UNION ALL
SELECT * FROM era_stats
ORDER BY
  CASE period
    WHEN 'Overall (90d)' THEN 0
    WHEN 'Pectra' THEN 1
    WHEN 'BPO1' THEN 2
    WHEN 'BPO2' THEN 3
    ELSE 4
  END;
