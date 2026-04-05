// Temporary verification endpoint for Admin Intelligence Phase 1
// DELETE THIS FILE after verification is complete

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);

    // 1. Check lifecycle fields on profiles
    const profiles = await sql(`
      SELECT full_name, role, first_login_at, last_active_at, login_count, total_session_seconds
      FROM profiles
      WHERE first_login_at IS NOT NULL
      ORDER BY last_active_at DESC NULLS LAST
      LIMIT 5
    `);

    // 2. Check llm_logs
    const llmLogs = await sql(`
      SELECT id, route, analysis_type, model, status, latency_ms, tokens_prompt, tokens_completion, created_at
      FROM llm_logs
      ORDER BY created_at DESC
      LIMIT 5
    `);

    // 3. Count rows in new tables
    const llmCount = await sql(`SELECT COUNT(*) as count FROM llm_logs`);
    const queryCount = await sql(`SELECT COUNT(*) as count FROM admin_query_log`);
    const chatCount = await sql(`SELECT COUNT(*) as count FROM chat_activity_log`);

    // 4. Check migration record
    const migration = await sql(`SELECT * FROM _migrations WHERE name = 'v18-admin-intelligence-phase1'`);

    // 5. Profile with most sessions (backfill check)
    const topUser = await sql(`
      SELECT full_name, login_count, total_session_seconds, first_login_at, last_active_at
      FROM profiles
      WHERE login_count IS NOT NULL AND login_count > 0
      ORDER BY login_count DESC
      LIMIT 3
    `);

    return NextResponse.json({
      success: true,
      lifecycle_profiles: profiles,
      llm_logs_recent: llmLogs,
      table_counts: {
        llm_logs: llmCount[0]?.count,
        admin_query_log: queryCount[0]?.count,
        chat_activity_log: chatCount[0]?.count,
      },
      migration_record: migration,
      top_users_by_logins: topUser,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
