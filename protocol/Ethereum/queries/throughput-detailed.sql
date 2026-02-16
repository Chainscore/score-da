WITH
params AS (
  SELECT
    now() - interval '90' day AS start_time,
    now() AS end_time
),

-- Blob count per slot (each row in beacon.blobs is a blob sidecar)
blob_counts AS (
  SELECT
    b.block_slot AS slot,
    count(*) AS blob_count
  FROM beacon.blobs b
  JOIN params p
    ON b.block_time >= p.start_time
   AND b.block_time <  p.end_time
  GROUP BY 1
),

-- Base per-slot block info (slot time + execution payload fields)
slots AS (
  SELECT
    blk.slot,
    blk.time AS block_time,
    blk.execution_payload_block_number AS execution_block_number,
    blk.execution_payload_base_fee_per_gas AS base_fee_per_gas_wei
  FROM beacon.blocks blk
  JOIN params p
    ON blk.time >= p.start_time
   AND blk.time <  p.end_time
),

-- Build upgrade activation timestamps FROM CHAIN DATA
upgrade_points AS (
  SELECT
    TIMESTAMP '1970-01-01 00:00:00' AS activation_time,
    'pre-Dencun' AS upgrade,
    0 AS target_blobs,
    0 AS max_blobs

  UNION ALL
  SELECT
    min(time) AS activation_time,
    'Dencun (EIP-4844)' AS upgrade,
    3 AS target_blobs,
    6 AS max_blobs
  FROM beacon.blocks
  WHERE epoch = 269568

  UNION ALL
  SELECT
    min(time) AS activation_time,
    'Pectra (EIP-7691)' AS upgrade,
    6 AS target_blobs,
    9 AS max_blobs
  FROM beacon.blocks
  WHERE epoch = 364032

  UNION ALL
  SELECT
    time AS activation_time,
    'BPO1 (EIP-7892)' AS upgrade,
    10 AS target_blobs,
    15 AS max_blobs
  FROM beacon.blocks
  WHERE execution_payload_block_number = 23975796

  UNION ALL
  SELECT
    min(time) AS activation_time,
    'BPO2 (EIP-7892)' AS upgrade,
    14 AS target_blobs,
    21 AS max_blobs
  FROM beacon.blocks
  WHERE epoch = 419072
),

regimes AS (
  SELECT
    activation_time,
    lead(activation_time, 1, TIMESTAMP '2999-01-01 00:00:00')
      OVER (ORDER BY activation_time) AS next_activation_time,
    upgrade,
    target_blobs,
    max_blobs
  FROM upgrade_points
),

per_slot AS (
  SELECT
    s.block_time,
    s.execution_block_number,
    s.slot,

    coalesce(bc.blob_count, 0) AS blob_count,

    r.upgrade AS blob_capacity_era,
    r.activation_time AS era_start_time_utc,
    r.target_blobs,
    r.max_blobs,

    (s.base_fee_per_gas_wei / 1e9) AS base_fee_gwei,

    -- Throughput in MiB/s (force double precision)
    (CAST(coalesce(bc.blob_count, 0) AS DOUBLE) * 131072.0) / 1048576.0 / 12.0 AS actual_mib_per_s,
    (CAST(r.target_blobs AS DOUBLE) * 131072.0) / 1048576.0 / 12.0 AS expected_mib_per_s,
    (CAST(r.max_blobs AS DOUBLE) * 131072.0) / 1048576.0 / 12.0 AS max_mib_per_s,

    -- Optional: upgrade marker (first ~12s window after activation)
    CASE
      WHEN s.block_time >= r.activation_time
       AND s.block_time <  r.activation_time + interval '12' second
      THEN 1 ELSE 0
    END AS is_upgrade_marker,

    -- bytes per slot (for weighted averages)
    (coalesce(bc.blob_count, 0) * 131072.0) AS bytes_in_slot

  FROM slots s
  LEFT JOIN blob_counts bc
    ON s.slot = bc.slot
  JOIN regimes r
    ON s.block_time >= r.activation_time
   AND s.block_time <  r.next_activation_time
)

SELECT
  block_time,
  execution_block_number,
  slot,
  blob_count,
  blob_capacity_era,
  era_start_time_utc,
  target_blobs,
  max_blobs,
  base_fee_gwei,
  actual_mib_per_s,
  expected_mib_per_s,
  max_mib_per_s,
  is_upgrade_marker,
  bytes_in_slot,

  -- 1h rolling time-weighted average (MiB/s)
  (
    CAST(sum(bytes_in_slot) OVER (
      ORDER BY block_time
      RANGE BETWEEN INTERVAL '1' HOUR PRECEDING AND CURRENT ROW
    ) AS DOUBLE) / 1048576.0
  ) / 3600.0 AS actual_wavg_1h_mib_per_s

FROM per_slot
ORDER BY block_time;
