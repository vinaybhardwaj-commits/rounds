// ============================================
// POST /api/admin/migrate
// Runs the v5 migration SQL against Neon.
// Protected: super_admin only. Idempotent
// (uses IF NOT EXISTS and ON CONFLICT).
// ============================================

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function POST() {
  try {
    // Auth check — super_admin only
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: super_admin role required' },
        { status: 403 }
      );
    }

    const sql = neon(process.env.POSTGRES_URL!);

    // Read the migration SQL file
    const migrationPath = join(process.cwd(), 'src', 'lib', 'migration-v5-tables.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Split by semicolons and execute each statement
    // (Neon's HTTP driver doesn't support multi-statement in one call)
    const statements = migrationSQL
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    const results: string[] = [];
    let executed = 0;
    let skipped = 0;

    for (const stmt of statements) {
      try {
        await sql(stmt);
        executed++;
        // Extract a label from the statement
        const label =
          stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] ||
          stmt.match(/CREATE INDEX IF NOT EXISTS (\w+)/)?.[1] ||
          stmt.match(/CREATE OR REPLACE FUNCTION (\w+)/)?.[1] ||
          stmt.match(/INSERT INTO (\w+)/)?.[1] ||
          `statement ${executed}`;
        results.push(`✅ ${label}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Skip "already exists" errors
        if (msg.includes('already exists') || msg.includes('duplicate key')) {
          skipped++;
          results.push(`⏭ Skipped (already exists): ${msg.substring(0, 80)}`);
        } else {
          results.push(`❌ Error: ${msg.substring(0, 120)}`);
          // Don't abort — try remaining statements
        }
      }
    }

    // Verify tables exist
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('patient_threads','form_submissions','readiness_items','escalation_log','admission_tracker','duty_roster','_migrations')
      ORDER BY table_name
    `;

    return NextResponse.json({
      success: true,
      data: {
        statements_executed: executed,
        statements_skipped: skipped,
        total_statements: statements.length,
        tables_found: tables.map((t) => t.table_name),
        log: results,
      },
      message: `Migration complete. ${executed} executed, ${skipped} skipped. ${tables.length} v5 tables found.`,
    });
  } catch (error) {
    console.error('POST /api/admin/migrate error:', error);
    const message = error instanceof Error ? error.message : 'Migration failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
