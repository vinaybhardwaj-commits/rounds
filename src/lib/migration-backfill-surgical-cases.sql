-- =============================================================================
-- migration-backfill-surgical-cases.sql
-- 25 Apr 2026
--
-- Diagnosis (25 Apr 2026):
--   - 415 active patient_threads
--   - Only 6 Marketing Handoff submissions (3 with surgery_planned=true)
--   - Only 3 surgical_cases rows existed (hook fired correctly each time)
--   - 33 patients in admitted/pre_op/surgery/post_op stages with NO case row
--     → CasePanel renders nothing → all OT planning surfaces unreachable
--
-- This migration backfills surgical_cases for all active patients in
-- admitted/pre_op/surgery/post_op stages who don't already have one. State is
-- inferred from current_stage (best-effort guess; staff can transition forward
-- via the existing 10-state machine after backfill).
--
-- Idempotent. Skips patients that already have a case.
-- =============================================================================

-- 1. Backfill surgical_cases for admitted+ patients without one.
WITH inserted_cases AS (
  INSERT INTO surgical_cases (
    hospital_id,
    patient_thread_id,
    state,
    urgency,
    planned_procedure,
    created_by,
    created_at,
    updated_at
  )
  SELECT
    pt.hospital_id,
    pt.id AS patient_thread_id,
    -- State inferred from patient stage (best-effort; staff can advance later).
    CASE pt.current_stage
      WHEN 'admitted'      THEN 'pac_scheduled'
      WHEN 'pre_op'        THEN 'pac_scheduled'
      WHEN 'surgery'       THEN 'in_theatre'
      WHEN 'post_op_care'  THEN 'completed'
      WHEN 'post_op'       THEN 'completed'
      WHEN 'discharge'     THEN 'completed'
      ELSE 'draft'
    END AS state,
    'elective' AS urgency,
    -- planned_procedure: try to derive from latest Marketing Handoff;
    -- otherwise leave NULL.
    (
      SELECT NULLIF(fs.form_data->>'proposed_procedure', '')
        FROM form_submissions fs
       WHERE fs.patient_thread_id = pt.id
         AND fs.form_type = 'consolidated_marketing_handoff'
         AND fs.status = 'submitted'
       ORDER BY fs.created_at DESC
       LIMIT 1
    ) AS planned_procedure,
    NULL AS created_by,  -- system backfill; no actor
    NOW() AS created_at,
    NOW() AS updated_at
    FROM patient_threads pt
   WHERE pt.archived_at IS NULL
     AND pt.hospital_id IS NOT NULL
     AND pt.current_stage IN ('admitted', 'pre_op', 'surgery', 'post_op_care', 'post_op', 'discharge')
     AND NOT EXISTS (
       SELECT 1 FROM surgical_cases sc
        WHERE sc.patient_thread_id = pt.id
          AND sc.archived_at IS NULL
     )
  RETURNING id, state
)
-- 2. Insert initial case_state_events row for each newly-created case
--    (Invariant: every state mutation logs).
INSERT INTO case_state_events (
  case_id, from_state, to_state, transition_reason, actor_profile_id, metadata
)
SELECT id, NULL, state, 'system_backfill_25apr2026', NULL,
       jsonb_build_object('source', 'migration-backfill-surgical-cases', 'date', '25-apr-2026')
  FROM inserted_cases;

-- 3. Marker
INSERT INTO _migrations (name, applied_at)
VALUES ('25-apr-backfill-surgical-cases', NOW())
ON CONFLICT (name) DO NOTHING;

-- 4. Sanity report
DO $chk$
DECLARE
  v_total_active INT;
  v_admitted_plus INT;
  v_with_case INT;
  v_without_case INT;
BEGIN
  SELECT COUNT(*) INTO v_total_active FROM patient_threads WHERE archived_at IS NULL;
  SELECT COUNT(*) INTO v_admitted_plus
    FROM patient_threads
   WHERE archived_at IS NULL
     AND current_stage IN ('admitted', 'pre_op', 'surgery', 'post_op_care', 'post_op', 'discharge');
  SELECT COUNT(DISTINCT pt.id) INTO v_with_case
    FROM patient_threads pt
    JOIN surgical_cases sc ON sc.patient_thread_id = pt.id AND sc.archived_at IS NULL
   WHERE pt.archived_at IS NULL
     AND pt.current_stage IN ('admitted', 'pre_op', 'surgery', 'post_op_care', 'post_op', 'discharge');
  v_without_case := v_admitted_plus - v_with_case;
  RAISE NOTICE 'backfill complete: %/% admitted+ patients now have a surgical_case (% remaining without — likely older archived states)',
    v_with_case, v_admitted_plus, v_without_case;
END
$chk$;
