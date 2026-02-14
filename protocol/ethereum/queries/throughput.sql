-- Ethereum DA Throughput - MiB/s with Rolling Averages
-- Shows actual, max, and expected throughput across upgrade eras
-- Includes 24h, 30d, 90d rolling averages

WITH
params AS (
  SELECT
    now() - interval '90' day AS start_time,
    now() AS end_time,
    131072 AS blob_gas_per_blob,  -- 128 KB
    12.0 AS avg_block_time_sec
),

-- Upgrade eras with capacity
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

-- Block-level throughput calculation
block_throughput AS (
  SELECT
    bb.time,
    date_trunc('hour', bb.time) AS hour,
    r.era,
    r.target_blobs,
    r.max_blobs,
    p.blob_gas_per_blob,
    p.avg_block_time_sec,

    -- Count actual blobs in this block
    CAST(coalesce(
      (SELECT count(*) FROM beacon.blobs b WHERE b.block_slot = bb.slot),
      0
    ) AS DOUBLE) AS blobs_in_block,

    -- Convert to MB
    CAST(coalesce(
      (SELECT count(*) FROM beacon.blobs b WHERE b.block_slot = bb.slot),
      0
    ) AS DOUBLE) * p.blob_gas_per_blob / 1048576.0 AS mb_in_block

  FROM beacon.blocks bb
  JOIN regimes r
    ON bb.time >= r.activation_time
    AND bb.time < r.next_activation_time
  CROSS JOIN params p
  WHERE bb.time >= p.start_time
    AND bb.time < p.end_time
),

-- Hourly aggregates for time series
hourly_stats AS (
  SELECT
    hour AS time,
    era,
    target_blobs,
    max_blobs,
    blob_gas_per_blob,
    avg_block_time_sec,

    CAST(count(*) AS DOUBLE) AS blocks_in_hour,
    sum(blobs_in_block) AS total_blobs,
    sum(mb_in_block) AS total_mb,

    -- Actual throughput (MB/s)
    sum(mb_in_block) / (CAST(count(*) AS DOUBLE) * avg_block_time_sec) AS actual_mib_per_s,

    -- Average blobs per block in this hour
    avg(blobs_in_block) AS avg_blobs_per_block

  FROM block_throughput
  GROUP BY 1, 2, 3, 4, 5, 6
),

-- Calculate max and expected throughput based on capacity
throughput_with_capacity AS (
  SELECT
    time,
    era,

    -- Actual throughput
    actual_mib_per_s,

    -- Max theoretical throughput (max_blobs per block)
    (CAST(max_blobs AS DOUBLE) * blob_gas_per_blob / 1048576.0) / avg_block_time_sec AS max_mib_per_s,

    -- Expected/target throughput (target_blobs per block)
    (CAST(target_blobs AS DOUBLE) * blob_gas_per_blob / 1048576.0) / avg_block_time_sec AS expected_mib_per_s,

    -- Raw data for context
    avg_blobs_per_block,
    blocks_in_hour,
    max_blobs,
    target_blobs

  FROM hourly_stats
),

-- Rolling averages
throughput_with_averages AS (
  SELECT
    time,
    era,

    -- Instant values
    actual_mib_per_s,
    max_mib_per_s,
    expected_mib_per_s,

    -- 24-hour rolling average (24 hours)
    avg(actual_mib_per_s) OVER (
      ORDER BY time
      ROWS BETWEEN 23 PRECEDING AND CURRENT ROW
    ) AS actual_mib_per_s_24h,

    -- 30-day rolling average (30 * 24 = 720 hours)
    avg(actual_mib_per_s) OVER (
      ORDER BY time
      ROWS BETWEEN 719 PRECEDING AND CURRENT ROW
    ) AS actual_mib_per_s_30d,

    -- 90-day rolling average (90 * 24 = 2160 hours)
    avg(actual_mib_per_s) OVER (
      ORDER BY time
      ROWS BETWEEN 2159 PRECEDING AND CURRENT ROW
    ) AS actual_mib_per_s_90d,

    -- Context
    avg_blobs_per_block,
    blocks_in_hour,
    max_blobs,
    target_blobs

  FROM throughput_with_capacity
)

SELECT
  time,
  era,

  -- Instant throughput
  actual_mib_per_s AS actual_wavg_1h_mib_per_s,
  max_mib_per_s,
  expected_mib_per_s,

  -- Rolling averages
  actual_mib_per_s_24h AS actual_wavg_24h_mib_per_s,
  actual_mib_per_s_30d AS actual_wavg_30d_mib_per_s,
  actual_mib_per_s_90d AS actual_wavg_90d_mib_per_s,

  -- Context (for tooltips)
  avg_blobs_per_block,
  blocks_in_hour,
  max_blobs,
  target_blobs

FROM throughput_with_averages
ORDER BY time;
