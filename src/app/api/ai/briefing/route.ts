// ============================================
// GET /api/ai/briefing — generate daily morning briefing
// POST /api/ai/briefing — force regenerate
// Step 8.2: AI Daily Briefing
// ============================================

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { generateDailyBriefing } from '@/lib/ai';
import { sql } from '@/lib/db';

// GET: return today's cached briefing or generate new one
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const today = new Date().toISOString().split('T')[0];

    // Check for cached briefing from today
    const cached = await sql`
      SELECT result, created_at FROM ai_analysis
      WHERE analysis_type = 'daily_briefing'
      AND created_at::date = ${today}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (cached.length > 0) {
      return NextResponse.json({
        success: true,
        data: cached[0].result,
        cached: true,
        generated_at: cached[0].created_at,
      });
    }

    // Generate new briefing
    const briefing = await generateDailyBriefing();
    return NextResponse.json({
      success: true,
      data: briefing,
      cached: false,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('GET /api/ai/briefing error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate briefing' },
      { status: 500 }
    );
  }
}

// POST: force regenerate
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'super_admin' && user.role !== 'department_head')) {
      return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 });
    }

    const briefing = await generateDailyBriefing();
    return NextResponse.json({
      success: true,
      data: briefing,
      cached: false,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('POST /api/ai/briefing error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate briefing' },
      { status: 500 }
    );
  }
}
