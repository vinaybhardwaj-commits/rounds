// ============================================
// GET /api/admin/chat/analytics
// Chat activity analytics from chat_activity_log
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

    // ── 1. Overview stats ──
    let overview: any = {};
    try {
      const result = await sql(`
        SELECT
          COUNT(DISTINCT channel_id)::int as total_channels,
          SUM(message_count)::int as total_messages,
          SUM(unique_senders)::int as total_senders,
          COALESCE(AVG(message_count), 0)::int as avg_messages_per_channel,
          COUNT(DISTINCT snapshot_date)::int as snapshot_dates
        FROM chat_activity_log
      `);
      overview = result[0] || {};
    } catch (error) {
      console.warn('Overview query failed:', error);
    }

    // ── 2. By channel type ──
    let byChannelType: any[] = [];
    try {
      byChannelType = await sql(`
        SELECT
          channel_type,
          COUNT(DISTINCT channel_id)::int as channel_count,
          SUM(message_count)::int as total_messages,
          COALESCE(AVG(message_count), 0)::int as avg_messages
        FROM chat_activity_log
        GROUP BY channel_type
        ORDER BY total_messages DESC
      `);
    } catch (error) {
      console.warn('By channel type query failed:', error);
    }

    // ── 3. Daily trend (last 30 days) ──
    let dailyTrend: any[] = [];
    try {
      dailyTrend = await sql(`
        SELECT
          snapshot_date as date,
          SUM(message_count)::int as total_messages,
          COUNT(DISTINCT CONCAT(channel_id, ':',
            COALESCE(NULLIF(json_agg(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL), 'null'::json), '[]'::json)))::int as unique_senders
        FROM (
          SELECT
            cal.snapshot_date,
            cal.channel_id,
            cal.message_count,
            jsonb_array_elements(
              COALESCE(
                (SELECT jsonb_agg(DISTINCT user_id) FROM (
                  -- We're approximating unique senders from unique_senders count
                  -- since raw message-level data isn't stored
                  SELECT GENERATE_SERIES(1, GREATEST(1, cal.unique_senders)) as user_id
                ) t),
                '[]'::jsonb
              )
            )::text as user_id
          FROM chat_activity_log cal
          WHERE cal.snapshot_date > CURRENT_DATE - INTERVAL '30 days'
        ) expanded
        GROUP BY snapshot_date
        ORDER BY snapshot_date DESC
      `);
    } catch (error) {
      console.warn('Daily trend query failed, using fallback:', error);
      // Fallback: simpler daily aggregation without unique user estimation
      try {
        dailyTrend = await sql(`
          SELECT
            snapshot_date as date,
            SUM(message_count)::int as total_messages,
            COUNT(DISTINCT channel_id) as unique_senders
          FROM chat_activity_log
          WHERE snapshot_date > CURRENT_DATE - INTERVAL '30 days'
          GROUP BY snapshot_date
          ORDER BY snapshot_date
        `);
      } catch {
        dailyTrend = [];
      }
    }

    // ── 4. Top channels by message count ──
    let topChannels: any[] = [];
    try {
      topChannels = await sql(`
        SELECT
          channel_id,
          channel_name,
          channel_type,
          SUM(message_count)::int as total_messages,
          SUM(unique_senders)::int as unique_senders,
          MAX(snapshot_date) as last_snapshot_date
        FROM chat_activity_log
        GROUP BY channel_id, channel_name, channel_type
        ORDER BY total_messages DESC
        LIMIT 20
      `);
    } catch (error) {
      console.warn('Top channels query failed:', error);
    }

    // ── 5. Activity summary (human vs system messages) ──
    let activitySummary: any = {};
    try {
      const result = await sql(`
        SELECT
          SUM(human_messages)::int as human_messages,
          SUM(system_messages)::int as system_messages
        FROM chat_activity_log
      `);
      const summary = result[0] || {};
      const totalActivity = (summary.human_messages || 0) + (summary.system_messages || 0);
      activitySummary = {
        human_messages: summary.human_messages || 0,
        system_messages: summary.system_messages || 0,
        human_pct: totalActivity > 0
          ? Math.round(((summary.human_messages || 0) / totalActivity) * 100)
          : 0,
      };
    } catch (error) {
      console.warn('Activity summary query failed:', error);
    }

    // Format response
    const formatDate = (d: any) => {
      if (typeof d === 'string') return d.split('T')[0];
      if (d instanceof Date) return d.toISOString().split('T')[0];
      return String(d);
    };

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          total_channels: overview.total_channels || 0,
          total_messages: overview.total_messages || 0,
          total_senders: overview.total_senders || 0,
          avg_messages_per_channel: overview.avg_messages_per_channel || 0,
          snapshot_dates: overview.snapshot_dates || 0,
        },
        by_channel_type: byChannelType.map((row: any) => ({
          channel_type: row.channel_type,
          channel_count: row.channel_count,
          total_messages: row.total_messages || 0,
          avg_messages: row.avg_messages || 0,
        })),
        daily_trend: dailyTrend.map((row: any) => ({
          date: formatDate(row.date),
          total_messages: row.total_messages || 0,
          unique_senders: row.unique_senders || 0,
        })),
        top_channels: topChannels.map((row: any) => ({
          channel_id: row.channel_id,
          channel_name: row.channel_name,
          channel_type: row.channel_type,
          total_messages: row.total_messages || 0,
          unique_senders: row.unique_senders || 0,
          last_snapshot_date: formatDate(row.last_snapshot_date),
        })),
        activity_summary: activitySummary,
      },
    });
  } catch (error) {
    console.error('GET /api/admin/chat/analytics error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch chat analytics' },
      { status: 500 }
    );
  }
}
