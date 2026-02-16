#!/usr/bin/env bash
set -euo pipefail

PROTOCOL="${1:-}"
shift 2>/dev/null || true

usage() {
  cat <<'EOF'
Usage: docker run da-research <protocol> [options]

Protocols:
  celestia             python3 data/collect.py [--days N] [--blocks N]
  espresso             python3 data/collect.py [--days N] [--blocks N]
  avail                npx tsx data/collect.ts [--days N] [--blocks N]
  near                 npx tsx data/collect.ts [--days N] [--blocks N]
  ethereum             npx tsx data/collect.ts [--days N] [--start-date YYYY-MM-DD]
  polkadot-throughput  npx tsx data/throughput/collect.ts [--days N] [--blocks N]
  polkadot-cost        npx tsx data/cost/collect.ts [--ondemand-blocks N]
  all                  Run all collectors in parallel (pass --days/--blocks through)

Examples:
  docker run da-research celestia --days 1
  docker run da-research near --blocks 5000
  docker run -e AWS_ACCESS_KEY_ID=x -e AWS_SECRET_ACCESS_KEY=y da-research near --days 2
  docker run -e GOOGLE_APPLICATION_CREDENTIALS=/creds/key.json \
    -v ./key.json:/creds/key.json da-research ethereum --days 1
  docker run da-research all --days 1
EOF
}

run_celestia()            { cd /app/protocol/celestia   && python3 data/collect.py "$@"; }
run_espresso()            { cd /app/protocol/espresso   && python3 data/collect.py "$@"; }
run_avail()               { cd /app/protocol/avail      && npx tsx data/collect.ts "$@"; }
run_near()                { cd /app/protocol/near       && npx tsx data/collect.ts "$@"; }
run_ethereum()            { cd /app/protocol/ethereum   && npx tsx data/collect.ts "$@"; }
run_polkadot_throughput() { cd /app/protocol/polkadot   && npx tsx data/throughput/collect.ts "$@"; }
run_polkadot_cost()       { cd /app/protocol/polkadot   && npx tsx data/cost/collect.ts "$@"; }

run_all() {
  local pids=()
  local names=()
  local logdir="/tmp/collect-logs"
  mkdir -p "$logdir"

  echo "=== Running all collectors in parallel ==="
  echo ""

  # Celestia
  run_celestia "$@" > >(tee "$logdir/celestia.log") 2>&1 &
  pids+=($!); names+=("celestia")

  # Espresso
  run_espresso "$@" > >(tee "$logdir/espresso.log") 2>&1 &
  pids+=($!); names+=("espresso")

  # Avail
  run_avail "$@" > >(tee "$logdir/avail.log") 2>&1 &
  pids+=($!); names+=("avail")

  # NEAR
  run_near "$@" > >(tee "$logdir/near.log") 2>&1 &
  pids+=($!); names+=("near")

  # Ethereum (uses --days but not --blocks; pass args through, collector ignores unknown)
  run_ethereum "$@" > >(tee "$logdir/ethereum.log") 2>&1 &
  pids+=($!); names+=("ethereum")

  # Polkadot throughput
  run_polkadot_throughput "$@" > >(tee "$logdir/polkadot-throughput.log") 2>&1 &
  pids+=($!); names+=("polkadot-throughput")

  # Polkadot cost (no --days/--blocks args)
  run_polkadot_cost > >(tee "$logdir/polkadot-cost.log") 2>&1 &
  pids+=($!); names+=("polkadot-cost")

  # Wait for all and collect results
  local failed=0
  local results=()

  for i in "${!pids[@]}"; do
    if wait "${pids[$i]}" 2>/dev/null; then
      results+=("  ✓ ${names[$i]}")
    else
      results+=("  ✗ ${names[$i]} (exit $?)")
      failed=$((failed + 1))
    fi
  done

  echo ""
  echo "=== Collection Summary ==="
  for r in "${results[@]}"; do
    echo "$r"
  done
  echo ""

  if [ "$failed" -gt 0 ]; then
    echo "$failed collector(s) failed. Check logs in $logdir/"
    exit 1
  else
    echo "All collectors completed successfully."
  fi
}

case "$PROTOCOL" in
  celestia)            run_celestia "$@" ;;
  espresso)            run_espresso "$@" ;;
  avail)               run_avail "$@" ;;
  near)                run_near "$@" ;;
  ethereum)            run_ethereum "$@" ;;
  polkadot-throughput) run_polkadot_throughput "$@" ;;
  polkadot-cost)       run_polkadot_cost "$@" ;;
  all)                 run_all "$@" ;;
  -h|--help|"")        usage ;;
  *)
    echo "Unknown protocol: $PROTOCOL"
    echo ""
    usage
    exit 1
    ;;
esac
