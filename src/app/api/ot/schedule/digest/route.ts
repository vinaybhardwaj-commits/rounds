// ============================================
// POST /api/ot/schedule/digest
// Cron: post daily OT digest to #ot-schedule
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { withTenancy } from '@/lib/with-tenancy';
import { query } from '@/lib/db';
import { sendSystemMessage } from '@/lib/getstream';

export const POST = withTenancy('/api/ot/schedule/digest', async (request: NextRequest, ctx) => {
  try {
    // Cron endpoint — super_admin gated
    if (ctx.user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden: super_admin only' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    // Default to today (IST)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    const date = body.date || istDate.toISOString().split('T')[0];

    // Get schedule filtered to accessible hospitals
    const schedule = await query(
      `SELECT sp.* FROM surgery_postings sp
       JOIN patient_threads pt ON pt.id = sp.patient_thread_id
       WHERE sp.scheduled_date = $1::date
       AND pt.hospital_id = ANY($2::uuid[])
       ORDER BY sp.scheduled_time ASC, sp.id`,
      [date, ctx.accessibleHospitalIds]
    );

    const stats = await query(
      `SELECT
         COUNT(*) FILTER (WHERE sp.status = 'posted') as total,
         COUNT(*) FILTER (WHERE sp.status = 'completed') as ready
       FROM surgery_postings sp
       JOIN patient_threads pt ON pt.id = sp.patient_thread_id
       WHERE sp.scheduled_date = $1::date
       AND pt.hospital_id = ANY($2::uuid[])`,
      [date, ctx.accessibleHospitalIds]
    );

    const statsData = stats[0] as any || { total: 0, ready: 0 };

    if (statsData.total === 0) {
      return NextResponse.json({ success: true, data: { message: 'No surgeries scheduled', date } });
    }

    const lines = [
      `📋 OT DAILY DIGEST — ${date}`,
      `${statsData.total} surgeries | ✅ ${statsData.ready} ready | 🟡 ${statsData.partial} partial | 🔴 ${statsData.not_ready + statsData.blocked} not ready`,
      '',
    ];

    for (const s of schedule) {
      const readinessIcon = s.overall_readiness === 'ready' ? '🟢' : s.overall_readiness === 'partial' ? '🟡' : '🔴';
      lines.push(`${readinessIcon} OT${s.ot_room} ${s.scheduled_time || '—'} | ${s.procedure_name} — ${s.primary_surgeon_name} | ${(s as any).readiness_confirmed}/${(s as any).readiness_total}`);
    }

    const msg = lines.join('\n');

    try {
      await sendSystemMessage('cross-functional', 'ot-schedule', msg);
    } catch (err) {
      console.error('[OT] Digest system message failed:', err);
    }

    return NextResponse.json({ success: true, data: { date, message: msg, stats: statsData } });
  } catch (error) {
    console.error('POST /api/ot/schedule/digest error:', error);
    return NextResponse.json({ success: false, error: 'Digest failed' }, { status: 500 });
  }
});
