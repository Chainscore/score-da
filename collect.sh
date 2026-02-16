#!/usr/bin/env bash
set -euo pipefail

PROTOCOL="${1:-}"
shift 2>/dev/null || true

ACTION="${1:-collect}"
# Only shift if the first remaining arg looks like an action keyword
case "$ACTION" in
  collect|transform|plot) shift 2>/dev/null || true ;;
  *)                      ACTION="collect" ;;   # not an action — treat as collector flag
esac

usage() {
  cat <<'EOF'
Usage: docker run da-research <protocol> [action] [options]

Protocols:
  celestia             Celenium API (Python collector)
  espresso             Explorer API (Python collector)
  avail                Public WSS RPCs (TypeScript collector)
  near                 NEAR Lake S3 + RPC (TypeScript collector)
  ethereum             Google BigQuery (TypeScript collector)
  polkadot-throughput  Relay chain RPCs (TypeScript collector)
  polkadot-cost        Coretime broker (TypeScript collector)
  polkadot             Transform/plot only (uses throughput + cost data)
  all                  Run action for all protocols in parallel

Actions:
  collect   (default)  Run the data collector [--days N] [--blocks N] ...
  transform            Run data/transform.py  (blocks/ + prices -> daily.csv + hourly.csv)
  plot                 Run analysis/plot.py    (daily.csv -> analysis/out/*.png)

Examples:
  docker run da-research celestia collect --days 1
  docker run da-research celestia --days 1            # collect is the default action
  docker run da-research celestia transform
  docker run da-research celestia plot
  docker run da-research near collect --blocks 5000
  docker run da-research all transform
  docker run da-research all plot
EOF
}

# ── Per-protocol directories ──────────────────────────────────────────────────

proto_dir() {
  case "$1" in
    celestia)            echo /app/protocol/celestia ;;
    espresso)            echo /app/protocol/espresso ;;
    avail)               echo /app/protocol/avail ;;
    near)                echo /app/protocol/near ;;
    ethereum)            echo /app/protocol/ethereum ;;
    polkadot-throughput) echo /app/protocol/polkadot ;;
    polkadot-cost)       echo /app/protocol/polkadot ;;
    polkadot)            echo /app/protocol/polkadot ;;
  esac
}

# ── Collect commands ──────────────────────────────────────────────────────────

collect_celestia()            { cd /app/protocol/celestia && python3 data/collect.py "$@"; }
collect_espresso()            { cd /app/protocol/espresso && python3 data/collect.py "$@"; }
collect_avail()               { cd /app/protocol/avail    && npx tsx data/collect.ts "$@"; }
collect_near()                { cd /app/protocol/near     && npx tsx data/collect.ts "$@"; }
collect_ethereum()            { cd /app/protocol/ethereum && npx tsx data/collect.ts "$@"; }
collect_polkadot_throughput() { cd /app/protocol/polkadot && npx tsx data/throughput/collect.ts "$@"; }
collect_polkadot_cost()       { cd /app/protocol/polkadot && npx tsx data/cost/collect.ts "$@"; }

# ── Transform commands (all Python, no extra args) ────────────────────────────

transform_proto() {
  local dir
  dir="$(proto_dir "$1")"
  cd "$dir" && python3 data/transform.py
}

# ── Plot commands (all Python, no extra args) ─────────────────────────────────

plot_proto() {
  local dir
  dir="$(proto_dir "$1")"
  cd "$dir" && python3 analysis/plot.py
}

# ── Dispatch a single protocol ────────────────────────────────────────────────

run_protocol() {
  local proto="$1"; shift
  local action="$1"; shift

  case "$action" in
    collect)
      case "$proto" in
        celestia)            collect_celestia "$@" ;;
        espresso)            collect_espresso "$@" ;;
        avail)               collect_avail "$@" ;;
        near)                collect_near "$@" ;;
        ethereum)            collect_ethereum "$@" ;;
        polkadot-throughput) collect_polkadot_throughput "$@" ;;
        polkadot-cost)       collect_polkadot_cost "$@" ;;
        polkadot)
          echo "Use polkadot-throughput or polkadot-cost for collection."
          exit 1
          ;;
      esac
      ;;
    transform) transform_proto "$proto" ;;
    plot)      plot_proto "$proto" ;;
    *)
      echo "Unknown action: $action"
      exit 1
      ;;
  esac
}

# ── Run all protocols ─────────────────────────────────────────────────────────

ALL_PROTOS="celestia espresso avail near ethereum polkadot"
ALL_COLLECTORS="celestia espresso avail near ethereum polkadot-throughput polkadot-cost"

run_all() {
  local action="$1"; shift
  local pids=()
  local names=()
  local logdir="/tmp/da-logs"
  mkdir -p "$logdir"

  local proto_list
  if [ "$action" = "collect" ]; then
    proto_list="$ALL_COLLECTORS"
  else
    proto_list="$ALL_PROTOS"
  fi

  echo "=== Running '$action' for all protocols in parallel ==="
  echo ""

  for proto in $proto_list; do
    if [ "$action" = "collect" ]; then
      # polkadot-cost has no --days/--blocks passthrough
      if [ "$proto" = "polkadot-cost" ]; then
        run_protocol "$proto" "$action" > >(tee "$logdir/$proto.log") 2>&1 &
      else
        run_protocol "$proto" "$action" "$@" > >(tee "$logdir/$proto.log") 2>&1 &
      fi
    else
      run_protocol "$proto" "$action" > >(tee "$logdir/$proto.log") 2>&1 &
    fi
    pids+=($!); names+=("$proto")
  done

  # Wait for all and collect results
  local failed=0
  local results=()

  for i in "${!pids[@]}"; do
    if wait "${pids[$i]}" 2>/dev/null; then
      results+=("  OK  ${names[$i]}")
    else
      results+=("  FAIL ${names[$i]} (exit $?)")
      failed=$((failed + 1))
    fi
  done

  echo ""
  echo "=== Summary ($action) ==="
  for r in "${results[@]}"; do
    echo "$r"
  done
  echo ""

  if [ "$failed" -gt 0 ]; then
    echo "$failed protocol(s) failed. Check logs in $logdir/"
    exit 1
  else
    echo "All protocols completed successfully."
  fi
}

# ── Main dispatch ─────────────────────────────────────────────────────────────

case "$PROTOCOL" in
  celestia|espresso|avail|near|ethereum|polkadot-throughput|polkadot-cost|polkadot)
    run_protocol "$PROTOCOL" "$ACTION" "$@"
    ;;
  all)
    run_all "$ACTION" "$@"
    ;;
  -h|--help|"")
    usage
    ;;
  *)
    echo "Unknown protocol: $PROTOCOL"
    echo ""
    usage
    exit 1
    ;;
esac
