// ============================================
// POST /api/ot/schedule/digest
// Cron: post daily OT digest to #ot-schedule
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getOTSchedule, getOTScheduleStats } from '@/lib/ot/surgery-postings';
import { sendSystemMessage } from '@/lib/getstream';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'super_admin') {
      return NextResponse.json({ success: false, error: 'Forbidden: super_admin only' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    // Default to today (IST)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    const date = body.date || istDate.toISOString().split('T')[0];

    const [schedule, stats] = await Promise.all([
      getOTSchedule(date),
      getOTScheduleStats(date),
    ]);

    if (stats.total === 0) {
      return NextResponse.json({ success: true, data: { message: 'No surgeries scheduled', date } });
    }

    // Build digest message
    const lines = [
      `📋 OT DAILY DIGEST — ${date}`,
      `${stats.total} surgeries | ✅ ${stats.ready} ready | 🟡 ${stats.partial} partial | 🔴 ${stats.not_ready + stats.blocked} not ready`,
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

    return NextResponse.json({ success: true, data: { date, message: msg, stats } });
  } catch (error) {
    console.error('POST /api/ot/schedule/digest error:', error);
    return NextResponse.json({ success: false, error: 'Digest failed' }, { status: 500 });
  }
}
