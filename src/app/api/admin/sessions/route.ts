// ============================================
// GET /api/admin/sessions
// Returns paginated session list with filters
// Protected: admin/super_admin only
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'admin')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sql = neon(process.env.POSTGRES_URL!);
    const { searchParams } = new URL(request.url);

    // Filters
    const department = searchParams.get('department');
    const search = searchParams.get('search');
    const dateFrom = searchParams.get('from');
    const dateTo = searchParams.get('to');
    const firstSessionOnly = searchParams.get('first_session') === 'true';
    const sortBy = searchParams.get('sort') || 'recent'; // recent, longest, most_pages
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);
    const offset = (page - 1) * limit;

    // Build WHERE clauses (pre-aggregate) and HAVING clauses (post-aggregate)
    const whereConditions: string[] = [];
    const havingConditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (department) {
      whereConditions.push(`d.slug = $${paramIdx}`);
      params.push(department);
      paramIdx++;
    }

    if (search) {
      whereConditions.push(`(p.full_name ILIKE $${paramIdx} OR p.email ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (dateFrom) {
      havingConditions.push(`MIN(se.created_at) >= $${paramIdx}::timestamptz`);
      params.push(dateFrom);
      paramIdx++;
    }

    if (dateTo) {
      havingConditions.push(`MAX(se.created_at) <= $${paramIdx}::timestamptz`);
      params.push(dateTo);
      paramIdx++;
    }

    if (firstSessionOnly) {
      // Use date-level comparison to avoid microsecond mismatches
      havingConditions.push(`DATE(MIN(se.created_at)) = DATE(p.first_login_at)`);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    const havingClause = havingConditions.length > 0 ? 'HAVING ' + havingConditions.join(' AND ') : '';

    // Sort
    let orderBy = 'MAX(se.created_at) DESC'; // recent
    if (sortBy === 'longest') orderBy = 'duration_seconds DESC NULLS LAST';
    if (sortBy === 'most_pages') orderBy = 'page_count DESC';

    // Session list query with aggregated metrics
    const sessionsQuery = `
      SELECT
        se.session_id,
        se.profile_id,
        p.full_name,
        p.email,
        p.avatar_url,
        d.name as department_name,
        d.slug as department_slug,
        MIN(se.created_at) as session_start,
        MAX(se.created_at) as session_end,
        EXTRACT(EPOCH FROM (MAX(se.created_at) - MIN(se.created_at)))::int as duration_seconds,
        COUNT(*) FILTER (WHERE se.event_type = 'page_view')::int as page_count,
        COUNT(*) FILTER (WHERE se.event_type = 'error_encountered')::int as error_count,
        COUNT(*)::int as total_events,
        CASE WHEN DATE(MIN(se.created_at)) = DATE(p.first_login_at) THEN true ELSE false END as is_first_session,
        ARRAY_AGG(DISTINCT se.page) FILTER (WHERE se.page IS NOT NULL) as pages_visited
      FROM session_events se
      JOIN profiles p ON se.profile_id = p.id
      LEFT JOIN departments d ON p.department_id = d.id
      ${whereClause}
      GROUP BY se.session_id, se.profile_id, p.full_name, p.email, p.avatar_url,
               d.name, d.slug, p.first_login_at
      ${havingClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    params.push(limit, offset);

    const sessions = await sql(sessionsQuery, params);

    // Count query — applies the same WHERE/HAVING filters for accurate pagination
    const countParams = params.slice(0, -2); // Remove limit and offset
    const countQuery = `
      SELECT COUNT(*)::int as total FROM (
        SELECT se.session_id
        FROM session_events se
        JOIN profiles p ON se.profile_id = p.id
        LEFT JOIN departments d ON p.department_id = d.id
        ${whereClause}
        GROUP BY se.session_id, p.first_login_at
        ${havingClause}
      ) counted
    `;
    const countResult = await sql(countQuery, countParams);

    return NextResponse.json({
      success: true,
      data: {
        sessions: sessions.map((s: any) => ({
          session_id: s.session_id,
          profile_id: s.profile_id,
          full_name: s.full_name,
          email: s.email,
          avatar_url: s.avatar_url,
          department_name: s.department_name,
          department_slug: s.department_slug,
          session_start: s.session_start,
          session_end: s.session_end,
          duration_seconds: s.duration_seconds || 0,
          page_count: s.page_count,
          error_count: s.error_count,
          total_events: s.total_events,
          is_first_session: s.is_first_session,
          pages_visited: s.pages_visited || [],
        })),
        pagination: {
          page,
          limit,
          total: countResult[0]?.total || 0,
          totalPages: Math.ceil((countResult[0]?.total || 0) / limit),
        },
      },
    });
  } catch (error) {
    console.error('GET /api/admin/sessions error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}
