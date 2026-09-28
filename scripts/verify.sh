#!/usr/bin/env bash
# From a clean state to proof, in one command: tear down, rebuild, wait for
# health, then run every check Localio has and print a summary. Exits 1 if
# anything failed. Runs in Linux, macOS and Git Bash on Windows.
set -uo pipefail
cd "$(dirname "$0")/.."

summary=()
failed=0

step() {
  local name=$1
  shift
  echo
  echo "== $name"
  local start=$SECONDS
  if "$@"; then
    summary+=("  ok    $(printf '%-34s' "$name") $((SECONDS - start))s")
  else
    summary+=("  FAIL  $(printf '%-34s' "$name") $((SECONDS - start))s")
    failed=1
  fi
}

pipeline_exited_cleanly() {
  docker compose logs data --no-log-prefix | tail -20
  test "$(docker compose ps --all --format '{{.ExitCode}}' data)" = "0"
}

step "clean start"                   docker compose down --volumes --remove-orphans
step "build, pipeline, health checks" docker compose up --build --detach --wait web
step "pipeline checks"               pipeline_exited_cleanly
step "pipeline unit tests"           docker compose run --rm data python -m pytest -q -p no:cacheprovider tests
step "browser tests: map, chat, visuals" docker compose --profile test run --rm --build e2e

echo
echo "localio verify"
printf '%s\n' "${summary[@]}"
[ "$failed" -eq 0 ] && echo "all checks passed" || echo "some checks failed"
exit "$failed"
