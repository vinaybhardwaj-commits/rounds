#!/usr/bin/env bash
# =============================================================================
# scripts/chat-tasks-smoke.sh — chat-tasks v1 deploy smoke (CT.11)
#
# PRD §CT.11: exercises every chat-task endpoint end-to-end. Run after every
# Rounds deploy that touches chat-tasks code.
#
# Required env (export before running):
#   BASE_URL            default https://rounds-sqxh.vercel.app
#   TEST_JWT            super_admin session cookie value (rounds_session=<JWT>)
#   TEST_HOSPITAL_ID    UUID of the hospital the test super_admin belongs to
#   TEST_PATIENT_ID     UUID of an existing patient_thread in TEST_HOSPITAL_ID
#   TEST_ASSIGNEE_ID    UUID of a profile in TEST_HOSPITAL_ID (can be same as super_admin)
#   TEST_CHANNEL_ID     Stream channel id (without type prefix) reachable to super_admin
#   TEST_CHANNEL_TYPE   one of patient-thread / department / direct / broadcast
#
# Exit codes:
#   0 — all smokes passed
#   1 — any smoke failed (script aborts on first failure via set -e)
#
# Pattern: each step echoes a one-line "✓ Step N: ..." on pass.
# =============================================================================

set -euo pipefail

BASE="${BASE_URL:-https://rounds-sqxh.vercel.app}"

# ── Pre-flight: env presence ────────────────────────────────────────────────
require_env() {
  if [ -z "${!1:-}" ]; then
    echo "✗ FATAL: $1 not set" >&2
    exit 1
  fi
}
for v in TEST_JWT TEST_HOSPITAL_ID TEST_PATIENT_ID TEST_ASSIGNEE_ID TEST_CHANNEL_ID TEST_CHANNEL_TYPE; do
  require_env "$v"
done

# ── Helpers ─────────────────────────────────────────────────────────────────
hdr_auth=("-H" "Cookie: rounds_session=${TEST_JWT}")
hdr_json=("-H" "Content-Type: application/json")

# ── Step 1: anon /api/tasks should be 401 (auth gate works) ─────────────────
status=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE}/api/tasks?status=pending&limit=1")
test "$status" = "401" || { echo "✗ Step 1: /api/tasks anon expected 401, got $status" >&2; exit 1; }
echo "✓ Step 1: /api/tasks anon → 401 (auth gate working)"

# ── Step 2: anon POST /api/chat-tasks should be 401 ─────────────────────────
status=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${BASE}/api/chat-tasks")
test "$status" = "401" || { echo "✗ Step 2: POST /api/chat-tasks anon expected 401, got $status" >&2; exit 1; }
echo "✓ Step 2: POST /api/chat-tasks anon → 401"

# ── Step 3: authed POST /api/chat-tasks happy path ──────────────────────────
unique_title="smoke-$(date +%s)"
create_payload=$(cat <<JSON
{
  "channel_id": "${TEST_CHANNEL_ID}",
  "channel_type": "${TEST_CHANNEL_TYPE}",
  "assignee_profile_id": "${TEST_ASSIGNEE_ID}",
  "title": "${unique_title}",
  "patient_thread_id": "${TEST_PATIENT_ID}",
  "priority": "normal"
}
JSON
)
create_resp=$(curl -sS -X POST "${BASE}/api/chat-tasks" "${hdr_auth[@]}" "${hdr_json[@]}" -d "$create_payload")
task_id=$(echo "$create_resp" | jq -r '.data.id // empty')
test -n "$task_id" || { echo "✗ Step 3: POST /api/chat-tasks did not return data.id. Response: $create_resp" >&2; exit 1; }
echo "✓ Step 3: POST /api/chat-tasks → task_id=${task_id}"

# ── Step 4: GET /api/chat-tasks/[id] (orphan-card defense path) ─────────────
status=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE}/api/chat-tasks/${task_id}" "${hdr_auth[@]}")
test "$status" = "200" || { echo "✗ Step 4: GET /api/chat-tasks/${task_id} expected 200, got $status" >&2; exit 1; }
echo "✓ Step 4: GET /api/chat-tasks/${task_id} → 200"

# ── Step 5: PATCH .../status → acknowledged (metadata flag, status stays pending) ──
status=$(curl -sS -o /dev/null -w "%{http_code}" -X PATCH "${BASE}/api/chat-tasks/${task_id}/status" \
  "${hdr_auth[@]}" "${hdr_json[@]}" -d '{"status":"acknowledged"}')
test "$status" = "200" || { echo "✗ Step 5: PATCH .../status acknowledged expected 200, got $status" >&2; exit 1; }
echo "✓ Step 5: PATCH .../status acknowledged → 200"

# ── Step 6: PATCH .../status → in_progress ──────────────────────────────────
status=$(curl -sS -o /dev/null -w "%{http_code}" -X PATCH "${BASE}/api/chat-tasks/${task_id}/status" \
  "${hdr_auth[@]}" "${hdr_json[@]}" -d '{"status":"in_progress"}')
test "$status" = "200" || { echo "✗ Step 6: PATCH .../status in_progress expected 200, got $status" >&2; exit 1; }
echo "✓ Step 6: PATCH .../status in_progress → 200"

# ── Step 7: PATCH /[id] edit (assigner / super_admin can change title) ──────
status=$(curl -sS -o /dev/null -w "%{http_code}" -X PATCH "${BASE}/api/chat-tasks/${task_id}" \
  "${hdr_auth[@]}" "${hdr_json[@]}" -d "{\"title\":\"${unique_title}-edited\"}")
test "$status" = "200" || { echo "✗ Step 7: PATCH /[id] edit expected 200, got $status" >&2; exit 1; }
echo "✓ Step 7: PATCH /api/chat-tasks/${task_id} edit → 200"

# ── Step 8: PATCH .../status → done (terminal state) ────────────────────────
status=$(curl -sS -o /dev/null -w "%{http_code}" -X PATCH "${BASE}/api/chat-tasks/${task_id}/status" \
  "${hdr_auth[@]}" "${hdr_json[@]}" -d '{"status":"done"}')
test "$status" = "200" || { echo "✗ Step 8: PATCH .../status done expected 200, got $status" >&2; exit 1; }
echo "✓ Step 8: PATCH .../status done → 200"

# ── Step 9: PATCH .../status from done → in_progress should 409 (state-machine guard) ──
status=$(curl -sS -o /dev/null -w "%{http_code}" -X PATCH "${BASE}/api/chat-tasks/${task_id}/status" \
  "${hdr_auth[@]}" "${hdr_json[@]}" -d '{"status":"in_progress"}')
test "$status" = "409" || { echo "✗ Step 9: PATCH done→in_progress expected 409, got $status" >&2; exit 1; }
echo "✓ Step 9: PATCH .../status done→in_progress → 409 (state machine guard)"

# ── Step 10: DELETE /[id] (cancel — assigner / super_admin only) ────────────
# Note: this task is already 'done' so cancel is a no-op semantically (per CT.4 logic);
# we just check the endpoint accepts/returns sensibly.
status=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE "${BASE}/api/chat-tasks/${task_id}" "${hdr_auth[@]}")
# DELETE on a done task may 200 (idempotent cancel) or 409 (terminal-state guard).
# Either is acceptable — both prove the endpoint is reachable + auth-gated.
case "$status" in
  200|409) echo "✓ Step 10: DELETE /api/chat-tasks/${task_id} → ${status} (endpoint reachable)" ;;
  *) echo "✗ Step 10: DELETE expected 200 or 409, got $status" >&2; exit 1 ;;
esac

# ── Step 11: GET /api/patients/searchable (CT.6 typeahead endpoint) ─────────
status=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE}/api/patients/searchable?q=test&limit=1" "${hdr_auth[@]}")
test "$status" = "200" -o "$status" = "204" || { echo "✗ Step 11: GET /api/patients/searchable expected 200/204, got $status" >&2; exit 1; }
echo "✓ Step 11: GET /api/patients/searchable → ${status}"

echo ""
echo "✓ chat-tasks smoke passed (11/11 steps)"
