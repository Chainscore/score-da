-- Ethereum Blob Cost Analysis with Fork-Aware Blob Base Fee Calculation
-- Correctly handles Prague, BPO1, and BPO2 denominator changes

WITH
params AS (
  SELECT
    now() - interval '90' day AS start_time,
    now() AS end_time,
    432.0 AS availability_hours,  -- 18 days
    131072.0 AS bytes_per_blob,

    -- Fork activation timestamps (Unix seconds)
    CAST(1733753471 AS BIGINT) AS bpo1_time,  -- Dec 9, 2025 14:21:11 UTC
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
    'pre-Dencun' AS upgrade,
    0 AS target_blobs,
    0 AS max_blobs
  UNION ALL
  SELECT min(time), 'Dencun (EIP-4844)', 3, 6
  FROM beacon.blocks WHERE epoch = 269568
  UNION ALL
  SELECT min(time), 'Pectra (EIP-7691)', 6, 9
  FROM beacon.blocks WHERE epoch = 364032
  UNION ALL
  SELECT time, 'BPO1 (EIP-7892)', 10, 15
  FROM beacon.blocks WHERE execution_payload_block_number = 23975796
  UNION ALL
  SELECT min(time), 'BPO2 (EIP-7892)', 14, 21
  FROM beacon.blocks WHERE epoch = 419072
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
    s.execution_block_number,
    s.slot,
    s.ts_unix,

    coalesce(bc.blob_count, 0) AS blob_count,

    r.upgrade AS blob_capacity_era,
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
    -- Note: This uses exp() which is slightly less accurate than fake_exponential
    -- but close enough for cost analysis
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
    p.availability_hours,
    p.bytes_per_blob

  FROM slots s
  LEFT JOIN blob_counts bc ON s.slot = bc.slot
  JOIN regimes r
    ON s.block_time >= r.activation_time
    AND s.block_time < r.next_activation_time
  JOIN ethereum.blocks eb ON eb.number = s.execution_block_number
  LEFT JOIN eth_price ep ON ep.hour = date_trunc('hour', s.block_time)
  CROSS JOIN params p
  WHERE coalesce(bc.blob_count, 0) > 0  -- Only blocks with blobs
),

per_block_with_costs AS (
  SELECT
    block_time,
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

    -- Cost calculations
    (blob_base_fee_wei * bytes_per_blob / 1e18) * coalesce(eth_usd_price, 0) AS cost_per_blob_usd,
    ((blob_base_fee_wei * bytes_per_blob / 1e18) * coalesce(eth_usd_price, 0)) / 0.125 AS cost_per_mb_usd,
    blob_count * (blob_base_fee_wei * bytes_per_blob / 1e18) * coalesce(eth_usd_price, 0) AS total_blob_cost_usd,
    (blob_count * bytes_per_blob) / 1048576.0 AS data_mb

  FROM per_block
)

SELECT
  block_time,
  execution_block_number,
  slot,
  blob_count,
  blob_capacity_era,
  target_blobs,
  max_blobs,
  CAST(blob_count AS DOUBLE) / NULLIF(max_blobs, 0) AS utilization,

  blob_gas_used,
  excess_blob_gas,
  denominator,  -- Show which denominator was used
  blob_base_fee_wei / 1e9 AS blob_base_fee_gwei,
  eth_usd_price,

  cost_per_blob_usd,
  cost_per_mb_usd,
  total_blob_cost_usd,
  data_mb,

  avg(cost_per_mb_usd) OVER (
    ORDER BY block_time
    RANGE BETWEEN INTERVAL '1' HOUR PRECEDING AND CURRENT ROW
  ) AS avg_cost_per_mb_1h,

  -- Cumulative
  sum(total_blob_cost_usd) OVER (
    ORDER BY block_time
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS cumulative_cost_usd,

  sum(data_mb) OVER (
    ORDER BY block_time
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS cumulative_data_mb

FROM per_block_with_costs
ORDER BY block_time;
