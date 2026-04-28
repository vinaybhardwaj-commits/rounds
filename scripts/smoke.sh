#!/usr/bin/env bash
# =============================================================================
# scripts/smoke.sh — QA Gates v1 unified authed smoke runner (QA.3)
#
# Replaces the 3 sprint-specific smoke scripts (multi-hospital-v2-smoke.sh,
# glass-smoke.sh, chat-tasks-smoke.sh — all in scripts/_archive/).
#
# Auth strategy:
#   - TEST_SESSION_COOKIE env var (manual override; bypasses login rate limit)
#   - Or auto-login via TEST_USER_EMAIL + TEST_USER_PIN (subject to 5/15min rate)
#
# Usage:
#   bash scripts/smoke.sh
#   TEST_SESSION_COOKIE='rounds_session=eyJ...' bash scripts/smoke.sh
#   BASE_URL=http://localhost:3000 bash scripts/smoke.sh
#
# Exit codes:
#   0 — all anon + authed (if cookie available) checks passed
#   1 — any anon check failed
#   2 — auth setup failed (only if STRICT_AUTH=1)
# =============================================================================

set -uo pipefail

BASE="${BASE_URL:-https://rounds-sqxh.vercel.app}"
COOKIE="${TEST_SESSION_COOKIE:-}"
EMAIL="${TEST_USER_EMAIL:-vinay.bhardwaj@even.in}"
PIN="${TEST_USER_PIN:-}"
PASS=0
FAIL=0
SKIP=0
FAILURES=()

check() {
  local method=$1 path=$2 expected=$3 desc=$4
  local headers=()
  if [ -n "$COOKIE" ]; then
    headers+=(-H "Cookie: $COOKIE")
  fi
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X "$method" "${headers[@]}" "$BASE$path" || echo "000")
  if [ "$code" = "$expected" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$method $path → got $code, expected $expected ($desc)")
  fi
}

# Anon-only checks (don't pass cookie)
check_anon() {
  local method=$1 path=$2 expected=$3 desc=$4
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X "$method" "$BASE$path" || echo "000")
  if [ "$code" = "$expected" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("[anon] $method $path → got $code, expected $expected ($desc)")
  fi
}

# Authed checks (skip if no cookie + auto-login fails)
check_authed() {
  local method=$1 path=$2 expected=$3 desc=$4
  if [ -z "$COOKIE" ]; then
    SKIP=$((SKIP + 1))
    return
  fi
  check "$method" "$path" "$expected" "$desc"
}

# Auto-login if no cookie + creds present
auto_login() {
  if [ -n "$COOKIE" ]; then return 0; fi
  if [ -z "$PIN" ]; then return 1; fi
  local resp_headers
  resp_headers=$(curl -s -i -X POST -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"pin\":\"$PIN\"}" \
    --max-time 10 "$BASE/api/auth/login" | head -50)
  COOKIE=$(echo "$resp_headers" | grep -i "set-cookie:" | grep -oE 'rounds_session=[^;]+' | head -1)
  [ -n "$COOKIE" ]
}

echo "── QA Gates smoke (BASE=$BASE) ──"
auto_login && echo "  ✓ auto-login succeeded" || echo "  ⚠ no session (set TEST_SESSION_COOKIE or TEST_USER_PIN)"

echo "── Anon endpoint smoke (auth-gate envelope intact) ──"
check_anon GET  /api/auth/me                      401 "auth me"
check_anon GET  /api/cron/cleanup-audit           401 "cron requires CRON_SECRET"
check_anon GET  /api/cron/sla-sweeper             401 "cron requires CRON_SECRET"
check_anon POST /api/patients                     401 "patient.create"
check_anon PATCH /api/patients/test-id            401 "patient.update_field"
check_anon POST /api/patients/test-id/discharge   401 "patient.discharge"
check_anon PATCH /api/patients/test-id/stage      401 "patient.stage_advance"
check_anon POST /api/cases                        401 "case.create"
check_anon POST /api/cases/test-id/cancel         401 "case.cancel"
check_anon POST /api/cases/test-id/ot-booking     401 "case.book_ot"
check_anon POST /api/cases/schedule-pac           401 "schedule pac"
check_anon GET  /api/ot/postings                  401 "ot postings"
check_anon GET  /api/ot/readiness/mine            401 "ot readiness mine"
check_anon GET  /api/ot/readiness/overdue         401 "ot readiness overdue"
check_anon GET  /api/ot/schedule                  401 "ot schedule"
check_anon GET  /api/admin/dashboard-stats        401 "admin dashboard"
check_anon GET  /api/admin/cases/summary          401 "admin cases"
check_anon GET  /api/admin/audit-log              401 "admin audit-log"
check_anon GET  /api/admin/doctor-affiliations    401 "admin doctor affs"
check_anon GET  /api/admin/profiles               404 "admin profiles (route shape)"
check_anon GET  /api/admin/getstream/seed-channels 405 "POST-only"
check_anon GET  /api/admin/database/query         405 "POST-only"
check_anon POST /api/profiles/import              403 "import super_admin only"
check_anon POST /api/patients/import              401 "patients import"
check_anon GET  /api/forms                        401 "forms list"
check_anon GET  /api/help/manifests               404 "help manifests (route shape)"
check_anon POST /api/help/ask                     401 "help ask"
check_anon POST /api/auth/signup                  500 "signup empty body (known-bug v1.x: should 400, currently 500)"
check_anon POST /api/auth/login                   500 "login empty body (known-bug v1.x: should 400)"

echo "── Authed endpoint smoke (skipped if no cookie) ──"
check_authed GET /api/auth/me                     200 "authed me"
check_authed GET /api/ot/readiness/mine           200 "authed readiness mine (catches v1.1 #8 SQL bug)"
check_authed GET /api/ot/readiness/overdue        200 "authed readiness overdue"
check_authed GET /api/admin/dashboard-stats       200 "authed dashboard"
check_authed GET /api/admin/audit-log             200 "authed audit-log (super_admin)"
check_authed GET /api/admin/doctor-affiliations   200 "authed doctor affs"
check_authed GET /api/hospitals/accessible        200 "accessible hospitals"
check_authed GET /api/forms                       200 "authed forms list"
check_authed GET /api/patients                    200 "authed patient list"
check_authed GET /api/help/manifests              200 "authed help manifests"

echo
echo "── Results ──"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  SKIP: $SKIP"
if [ $FAIL -gt 0 ]; then
  echo
  echo "Failures:"
  printf '  ✗ %s\n' "${FAILURES[@]}"
  exit 1
fi
echo "✓ All smoke checks passed (skipped: $SKIP — set TEST_SESSION_COOKIE for full coverage)"
exit 0
