// ============================================
// ONE-TIME MIGRATION: Patient Changelog + New Stages + PAC
// DELETE THIS FILE AFTER RUNNING
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: string[] = [];

  try {
    // 1. Add pac_status column
    await query(`ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS pac_status VARCHAR(30) DEFAULT NULL`, []);
    results.push('✅ Added pac_status column');
  } catch (e: unknown) {
    results.push(`⚠️ pac_status column: ${(e as Error).message}`);
  }

  try {
    // 2. Drop old stage constraint
    await query(`ALTER TABLE patient_threads DROP CONSTRAINT IF EXISTS patient_threads_current_stage_check`, []);
    results.push('✅ Dropped old stage constraint');
  } catch (e: unknown) {
    results.push(`⚠️ Drop stage constraint: ${(e as Error).message}`);
  }

  try {
    // 3. Add new stage constraint with 11 stages
    await query(
      `ALTER TABLE patient_threads ADD CONSTRAINT patient_threads_current_stage_check
       CHECK (current_stage IN (
         'opd', 'pre_admission', 'admitted', 'pre_op', 'surgery',
         'post_op', 'discharge', 'post_discharge',
         'medical_management', 'post_op_care', 'long_term_followup'
       ))`,
      []
    );
    results.push('✅ Added new stage constraint (11 stages)');
  } catch (e: unknown) {
    results.push(`⚠️ New stage constraint: ${(e as Error).message}`);
  }

  try {
    // 4. Add pac_status constraint
    await query(
      `ALTER TABLE patient_threads ADD CONSTRAINT patient_threads_pac_status_check
       CHECK (pac_status IS NULL OR pac_status IN (
         'telemed_pac_pending', 'inpatient_pac_pending',
         'telemed_pac_passed', 'inpatient_pac_passed'
       ))`,
      []
    );
    results.push('✅ Added pac_status constraint');
  } catch (e: unknown) {
    results.push(`⚠️ pac_status constraint: ${(e as Error).message}`);
  }

  try {
    // 5. Create patient_changelog table
    await query(
      `CREATE TABLE IF NOT EXISTS patient_changelog (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_thread_id UUID NOT NULL REFERENCES patient_threads(id),
        change_type VARCHAR(30) NOT NULL
          CHECK (change_type IN ('stage_change', 'field_edit', 'pac_status_change', 'form_submission')),
        field_name VARCHAR(50),
        old_value TEXT,
        new_value TEXT,
        old_display TEXT,
        new_display TEXT,
        changed_by UUID NOT NULL REFERENCES profiles(id),
        changed_by_name VARCHAR(200),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      []
    );
    results.push('✅ Created patient_changelog table');
  } catch (e: unknown) {
    results.push(`⚠️ patient_changelog table: ${(e as Error).message}`);
  }

  try {
    // 6. Index: patient + created_at
    await query(`CREATE INDEX IF NOT EXISTS idx_changelog_patient ON patient_changelog(patient_thread_id, created_at DESC)`, []);
    results.push('✅ Created idx_changelog_patient');
  } catch (e: unknown) {
    results.push(`⚠️ idx_changelog_patient: ${(e as Error).message}`);
  }

  try {
    // 7. Index: change_type
    await query(`CREATE INDEX IF NOT EXISTS idx_changelog_type ON patient_changelog(change_type)`, []);
    results.push('✅ Created idx_changelog_type');
  } catch (e: unknown) {
    results.push(`⚠️ idx_changelog_type: ${(e as Error).message}`);
  }

  try {
    // 8. Index: created_at
    await query(`CREATE INDEX IF NOT EXISTS idx_changelog_created ON patient_changelog(created_at DESC)`, []);
    results.push('✅ Created idx_changelog_created');
  } catch (e: unknown) {
    results.push(`⚠️ idx_changelog_created: ${(e as Error).message}`);
  }

  return NextResponse.json({ success: true, results });
}
