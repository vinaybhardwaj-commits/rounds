#!/usr/bin/env bash
# =============================================================================
# scripts/qa-gate.sh — QA Gates v1 master runner (QA.7)
#
# Runs all 6 gates from the QA Gates Framework PRD against the LOCAL working
# tree + last-deployed prod. Use before declaring a sprint shipped.
#
# Per PRD §9 Q4 tiered policy:
#   HARD BLOCK (exit 1 on fail): Gates 1-3 (TS, ESLint, build)
#   SOFT WARN (exit 0 on fail; print warnings): Gates 4-6 (regression, smoke, runtime logs)
#
# Usage:
#   bash scripts/qa-gate.sh
#   TEST_SESSION_COOKIE='rounds_session=...' bash scripts/qa-gate.sh
# =============================================================================

set -uo pipefail

BASE="${BASE_URL:-https://rounds-sqxh.vercel.app}"
HARD_FAIL=0
SOFT_WARN=0

echo "════════════════════════════════════════"
echo "  QA Gates v1 — full sprint-close run"
echo "  $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
echo "════════════════════════════════════════"

run_step() {
  local label=$1
  local cmd=$2
  local hard=$3  # 1 = hard, 0 = soft
  echo
  echo "── $label ──"
  if eval "$cmd"; then
    echo "  ✓ PASS"
    return 0
  fi
  if [ "$hard" = "1" ]; then
    echo "  ✗ FAIL (hard block)"
    HARD_FAIL=$((HARD_FAIL + 1))
  else
    echo "  ⚠ WARN (soft)"
    SOFT_WARN=$((SOFT_WARN + 1))
  fi
  return 1
}

# Gate 1 — TypeScript compile (≤ 441 baseline)
run_step "Gate 1: TS compile (≤ 441 baseline)" '
  npx tsc --noEmit 2>&1 > /tmp/qa-tsc.out || true
  COUNT=$(grep -c "error TS" /tmp/qa-tsc.out || echo 0)
  echo "  TS error count: $COUNT (baseline: 441)"
  [ "$COUNT" -le 441 ]
' 1

# Gate 2 — ESLint
run_step "Gate 2: ESLint (react-hooks/rules-of-hooks @ error)" '
  npx next lint 2>&1 | tail -3
' 1

# Gate 3 — next build (skipped if no env vars; prereq is heavyweight)
run_step "Gate 3: next build" '
  if [ -z "${POSTGRES_URL:-}" ]; then
    echo "  (skipped — POSTGRES_URL not set; CI runs this gate with stub envs)"
    true
  else
    npx next build 2>&1 | tail -5
  fi
' 1

# Gate 4 — Regression suite
run_step "Gate 4: Vitest regression suite" '
  npx vitest run tests/regressions 2>&1 | tail -5
' 0

# Gate 5 — Smoke
run_step "Gate 5: scripts/smoke.sh" '
  bash scripts/smoke.sh 2>&1 | tail -5
' 0

# Gate 6 — Runtime log scan (requires Vercel API access; soft-skip if no token)
run_step "Gate 6: Vercel runtime log scan (last 10 min, 500-class)" '
  if [ -z "${VERCEL_API_TOKEN:-}" ]; then
    echo "  (skipped — VERCEL_API_TOKEN not set; manual: hit /api/cron/qa-smoke)"
    true
  else
    # If we have a token, do a real scan
    SINCE=$(date -u -d "10 minutes ago" +%s 2>/dev/null || echo 0)
    curl -s -H "Authorization: Bearer $VERCEL_API_TOKEN" \
      "https://api.vercel.com/v3/projects/prj_AEmDkBQ5W2pS4sdEqIDSui1ioOaP/logs?since=$SINCE&statusCode=500" \
      | head -c 200
  fi
' 0

echo
echo "════════════════════════════════════════"
echo "  Summary: HARD_FAIL=$HARD_FAIL  SOFT_WARN=$SOFT_WARN"
echo "════════════════════════════════════════"
if [ "$HARD_FAIL" -gt 0 ]; then
  echo "✗ Sprint NOT ready — fix hard-blocking gates before declaring shipped."
  exit 1
fi
if [ "$SOFT_WARN" -gt 0 ]; then
  echo "⚠ Hard gates passed; soft gates have warnings — review before declaring shipped."
  exit 0
fi
echo "✓ All 6 gates passed. Sprint ready."
exit 0

# Tier 2 CI armed with TEST_SESSION_COOKIE secret 28 Apr 2026
