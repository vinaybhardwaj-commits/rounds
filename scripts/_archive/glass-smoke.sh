#!/usr/bin/env bash
# =============================================================================
# scripts/glass-smoke.sh — Glass Mode v1 anon endpoint smoke (GLASS.11)
#
# Pings every endpoint introduced or modified by the Glass Mode sprint and
# asserts the expected anon response (401 for /api/* gated routes, 307 for
# pages that redirect to /auth/login). Run after every Rounds deploy that
# touches Glass code.
#
# No auth required — proves the auth-gate envelope itself is intact.
# Authenticated 200-path verification is V-driven via the actual UI.
#
# Usage:
#   BASE_URL=https://rounds-sqxh.vercel.app bash scripts/glass-smoke.sh
# =============================================================================

set -euo pipefail

BASE="${BASE_URL:-https://rounds-sqxh.vercel.app}"
PASS=0
FAIL=0

check() {
  local method=$1 path=$2 expected=$3 desc=$4
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 -X "$method" "$BASE$path" || echo "000")
  if [ "$code" = "$expected" ]; then
    echo "  ✓ $code $method $path  ($desc)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $code $method $path  (expected $expected — $desc)"
    FAIL=$((FAIL + 1))
  fi
}

echo "== GLASS smoke against $BASE =="
echo
echo "── GLASS.1: audit_log + cleanup cron ──"
check GET /api/cron/cleanup-audit 401 "cleanup-audit cron — requires CRON_SECRET"

echo
echo "── GLASS.4: 15 mutating endpoints (still 401 anon — auth check intact) ──"
check POST /api/patients 401 "patient.create"
check PATCH /api/patients/test-id 401 "patient.update_field"
check POST /api/patients/test-id/discharge 401 "patient.discharge (GUARANTEED)"
check POST /api/patients/archive 401 "patient.archive (GUARANTEED)"
check PATCH /api/patients/test-id/stage 401 "patient.stage_advance (GUARANTEED)"
check POST /api/cases 401 "case.create"
check POST /api/cases/test-id/cancel 401 "case.cancel (GUARANTEED)"
check POST /api/cases/test-id/ot-booking 401 "case.book_ot (GUARANTEED)"
check POST /api/cases/schedule-pac 401 "pac.schedule"
check POST /api/cases/test-id/pac/publish-outcome 401 "pac.publish_outcome (GUARANTEED)"
check POST /api/forms 401 "form.submit"
check POST /api/chat-tasks 401 "task.create"
check PATCH /api/chat-tasks/test-id 401 "task.<status>"
check POST /api/equipment-requests 401 "equipment.request_create"
check PATCH /api/equipment-requests/test-id 401 "equipment.request_update"

echo
echo "── GLASS.5+6: 14 routes flattened (still 401 anon — no leak) ──"
# GLASS.5 already covered above; GLASS.6 additions:
check POST /api/cases/test-id/postpone 401 "case.postpone"
check PATCH /api/cases/test-id/equipment/test-req-id 401 "equipment.mutation (guard helper)"
check POST /api/cases/test-id/schedule 401 "case.schedule"
check PATCH /api/cases/test-id/conditions/test-card-id 401 "case.conditions waive"
check POST /api/ot-lists/lock 401 "ot-list lock"

echo
echo "── GLASS.6: KEPT admin gates (still 401 anon, super_admin-only post-auth) ──"
check GET /api/admin/api-performance 401 "admin gate KEPT"
check POST /api/duty-roster 401 "ADMIN_ROLES KEPT"
check POST /api/patients/import 401 "ADMIN_ROLES KEPT"

echo
echo "── GLASS.8: All Modules ──"
check GET /all-modules 307 "every-user page (redirects to login when anon)"

echo
echo "── GLASS.9: Undo dispatcher + recent ──"
check POST /api/undo/123 401 "undo dispatcher"
check GET /api/undo/recent 401 "recent undoable list"

echo
echo "── GLASS.10: admin audit-log ──"
check GET /api/admin/audit-log 401 "audit-log endpoint"
check GET /admin/audit-log 307 "audit-log page"

echo
echo "── GLASS.10.5: per-patient audit timeline ──"
check GET /api/patients/00000000-0000-0000-0000-000000000000/audit 401 "per-patient audit endpoint"

echo
echo "============================================="
echo "  Pass: $PASS"
echo "  Fail: $FAIL"
echo "============================================="

# NOTE — first-run after deploy may show 404 instead of 307/401 on brand-new
# routes due to Vercel's CDN caching the 404 from the seconds between commit
# push and route promotion. V's first authenticated browser visit will
# populate the correct cache entry; re-run this script afterward and the
# 404s should clear. See GLASS-MODE-BUILD-JOURNAL.md §1 (cross-cutting
# decisions) for the full diagnosis.

if [ "$FAIL" -gt 0 ]; then
  echo "✗ FAIL — $FAIL endpoints did not match expected response" >&2
  exit 1
fi
echo "✓ PASS — Glass mode anon smoke green"
