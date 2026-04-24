-- ============================================
-- Sprint 3 Day 11.5 migration — tasks table
--
-- Task queue for auto-generated and manual tasks tied to cases (or standalone).
-- Enables "auto-create RMO pre-op verification task on schedule" + future
-- cross-role automation.
--
-- Multi-hospital safe: hospital_id NOT NULL. Tenancy via user_accessible_hospital_ids.
-- Idempotent: guarded by _migrations row.
-- ============================================

DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migrations WHERE name = 'sprint3-tasks-table') THEN

    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE RESTRICT,
      case_id UUID REFERENCES surgical_cases(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      assignee_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
      owner_role TEXT,
      due_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
      source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'auto')),
      source_ref TEXT,
      metadata JSONB,
      created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
      completed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_hospital_status
      ON tasks(hospital_id, status) WHERE status IN ('pending', 'in_progress');
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee
      ON tasks(assignee_profile_id) WHERE assignee_profile_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_case
      ON tasks(case_id) WHERE case_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_owner_role_pending
      ON tasks(hospital_id, owner_role) WHERE status = 'pending' AND assignee_profile_id IS NULL;
    -- Partial unique: prevent duplicate auto-tasks for the same (case, source_ref)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_auto_dedup
      ON tasks(case_id, source_ref) WHERE source = 'auto' AND case_id IS NOT NULL;

    INSERT INTO _migrations (name, applied_at)
    VALUES ('sprint3-tasks-table', NOW());

    RAISE NOTICE 'sprint3-tasks-table applied';
  ELSE
    RAISE NOTICE 'sprint3-tasks-table already applied, skipping';
  END IF;
END
$mig$;
