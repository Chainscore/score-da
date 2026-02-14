-- Ethereum DA Utilization - Daily Time Series for Visualization

WITH
params AS (
  SELECT
    now() - interval '90' day AS start_time,
    now() AS end_time
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

-- Daily aggregates
daily_stats AS (
  SELECT
    date_trunc('day', bb.time) AS day,
    r.era,
    r.target_blobs,
    r.max_blobs,

    count(*) AS total_blocks,

    -- Average blobs per block
    avg(coalesce(
      (SELECT count(*) FROM beacon.blobs b WHERE b.block_slot = bb.slot),
      0
    )) AS avg_blobs_per_block

  FROM beacon.blocks bb
  JOIN regimes r
    ON bb.time >= r.activation_time
    AND bb.time < r.next_activation_time
  CROSS JOIN params p
  WHERE bb.time >= p.start_time
    AND bb.time < p.end_time
  GROUP BY 1, 2, 3, 4
)

SELECT
  day AS time,
  era,

  -- Y-axis values for chart
  (avg_blobs_per_block / NULLIF(max_blobs, 0)) * 100 AS utilization_pct,
  (avg_blobs_per_block / NULLIF(target_blobs, 0)) * 100 AS target_utilization_pct,

  -- Reference lines for capacity (will show as stepped line)
  CAST(max_blobs AS DOUBLE) AS max_capacity_blobs,
  CAST(target_blobs AS DOUBLE) AS target_capacity_blobs,

  -- Additional context (optional, for tooltip)
  avg_blobs_per_block,
  total_blocks

FROM daily_stats
ORDER BY time;
