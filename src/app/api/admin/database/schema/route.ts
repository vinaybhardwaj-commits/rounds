// ============================================
// GET /api/admin/database/schema
// Returns table list with row counts and column info
// Protected: super_admin only
// ============================================

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);

    // ── 1. Get all tables with estimated row counts ──
    const tables = await sql(`
      SELECT
        c.relname as table_name,
        c.reltuples::bigint as estimated_rows,
        pg_total_relation_size(c.oid) as total_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY c.relname
    `);

    // ── 2. Get column info for all public tables ──
    const columns = await sql(`
      SELECT
        table_name,
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);

    // Group columns by table
    const columnsByTable = new Map<string, any[]>();
    for (const col of columns) {
      if (!columnsByTable.has(col.table_name)) {
        columnsByTable.set(col.table_name, []);
      }
      columnsByTable.get(col.table_name)!.push({
        name: col.column_name,
        type: col.data_type,
        max_length: col.character_maximum_length,
        nullable: col.is_nullable === 'YES',
        default_value: col.column_default,
      });
    }

    // ── 3. Get indexes ──
    let indexes: any[] = [];
    try {
      indexes = await sql(`
        SELECT
          t.relname as table_name,
          i.relname as index_name,
          pg_get_indexdef(ix.indexrelid) as index_def
        FROM pg_index ix
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY t.relname, i.relname
      `);
    } catch { /* skip */ }

    const indexesByTable = new Map<string, any[]>();
    for (const idx of indexes) {
      if (!indexesByTable.has(idx.table_name)) {
        indexesByTable.set(idx.table_name, []);
      }
      indexesByTable.get(idx.table_name)!.push({
        name: idx.index_name,
        definition: idx.index_def,
      });
    }

    // ── 4. Get recent query audit log (for the DB Explorer) ──
    let recentQueries: any[] = [];
    try {
      recentQueries = await sql(`
        SELECT
          aql.query_text,
          aql.row_count,
          aql.execution_ms,
          aql.created_at,
          p.full_name
        FROM admin_query_log aql
        LEFT JOIN profiles p ON aql.profile_id = p.id
        ORDER BY aql.created_at DESC
        LIMIT 20
      `);
    } catch { /* skip */ }

    // Format file sizes
    function formatBytes(bytes: number): string {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    return NextResponse.json({
      success: true,
      data: {
        tables: tables.map((t: any) => ({
          name: t.table_name,
          estimated_rows: Number(t.estimated_rows),
          total_size: formatBytes(Number(t.total_bytes)),
          total_bytes: Number(t.total_bytes),
          columns: columnsByTable.get(t.table_name) || [],
          indexes: indexesByTable.get(t.table_name) || [],
        })),
        recent_queries: recentQueries.map((q: any) => ({
          query: q.query_text,
          row_count: q.row_count,
          execution_ms: q.execution_ms,
          created_at: q.created_at,
          run_by: q.full_name,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/admin/database/schema error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch schema' },
      { status: 500 }
    );
  }
}
