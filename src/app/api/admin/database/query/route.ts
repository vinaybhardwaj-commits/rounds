// ============================================
// POST /api/admin/database/query
// Execute read-only SQL queries against the database
// Protected: super_admin only
// All queries are logged to admin_query_log
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Whitelist of allowed SQL statement types
const FORBIDDEN_PATTERNS = [
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b/i,
  /\b(EXEC|EXECUTE)\b/i,
  /\bINTO\s+OUTFILE\b/i,
  /;\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)/i,
  /--/,  // SQL comments that could hide malicious code
];

function isSafeQuery(query: string): { safe: boolean; reason?: string } {
  const trimmed = query.trim();

  // Must start with SELECT or WITH (CTEs)
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
    return { safe: false, reason: 'Only SELECT queries are allowed' };
  }

  // Check for forbidden patterns
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { safe: false, reason: `Query contains forbidden operation: ${pattern.source}` };
    }
  }

  // Limit result size — enforce LIMIT if not present
  if (!/\bLIMIT\b/i.test(trimmed)) {
    return { safe: false, reason: 'Query must include a LIMIT clause (max 500 rows)' };
  }

  // Check LIMIT value isn't too high
  const limitMatch = trimmed.match(/\bLIMIT\s+(\d+)/i);
  if (limitMatch && parseInt(limitMatch[1]) > 500) {
    return { safe: false, reason: 'LIMIT cannot exceed 500 rows' };
  }

  return { safe: true };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);
    const body = await request.json();
    const queryText = body.query?.trim();

    if (!queryText) {
      return NextResponse.json(
        { success: false, error: 'Query text is required' },
        { status: 400 }
      );
    }

    // Safety check
    const safety = isSafeQuery(queryText);
    if (!safety.safe) {
      // Log rejected query
      try {
        await sql(
          `INSERT INTO admin_query_log (profile_id, query_text, row_count, execution_ms)
           VALUES ($1, $2, -1, 0)`,
          [user.profileId, `[REJECTED] ${queryText}`]
        );
      } catch { /* skip */ }

      return NextResponse.json(
        { success: false, error: safety.reason },
        { status: 400 }
      );
    }

    // Execute the query
    const startMs = Date.now();
    let rows: any[] = [];
    let queryError: string | null = null;

    try {
      rows = await sql(queryText) as any[];
    } catch (err: any) {
      queryError = err.message || 'Query execution failed';
    }

    const executionMs = Date.now() - startMs;

    // Log the query (success or error)
    try {
      await sql(
        `INSERT INTO admin_query_log (profile_id, query_text, row_count, execution_ms)
         VALUES ($1, $2, $3, $4)`,
        [user.profileId, queryText, queryError ? -1 : rows.length, executionMs]
      );
    } catch { /* skip logging errors */ }

    if (queryError) {
      return NextResponse.json({
        success: false,
        error: queryError,
        execution_ms: executionMs,
      });
    }

    // Extract column names from first row
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return NextResponse.json({
      success: true,
      data: {
        columns,
        rows,
        row_count: rows.length,
        execution_ms: executionMs,
      },
    });
  } catch (error) {
    console.error('POST /api/admin/database/query error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to execute query' },
      { status: 500 }
    );
  }
}
