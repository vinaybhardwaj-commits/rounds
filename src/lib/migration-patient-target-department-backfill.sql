-- =============================================================================
-- migration-patient-target-department-backfill.sql
-- 25 Apr 2026
--
-- Backfills patient_threads.target_department (already exists from r3-r4-dedup
-- migration) for patients who have a Marketing Handoff submission but no
-- target_department set on the thread.
--
-- Source of truth: form_submissions.form_data->>'target_department' from the
-- patient's MOST RECENT submitted Marketing Handoff form. We use DISTINCT ON
-- (patient_thread_id) sorted by created_at DESC to pick the latest.
--
-- Idempotent: only updates rows where pt.target_department IS NULL.
-- =============================================================================

UPDATE patient_threads pt
   SET target_department = sub.tdep
  FROM (
    SELECT DISTINCT ON (fs.patient_thread_id)
           fs.patient_thread_id,
           NULLIF(fs.form_data->>'target_department', '') AS tdep,
           fs.created_at
      FROM form_submissions fs
     WHERE fs.form_type = 'consolidated_marketing_handoff'
       AND fs.patient_thread_id IS NOT NULL
       AND fs.status = 'submitted'
       AND fs.form_data ? 'target_department'
       AND NULLIF(fs.form_data->>'target_department', '') IS NOT NULL
     ORDER BY fs.patient_thread_id, fs.created_at DESC
  ) sub
 WHERE sub.patient_thread_id = pt.id
   AND pt.target_department IS NULL
   AND sub.tdep IS NOT NULL;

-- Marker
INSERT INTO _migrations (name, applied_at)
VALUES ('25-apr-patient-target-department-backfill', NOW())
ON CONFLICT (name) DO NOTHING;

-- Sanity report
DO $chk$
DECLARE
  v_filled INT;
  v_total INT;
  v_with_handoff_no_dept INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM patient_threads WHERE archived_at IS NULL;
  SELECT COUNT(*) INTO v_filled
    FROM patient_threads
   WHERE target_department IS NOT NULL AND archived_at IS NULL;
  SELECT COUNT(DISTINCT fs.patient_thread_id) INTO v_with_handoff_no_dept
    FROM form_submissions fs
    JOIN patient_threads pt ON pt.id = fs.patient_thread_id
   WHERE fs.form_type = 'consolidated_marketing_handoff'
     AND fs.status = 'submitted'
     AND pt.target_department IS NULL
     AND pt.archived_at IS NULL;
  RAISE NOTICE 'patient_threads.target_department filled on %/% active threads (% have Marketing Handoff with no target_department — likely empty in the form)', v_filled, v_total, v_with_handoff_no_dept;
END
$chk$;
