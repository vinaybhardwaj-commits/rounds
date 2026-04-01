// ============================================
// POST /api/admin/migrate-lsq
// Runs the LeadSquared integration migration.
// Adds LSQ-specific columns to patient_threads
// and creates sync log + activity cache tables.
// Protected: super_admin only. Idempotent.
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

    const run = async (label: string, statement: string) => {
      try {
        await sql(statement);
        results.push(`\u2705 ${label}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists')) {
          results.push(`\u2139\ufe0f ${label} (already exists)`);
        } else {
          results.push(`\u274c ${label}: ${msg}`);
        }
      }
    };

    // ---- Patient Threads: LSQ fields ----
    await run('Add lsq_lead_id', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_lead_id VARCHAR(100)');
    await run('Add lsq_prospect_auto_id', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_prospect_auto_id VARCHAR(20)');
    await run('Add phone', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS phone VARCHAR(30)');
    await run('Add whatsapp_number', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(30)');
    await run('Add email', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS email VARCHAR(200)');
    await run('Add gender', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS gender VARCHAR(20)');
    await run('Add age', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS age INTEGER');
    await run('Add date_of_birth', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS date_of_birth DATE');
    await run('Add city', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS city VARCHAR(100)');
    await run('Add state', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS state VARCHAR(100)');
    await run('Add address', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS address TEXT');
    await run('Add zip', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS zip VARCHAR(20)');
    await run('Add ailment', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS ailment VARCHAR(200)');
    await run('Add doctor_name', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS doctor_name VARCHAR(200)');
    await run('Add appointment_date', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS appointment_date TIMESTAMPTZ');
    await run('Add hospital_location', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS hospital_location VARCHAR(200)');
    await run('Add surgery_order_value', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS surgery_order_value NUMERIC(12,2)');
    await run('Add financial_category', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS financial_category VARCHAR(20)');
    await run('Add utm_source', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS utm_source VARCHAR(200)');
    await run('Add utm_campaign', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(500)');
    await run('Add utm_medium', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(200)');
    await run('Add signup_url', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS signup_url TEXT');
    await run('Add lsq_owner_name', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_owner_name VARCHAR(200)');
    await run('Add lsq_owner_email', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_owner_email VARCHAR(200)');
    await run('Add lsq_lead_stage', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_lead_stage VARCHAR(50)');
    await run('Add lsq_created_on', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_created_on TIMESTAMPTZ');
    await run('Add lsq_last_synced_at', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS lsq_last_synced_at TIMESTAMPTZ');
    await run('Add archived_at', 'ALTER TABLE patient_threads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ');

    // ---- Indexes ----
    await run('Index lsq_lead_id (unique)', 'CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_threads_lsq_lead_id ON patient_threads(lsq_lead_id) WHERE lsq_lead_id IS NOT NULL');
    await run('Index phone', 'CREATE INDEX IF NOT EXISTS idx_patient_threads_phone ON patient_threads(phone) WHERE phone IS NOT NULL');
    await run('Index lsq_stage', 'CREATE INDEX IF NOT EXISTS idx_patient_threads_lsq_stage ON patient_threads(lsq_lead_stage) WHERE lsq_lead_stage IS NOT NULL');

    // ---- LSQ Sync Log Table ----
    await run('Create lsq_sync_log', `CREATE TABLE IF NOT EXISTS lsq_sync_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sync_type VARCHAR(20) NOT NULL CHECK (sync_type IN ('webhook', 'poll', 'manual')),
      trigger_stage VARCHAR(50),
      leads_found INTEGER NOT NULL DEFAULT 0,
      leads_created INTEGER NOT NULL DEFAULT 0,
      leads_updated INTEGER NOT NULL DEFAULT 0,
      leads_skipped INTEGER NOT NULL DEFAULT 0,
      errors JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      duration_ms INTEGER
    )`);
    await run('Index lsq_sync_log', 'CREATE INDEX IF NOT EXISTS idx_lsq_sync_log_type ON lsq_sync_log(sync_type, started_at DESC)');

    // ---- LSQ Activity Cache Table ----
    await run('Create lsq_activity_cache', `CREATE TABLE IF NOT EXISTS lsq_activity_cache (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_thread_id UUID NOT NULL REFERENCES patient_threads(id) ON DELETE CASCADE,
      lsq_lead_id VARCHAR(100) NOT NULL,
      activity_type VARCHAR(100),
      activity_event_code INTEGER,
      activity_data JSONB,
      activity_date TIMESTAMPTZ,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await run('Index activity_cache patient', 'CREATE INDEX IF NOT EXISTS idx_lsq_activity_cache_patient ON lsq_activity_cache(patient_thread_id)');
    await run('Index activity_cache lead', 'CREATE INDEX IF NOT EXISTS idx_lsq_activity_cache_lead ON lsq_activity_cache(lsq_lead_id)');

    // ---- LSQ API Call Log Table ----
    await run('Create lsq_api_log', `CREATE TABLE IF NOT EXISTS lsq_api_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      endpoint VARCHAR(200) NOT NULL,
      method VARCHAR(10) NOT NULL DEFAULT 'GET',
      request_body JSONB,
      response_status INTEGER NOT NULL DEFAULT 0,
      response_body JSONB,
      error_message TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      sync_run_id UUID REFERENCES lsq_sync_log(id) ON DELETE SET NULL,
      lead_id VARCHAR(100),
      call_type VARCHAR(30) NOT NULL DEFAULT 'other' CHECK (call_type IN ('get_lead', 'search_leads', 'get_activities', 'webhook_receive', 'other')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await run('Index api_log sync_run', 'CREATE INDEX IF NOT EXISTS idx_lsq_api_log_sync_run ON lsq_api_log(sync_run_id)');
    await run('Index api_log created', 'CREATE INDEX IF NOT EXISTS idx_lsq_api_log_created ON lsq_api_log(created_at DESC)');
    await run('Index api_log errors', 'CREATE INDEX IF NOT EXISTS idx_lsq_api_log_errors ON lsq_api_log(created_at DESC) WHERE response_status >= 400 OR error_message IS NOT NULL');

    // ---- Migration record ----
    await run('Record migration', "INSERT INTO _migrations (name) VALUES ('lsq-integration-v1') ON CONFLICT (name) DO NOTHING");

    return NextResponse.json({
      success: true,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Migrate LSQ] Error:', error);
    return NextResponse.json(
      { success: false, error: `Migration failed: ${error}` },
      { status: 500 }
    );
  }
}
