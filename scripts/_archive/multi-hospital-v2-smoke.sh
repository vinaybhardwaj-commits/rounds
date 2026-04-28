#!/usr/bin/env bash
# =============================================================================
# scripts/multi-hospital-v2-smoke.sh — Multi-Hospital v2 anon endpoint smoke (MH.8)
#
# Pings every endpoint introduced or modified by the Multi-Hospital v2 sprint
# (MH.0 → MH.7b) and asserts the expected anon response. Run after every
# Rounds deploy that touches MH v2 code.
#
# No auth required — proves the auth-gate envelope itself is intact across all
# new MH-touched routes. Authenticated cross-hospital path verification is
# V-driven via the actual UI per the §8.5 gate matrix.
#
# Usage:
#   BASE_URL=https://rounds-sqxh.vercel.app bash scripts/multi-hospital-v2-smoke.sh
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

echo "== Multi-Hospital v2 smoke against $BASE =="
echo

echo "── MH.0/.1: schema foundation (no new endpoints; verify auth/me reflects added fields by hitting unauth) ──"
check GET /api/auth/me 401 "auth/me — primary_hospital_* + role_scope added"

echo
echo "── MH.2: 13 OT routes wrapped with withTenancy (still 401 anon — wrapper auth gate intact) ──"
check GET /api/ot/postings 401 "ot postings list"
check POST /api/ot/postings 401 "ot posting create"
check GET /api/ot/postings/test-id 401 "ot posting get"
check POST /api/ot/postings/cleanup 401 "ot postings cleanup cron"
check GET /api/ot/readiness/overdue 401 "ot readiness overdue"
check POST /api/ot/readiness/add 401 "ot readiness add"
check POST /api/ot/readiness/bulk-confirm 401 "ot readiness bulk confirm"
check GET /api/ot/readiness/mine 401 "ot readiness mine"
check PATCH /api/ot/readiness/test-id 401 "ot readiness item patch"
check PATCH /api/ot/equipment/test-id 401 "ot equipment item PATCH"
check GET /api/ot/schedule 401 "ot schedule"
check GET /api/ot/schedule/stats 401 "ot schedule stats"
check POST /api/ot/schedule/digest 401 "ot schedule digest"
check POST /api/ot/escalation/check 401 "ot escalation check (POST)"

echo
echo "── MH.3a/.3.5: hospital_admin role middleware + 6 admin endpoints scope-wrapped ──"
check GET /admin 200 "admin shell renders (client-side auth guard kicks in)"
check GET /api/admin/dashboard-stats 401 "admin dashboard stats"
check GET /api/admin/cases/summary 401 "admin cases summary"
check GET /api/admin/help/analytics 401 "admin help analytics"
check GET /api/admin/chat/analytics 401 "admin chat analytics"
check GET /api/admin/api-performance 401 "admin api performance"
check GET /api/admin/hospitals 401 "admin hospitals list"

echo
echo "── MH.4a/.4b: HospitalPicker + tenancy fix on /api/patients ──"
check GET /api/hospitals/accessible 401 "hospitals accessible — picker source of truth"
check POST /api/patients 401 "patient create — anti-leak hospital_id validation"

echo
echo "── MH.5: per-hospital broadcasts + sla-sweeper routing + sidebar scoping ──"
check GET /api/cron/sla-sweeper 401 "sla-sweeper cron — requires CRON_SECRET; per-hospital routing live"
check POST /api/admin/getstream/seed-channels 401 "seed-channels — extended with per-hospital broadcasts"
check GET /api/admin/getstream/seed-channels 405 "seed-channels — POST-only method block"

echo
echo "── MH.6: HospitalChip on list views (API augmentations) ──"
check GET /api/patients 401 "patients list — JOIN hospitals for chip"
check GET /api/forms 401 "forms list — JOIN hospitals for chip"
check GET /api/profiles 401 "profiles list — JOIN hospitals for chip + role_scope"
check GET /api/equipment-requests 401 "equipment-requests — already had hospital_slug"
check GET /admin/users 200 "admin/users page shell — Hospital · Scope column"
check GET /equipment-kanban 200 "equipment kanban page shell — HospitalChip render"

echo
echo "── MH.7a: validateDoctorHospitalAffiliation + 3 admin endpoints ──"
check GET /api/admin/doctor-affiliations 401 "doctor-affiliations list (scope-filtered)"
check POST /api/admin/doctor-affiliations 401 "doctor-affiliations add"
check DELETE /api/admin/doctor-affiliations/00000000-0000-0000-0000-000000000000 401 "doctor-affiliations delete (anti-leak 404 if scoped out)"
check GET /api/admin/doctor-affiliations/00000000-0000-0000-0000-000000000000 405 "doctor-affiliations [id] — DELETE-only"

echo
echo "── MH.7b: admin UI + FormsView warning banner + ProfileView Hospital access ──"
check GET /admin/doctor-affiliations 200 "admin doctor-affiliations page shell"

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo "Multi-Hospital v2 smoke: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo "FAILURES — investigate before marking sprint shipped."
  exit 1
fi

echo "All anon endpoints returned expected status codes."
echo "V's UAT is the authenticated cross-hospital path verification (per PRD §8.5)."
