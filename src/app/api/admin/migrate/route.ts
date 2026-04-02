// ============================================
// POST /api/admin/migrate
// Runs the v5 migration against Neon.
// Protected: super_admin only. Idempotent.
// Executes each statement individually to avoid
// Neon HTTP driver multi-statement limitations.
// ============================================

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden: super_admin role required' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);
    const results: string[] = [];

    async function run(label: string, statement: string) {
      try {
        await sql(statement);
        results.push(`✅ ${label}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists') || msg.includes('duplicate key')) {
          results.push(`⏭ ${label} (already exists)`);
        } else {
          results.push(`❌ ${label}: ${msg.substring(0, 150)}`);
        }
      }
    }

    // 0. Extension
    await run('pgcrypto', `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // 1. patient_threads
    await run('patient_threads', `
      CREATE TABLE IF NOT EXISTS patient_threads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_name VARCHAR(200) NOT NULL,
        uhid VARCHAR(50),
        ip_number VARCHAR(50),
        even_member_id VARCHAR(50),
        getstream_channel_id VARCHAR(100),
        current_stage VARCHAR(30) NOT NULL DEFAULT 'opd',
        lead_source VARCHAR(50),
        primary_consultant_id UUID REFERENCES profiles(id),
        primary_diagnosis TEXT,
        planned_procedure TEXT,
        department_id UUID REFERENCES departments(id),
        admission_date TIMESTAMPTZ,
        planned_surgery_date TIMESTAMPTZ,
        discharge_date TIMESTAMPTZ,
        created_by UUID REFERENCES profiles(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run('idx_patient_threads_stage', `CREATE INDEX IF NOT EXISTS idx_patient_threads_stage ON patient_threads(current_stage)`);
    await run('idx_patient_threads_uhid', `CREATE INDEX IF NOT EXISTS idx_patient_threads_uhid ON patient_threads(uhid) WHERE uhid IS NOT NULL`);
    await run('idx_patient_threads_ip_number', `CREATE INDEX IF NOT EXISTS idx_patient_threads_ip_number ON patient_threads(ip_number) WHERE ip_number IS NOT NULL`);
    await run('idx_patient_threads_consultant', `CREATE INDEX IF NOT EXISTS idx_patient_threads_consultant ON patient_threads(primary_consultant_id) WHERE primary_consultant_id IS NOT NULL`);
    await run('idx_patient_threads_dept', `CREATE INDEX IF NOT EXISTS idx_patient_threads_dept ON patient_threads(department_id) WHERE department_id IS NOT NULL`);
    await run('idx_patient_threads_created', `CREATE INDEX IF NOT EXISTS idx_patient_threads_created ON patient_threads(created_at DESC)`);

    // 2. form_submissions
    await run('form_submissions', `
      CREATE TABLE IF NOT EXISTS form_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form_type VARCHAR(50) NOT NULL,
        form_version INTEGER NOT NULL DEFAULT 1,
        status VARCHAR(20) NOT NULL DEFAULT 'submitted',
        patient_thread_id UUID REFERENCES patient_threads(id) ON DELETE SET NULL,
        getstream_message_id VARCHAR(100),
        getstream_channel_id VARCHAR(100),
        submitted_by UUID NOT NULL REFERENCES profiles(id),
        department_id UUID REFERENCES departments(id),
        form_data JSONB NOT NULL DEFAULT '{}',
        completion_score REAL,
        ai_gap_report JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run('idx_form_submissions_type', `CREATE INDEX IF NOT EXISTS idx_form_submissions_type ON form_submissions(form_type)`);
    await run('idx_form_submissions_patient', `CREATE INDEX IF NOT EXISTS idx_form_submissions_patient ON form_submissions(patient_thread_id) WHERE patient_thread_id IS NOT NULL`);
    await run('idx_form_submissions_submitted_by', `CREATE INDEX IF NOT EXISTS idx_form_submissions_submitted_by ON form_submissions(submitted_by)`);
    await run('idx_form_submissions_status', `CREATE INDEX IF NOT EXISTS idx_form_submissions_status ON form_submissions(status)`);
    await run('idx_form_submissions_created', `CREATE INDEX IF NOT EXISTS idx_form_submissions_created ON form_submissions(created_at DESC)`);

    // 3. readiness_items
    await run('readiness_items', `
      CREATE TABLE IF NOT EXISTS readiness_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form_submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
        patient_thread_id UUID REFERENCES patient_threads(id) ON DELETE SET NULL,
        item_name VARCHAR(200) NOT NULL,
        item_category VARCHAR(100) NOT NULL,
        item_description TEXT,
        responsible_role VARCHAR(50),
        responsible_user_id UUID REFERENCES profiles(id),
        responsible_department_id UUID REFERENCES departments(id),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        confirmed_by UUID REFERENCES profiles(id),
        confirmed_at TIMESTAMPTZ,
        flagged_reason TEXT,
        notes TEXT,
        due_by TIMESTAMPTZ,
        escalated BOOLEAN NOT NULL DEFAULT false,
        escalation_level INTEGER NOT NULL DEFAULT 0,
        last_escalated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run('idx_readiness_form', `CREATE INDEX IF NOT EXISTS idx_readiness_form ON readiness_items(form_submission_id)`);
    await run('idx_readiness_patient', `CREATE INDEX IF NOT EXISTS idx_readiness_patient ON readiness_items(patient_thread_id) WHERE patient_thread_id IS NOT NULL`);
    await run('idx_readiness_status', `CREATE INDEX IF NOT EXISTS idx_readiness_status ON readiness_items(status)`);
    await run('idx_readiness_responsible', `CREATE INDEX IF NOT EXISTS idx_readiness_responsible ON readiness_items(responsible_user_id) WHERE responsible_user_id IS NOT NULL`);
    await run('idx_readiness_due', `CREATE INDEX IF NOT EXISTS idx_readiness_due ON readiness_items(due_by) WHERE due_by IS NOT NULL AND status = 'pending'`);

    // 4. escalation_log
    await run('escalation_log', `
      CREATE TABLE IF NOT EXISTS escalation_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_type VARCHAR(30) NOT NULL,
        source_id VARCHAR(100) NOT NULL,
        escalated_from UUID REFERENCES profiles(id),
        escalated_to UUID REFERENCES profiles(id),
        patient_thread_id UUID REFERENCES patient_threads(id) ON DELETE SET NULL,
        getstream_channel_id VARCHAR(100),
        getstream_message_id VARCHAR(100),
        reason TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 1,
        resolved BOOLEAN NOT NULL DEFAULT false,
        resolved_by UUID REFERENCES profiles(id),
        resolved_at TIMESTAMPTZ,
        resolution_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run('idx_escalation_source', `CREATE INDEX IF NOT EXISTS idx_escalation_source ON escalation_log(source_type, source_id)`);
    await run('idx_escalation_patient', `CREATE INDEX IF NOT EXISTS idx_escalation_patient ON escalation_log(patient_thread_id) WHERE patient_thread_id IS NOT NULL`);
    await run('idx_escalation_unresolved', `CREATE INDEX IF NOT EXISTS idx_escalation_unresolved ON escalation_log(resolved, created_at) WHERE resolved = false`);
    await run('idx_escalation_created', `CREATE INDEX IF NOT EXISTS idx_escalation_created ON escalation_log(created_at DESC)`);

    // 5. admission_tracker
    await run('admission_tracker', `
      CREATE TABLE IF NOT EXISTS admission_tracker (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_thread_id UUID REFERENCES patient_threads(id) ON DELETE SET NULL,
        patient_name VARCHAR(200) NOT NULL,
        uhid VARCHAR(50) NOT NULL,
        ip_number VARCHAR(50) NOT NULL,
        even_member_id VARCHAR(50),
        admission_date TIMESTAMPTZ NOT NULL,
        admitted_by UUID REFERENCES profiles(id),
        primary_surgeon VARCHAR(200),
        primary_surgeon_id UUID REFERENCES profiles(id),
        surgery_name VARCHAR(300),
        planned_surgery_date TIMESTAMPTZ,
        actual_surgery_date TIMESTAMPTZ,
        room_number VARCHAR(20),
        bed_number VARCHAR(20),
        room_category VARCHAR(20) NOT NULL DEFAULT 'general',
        financial_category VARCHAR(20) NOT NULL DEFAULT 'insurance',
        package_name VARCHAR(200),
        estimated_cost NUMERIC(12,2),
        deposit_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        deposit_amount NUMERIC(12,2),
        deposit_collected_at TIMESTAMPTZ,
        pre_auth_status VARCHAR(20) NOT NULL DEFAULT 'not_required',
        pre_auth_amount NUMERIC(12,2),
        tpa_name VARCHAR(100),
        policy_number VARCHAR(100),
        financial_counselling_complete BOOLEAN NOT NULL DEFAULT false,
        financial_counselling_sheet_signed BOOLEAN NOT NULL DEFAULT false,
        ot_clearance_complete BOOLEAN NOT NULL DEFAULT false,
        ot_clearance_sheet_signed BOOLEAN NOT NULL DEFAULT false,
        pac_complete BOOLEAN NOT NULL DEFAULT false,
        physician_clearance_required BOOLEAN NOT NULL DEFAULT false,
        physician_clearance_done BOOLEAN NOT NULL DEFAULT false,
        cardiologist_clearance_required BOOLEAN NOT NULL DEFAULT false,
        cardiologist_clearance_done BOOLEAN NOT NULL DEFAULT false,
        surgery_readiness VARCHAR(20) NOT NULL DEFAULT 'not_started',
        current_status VARCHAR(20) NOT NULL DEFAULT 'admitted',
        discharge_order_at TIMESTAMPTZ,
        discharge_completed_at TIMESTAMPTZ,
        discharge_tat_minutes INTEGER,
        discharge_type VARCHAR(30),
        ip_coordinator_id UUID REFERENCES profiles(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run('idx_admission_tracker_status', `CREATE INDEX IF NOT EXISTS idx_admission_tracker_status ON admission_tracker(current_status)`);
    await run('idx_admission_tracker_patient', `CREATE INDEX IF NOT EXISTS idx_admission_tracker_patient ON admission_tracker(patient_thread_id) WHERE patient_thread_id IS NOT NULL`);
    await run('idx_admission_tracker_uhid', `CREATE INDEX IF NOT EXISTS idx_admission_tracker_uhid ON admission_tracker(uhid)`);
    await run('idx_admission_tracker_ip', `CREATE INDEX IF NOT EXISTS idx_admission_tracker_ip ON admission_tracker(ip_number)`);
    await run('idx_admission_tracker_surgery_date', `CREATE INDEX IF NOT EXISTS idx_admission_tracker_surgery_date ON admission_tracker(planned_surgery_date) WHERE planned_surgery_date IS NOT NULL`);
    await run('idx_admission_tracker_active', `CREATE INDEX IF NOT EXISTS idx_admission_tracker_active ON admission_tracker(current_status, admission_date DESC) WHERE current_status != 'discharged'`);

    // 6. duty_roster
    await run('duty_roster', `
      CREATE TABLE IF NOT EXISTS duty_roster (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES profiles(id),
        department_id UUID NOT NULL REFERENCES departments(id),
        role VARCHAR(50) NOT NULL,
        shift_type VARCHAR(20) NOT NULL,
        day_of_week INTEGER[] NOT NULL,
        shift_start_time TIME,
        shift_end_time TIME,
        effective_from DATE NOT NULL,
        effective_to DATE,
        is_override BOOLEAN NOT NULL DEFAULT false,
        override_reason TEXT,
        override_date DATE,
        created_by UUID NOT NULL REFERENCES profiles(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run('idx_duty_roster_user', `CREATE INDEX IF NOT EXISTS idx_duty_roster_user ON duty_roster(user_id)`);
    await run('idx_duty_roster_dept_role', `CREATE INDEX IF NOT EXISTS idx_duty_roster_dept_role ON duty_roster(department_id, role)`);
    await run('idx_duty_roster_shift', `CREATE INDEX IF NOT EXISTS idx_duty_roster_shift ON duty_roster(shift_type, day_of_week)`);
    await run('idx_duty_roster_effective', `CREATE INDEX IF NOT EXISTS idx_duty_roster_effective ON duty_roster(effective_from, effective_to)`);
    await run('idx_duty_roster_override', `CREATE INDEX IF NOT EXISTS idx_duty_roster_override ON duty_roster(override_date) WHERE is_override = true`);

    // 7. updated_at trigger function
    await run('trigger_set_updated_at', `
      CREATE OR REPLACE FUNCTION trigger_set_updated_at()
      RETURNS TRIGGER AS $func$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $func$ LANGUAGE plpgsql
    `);

    // Apply triggers
    for (const tbl of ['patient_threads', 'form_submissions', 'admission_tracker']) {
      await run(`trigger_${tbl}`, `DROP TRIGGER IF EXISTS set_updated_at ON ${tbl}`);
      await run(`trigger_${tbl}_create`, `CREATE TRIGGER set_updated_at BEFORE UPDATE ON ${tbl} FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()`);
    }

    // 8. Migrations tracking table
    await run('_migrations', `
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run('migration_record', `INSERT INTO _migrations (name) VALUES ('v5-tables-initial') ON CONFLICT (name) DO NOTHING`);

    // ── Step 7.1: Push subscriptions table ──
    await run('push_subscriptions_table', `
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        subscription_json JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (profile_id, endpoint)
      )
    `);
    await run('push_subscriptions_idx', `CREATE INDEX IF NOT EXISTS idx_push_subs_profile ON push_subscriptions(profile_id)`);
    await run('push_migration_record', `INSERT INTO _migrations (name) VALUES ('v7-push-subscriptions') ON CONFLICT (name) DO NOTHING`);

    // ── Step 8.1: AI analysis cache table ──
    await run('ai_analysis_table', `
      CREATE TABLE IF NOT EXISTS ai_analysis (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        analysis_type TEXT NOT NULL,
        source_id UUID,
        source_type TEXT,
        result JSONB NOT NULL,
        model TEXT DEFAULT 'claude-sonnet-4-5-20250514',
        token_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await run('ai_analysis_idx', `CREATE INDEX IF NOT EXISTS idx_ai_analysis_source ON ai_analysis(source_type, source_id)`);
    await run('ai_migration_record', `INSERT INTO _migrations (name) VALUES ('v8-ai-analysis') ON CONFLICT (name) DO NOTHING`);

    // ── Step 9.1: must_change_pin column on profiles ──
    await run('profiles_must_change_pin', `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN NOT NULL DEFAULT false`);
    await run('must_change_pin_migration', `INSERT INTO _migrations (name) VALUES ('v9-must-change-pin') ON CONFLICT (name) DO NOTHING`);

    // ── Step 10: deleted_messages audit table ──
    await run('deleted_messages_table', `
      CREATE TABLE IF NOT EXISTS deleted_messages (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        message_id VARCHAR(200) NOT NULL,
        channel_id VARCHAR(200) NOT NULL,
        original_text TEXT,
        original_user_id UUID,
        original_user_name VARCHAR(200),
        deleted_by_id UUID NOT NULL REFERENCES profiles(id),
        deleted_by_name VARCHAR(200),
        deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason VARCHAR(50) NOT NULL DEFAULT 'other',
        reason_detail TEXT,
        is_system_message BOOLEAN NOT NULL DEFAULT false
      )
    `);
    await run('idx_deleted_messages_channel', `CREATE INDEX IF NOT EXISTS idx_deleted_messages_channel ON deleted_messages(channel_id)`);
    await run('idx_deleted_messages_message', `CREATE INDEX IF NOT EXISTS idx_deleted_messages_message ON deleted_messages(message_id)`);
    await run('idx_deleted_messages_deleted_by', `CREATE INDEX IF NOT EXISTS idx_deleted_messages_deleted_by ON deleted_messages(deleted_by_id)`);
    await run('deleted_messages_migration', `INSERT INTO _migrations (name) VALUES ('v10-deleted-messages') ON CONFLICT (name) DO NOTHING`);

    // ── Step 11: patient_threads soft-delete columns ──
    await run('pt_archived_at', `ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
    await run('pt_archive_type', `ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS archive_type VARCHAR(20)`);
    await run('pt_archive_reason', `ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(100)`);
    await run('pt_archive_reason_detail', `ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS archive_reason_detail TEXT`);
    await run('pt_archived_by', `ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES profiles(id)`);
    await run('idx_pt_archived', `CREATE INDEX IF NOT EXISTS idx_patient_threads_archived ON patient_threads(archive_type, archived_at DESC) WHERE archived_at IS NOT NULL`);
    await run('pt_archive_migration', `INSERT INTO _migrations (name) VALUES ('v11-patient-soft-delete') ON CONFLICT (name) DO NOTHING`);

    // ── Step 12: Billing Integration (Phase 1) ──

    // 12a. insurance_claims table
    await run('insurance_claims', `
      CREATE TABLE IF NOT EXISTS insurance_claims (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_thread_id UUID NOT NULL REFERENCES patient_threads(id) ON DELETE CASCADE,
        admission_tracker_id UUID REFERENCES admission_tracker(id) ON DELETE SET NULL,
        insurer_name VARCHAR(200),
        tpa_name VARCHAR(200),
        submission_channel VARCHAR(20) NOT NULL DEFAULT 'tpa',
        portal_used VARCHAR(50),
        policy_number VARCHAR(100),
        claim_number VARCHAR(100),
        patient_card_photo_url TEXT,
        sum_insured NUMERIC(12,2),
        room_rent_eligibility NUMERIC(10,2),
        room_category_selected VARCHAR(20),
        actual_room_rent NUMERIC(10,2),
        proportional_deduction_pct NUMERIC(5,2),
        co_pay_pct NUMERIC(5,2),
        has_room_rent_waiver BOOLEAN DEFAULT false,
        estimated_cost NUMERIC(12,2),
        pre_auth_submitted_at TIMESTAMPTZ,
        pre_auth_approved_at TIMESTAMPTZ,
        pre_auth_amount NUMERIC(12,2),
        pre_auth_status VARCHAR(20) NOT NULL DEFAULT 'not_started',
        pre_auth_tat_minutes INTEGER,
        total_enhancements INTEGER DEFAULT 0,
        latest_enhancement_amount NUMERIC(12,2),
        cumulative_approved_amount NUMERIC(12,2),
        final_bill_amount NUMERIC(12,2),
        final_submitted_at TIMESTAMPTZ,
        final_approved_at TIMESTAMPTZ,
        final_approved_amount NUMERIC(12,2),
        final_settlement_tat_minutes INTEGER,
        hospital_discount NUMERIC(12,2),
        non_payable_deductions NUMERIC(12,2),
        patient_liability NUMERIC(12,2),
        claim_status VARCHAR(30) NOT NULL DEFAULT 'counseling',
        recovery_rate NUMERIC(5,2),
        revenue_leakage NUMERIC(12,2),
        leakage_reason TEXT,
        created_by UUID REFERENCES profiles(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run('idx_claims_patient', `CREATE INDEX IF NOT EXISTS idx_claims_patient ON insurance_claims(patient_thread_id)`);
    await run('idx_claims_admission', `CREATE INDEX IF NOT EXISTS idx_claims_admission ON insurance_claims(admission_tracker_id) WHERE admission_tracker_id IS NOT NULL`);
    await run('idx_claims_status', `CREATE INDEX IF NOT EXISTS idx_claims_status ON insurance_claims(claim_status)`);
    await run('idx_claims_insurer', `CREATE INDEX IF NOT EXISTS idx_claims_insurer ON insurance_claims(insurer_name) WHERE insurer_name IS NOT NULL`);
    await run('idx_claims_created', `CREATE INDEX IF NOT EXISTS idx_claims_created ON insurance_claims(created_at DESC)`);

    // 12b. claim_events table
    await run('claim_events', `
      CREATE TABLE IF NOT EXISTS claim_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        insurance_claim_id UUID NOT NULL REFERENCES insurance_claims(id) ON DELETE CASCADE,
        patient_thread_id UUID NOT NULL REFERENCES patient_threads(id) ON DELETE CASCADE,
        event_type VARCHAR(40) NOT NULL,
        description TEXT NOT NULL,
        amount NUMERIC(12,2),
        portal_reference VARCHAR(200),
        document_urls TEXT[],
        insurer_response_needed BOOLEAN DEFAULT false,
        insurer_response_deadline TIMESTAMPTZ,
        performed_by UUID REFERENCES profiles(id),
        performed_by_name VARCHAR(200),
        getstream_message_id VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run('idx_claim_events_claim', `CREATE INDEX IF NOT EXISTS idx_claim_events_claim ON claim_events(insurance_claim_id)`);
    await run('idx_claim_events_patient', `CREATE INDEX IF NOT EXISTS idx_claim_events_patient ON claim_events(patient_thread_id)`);
    await run('idx_claim_events_type', `CREATE INDEX IF NOT EXISTS idx_claim_events_type ON claim_events(event_type)`);
    await run('idx_claim_events_created', `CREATE INDEX IF NOT EXISTS idx_claim_events_created ON claim_events(created_at DESC)`);

    // 12c. discharge_milestones table
    await run('discharge_milestones', `
      CREATE TABLE IF NOT EXISTS discharge_milestones (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_thread_id UUID NOT NULL REFERENCES patient_threads(id) ON DELETE CASCADE,
        admission_tracker_id UUID REFERENCES admission_tracker(id) ON DELETE SET NULL,
        insurance_claim_id UUID REFERENCES insurance_claims(id) ON DELETE SET NULL,
        discharge_ordered_at TIMESTAMPTZ,
        discharge_ordered_by UUID REFERENCES profiles(id),
        pharmacy_clearance_at TIMESTAMPTZ,
        pharmacy_cleared_by UUID REFERENCES profiles(id),
        lab_clearance_at TIMESTAMPTZ,
        lab_cleared_by UUID REFERENCES profiles(id),
        discharge_summary_at TIMESTAMPTZ,
        discharge_summary_by UUID REFERENCES profiles(id),
        billing_closure_at TIMESTAMPTZ,
        billing_closed_by UUID REFERENCES profiles(id),
        final_bill_submitted_at TIMESTAMPTZ,
        final_bill_submitted_by UUID REFERENCES profiles(id),
        final_approval_at TIMESTAMPTZ,
        final_approval_logged_by UUID REFERENCES profiles(id),
        patient_settled_at TIMESTAMPTZ,
        patient_settled_by UUID REFERENCES profiles(id),
        patient_departed_at TIMESTAMPTZ,
        tat_order_to_pharmacy INTEGER,
        tat_order_to_summary INTEGER,
        tat_summary_to_billing INTEGER,
        tat_billing_to_submission INTEGER,
        tat_submission_to_approval INTEGER,
        tat_order_to_departure INTEGER,
        is_complete BOOLEAN DEFAULT false,
        is_cancelled BOOLEAN DEFAULT false,
        cancellation_reason TEXT,
        bottleneck_step VARCHAR(40),
        bottleneck_minutes INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run('idx_discharge_ms_patient', `CREATE INDEX IF NOT EXISTS idx_discharge_ms_patient ON discharge_milestones(patient_thread_id)`);
    await run('idx_discharge_ms_active', `CREATE INDEX IF NOT EXISTS idx_discharge_ms_active ON discharge_milestones(is_complete, created_at DESC) WHERE is_complete = false AND is_cancelled = false`);
    await run('idx_discharge_ms_created', `CREATE INDEX IF NOT EXISTS idx_discharge_ms_created ON discharge_milestones(created_at DESC)`);

    // 12d. Extend admission_tracker with billing columns
    await run('at_insurance_claim_id', `ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS insurance_claim_id UUID REFERENCES insurance_claims(id)`);
    await run('at_insurer_name', `ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS insurer_name VARCHAR(200)`);
    await run('at_submission_channel', `ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS submission_channel VARCHAR(20) DEFAULT 'tpa'`);
    await run('at_sum_insured', `ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS sum_insured NUMERIC(12,2)`);
    await run('at_room_rent_eligibility', `ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS room_rent_eligibility NUMERIC(10,2)`);
    await run('at_proportional_deduction_risk', `ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS proportional_deduction_risk NUMERIC(5,2)`);
    await run('at_running_bill_amount', `ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS running_bill_amount NUMERIC(12,2)`);
    await run('at_cumulative_approved_amount', `ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS cumulative_approved_amount NUMERIC(12,2)`);
    await run('at_enhancement_alert_threshold', `ALTER TABLE admission_tracker ADD COLUMN IF NOT EXISTS enhancement_alert_threshold NUMERIC(12,2) DEFAULT 50000`);

    // 12e. Triggers for new billing tables
    for (const tbl of ['insurance_claims', 'discharge_milestones']) {
      await run(`trigger_${tbl}_drop`, `DROP TRIGGER IF EXISTS set_updated_at ON ${tbl}`);
      await run(`trigger_${tbl}_create`, `CREATE TRIGGER set_updated_at BEFORE UPDATE ON ${tbl} FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()`);
    }

    await run('billing_migration_record', `INSERT INTO _migrations (name) VALUES ('billing-integration-v1') ON CONFLICT (name) DO NOTHING`);

    // 9. Verify
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('patient_threads','form_submissions','readiness_items','escalation_log','admission_tracker','duty_roster','_migrations','deleted_messages','insurance_claims','claim_events','discharge_milestones')
      ORDER BY table_name
    `;

    const successCount = results.filter((r) => r.startsWith('✅')).length;
    const skipCount = results.filter((r) => r.startsWith('⏭')).length;
    const errorCount = results.filter((r) => r.startsWith('❌')).length;

    return NextResponse.json({
      success: errorCount === 0,
      data: {
        executed: successCount,
        skipped: skipCount,
        errors: errorCount,
        tables_found: tables.map((t) => t.table_name),
        log: results,
      },
      message: `Migration complete. ${successCount} executed, ${skipCount} skipped, ${errorCount} errors. ${tables.length}/11 tables found.`,
    });
  } catch (error) {
    console.error('POST /api/admin/migrate error:', error);
    const message = error instanceof Error ? error.message : 'Migration failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
