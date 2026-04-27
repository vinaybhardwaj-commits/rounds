// ============================================
// GET /api/admin/dashboard-stats
// Returns all data needed for the Operations Dashboard landing page
// Protected: admin/super_admin only
// ============================================

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { getAdminHospitalScope, isAdminRole } from '@/lib/admin-hospital-scope';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdminRole(user.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const scope = await getAdminHospitalScope(user.role, user.primary_hospital_id ?? '');

    const sql = neon(process.env.POSTGRES_URL!);

    // ── 1. Lifecycle Funnel ──
    let funnel = {
      signed_up: 0,
      approved: 0,
      first_login: 0,
      active_7d: 0,
      regular_30d: 0,
    };

    try {
      const funnelData = await sql(`
        SELECT
          COUNT(*)::int as signed_up,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)::int as approved,
          SUM(CASE WHEN first_login_at IS NOT NULL THEN 1 ELSE 0 END)::int as first_login,
          SUM(CASE WHEN last_active_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int as active_7d,
          SUM(CASE WHEN login_count >= 5 AND last_active_at > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int as regular_30d
        FROM profiles
      `);

      if (funnelData && funnelData.length > 0) {
        funnel = {
          signed_up: funnelData[0].signed_up || 0,
          approved: funnelData[0].approved || 0,
          first_login: funnelData[0].first_login || 0,
          active_7d: funnelData[0].active_7d || 0,
          regular_30d: funnelData[0].regular_30d || 0,
        };
      }
    } catch (err) {
      console.error('Funnel query failed:', err);
    }

    // ── 2. Department Adoption Data (batch queries instead of per-dept) ──
    let departments: Array<{
      name: string;
      total_users: number;
      active_users: number;
      forms_submitted_7d: number;
      sparkline_14d: number[];
    }> = [];

    try {
      // Get all departments with user counts in a single query
      const deptUsers = await sql(`
        SELECT d.slug as name, COUNT(p.id)::int as total_users
        FROM departments d
        LEFT JOIN profiles p ON p.department_id = d.id AND p.status = 'active'
        WHERE d.is_active = true
        GROUP BY d.slug, d.name
        ORDER BY d.name
      `);

      // Get active users per department (7d) in a single query
      const deptActive = await sql(`
        SELECT d.slug as name, COUNT(DISTINCT se.profile_id)::int as active_users
        FROM departments d
        JOIN profiles p ON p.department_id = d.id
        JOIN session_events se ON se.profile_id = p.id AND se.created_at > NOW() - INTERVAL '7 days'
        WHERE d.is_active = true
        GROUP BY d.slug
      `);

      // Get forms per department (7d) in a single query
      let deptForms: Array<{ name: string; forms: number }> = [];
      try {
        const formsResult = await sql(`
          SELECT d.slug as name, COUNT(fs.id)::int as forms
          FROM departments d
          JOIN profiles p ON p.department_id = d.id
          JOIN form_submissions fs ON fs.submitted_by = p.id AND fs.created_at > NOW() - INTERVAL '7 days'
          WHERE d.is_active = true
          GROUP BY d.slug
        `);
        deptForms = formsResult as any;
      } catch {
        // form_submissions may not have submitted_by, try department_id
        try {
          const formsResult2 = await sql(`
            SELECT d.slug as name, COUNT(fs.id)::int as forms
            FROM departments d
            JOIN form_submissions fs ON fs.department_id = d.id AND fs.created_at > NOW() - INTERVAL '7 days'
            WHERE d.is_active = true
            GROUP BY d.slug
          `);
          deptForms = formsResult2 as any;
        } catch { /* skip */ }
      }

      // Get 14-day sparkline data in a single query
      const sparklineData = await sql(`
        SELECT d.slug as name, DATE(se.created_at) as date, COUNT(*)::int as count
        FROM departments d
        JOIN profiles p ON p.department_id = d.id
        JOIN session_events se ON se.profile_id = p.id AND se.created_at > NOW() - INTERVAL '14 days'
        WHERE d.is_active = true
        GROUP BY d.slug, DATE(se.created_at)
        ORDER BY d.slug, date
      `);

      // Build lookup maps
      const activeMap = new Map<string, number>();
      for (const row of deptActive) activeMap.set(row.name, row.active_users);

      const formsMap = new Map<string, number>();
      for (const row of deptForms) formsMap.set(row.name, row.forms);

      const sparkMap = new Map<string, Map<string, number>>();
      for (const row of sparklineData) {
        if (!sparkMap.has(row.name)) sparkMap.set(row.name, new Map());
        const dateStr = typeof row.date === 'string' ? row.date.split('T')[0] : new Date(row.date).toISOString().split('T')[0];
        sparkMap.get(row.name)!.set(dateStr, row.count);
      }

      // Assemble department data
      const today = new Date();
      departments = (deptUsers as any[]).map(dept => {
        const deptSparkMap = sparkMap.get(dept.name) || new Map();
        const sparkline: number[] = [];
        for (let i = 13; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          sparkline.push(deptSparkMap.get(d.toISOString().split('T')[0]) || 0);
        }

        return {
          name: dept.name,
          total_users: dept.total_users || 0,
          active_users: activeMap.get(dept.name) || 0,
          forms_submitted_7d: formsMap.get(dept.name) || 0,
          sparkline_14d: sparkline,
        };
      });
    } catch (err) {
      console.error('Department query failed:', err);
    }

    // ── 3. Adoption Insight Signals ──
    const signals: Array<{
      type: string;
      icon: string;
      message: string;
      action: string;
      severity: 'info' | 'warning' | 'critical';
      count?: number;
    }> = [];

    try {
      // Signal 1: Approved but never logged in (3+ days)
      const notLoggedInResult = await sql(`
        SELECT COUNT(*)::int as count
        FROM profiles
        WHERE status = 'active' AND first_login_at IS NULL AND approved_at < NOW() - INTERVAL '3 days'
      `);
      if (notLoggedInResult[0]?.count > 0) {
        signals.push({
          type: 'never_logged_in',
          icon: '⚠️',
          message: `${notLoggedInResult[0].count} users approved but never logged in`,
          action: 'Send activation reminder',
          severity: 'warning',
          count: notLoggedInResult[0].count,
        });
      }
    } catch {
      // Silently skip
    }

    try {
      // Signal 2: Department gone dark (has users but no activity in 7 days)
      const darkDeptResult = await sql(`
        SELECT d.name, d.slug
        FROM departments d
        WHERE d.is_active = true
          AND EXISTS (
            SELECT 1 FROM profiles p WHERE p.department_id = d.id AND p.status = 'active'
          )
          AND NOT EXISTS (
            SELECT 1 FROM session_events se
            JOIN profiles p ON se.profile_id = p.id
            WHERE p.department_id = d.id
              AND se.created_at > NOW() - INTERVAL '7 days'
          )
        LIMIT 5
      `);

      for (const dept of darkDeptResult) {
        signals.push({
          type: 'department_dark',
          icon: '🔇',
          message: `${dept.name} department has no activity in last 7 days`,
          action: 'Check team engagement',
          severity: 'warning',
        });
      }
    } catch {
      // Silently skip
    }

    try {
      // Signal 3: Bounce first session (login_count = 1, session < 60s)
      const bounceResult = await sql(`
        SELECT COUNT(*)::int as count
        FROM profiles
        WHERE login_count = 1 AND total_session_seconds < 60
      `);
      if (bounceResult[0]?.count > 0) {
        signals.push({
          type: 'bounce_first_session',
          icon: '🚪',
          message: `${bounceResult[0].count} users bounced on first session (< 1 min)`,
          action: 'Review onboarding UX',
          severity: 'info',
          count: bounceResult[0].count,
        });
      }
    } catch {
      // Silently skip
    }

    try {
      // Signal 4: Help gap (searches with 0 results, grouped by query)
      const helpGapResult = await sql(`
        SELECT question, COUNT(*)::int as count
        FROM help_interactions
        WHERE response_source = 'no-match'
        AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY question
        ORDER BY count DESC
        LIMIT 3
      `);

      if (helpGapResult.length > 0) {
        signals.push({
          type: 'help_gap',
          icon: '❓',
          message: `${helpGapResult.length} help topics with no matches (${helpGapResult[0].count} searches)`,
          action: 'Add knowledge articles',
          severity: 'info',
        });
      }
    } catch {
      // Silently skip
    }

    try {
      // Signal 5: Form drop-off (high draft ratio)
      const dropOffResult = await sql(`
        SELECT
          COUNT(CASE WHEN status = 'draft' THEN 1 END)::int as drafts,
          COUNT(CASE WHEN status = 'submitted' THEN 1 END)::int as submitted
        FROM form_submissions
        WHERE created_at > NOW() - INTERVAL '7 days'
      `);

      if (dropOffResult[0] && dropOffResult[0].submitted > 0) {
        const dropRate =
          (dropOffResult[0].drafts / (dropOffResult[0].drafts + dropOffResult[0].submitted)) * 100;
        if (dropRate > 25) {
          signals.push({
            type: 'form_dropoff',
            icon: '📋',
            message: `Form abandonment rate: ${Math.round(dropRate)}%`,
            action: 'Simplify form flow',
            severity: dropRate > 50 ? 'critical' : 'warning',
          });
        }
      }
    } catch {
      // Silently skip
    }

    // ── 4. Error Summary (last 5 grouped incidents) ──
    let errorsSummary: Array<{
      message: string;
      count: number;
      affected_users: number;
      severity: string;
      last_seen: string;
    }> = [];

    try {
      const errorsResult = await sql(`
        SELECT
          SUBSTRING(message FROM 1 FOR 100) as message,
          severity,
          COUNT(*)::int as count,
          COUNT(DISTINCT profile_id)::int as affected_users,
          MAX(created_at) as last_seen
        FROM app_errors
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY SUBSTRING(message FROM 1 FOR 100), severity
        ORDER BY count DESC
        LIMIT 5
      `);

      errorsSummary = errorsResult.map((row: any) => ({
        message: row.message,
        count: row.count,
        affected_users: row.affected_users,
        severity: row.severity,
        is_new: row.count <= 2, // Flag as "new" if only 1-2 occurrences
        last_seen: row.last_seen,
      }));
    } catch (err) {
      console.error('Error summary query failed:', err);
    }

    // ── 5. LLM Recent Calls (last 8) ──
    let llmRecent: Array<{
      analysis_type: string;
      model: string;
      status: string;
      latency_ms: number;
      created_at: string;
      triggered_by_email?: string;
    }> = [];

    try {
      const llmResult = await sql(`
        SELECT
          ll.id,
          ll.analysis_type,
          ll.model,
          ll.status,
          ll.latency_ms,
          ll.tokens_prompt,
          ll.tokens_completion,
          ll.created_at,
          p.email as triggered_by_email
        FROM llm_logs ll
        LEFT JOIN profiles p ON ll.triggered_by = p.id
        ORDER BY ll.created_at DESC
        LIMIT 8
      `);

      llmRecent = llmResult.map((row: any) => ({
        id: row.id,
        analysis_type: row.analysis_type,
        model: row.model,
        status: row.status,
        latency_ms: row.latency_ms,
        tokens_prompt: row.tokens_prompt || 0,
        tokens_completion: row.tokens_completion || 0,
        created_at: row.created_at,
        triggered_by_email: row.triggered_by_email,
      }));
    } catch (err) {
      console.error('LLM recent query failed:', err);
    }

    // ── 6. Health Indicators ──
    let health = {
      active_sessions: 0,
      forms_today: 0,
      forms_yesterday: 0,
      error_count_1h: 0,
      error_sparkline_6h: [0, 0, 0, 0, 0, 0] as number[],
    };

    try {
      // Active sessions (session_start in last 24h, grouped by unique session_id)
      const activeSessions = await sql(`
        SELECT COUNT(DISTINCT session_id)::int as count
        FROM session_events
        WHERE event_type = 'session_start'
        AND created_at > NOW() - INTERVAL '24 hours'
      `);
      health.active_sessions = activeSessions[0]?.count || 0;
    } catch {
      // Silently skip
    }

    try {
      // Forms today
      const formsToday = await sql(`
        SELECT COUNT(*)::int as count
        FROM form_submissions
        WHERE DATE(created_at) = DATE(NOW())
      `);
      health.forms_today = formsToday[0]?.count || 0;
    } catch {
      // Silently skip
    }

    try {
      // Errors in last hour
      const errorsLastHour = await sql(`
        SELECT COUNT(*)::int as count
        FROM app_errors
        WHERE created_at > NOW() - INTERVAL '1 hour'
      `);
      health.error_count_1h = errorsLastHour[0]?.count || 0;
    } catch {
      // Silently skip
    }

    try {
      // Forms yesterday
      const formsYesterday = await sql(`
        SELECT COUNT(*)::int as count
        FROM form_submissions
        WHERE DATE(created_at) = DATE(NOW() - INTERVAL '1 day')
      `);
      health.forms_yesterday = formsYesterday[0]?.count || 0;
    } catch {
      // Silently skip
    }

    try {
      // Error sparkline (6 hourly buckets)
      const sparkResult = await sql(`
        SELECT
          EXTRACT(HOUR FROM created_at)::int as hour,
          COUNT(*)::int as count
        FROM app_errors
        WHERE created_at > NOW() - INTERVAL '6 hours'
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY hour
      `);
      const now = new Date();
      const sparkline: number[] = [];
      for (let i = 5; i >= 0; i--) {
        const h = (now.getHours() - i + 24) % 24;
        const row = sparkResult.find((r: any) => r.hour === h);
        sparkline.push(row?.count || 0);
      }
      health.error_sparkline_6h = sparkline;
    } catch {
      // Silently skip
    }

    return NextResponse.json({
      success: true,
      data: {
        funnel,
        departments,
        signals,
        errors_summary: errorsSummary,
        llm_recent: llmRecent,
        health,
      },
    });
  } catch (error) {
    console.error('GET /api/admin/dashboard-stats error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch dashboard stats' }, { status: 500 });
  }
}
